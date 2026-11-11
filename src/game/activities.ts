// Activities: checkpoint races, time trials, speed traps and drift zones, with world markers.
import * as THREE from 'three';
import { clamp } from '../core/noise';
import { Save } from '../core/save';
import { ACTIVITIES, ActivityDef } from '../world/layout';
import { Road, RoadNetwork } from '../world/roads';
import { CarPhysics } from '../vehicle/physics';

export const KIND_COLOR: Record<string, number> = { race: 0xff7a1a, trial: 0x25c8ff, trap: 0xff3d8b, drift: 0xb6ff3b };
export const KIND_LABEL: Record<string, string> = { race: 'Road Race', trial: 'Time Trial', trap: 'Speed Trap', drift: 'Drift Zone' };
export interface Result { def: ActivityDef; value: number; stars: number; best: number; newBest: boolean; credits: number; xp: number; prevStars: number; }
export interface ActivityHooks {
  toast(kind: string, title: string, value: string, stars: number, sub: string): void;
  result(r: Result): void;
  countdown(n: number): void;
  checkpoint(i: number, n: number): void;
}
export function starsFor(def: ActivityDef, v: number): number {
  const lower = def.kind === 'race' || def.kind === 'trial';
  let s = 0; for (let i = 0; i < 3; i++) if (lower ? v <= def.stars[i] : v >= def.stars[i]) s = i + 1;
  return s;
}

const _v = new THREE.Vector3();
export class Activities {
  readonly group = new THREE.Group();
  active: ActivityDef | null = null; state: 'idle' | 'countdown' | 'running' = 'idle';
  time = 0; cpIndex = 0; cps: number[] = []; countdownT = 0; lastCpS = 0;
  nearby: ActivityDef | null = null;
  /** live drift zone */ drift: { def: ActivityDef; score: number; combo: number; t: number } | null = null;
  driftChain = 0;
  private armed = new Map<string, boolean>();
  private gate: THREE.Group; private gateNext: THREE.Group; private lastN = -1;
  private road: Road | null = null; private total = 0;
  startPos = new Map<string, THREE.Vector3>();

