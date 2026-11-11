// Horizon — Open Roads. Boot, game state machine and frame loop.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Assets } from './core/assets';
import { Input } from './core/input';
import { clamp, damp } from './core/noise';
import { Quality, Save } from './core/save';
import { Activities, KIND_COLOR } from './game/activities';
import { GameAudio } from './game/audio';
import { CAM_NAMES, CameraRig } from './game/camera';
import { Effects } from './game/effects';
import { UI } from './ui/ui';
import { CarVisual } from './vehicle/carVisual';
import { CarInput, CarPhysics } from './vehicle/physics';
import { carById, CARS } from './vehicle/specs';
import { Colliders, Ground } from './world/ground';
import { ACTIVITIES, ActivityDef, biomeAt, START } from './world/layout';
import { Props } from './world/props';
import { RoadMeshes } from './world/roadMesh';
import { F_TUNNEL, RoadNetwork, STEP } from './world/roads';
import { Environment } from './world/sky';
import { HeightField, Terrain } from './world/terrain';

type State = 'loading' | 'menu' | 'garage' | 'drive' | 'paused' | 'results';
const QUALITY: Record<Quality, { pr: number; shadow: number; shadowRange: number; lod: number; range: number; near: number; bloom: boolean }> = {
  low: { pr: 0.7, shadow: 0, shadowRange: 60, lod: 0.55, range: 0.5, near: 100, bloom: false },
  medium: { pr: 1.0, shadow: 1024, shadowRange: 70, lod: 0.8, range: 0.75, near: 125, bloom: false },
  high: { pr: 1.5, shadow: 2048, shadowRange: 105, lod: 1.1, range: 1.0, near: 215, bloom: true },
};
const nextFrame = () => new Promise<void>(r => setTimeout(r, 24));
const H = 1 / 120;

class Game {
  save = new Save();
  ui!: UI; input = new Input(); audio = new GameAudio(); assets = new Assets();
  renderer!: THREE.WebGLRenderer; scene = new THREE.Scene(); composer: EffectComposer | null = null; bloom: UnrealBloomPass | null = null;
  net!: RoadNetwork; hf!: HeightField; ground!: Ground; colliders = new Colliders();
  terrain!: Terrain; roads!: RoadMeshes; props!: Props; env!: Environment; rig!: CameraRig; fx = new Effects(); acts!: Activities;
  car!: CarPhysics; vis!: CarVisual;
  state: State = 'loading';
  private inp: CarInput = { accel: 0, decel: 0, steer: 0, handbrake: false, boost: false };
  /** optional scripted input for automated QA */ debugInput: Partial<CarInput> | null = null;
  private acc = 0; private last = 0; private dyn = 1; private ema = 16; private slowT = 0; private fastT = 0; private basePR = 1;
  private tunnel = 0; private offRouteT = 0; private lastEvent: ActivityDef | null = null; private previewId = '';
  private tunnelLight = new THREE.PointLight(0xffb070, 0, 46, 1.6); private blob!: THREE.Mesh;
  private biome: [number, number, number] = [1, 0, 0]; private saveT = 0; private lastLevel = 1; private miniT = 0;
  fps = 60; frames = 0; skipRender = false;

  async boot() {
    const canvas = document.getElementById('game') as HTMLCanvasElement;
    this.ui = new UI(this.save, {
      drive: () => this.enterDrive(), openGarage: () => this.enterGarage(), selectCar: id => { this.save.data.car = id; this.save.write(); this.setCar(id); this.enterDrive(); },
      buyCar: id => this.buyCar(id), previewCar: id => this.setCar(id), paint: c => this.setPaint(c),
      resume: () => this.enterDrive(), restartEvent: () => { if (this.acts.active) this.startEvent(this.acts.active); }, quitEvent: () => { this.acts.quit(this.car); this.enterDrive(); },
      toMenu: () => this.enterMenu(), travel: d => this.travel(d), settingsChanged: () => this.applySettings(), resetSave: () => { this.save.reset(); this.save.write(); location.reload(); },
      sound: k => { this.audio.start(); if (k === 'hover') this.audio.uiHover(); else if (k === 'select') this.audio.uiSelect(); else if (k === 'back') this.audio.uiBack(); else this.audio.uiDeny(); },
      retry: () => { if (this.lastEvent) this.startEvent(this.lastEvent); },
    });
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    } catch { this.ui.setProgress(0, 'WebGL is not available in this browser'); return; }
    const r = this.renderer;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.outputColorSpace = THREE.SRGBColorSpace; r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap;
    this.assets.maxAniso = Math.min(8, r.capabilities.getMaxAnisotropy());
    this.assets.onProgress = (f, l) => this.ui.setProgress(f * 0.55, 'Loading ' + l.replace(/\.(webp|glb|hdr)$/, '').replace(/_/g, ' '));
    await this.assets.loadAll();
    if (!this.assets.models.concept) { this.ui.setProgress(0.5, 'Could not load game assets. Check your connection and reload.'); return; }

