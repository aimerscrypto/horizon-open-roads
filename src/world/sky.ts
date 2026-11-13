// Sky dome (gradient + sun + clouds in one cheap shader), sun/moon lighting, fog, stars, rain
// and the day/night + weather state.
import * as THREE from 'three';
import { clamp, damp, lerp, mulberry32, smoothstep } from '../core/noise';

export type WeatherMode = 'dynamic' | 'clear' | 'rain';
const C = (r: number, g: number, b: number) => new THREE.Color(r, g, b);
// linear-space palette
const ZEN_DAY = C(0.08, 0.24, 0.7), ZEN_DUSK = C(0.1, 0.13, 0.36), ZEN_NIGHT = C(0.012, 0.02, 0.055);
const HOR_DAY = C(0.62, 0.76, 0.93), HOR_DUSK = C(1.0, 0.46, 0.17), HOR_NIGHT = C(0.04, 0.055, 0.1), HOR_RAIN = C(0.34, 0.38, 0.43);
const SUN_LOW = C(1.0, 0.42, 0.12), SUN_HIGH = C(1.0, 0.93, 0.8), MOON = C(0.45, 0.6, 1.0);

export class Environment {
  readonly sun = new THREE.DirectionalLight(0xffffff, 3);
  readonly hemi = new THREE.HemisphereLight(0xbcd6ff, 0x6b5a45, 0.8);
  readonly fog = new THREE.FogExp2(0xbfd4ea, 0.00022);
  readonly sunDir = new THREE.Vector3(0, 1, 0);
  readonly lightDir = new THREE.Vector3(0, 1, 0);
  /** hours 0..24 */ time = 16.6;
  /** in-game hours per real second */ timeScale = 24 / (24 * 60);
  weatherMode: WeatherMode = 'dynamic';
  rain = 0; wet = 0; daylight = 1; exposure = 0.6;
  shadowRange = 110;
  readonly sky: THREE.Mesh; readonly stars: THREE.Points;
  private raining = false; private weatherTimer = 240;
  private rainMesh: THREE.LineSegments;
  private skyU = {
    uTime: { value: 0 }, uCover: { value: 0.45 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color() },
    uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uCloudLit: { value: new THREE.Color() }, uCloudShade: { value: new THREE.Color() },
  };
  private rainU = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uAmount: { value: 0 }, uVel: { value: new THREE.Vector3() } };
  private zen = new THREE.Color(); private hor = new THREE.Color();
  /** Image-based lighting is applied only to registered materials (cars, wet tarmac, water): far cheaper on integrated GPUs than a scene-wide environment. */
  envTex: THREE.Texture | null = null; envScale = 1;
  private envMats: { m: THREE.MeshStandardMaterial; base: number; car: boolean }[] = [];
  registerEnv(m: THREE.MeshStandardMaterial, car = false) {
    if (!this.envTex || this.envMats.some(e => e.m === m)) return;
    this.envMats.push({ m, base: m.envMapIntensity, car }); m.envMap = this.envTex; m.needsUpdate = true;
  }
  clearCarEnv() { this.envMats = this.envMats.filter(e => !e.car); }
  setEnvEnabled(m: THREE.MeshStandardMaterial, on: boolean) { const want = on ? this.envTex : null; if (m.envMap !== want) { m.envMap = want; m.needsUpdate = true; } }
  applyEnv(mul: number) { const k = this.envScale * mul; for (const e of this.envMats) e.m.envMapIntensity = e.base * k; }

  constructor(readonly scene: THREE.Scene, readonly renderer: THREE.WebGLRenderer, hdr: THREE.Texture | undefined) {
    scene.add(this.sun, this.sun.target, this.hemi);
    scene.fog = this.fog;
    if (hdr) { const pm = new THREE.PMREMGenerator(renderer); this.envTex = pm.fromEquirectangular(hdr).texture; pm.dispose(); }
    this.sun.castShadow = true; this.sun.shadow.bias = -0.0003; this.sun.shadow.normalBias = 0.5;

    this.sky = new THREE.Mesh(new THREE.SphereGeometry(9000, 24, 12), new THREE.ShaderMaterial({
      uniforms: this.skyU, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }',
      fragmentShader: `
        uniform float uTime, uCover; uniform vec3 uSunDir, uSunCol, uZenith, uHorizon, uCloudLit, uCloudShade; varying vec3 vDir;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        float fbm(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<4;i++){ s+=a*n(p); p=p*2.03+7.1; a*=0.5; } return s; }
        void main(){
          vec3 d = normalize(vDir);
          float up = max(d.y, 0.0);
          vec3 col = mix(uHorizon, uZenith, pow(up, 0.42));
          float sd = max(dot(d, uSunDir), 0.0);
          float halo = pow(sd, 10.0) * 0.32 + pow(sd, 3.0) * 0.1;
          col += uSunCol * (halo + smoothstep(0.99965, 0.9998, sd) * 26.0);
          if (d.y > 0.015) {
            vec2 p = d.xz / (d.y + 0.08) * 0.42 + cameraPosition.xz * 0.00006 + vec2(uTime * 0.004, uTime * 0.0017);
            float dn = fbm(p) * 0.84 + n(p * 7.0 - uTime * 0.01) * 0.16;
            float a = smoothstep(1.0 - uCover, 1.0 - uCover + 0.26, dn) * smoothstep(0.015, 0.16, d.y);
            float thick = smoothstep(1.0 - uCover + 0.1, 1.0 - uCover + 0.5, dn);
            vec3 cc = mix(uCloudLit + uSunCol * pow(sd, 6.0) * 0.5, uCloudShade, thick * (0.5 + 0.4 * uCover));
            col = mix(col, cc, a * 0.94);
          }
          col = mix(col, uHorizon * 0.82, smoothstep(0.0, -0.25, d.y));
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }));
    this.sky.frustumCulled = false; this.sky.renderOrder = -10; scene.add(this.sky);

    const rnd = mulberry32(7), n = 1400, sp = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = rnd() * 2 - 1, a = rnd() * 6.283, r = Math.sqrt(1 - u * u);
      sp[i * 3] = r * Math.cos(a) * 8000; sp[i * 3 + 1] = Math.abs(u) * 8000 + 200; sp[i * 3 + 2] = r * Math.sin(a) * 8000;
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xdfe8ff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.stars.frustumCulled = false; this.stars.renderOrder = -9; scene.add(this.stars);

    // rain streaks (GPU-wrapped around the camera)
    const R = 2200, rp = new Float32Array(R * 6), ro = new Float32Array(R * 2);
    for (let i = 0; i < R; i++) { const x = rnd() * 44, y = rnd() * 30, z = rnd() * 44; rp.set([x, y, z, x, y, z], i * 6); ro[i * 2] = 0; ro[i * 2 + 1] = 1; }
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(rp, 3)); rg.setAttribute('end', new THREE.BufferAttribute(ro, 1));
    this.rainMesh = new THREE.LineSegments(rg, new THREE.ShaderMaterial({
      uniforms: this.rainU, transparent: true, depthWrite: false,
      vertexShader: `uniform float uTime; uniform vec3 uCam, uVel; attribute float end; varying float vA;
        void main(){ vec3 box = vec3(44.0, 30.0, 44.0);
          vec3 fall = vec3(1.5, -24.0, 0.6);
          vec3 p = mod(position + fall * uTime - uCam, box) - box * 0.5 + uCam;
          p -= (fall * 0.035 - uVel * 0.02) * end;
          vA = 1.0 - smoothstep(14.0, 22.0, length(p - uCam));
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0); }`,
      fragmentShader: 'uniform float uAmount; varying float vA; void main(){ gl_FragColor = vec4(0.78, 0.84, 0.92, 0.34 * uAmount * vA); }',
    }));
    this.rainMesh.frustumCulled = false; this.rainMesh.visible = false; scene.add(this.rainMesh);
  }

  setShadowQuality(size: number, range: number) {
    this.sun.castShadow = size > 0; this.shadowRange = range;
    if (size > 0) {
      this.sun.shadow.mapSize.set(size, size); this.sun.shadow.map?.dispose(); (this.sun.shadow as any).map = null;
      const c = this.sun.shadow.camera; c.left = -range; c.right = range; c.top = range; c.bottom = -range; c.near = 10; c.far = 900; c.updateProjectionMatrix();
    }
  }

  update(dt: number, cam: THREE.Camera, focus: THREE.Vector3, vel: THREE.Vector3) {
    this.time = (this.time + dt * this.timeScale) % 24;
    if (this.weatherMode === 'dynamic') {
      this.weatherTimer -= dt;
      if (this.weatherTimer <= 0) { this.raining = !this.raining; this.weatherTimer = this.raining ? 100 + Math.random() * 80 : 260 + Math.random() * 200; }
    } else this.raining = this.weatherMode === 'rain';
    this.rain = damp(this.rain, this.raining ? 1 : 0, 0.25, dt);
    this.wet = clamp(this.wet + (this.rain > 0.3 ? dt * 0.09 * this.rain : -dt * 0.018), 0, 1);

    const t = this.time, a = Math.PI * (t - 6) / 12;
    const el = Math.sin(a) * 1.05;
    this.sunDir.set(Math.cos(el) * Math.cos(a), Math.sin(el), Math.cos(el) * 0.55 * Math.sin(a) + 0.25).normalize();
    const sy = this.sunDir.y;
    const day = this.daylight = smoothstep(-0.1, 0.22, sy);
    const low = (1 - smoothstep(0.0, 0.45, Math.abs(sy))) * smoothstep(-0.2, 0.02, sy);
    const over = this.rain;
    const sunCol = this.skyU.uSunCol.value;
    if (sy > -0.04) {
      this.lightDir.copy(this.sunDir); if (this.lightDir.y < 0.06) { this.lightDir.y = 0.06; this.lightDir.normalize(); }
      this.sun.color.copy(SUN_LOW).lerp(SUN_HIGH, smoothstep(0.02, 0.42, sy));
      this.sun.intensity = 4.4 * smoothstep(-0.04, 0.16, sy) * (1 - over * 0.8);
    } else {
      this.lightDir.set(-0.45, 0.72, 0.4).normalize();
      this.sun.color.copy(MOON); this.sun.intensity = 1.3 * smoothstep(-0.04, -0.16, sy) * (1 - over * 0.5);
    }
    sunCol.copy(SUN_LOW).lerp(SUN_HIGH, smoothstep(0.02, 0.42, sy)).multiplyScalar(smoothstep(-0.12, 0.05, sy) * (1 - over * 0.9));
    this.zen.copy(ZEN_NIGHT).lerp(ZEN_DAY, day).lerp(ZEN_DUSK, low * 0.75).lerp(HOR_RAIN.clone().multiplyScalar(lerp(0.05, 0.75, day)), over * 0.9);
    this.hor.copy(HOR_NIGHT).lerp(HOR_DAY, day).lerp(HOR_DUSK, low * 0.85).lerp(HOR_RAIN.clone().multiplyScalar(lerp(0.06, 1, day)), over * 0.92);
    this.skyU.uZenith.value.copy(this.zen); this.skyU.uHorizon.value.copy(this.hor); this.skyU.uSunDir.value.copy(this.sunDir);
    this.skyU.uCloudLit.value.setRGB(lerp(0.03, 1.0, day), lerp(0.035, 0.98, day), lerp(0.05, 0.95, day)).lerp(HOR_DUSK, low * 0.5).multiplyScalar(1 - over * 0.45);
    this.skyU.uCloudShade.value.setRGB(lerp(0.012, 0.42, day), lerp(0.014, 0.46, day), lerp(0.02, 0.54, day)).multiplyScalar(1 - over * 0.4);
    this.skyU.uTime.value += dt; this.skyU.uCover.value = lerp(0.47, 0.98, over);
    this.hemi.color.copy(this.zen).lerp(this.hor, 0.6).multiplyScalar(1.25); this.hemi.color.r = Math.max(this.hemi.color.r, 0.13); this.hemi.color.g = Math.max(this.hemi.color.g, 0.16); this.hemi.color.b = Math.max(this.hemi.color.b, 0.26);
    this.hemi.groundColor.setRGB(lerp(0.07, 0.42, day), lerp(0.07, 0.36, day), lerp(0.1, 0.29, day));
    this.hemi.intensity = lerp(1.2, 1.6, day) * (1 - over * 0.2);
    this.envScale = lerp(0.07, 0.95, day) * (1 - over * 0.35);
    this.fog.color.copy(this.hor);
    this.fog.density = lerp(0.0002, 0.00065, over) + low * 0.00008;
    this.exposure = lerp(1.45, 0.7, day) * (1 + over * 0.15);
    this.renderer.toneMappingExposure = this.exposure;
    (this.stars.material as THREE.PointsMaterial).opacity = (1 - day) * (1 - over);
    this.stars.position.copy(cam.position); this.sky.position.copy(cam.position);
    if (this.sun.castShadow) {
      const texel = (this.shadowRange * 2) / this.sun.shadow.mapSize.x;
      const fx = Math.round(focus.x / texel) * texel, fy = Math.round(focus.y / texel) * texel, fz = Math.round(focus.z / texel) * texel;
      this.sun.target.position.set(fx, fy, fz); this.sun.position.set(fx, fy, fz).addScaledVector(this.lightDir, 420);
    } else { this.sun.target.position.copy(focus); this.sun.position.copy(focus).addScaledVector(this.lightDir, 420); }
    this.applyEnv(1);
    this.rainMesh.visible = this.rain > 0.03;
    this.rainU.uTime.value += dt; this.rainU.uCam.value.copy(cam.position); this.rainU.uAmount.value = this.rain; this.rainU.uVel.value.copy(vel);
  }
  get clock(): string { const h = Math.floor(this.time), m = Math.floor((this.time - h) * 60); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; }
}