  constructor(readonly net: RoadNetwork, readonly save: Save, readonly hooks: ActivityHooks) {
    const postGeo = new THREE.CylinderGeometry(0.16, 0.2, 6.5, 10), barGeo = new THREE.BoxGeometry(1, 0.7, 0.3);
    const dark = new THREE.MeshStandardMaterial({ color: 0x15171a, metalness: 0.6, roughness: 0.4 });
    for (const def of ACTIVITIES) {
      const road = net.byId(def.road), hw = road.def.halfWidth, color = KIND_COLOR[def.kind];
      const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.2) });
      const beamMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
      const arch = (s: number, withBeam: boolean, wide = 2.2) => {
        const g = new THREE.Group(), p = road.pointAt(s), yaw = road.headingAt(s), W = hw + wide;
        g.position.copy(p); g.rotation.y = yaw;
        for (const sx of [-1, 1]) { const post = new THREE.Mesh(postGeo, dark); post.position.set(sx * W, 3.25, 0); post.castShadow = true; g.add(post); const cap = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.6, 0.5), glow); cap.position.set(sx * W, 5.2, 0); g.add(cap); }
        const bar = new THREE.Mesh(barGeo, dark); bar.scale.x = W * 2 + 0.6; bar.position.y = 6.6; g.add(bar);
        const strip = new THREE.Mesh(new THREE.BoxGeometry(W * 2 - 1, 0.22, 0.34), glow); strip.position.y = 6.3; g.add(strip);
        if (withBeam) { const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 240, 12, 1, true), beamMat); beam.position.set(W + 1.5, 120, 0); g.add(beam); }
        this.group.add(g); return g;
      };
      if (def.kind === 'race' || def.kind === 'trial') { arch(def.s0, true); this.startPos.set(def.id, road.pointAt(def.s0)); }
      else if (def.kind === 'trap') {
        arch(def.s0, false, 1.4); this.startPos.set(def.id, road.pointAt(def.s0)); this.armed.set(def.id, true);
      } else {
        for (const s of [def.s0, def.s1]) for (const sx of [-1, 1]) {
          const p = road.pointAt(s, sx * (hw + 1.8)); const b = new THREE.Mesh(new THREE.BoxGeometry(0.25, 2.4, 1.2), glow); b.position.set(p.x, p.y + 1.6, p.z); b.rotation.y = road.headingAt(s); this.group.add(b);
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.2, 6), dark); post.position.set(p.x, p.y + 0.4, p.z); this.group.add(post);
        }
        this.startPos.set(def.id, road.pointAt(def.s0));
      }
    }
    const mk = (opacity: number) => {
      const g = new THREE.Group(), m = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc23d).multiplyScalar(2), transparent: true, opacity, fog: false });
      const pm = new THREE.MeshBasicMaterial({ color: 0xffc23d, transparent: true, opacity: opacity * 0.14, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      for (const sx of [-1, 1]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 9, 10), m); p.position.set(sx * 8, 4.5, 0); g.add(p); }
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(16, 8), pm); pl.position.y = 4.2; g.add(pl);
      g.visible = false; this.group.add(g); return g;
    };
    this.gate = mk(1); this.gateNext = mk(0.35);
  }

  private placeGate(g: THREE.Group, i: number) {
    if (!this.road || i >= this.cps.length) { g.visible = false; return; }
    const s = this.cps[i]; g.position.copy(this.road.pointAt(s)); g.rotation.y = this.road.headingAt(s); g.visible = true;
  }

  begin(def: ActivityDef, car: CarPhysics) {
    const road = this.road = this.net.byId(def.road);
    this.active = def; this.state = 'countdown'; this.countdownT = 3.4; this.lastN = -1; this.time = 0; this.cpIndex = 0;
    const s1 = def.s1 < 0 ? def.s0 + road.length - 30 : def.s1;
    this.total = def.s1 < 0 ? road.length - 30 : (road.def.closed ? road.forwardDist(def.s0, s1) : s1 - def.s0);
    const n = Math.max(2, Math.round(this.total / 330));
    this.cps = []; for (let k = 1; k <= n; k++) this.cps.push(road.wrapS(def.s0 + this.total * k / n));
    this.lastCpS = def.s0 - 4;
    this.placeGate(this.gate, 0); this.placeGate(this.gateNext, 1);
    const p = road.pointAt(def.s0 - 4);
    car.place(p.x, p.z, road.headingAt(def.s0 - 4), p.y + 2); car.frozen = true; car.nitro = 1;
    this.drift = null;
  }
  quit(car: CarPhysics) { this.active = null; this.state = 'idle'; this.gate.visible = this.gateNext.visible = false; car.frozen = false; }
  /** Put the car back on the route at the last checkpoint. */
  respawn(car: CarPhysics) {
    if (!this.road) return;
    const p = this.road.pointAt(this.lastCpS); car.place(p.x, p.z, this.road.headingAt(this.lastCpS), p.y + 2);
  }
  get progress() { return this.cps.length ? this.cpIndex / this.cps.length : 0; }
  get remaining() { return this.road && this.active ? Math.max(0, this.total * (1 - this.progress)) : 0; }

  private record(def: ActivityDef, value: number): Result {
    const d = this.save.data, lower = def.kind === 'race' || def.kind === 'trial';
    const rec = d.activities[def.id] ?? { best: lower ? Infinity : 0, stars: 0, runs: 0 };
    if (rec.best === null) rec.best = lower ? Infinity : 0; // JSON turns Infinity into null
    const stars = starsFor(def, value), prevStars = rec.stars;
    const newBest = lower ? value < rec.best : value > rec.best;
    if (newBest) rec.best = value;
    const gained = Math.max(0, stars - rec.stars);
    rec.stars = Math.max(rec.stars, stars); rec.runs++;
    const timed = def.kind === 'race' || def.kind === 'trial';
    const credits = Math.round(timed ? def.reward * (0.25 + 0.12 * stars) + gained * def.reward * 0.3 : gained * def.reward + (stars > 0 ? 150 : 0));
    const xp = Math.round(timed ? 250 + stars * 250 + gained * 300 : 40 + gained * 250);
    d.activities[def.id] = rec; d.credits += credits; d.xp += xp; this.save.write();
    return { def, value, stars, best: rec.best, newBest, credits, xp, prevStars };
  }

  update(dt: number, car: CarPhysics) {
    const a = this.active;
    // --- countdown
    if (a && this.state === 'countdown') {
      this.countdownT -= dt;
      const n = Math.ceil(this.countdownT - 0.4);
      if (n !== this.lastN) { this.lastN = n; this.hooks.countdown(n); }
      if (this.countdownT <= 0.4) { this.state = 'running'; car.frozen = false; }
    } else if (a && this.state === 'running' && this.road) {
      this.time += dt;
      const s = this.cps[this.cpIndex], gp = this.road.pointAt(s, 0, _v);
      const ahead = car.road === this.road ? this.road.forwardDist(s, car.roadS) : 1e9;
      if ((ahead < 40 && Math.abs(car.roadLat) < 16 && Math.abs(car.pos.y - gp.y) < 12) || gp.distanceTo(car.pos) < 11) {
        this.lastCpS = s; this.cpIndex++;
        if (this.cpIndex >= this.cps.length) {
          const r = this.record(a, this.time);
          this.active = null; this.state = 'idle'; this.gate.visible = this.gateNext.visible = false;
          this.hooks.result(r);
        } else { this.hooks.checkpoint(this.cpIndex, this.cps.length); this.placeGate(this.gate, this.cpIndex); this.placeGate(this.gateNext, this.cpIndex + 1); }
      }
    }
    // --- nearby start prompt, traps, drift zones (free roam only)
    this.nearby = null;
    if (a) return;
    for (const def of ACTIVITIES) {
      const p = this.startPos.get(def.id)!;
      if (def.kind === 'race' || def.kind === 'trial') { if (p.distanceTo(car.pos) < 15) this.nearby = def; continue; }
      if (def.kind === 'trap') {
        const d = p.distanceTo(car.pos);
        if (d > 70) this.armed.set(def.id, true);
        else if (d < 9 && this.armed.get(def.id) && car.speed > 5) {
          this.armed.set(def.id, false);
          const r = this.record(def, car.kmh);
          this.hooks.toast('trap', def.name, String(r.value), r.stars, r.newBest ? 'New personal best' : `best:${r.best}`);
        }
        continue;
      }
      // drift zone
      const road = this.net.byId(def.road);
      const inside = car.road === road && road.forwardDist(def.s0, car.roadS) < road.forwardDist(def.s0, def.s1) && Math.abs(car.roadLat) < road.def.halfWidth + 6;
      if (inside && !this.drift && car.speed > 4 && road.forwardDist(def.s0, car.roadS) < 60) this.drift = { def, score: 0, combo: 1, t: 0 };
      if (this.drift && this.drift.def === def) {
        const dz = this.drift;
        if (!inside) {
          this.drift = null;
          if (dz.score > 200) { const r = this.record(def, Math.round(dz.score)); this.hooks.toast('drift', def.name, Math.round(dz.score).toLocaleString() + ' pts', r.stars, r.newBest ? 'New personal best' : `Best ${Math.round(r.best).toLocaleString()}`); }
        } else {
          const ang = Math.abs(car.driftAngle), spd = car.vel.length();
          if (ang > 0.17 && spd > 10 && car.grounded >= 3) { dz.t += dt; dz.combo = Math.min(5, 1 + dz.t * 0.5); dz.score += clamp(ang, 0, 0.9) * spd * dt * 9 * dz.combo; }
          else { dz.t = Math.max(0, dz.t - dt * 2.5); if (dz.t === 0) dz.combo = 1; }
          if (car.impact > 2.5) { dz.t = 0; dz.combo = 1; }
        }
      }
    }
  }
}