    this.ui.setProgress(0.58, 'Surveying roads'); await nextFrame(); await nextFrame();
    this.net = new RoadNetwork();
    this.ui.setProgress(0.62, 'Raising mountains'); await nextFrame(); await nextFrame();
    this.hf = new HeightField(this.net); this.ground = new Ground(this.hf, this.net);
    this.ui.setProgress(0.74, 'Laying tarmac'); await nextFrame(); await nextFrame();
    const T = this.assets.tex;
    this.terrain = new Terrain(this.hf, { sand: T.red_sand, sandN: T.red_sand_n, forest: T.forest_ground_04, forestN: T.forest_ground_04_n, rock: T.cliff_side, rockN: T.cliff_side_n, grass: T.aerial_grass_rock });
    this.roads = new RoadMeshes(this.net, this.hf, this.assets);
    this.ui.setProgress(0.82, 'Planting forests'); await nextFrame(); await nextFrame();
    this.props = new Props(this.hf, this.assets, this.colliders, r, 1);
    this.dressWorld(); this.props.buildMeshes();
    this.env = new Environment(this.scene, r, this.assets.hdr);
    this.env.registerEnv(this.roads.asphalt); this.env.registerEnv(this.roads.waterMat);
    this.rig = new CameraRig(this.ground);
    this.acts = new Activities(this.net, this.save, {
      toast: (k, t, v, s, sub) => { this.ui.toast(k, t, v, s, sub); this.audio.reward(); this.afterReward(); },
      result: res => { this.lastEvent = res.def; this.state = 'results'; this.ui.showResult(res); this.audio.fanfare(res.stars); this.audio.suspend(true); this.afterReward(); },
      countdown: n => { this.ui.countdown(n); this.audio.beep(n <= 0); },
      checkpoint: () => this.audio.checkpoint(),
    });
    this.scene.add(this.terrain.group, this.roads.group, this.props.group, this.fx.group, this.acts.group, this.tunnelLight);
    // contact shadow used when real shadows are off
    const bc = document.createElement('canvas'); bc.width = bc.height = 64; const bg = bc.getContext('2d')!; const gr = bg.createRadialGradient(32, 32, 4, 32, 32, 32); gr.addColorStop(0, 'rgba(0,0,0,0.75)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); bg.fillStyle = gr; bg.fillRect(0, 0, 64, 64);
    this.blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(bc), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    this.blob.rotation.x = -Math.PI / 2; this.scene.add(this.blob);

    this.ui.buildMap(this.net, this.hf);
    this.ui.setMarkers(ACTIVITIES.map(a => { const p = this.acts.startPos.get(a.id)!; return { x: p.x, z: p.z, color: '#' + KIND_COLOR[a.kind].toString(16).padStart(6, '0') }; }));
    this.setCar(this.save.data.car, true); this.registerCarEnv();
    this.lastLevel = this.save.level;
    this.applySettings();
    addEventListener('resize', () => this.resize()); this.resize();
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'drive') this.pause(); });
    addEventListener('pointerdown', () => this.audio.start(), { once: false });

    this.ui.setProgress(0.92, 'Warming up'); await nextFrame();
    this.rig.updateOrbit(0.016, this.car.pos, 7.5, 1.6, 0);
    for (let i = 0; i < 40 && this.terrain.update(this.rig.camera.position, 12); i++) await nextFrame();
    this.props.update(this.rig.camera.position); this.env.update(0.016, this.rig.camera, this.car.pos, this.car.vel);
    try { r.compile(this.scene, this.rig.camera); } catch { /* optional */ }
    r.render(this.scene, this.rig.camera);
    this.ui.setProgress(1, 'Ready'); await nextFrame();
    this.enterMenu();
    this.last = performance.now();
    r.setAnimationLoop(t => this.frame(t));
  }

  /** Hand-placed set dressing: start-line lamps, picnic spots at the viewpoints, barriers. */
  private dressWorld() {
    const loop = this.net.byId('loop'), hw = loop.def.halfWidth;
    for (const s of [5700, 7250, 2380, 10700]) { const p = loop.pointAt(s, hw + 9); this.props.addProp('wooden_picnic_table', p.x, p.z, 0.9, loop.headingAt(s) + 0.4, 1.1); const q = loop.pointAt(s + 7, hw + 10); this.props.addProp('wooden_picnic_table', q.x, q.z, 0.9, loop.headingAt(s) - 0.5, 1.1); }
    for (const s of [5690, 5696, 5702, 5708, 5714, 7240, 7246, 7252, 7258]) { const p = loop.pointAt(s, hw + 15); this.props.addProp('concrete_road_barrier', p.x, p.z, 0.85, loop.headingAt(s), 0.9); }
  }

  // ------------------------------------------------------------ cars
  setCar(id: string, initial = false) {
    const spec = carById(id);
    let x: number, z: number, yaw: number, refY = 1e4;
    if (initial || !this.car) { const road = this.net.byId(START.road), p = road.pointAt(START.s, 2.2); x = p.x; z = p.z; yaw = road.headingAt(START.s); refY = p.y + 2; }
    else { x = this.car.pos.x; z = this.car.pos.z; yaw = this.car.yaw; refY = this.car.pos.y + 1; }
    if (this.vis) { this.vis.dispose(); this.env?.clearCarEnv(); }
    this.vis = new CarVisual(spec, this.assets.models.concept, this.assets.models); // may refine the spec's wheel layout from the model
    this.car = new CarPhysics(spec, this.ground, this.colliders);
    this.car.place(x, z, yaw, refY);
    const paints = (this.save.data as any).paints as Record<string, number> | undefined;
    if (paints && paints[id] != null) this.vis.setPaint(paints[id]);
    this.scene.add(this.vis.group); this.registerCarEnv();
    this.audio.setCar(spec); this.ui.drawGauge(spec.redline, spec.redline * 0.93);
    this.previewId = id; this.rig?.snap();
  }
  private registerCarEnv() {
    if (!this.env || !this.vis) return;
    this.vis.group.traverse(o => { const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined; if (!m) return; for (const x of Array.isArray(m) ? m : [m]) if ((x as THREE.MeshStandardMaterial).isMeshStandardMaterial) this.env.registerEnv(x as THREE.MeshStandardMaterial, true); });
  }
  private setPaint(color: number) {
    const d = this.save.data as any; d.paints = d.paints || {}; d.paints[this.previewId] = color; this.save.write(); this.vis.setPaint(color);
  }
  private buyCar(id: string) {
    const spec = carById(id), d = this.save.data;
    if (d.owned.includes(id) || d.credits < spec.price) { this.audio.uiDeny(); return; }
    d.credits -= spec.price; d.owned.push(id); d.car = id; this.save.write(); this.audio.fanfare(2); this.ui.updateWallet();
  }

  // ------------------------------------------------------------ states
  private enterMenu() {
    if (this.acts.active) this.acts.quit(this.car);
    if (this.previewId !== this.save.data.car) this.setCar(this.save.data.car);
    this.state = 'menu'; this.ui.show('menu'); this.audio.suspend(true); this.input.enabled = false;
  }
  private enterGarage() { this.state = 'garage'; this.ui.show('garage'); this.audio.suspend(true); this.input.enabled = false; }
  private enterDrive() {
    if (this.previewId !== this.save.data.car) this.setCar(this.save.data.car);
    this.audio.start(); this.audio.suspend(false);
    this.state = 'drive'; this.ui.show('none'); this.ui.updateWallet(); this.input.enabled = true; this.rig.mode = this.save.data.camMode % 4; if (this.rig.mode === 3 && !this.car.spec.cockpit) this.rig.mode = 0; this.rig.snap();
    if (!this.save.data.seenIntro) { this.save.data.seenIntro = true; this.save.write(); this.ui.note('Welcome to Horizon', 'Follow the road. Drive through a glowing gate and press Enter to start an event.'); }
  }
  private pause() { if (this.state !== 'drive') return; this.state = 'paused'; this.ui.showPause(this.acts.active ? this.acts.active.name : null); this.audio.suspend(true); this.save.write(); }
  private startEvent(def: ActivityDef) { this.lastEvent = def; this.acts.begin(def, this.car); this.enterDrive(); this.rig.snap(); this.offRouteT = 0; }
  private travel(def: ActivityDef) {
    if (this.acts.active) this.acts.quit(this.car);
    const road = this.net.byId(def.road), s = def.s0 - (def.kind === 'race' || def.kind === 'trial' ? 9 : 160), p = road.pointAt(s);
    this.car.place(p.x, p.z, road.headingAt(s), p.y + 2); this.enterDrive();
  }
  private afterReward() {
    this.ui.updateWallet();
    const lvl = this.save.level;
    if (lvl > this.lastLevel) { this.lastLevel = lvl; this.ui.note('Level up', `You reached level ${lvl}`); }
  }
  private resetCar() {
    if (this.acts.active && this.acts.state === 'running') { this.acts.respawn(this.car); this.rig.snap(); return; }
    let best = 1e18, br = this.net.roads[0], bi = 0;
    for (const r of this.net.roads) for (let i = 0; i < r.n; i += 2) { const d = (r.px[i] - this.car.pos.x) ** 2 + (r.pz[i] - this.car.pos.z) ** 2 + ((r.py[i] - this.car.pos.y) * 2) ** 2; if (d < best) { best = d; br = r; bi = i; } }
    const s = bi * STEP; let yaw = br.headingAt(s);
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(this.car.quat); if (f.x * br.tx[bi] + f.z * br.tz[bi] < 0) yaw += Math.PI;
    const p = br.pointAt(s, 0); this.car.place(p.x, p.z, yaw, p.y + 2); this.rig.snap();
  }

  applySettings() {
    const s = this.save.data.settings, q = QUALITY[s.quality], r = this.renderer;
    this.basePR = Math.min(devicePixelRatio || 1, q.pr >= 1 ? q.pr : 1) * (q.pr < 1 ? q.pr : 1);
    this.env.setShadowQuality(q.shadow, q.shadowRange); r.shadowMap.enabled = q.shadow > 0; this.blob.visible = q.shadow === 0;
    this.terrain.uniforms.uDetail.value = s.quality === 'low' ? 0 : 1; this.terrain.setCastShadows(s.quality === 'high');
    this.roads.setDetail(s.quality === 'high'); this.env.setEnvEnabled(this.roads.asphalt, s.quality !== 'low');
    this.terrain.lodScale = q.lod; this.props.rangeScale = q.range; this.props.treeShadows = s.quality === 'high'; this.props.nearRange = q.near / q.range;
    this.scene.traverse(o => { const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined; if (m) (Array.isArray(m) ? m : [m]).forEach(x => x.needsUpdate = true); });
    if (q.bloom && !this.composer) {
      const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 });
      this.composer = new EffectComposer(r, rt); this.composer.addPass(new RenderPass(this.scene, this.rig.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.2, 0.55, 0.92); this.composer.addPass(this.bloom); this.composer.addPass(new OutputPass());
    } else if (!q.bloom && this.composer) { this.composer.dispose(); this.composer = null; this.bloom = null; }
    this.audio.vol.master = s.master; this.audio.vol.engine = s.engine; this.audio.vol.ambience = s.ambience; this.audio.applyVolumes();
    if (this.state !== 'drive') this.audio.suspend(true);
    this.env.weatherMode = s.weather; this.rig.shakeEnabled = s.camShake;
    if (s.timeFlow === 'cycle') this.env.timeScale = 24 / (24 * 60); else { this.env.timeScale = 0; this.env.time = s.timeFlow === 'day' ? 12.5 : s.timeFlow === 'sunset' ? 17.45 : 23.2; }
    this.dyn = 1; this.resize();
  }
  private resize() {
    const w = innerWidth, h = innerHeight, pr = this.basePR * this.dyn;
    this.renderer.setPixelRatio(pr); this.renderer.setSize(w, h, false);
    if (this.composer) { this.composer.setPixelRatio(pr); this.composer.setSize(w, h); }
    this.rig.camera.aspect = w / h; this.rig.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------ frame
  private frame(now: number) {
    const raw = (now - this.last) / 1000; this.last = now;
    const dt = Math.min(0.05, Math.max(0.001, raw));
    this.frames++; this.fps = damp(this.fps, 1 / Math.max(raw, 1e-3), 2, dt);
    const car = this.car, ui = this.ui, inp = this.input;

    // global keys
    if (inp.hit('Escape')) {
      if (this.state === 'drive') this.pause();
      else if (this.state === 'paused') { if (ui.screen === 'pause') this.enterDrive(); else { this.audio.uiBack(); ui.back(); } }
      else if (this.state === 'menu' && ui.screen !== 'menu') { this.audio.uiBack(); ui.back(); }
      else if (this.state === 'garage') this.enterMenu();
      else if (this.state === 'results') this.enterDrive();
    }
    if (this.state === 'results' && inp.hit('Enter')) this.enterDrive();
    if (this.state === 'menu' && ui.screen === 'menu' && inp.hit('Enter')) this.enterDrive();

    const driving = this.state === 'drive';
    if (driving) {
      if (inp.hit('KeyC')) { this.rig.cycle(car.spec.cockpit); this.save.data.camMode = this.rig.mode; ui.flash(CAM_NAMES[this.rig.mode] + ' camera'); }
      if (inp.hit('KeyR')) this.resetCar();
      if (inp.hit('KeyM')) { this.pause(); ui.show('events'); }
      if (inp.hit('KeyT')) { this.env.time = (this.env.time + 2) % 24; ui.flash('Time ' + this.env.clock); }
      if (inp.hit('Enter', 'KeyE') && this.acts.nearby && !this.acts.active) this.startEvent(this.acts.nearby);
    }
    // physics
    inp.read(this.inp);
    if (!driving) { this.inp.accel = 0; this.inp.decel = 0; this.inp.steer = 0; this.inp.boost = false; this.inp.handbrake = this.state !== 'paused'; }
    else if (this.debugInput) Object.assign(this.inp, this.debugInput);
    if (this.state !== 'paused') {
      this.acc = Math.min(this.acc + dt, 0.06);
      car.wet = this.env?.wet ?? 0;
      while (this.acc >= H) { car.step(H, this.inp); this.acc -= H; }
      if (car.impact > 0.5) {
        if (car.impact > 1.2) { this.audio.impact(car.impact); this.rig.kick(clamp(car.impact / 14, 0.1, 0.9)); this.fx.sparks(car.pos, car.vel, Math.min(24, Math.round(car.impact * 3))); }
        car.impact = 0;
      }
      if (car.shifted) { this.audio.shift(car.shifted > 0); car.shifted = 0; }
      if (car.landed) { this.audio.land(car.landed); this.rig.kick(car.landed * 0.35); car.landed = 0; }
      if (car.scrape > 0.2 && Math.random() < 0.5) this.fx.sparks(car.pos, car.vel, 2);
      if (driving) {
        this.acts.update(dt, car);
        this.save.data.distance += Math.abs(car.speed) * dt;
        if (car.upright < 0.1 && car.vel.length() < 2) this.resetCar();
      }
    }
    car.scrape = Math.max(0, car.scrape - dt * 4); car.brush = 0;

    // world
    const inTunnel = car.road && (car.road.flags[car.road.wrapClamp(Math.round(car.roadS / STEP))] & F_TUNNEL) && Math.abs(car.roadLat) < 8 ? 1 : 0;
    this.tunnel = damp(this.tunnel, inTunnel, 3, dt);
    this.vis.update(car, clamp((1 - this.env.daylight) * 1.6 + this.tunnel + this.env.rain * 0.4, 0, 1));
    if (driving || this.state === 'paused' || this.state === 'results') this.rig.update(this.state === 'paused' ? 0.0001 : dt, car, this.vis);
    else this.rig.updateOrbit(dt, car.pos, this.state === 'garage' ? 6.4 : 7.8, this.state === 'garage' ? 1.25 : 1.7, this.state === 'garage' ? 0.22 : 0.08);
    const cam = this.rig.camera;
    this.env.update(this.state === 'paused' ? 0 : dt, cam, car.pos, car.vel);
    if (this.tunnel > 0.01) {
      this.env.applyEnv(1 - 0.8 * this.tunnel); this.env.hemi.intensity *= 1 - 0.75 * this.tunnel;
      this.renderer.toneMappingExposure = this.env.exposure * (1 + this.tunnel * 0.25 * this.env.daylight);
    }
    this.tunnelLight.intensity = this.tunnel * 150; this.tunnelLight.position.set(car.pos.x, car.pos.y + 4.2, car.pos.z);
    this.terrain.update(cam.position, 2); this.props.update(cam.position); this.roads.update(dt, this.env.wet); this.terrain.uniforms.uWet.value = this.env.wet;
    this.fx.update(dt, car, this.env.hemi.color, innerHeight, this.env.wet, cam.position);
    this.props.treeU.value += dt;
    this.ui.setSpeedFx(driving ? clamp((car.vel.length() - 36) / 50, 0, 1) : 0, car.boosting);
    if (this.blob.visible) { const g = car.wheels[0].contact.y; this.blob.position.set(car.pos.x, (car.grounded ? g : car.pos.y - car.spec.cgHeight) + 0.04, car.pos.z); this.blob.scale.set(car.spec.body.width * 1.7, car.spec.body.length * 1.35, 1); this.blob.rotation.z = car.yaw; }
    biomeAt(car.pos.x, car.pos.z, this.biome);
    this.audio.update(dt, driving ? car : null, { rain: this.env.rain, daylight: this.env.daylight, biome: this.biome, tunnel: this.tunnel });

    // HUD
    if (driving) {
      const b = this.biome, bn = b[1] > 0.5 ? 'Mountain' : b[2] > 0.5 ? 'Forest' : 'Desert';
      ui.updateHud(dt, { kmh: car.kmh, rpm: car.rpm, redline: car.spec.redline, gear: car.gear, nitro: car.nitro, boosting: car.boosting, clock: this.env.clock,
        weather: this.env.rain > 0.4 ? 'Rain' : this.env.daylight < 0.12 ? 'Night' : this.env.daylight < 0.75 ? (this.env.time < 12 ? 'Dawn' : 'Dusk') : 'Clear', biome: bn, road: car.road && Math.abs(car.roadLat) < car.road.def.halfWidth + 6 ? car.road.def.name : 'Off-road' });
      const a = this.acts.active;
      if (a) {
        ui.setActivity({ name: a.name, time: this.acts.time, sub: `Checkpoint ${Math.min(this.acts.cpIndex + 1, this.acts.cps.length)} / ${this.acts.cps.length} · ${(this.acts.remaining / 1000).toFixed(1)} km to go`, progress: this.acts.progress });
        const road = this.net.byId(a.road), off = this.acts.state === 'running' && (car.road !== road || Math.abs(car.roadLat) > road.def.halfWidth + 22);
        this.offRouteT = off ? this.offRouteT + dt : 0; ui.setWarn(this.offRouteT > 3);
        const s = this.acts.cps[this.acts.cpIndex]; if (s != null) { const p = road.pointAt(s); ui.target = { x: p.x, z: p.z }; }
      } else { ui.setActivity(null); ui.setWarn(false); ui.target = null; }
      ui.setPrompt(this.acts.nearby);
      const dz = this.acts.drift; ui.setDrift(dz ? { name: dz.def.name, score: dz.score, combo: dz.combo } : null);
      this.miniT -= dt; if (this.miniT <= 0) { this.miniT = 0.05; ui.player.x = car.pos.x; ui.player.z = car.pos.z; ui.player.yaw = car.yaw; ui.drawMinimap(); }
      this.saveT += dt; if (this.saveT > 20) { this.saveT = 0; this.save.write(); }
    } else { ui.player.x = car.pos.x; ui.player.z = car.pos.z; ui.player.yaw = car.yaw; }

    if (this.skipRender) { /* QA fast-forward */ } else if (this.composer) this.composer.render(dt); else this.renderer.render(this.scene, cam);
    inp.endFrame();

    // adaptive resolution
    this.ema = this.ema * 0.95 + raw * 1000 * 0.05;
    if (this.ema > 24) { this.slowT += dt; this.fastT = 0; } else if (this.ema < 14) { this.fastT += dt; this.slowT = 0; } else { this.slowT = this.fastT = 0; }
    if (this.slowT > 1.5 && this.dyn > 0.55) { this.dyn = Math.max(0.55, this.dyn - 0.1); this.slowT = 0; this.resize(); }
    if (this.fastT > 5 && this.dyn < 1) { this.dyn = Math.min(1, this.dyn + 0.05); this.fastT = 0; this.resize(); }
  }
}

const game = new Game();
(window as any).__horizon = game;
// QA helpers used by the automated playtests (scripts/ and browser console).
(window as any).__qa = {
  /** advance the game `sec` seconds at 60 Hz with a scripted input, independent of real time */
  sim(sec: number, inp: Partial<CarInput> = {}) {
    const g = game as any; g.debugInput = inp; let t = g.last;
    for (let i = 0, n = Math.round(sec * 60); i < n; i++) { t += 1000 / 60; g.frame(t); }
    g.debugInput = null;
    const c = game.car; return { kmh: Math.round(c.kmh), gear: c.gear, road: c.road?.def.id, s: Math.round(c.roadS), lat: +c.roadLat.toFixed(1), y: +c.pos.y.toFixed(1), up: +c.upright.toFixed(2), state: game.state, act: game.acts.active?.id, cp: game.acts.cpIndex };
  },
  tp(roadId: string, s: number, lat = 0) { const r = game.net.byId(roadId), p = r.pointAt(s, lat); game.car.place(p.x, p.z, r.headingAt(s), p.y + 2); (game as any).rig.snap(); },
  /** follow the current road automatically for `sec` seconds */
  auto(sec: number, maxKmh = 400, skill = 0.75, fast = false) {
    const g = game as any; let t = g.last; const car = game.car; game.skipRender = fast;
    if (!car.road) { t += 1000 / 60; g.frame(t); }
    for (let i = 0, n = Math.round(sec * 60); i < n; i++) {
      if (game.state !== 'drive') break;
      const road = car.road; if (!road) break;
      const spd = Math.max(0, car.speed), la = 9 + spd * 0.55, tp = road.pointAt(car.roadS + la);
      let want = Math.atan2(-(tp.x - car.pos.x), -(tp.z - car.pos.z)) - car.yaw; while (want > Math.PI) want -= 2 * Math.PI; while (want < -Math.PI) want += 2 * Math.PI;
      const sp = car.spec, lock = Math.max(0.03, sp.steerLock / (1 + (spd / (sp.steerFade * 0.4)) ** 2));
      let vmax = maxKmh / 3.6;
      for (let d = 0; d < 20 + spd * 4.2; d += 6) { const k = road.wrapClamp(Math.round((car.roadS + d) / STEP)), c = Math.abs(road.curv[k]) + 1e-4; vmax = Math.min(vmax, Math.sqrt(sp.grip * 9.81 * skill / c + 2 * sp.brakeG * 9.81 * 0.75 * d)); }
      g.debugInput = { steer: clamp(-Math.atan(2 * sp.wheelbase * Math.sin(want) / la) * 1.5 / lock, -1, 1), accel: clamp((vmax - spd) / 4, 0, 1), decel: spd > vmax + 1.5 ? Math.min(1, (spd - vmax) / 6) : 0 };
      t += 1000 / 60; g.frame(t);
    }
    g.debugInput = null; game.skipRender = false; g.frame(t + 16);
    return { kmh: Math.round(car.kmh), road: car.road?.def.id, s: Math.round(car.roadS), lat: +car.roadLat.toFixed(1), state: game.state, act: game.acts.active?.id, cp: game.acts.cpIndex, time: +game.acts.time.toFixed(1) };
  },
  probe() {
    const r = game.renderer, gl = r.getContext(), px = new Uint8Array(4), cam = (game as any).rig.camera;
    const time = (fn: () => void) => { fn(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); const t0 = performance.now(); for (let i = 0; i < 5; i++) fn(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return +((performance.now() - t0) / 5).toFixed(1); };
    const out: Record<string, unknown> = { frameMs: time(() => r.render(game.scene, cam)) };
    for (const [k, o] of [['terrain', game.terrain.group], ['props', game.props.group], ['roads', game.roads.group], ['car', game.vis.group]] as const) { o.visible = false; out['without_' + k] = time(() => r.render(game.scene, cam)); o.visible = true; }
    out.tris = r.info.render.triangles; out.calls = r.info.render.calls; out.size = [r.domElement.width, r.domElement.height];
    return out;
  },
};
game.boot().catch(err => { console.error(err); const l = document.getElementById('loadLabel'); if (l) l.textContent = 'Something went wrong while loading: ' + (err?.message ?? err); });
void CARS;
