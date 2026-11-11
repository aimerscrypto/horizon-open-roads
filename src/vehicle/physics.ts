// Arcade-realistic rigid-body car: 4 raycast wheels, slip-angle tyres with a friction circle,
// automatic gearbox, impulse contacts against terrain, guardrails and static props.
import * as THREE from 'three';
import { clamp, damp } from '../core/noise';
import { Colliders, Ground, newGround, SURF_ASPHALT } from '../world/ground';
import { F_GUARD_L, F_GUARD_R, F_TUNNEL, Road } from '../world/roads';
import { CarSpec } from './specs';

export interface CarInput { accel: number; decel: number; steer: number; handbrake: boolean; boost: boolean; }
export class Wheel {
  readonly local = new THREE.Vector3();
  comp = 0; prevComp = 0; load = 0; grounded = false; steer = 0; spin = 0; omega = 0;
  /** sliding speed (m/s) used for smoke / skids / squeal */ slide = 0;
  surface = SURF_ASPHALT; onRoad = false;
  readonly contact = new THREE.Vector3(); readonly normal = new THREE.Vector3(0, 1, 0);
  constructor(readonly front: boolean, readonly left: boolean) {}
}

const G = 9.81;
const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3();
const _F = new THREE.Vector3(), _T = new THREE.Vector3(), _n = new THREE.Vector3(), _q = new THREE.Quaternion(), _qi = new THREE.Quaternion();
const _g = newGround();

export class CarPhysics {
  readonly pos = new THREE.Vector3(); readonly quat = new THREE.Quaternion();
  readonly vel = new THREE.Vector3(); readonly ang = new THREE.Vector3();
  readonly wheels: Wheel[] = [new Wheel(true, true), new Wheel(true, false), new Wheel(false, true), new Wheel(false, false)];
  gear = 1; rpm = 900; shiftT = 0; throttle = 0; brake = 0; steerNorm = 0; steerAngle = 0;
  /** signed forward speed m/s */ speed = 0;
  nitro = 1; boosting = false;
  /** events for audio / fx; consumer resets */
  impact = 0; scrape = 0; brush = 0; shifted = 0; landed = 0;
  driftAngle = 0; grounded = 0; airTime = 0;
  surface = SURF_ASPHALT; onRoad = false;
  road: Road | null = null; roadS = 0; roadLat = 0;
  wet = 0;
  private k: number; private c: number; private inertia = new THREE.Vector3(); private attachY: number;
  private half = new THREE.Vector3();
  private bodyPts: THREE.Vector3[] = [];
  frozen = false;

  constructor(public spec: CarSpec, readonly ground: Ground, readonly colliders: Colliders) {
    const s = spec, m = s.mass;
    this.k = Math.pow(2 * Math.PI * s.springHz, 2) * (m / 4);
    this.c = 2 * s.damping * Math.sqrt(this.k * (m / 4));
    const c0 = (m * G / 4) / this.k;
    this.attachY = -s.cgHeight + s.wheelRadius + (s.suspRest - c0);
    const lf = s.wheelbase * 0.52, lr = s.wheelbase * 0.48, ht = s.track / 2;
    this.wheels[0].local.set(-ht, this.attachY, -lf); this.wheels[1].local.set(ht, this.attachY, -lf);
    this.wheels[2].local.set(-ht, this.attachY, lr); this.wheels[3].local.set(ht, this.attachY, lr);
    const L = s.body.length, W = s.body.width, H = s.body.height;
    this.half.set(W / 2, H / 2, L / 2);
    this.inertia.set(m / 12 * (H * H + L * L) * 1.15, m / 12 * (W * W + L * L) * 1.1, m / 12 * (W * W + H * H) * 1.9);
    const yb = -s.cgHeight + s.body.ride + 0.1, yr = -s.cgHeight + H * 0.96;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.bodyPts.push(new THREE.Vector3(sx * W * 0.45, yb, sz * L * 0.48));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.bodyPts.push(new THREE.Vector3(sx * W * 0.33, yr, sz * L * 0.14));
  }

  /** Put the car at rest on the ground at (x,z) facing `yaw`. */
  place(x: number, z: number, yaw: number, refY = 1e4) {
    const g = this.ground.at(x, z, refY, _g);
    this.pos.set(x, g.y + this.spec.cgHeight + 0.06, z);
    this.quat.setFromAxisAngle(_a.set(0, 1, 0), yaw);
    // align to slope
    _n.set(g.nx, g.ny, g.nz); _q.setFromUnitVectors(_a.set(0, 1, 0), _n); this.quat.premultiply(_q);
    this.vel.set(0, 0, 0); this.ang.set(0, 0, 0); this.gear = 1; this.rpm = this.spec.idle; this.steerNorm = 0; this.shiftT = 0;
    for (const w of this.wheels) { w.comp = w.prevComp = this.spec.suspRest - (this.attachY + this.spec.cgHeight - this.spec.wheelRadius); w.slide = 0; }
  }

  private invInertia(v: THREE.Vector3): THREE.Vector3 {
    _qi.copy(this.quat).invert();
    v.applyQuaternion(_qi); v.x /= this.inertia.x; v.y /= this.inertia.y; v.z /= this.inertia.z;
    return v.applyQuaternion(this.quat);
  }

  /** Impulse contact at world point p with unit normal n. Returns impulse magnitude / mass. */
  private contact(p: THREE.Vector3, n: THREE.Vector3, depth: number, e: number, mu: number): number {
    const m = this.spec.mass;
    const r = _c.copy(p).sub(this.pos);
    const vp = _d.copy(this.ang).cross(r).add(this.vel);
    const vn = vp.dot(n);
    let jm = 0;
    if (vn < 0) {
      const rn = _e.copy(r).cross(n);
      const k = 1 / m + this.invInertia(rn.clone()).cross(r).dot(n);
      const j = -(1 + e) * vn / k;
      jm = j / m;
      // friction (approximate with the same effective mass)
      const vt = vp.addScaledVector(n, -vn); const vtl = vt.length();
      const imp = _e.copy(n).multiplyScalar(j);
      if (vtl > 1e-3) imp.addScaledVector(vt, -Math.min(mu * j, vtl / k) / vtl);
      this.vel.addScaledVector(imp, 1 / m);
      this.ang.add(this.invInertia(r.clone().cross(imp)));
    }
    this.pos.addScaledVector(n, Math.min(depth, 0.6) * 0.7);
    return jm;
  }

  step(dt: number, inp: CarInput) {
    if (this.frozen) return;
    const s = this.spec, m = s.mass, ws = this.wheels;
    const fwd = _f.set(0, 0, -1).applyQuaternion(this.quat), up = _u.set(0, 1, 0).applyQuaternion(this.quat), right = _r.set(1, 0, 0).applyQuaternion(this.quat);
    const vF = this.vel.dot(fwd), vR = this.vel.dot(right), spd = this.vel.length();
    this.speed = vF;

    // ---- gearbox / pedals
    let accel = inp.accel, decel = inp.decel;
    if (this.gear >= 1) { if (decel > 0.1 && accel < 0.1 && vF < 0.8) this.gear = -1; }
    else if (accel > 0.1 && vF > -0.8) this.gear = 1;
    const rev = this.gear < 0;
    const thrIn = rev ? decel : accel, brkIn = rev ? accel : decel;
    this.throttle = damp(this.throttle, thrIn, thrIn > this.throttle ? 9 : 14, dt);
    this.brake = damp(this.brake, brkIn, 16, dt);
    const ratio = (rev ? s.gears[0] * 0.95 : s.gears[this.gear - 1]) * s.final;
    const rpmWheel = Math.abs(vF) / s.wheelRadius * ratio * 9.5493;
    let shiftCut = 1;
    if (this.shiftT > 0) { this.shiftT -= dt; shiftCut = 0; }
    else if (!rev && this.grounded >= 2) {
      const n = s.gears.length;
      if (this.gear < n && rpmWheel > s.redline * (0.7 + 0.24 * this.throttle)) { this.gear++; this.shiftT = s.shiftTime; this.shifted = 1; }
      else if (this.gear > 1) {
        const lower = rpmWheel * s.gears[this.gear - 2] / s.gears[this.gear - 1];
        if (rpmWheel < s.redline * (0.36 + 0.22 * this.throttle) && lower < s.redline * 0.9) { this.gear--; this.shiftT = s.shiftTime * 0.8; this.shifted = -1; }
      }
    }
    // ---- nitro
    this.boosting = inp.boost && this.nitro > 0.02 && this.throttle > 0.5 && !rev;
    if (this.boosting) this.nitro = Math.max(0, this.nitro - dt / 4.5); else this.nitro = Math.min(1, this.nitro + dt / 22);

    // ---- steering (speed sensitive + counter-steer assist)
    const vf = s.steerFade * 0.4;
    const lock = Math.max(0.03, s.steerLock / (1 + (spd / vf) * (spd / vf)));
    const rate = Math.abs(inp.steer) > 0.01 ? (Math.sign(inp.steer) !== Math.sign(this.steerNorm) ? 7 : 3.6) : 6;
    const dS = inp.steer - this.steerNorm;
    this.steerNorm += clamp(dS, -rate * dt, rate * dt);
    const beta = spd > 6 ? Math.atan2(vR, Math.abs(vF) + 0.01) : 0;
    this.driftAngle = spd > 8 && vF > 0 ? beta : 0;
    const assist = Math.sign(beta) * clamp((Math.abs(beta) - 0.07) * 0.95, 0, 0.5) * clamp((spd - 6) / 10, 0, 1) * (vF > 0 ? 1 : 0);
    this.steerAngle = clamp(this.steerNorm * Math.max(lock, Math.abs(assist) * 0.6) + assist, -s.steerLock, s.steerLock);

    // ---- suspension pass
    const F = _F.set(0, -m * G, 0), T = _T.set(0, 0, 0);
    let grounded = 0, slipDriven = 0, surfSum = 0, roadCount = 0;
    for (let i = 0; i < 4; i++) {
      const w = ws[i];
      const at = _a.copy(w.local).applyQuaternion(this.quat).add(this.pos);
      const px = at.x - up.x * (s.suspRest + s.wheelRadius), pz = at.z - up.z * (s.suspRest + s.wheelRadius);
      const g = this.ground.at(px, pz, at.y, _g);
      w.surface = g.surface; w.onRoad = g.onRoad;
      w.normal.set(g.nx, g.ny, g.nz);
      const un = up.dot(w.normal);
      w.prevComp = w.comp; w.grounded = false; w.load = 0;
      if (un > 0.25) {
        const t = ((at.x - px) * g.nx + (at.y - g.y) * g.ny + (at.z - pz) * g.nz) / un;
        const comp = s.suspRest - (t - s.wheelRadius);
        if (comp > 0) {
          w.comp = Math.min(comp, s.suspTravel + 0.12); w.grounded = true; grounded++;
          w.contact.copy(at).addScaledVector(up, -t);
          let N = this.k * w.comp + this.c * clamp((w.comp - w.prevComp) / dt, -6, 6);
          if (comp > s.suspTravel) N += (comp - s.suspTravel) * this.k * 7;
          w.load = clamp(N, 0, m * G * 3.2);
        } else w.comp = Math.max(0, w.comp - dt * 2);
      } else w.comp = Math.max(0, w.comp - dt * 2);
      if (w.grounded) { surfSum += w.surface; if (w.onRoad) roadCount++; }
    }
    for (let ax = 0; ax < 2; ax++) { // anti-roll bars
      const l = ws[ax * 2], r = ws[ax * 2 + 1];
      if (l.grounded || r.grounded) {
        const f = s.antiRoll * (l.comp - r.comp) * 4;
        if (l.grounded) l.load = Math.max(0, l.load + f); if (r.grounded) r.load = Math.max(0, r.load - f);
      }
    }
    if (grounded === 0) this.airTime += dt; else { if (this.airTime > 0.35) this.landed = Math.min(1, this.airTime); this.airTime = 0; }
    this.grounded = grounded;
    this.surface = grounded ? Math.round(surfSum / grounded) : this.surface;
    this.onRoad = roadCount >= 2;

    // ---- engine
    const slipBoost = this.wheelspin * 1800;
    let rpmT = Math.max(s.idle, rpmWheel + slipBoost);
    if (this.gear === 1 || rev) rpmT = Math.max(rpmT, s.idle + this.throttle * (s.peakRpm * 0.62 - s.idle));
    if (grounded < 2) rpmT = Math.max(rpmT, s.idle + this.throttle * (s.redline * 0.92 - s.idle));
    rpmT = Math.min(rpmT, s.redline);
    this.rpm = damp(this.rpm, shiftCut ? rpmT : rpmT * 0.82, shiftCut ? 16 : 10, dt);
    const x = this.rpm / s.peakRpm;
    let tq = x < 1 ? 0.6 + 0.4 * Math.sin(x * Math.PI / 2) : 1 - 0.42 * Math.pow((this.rpm - s.peakRpm) / (s.redline - s.peakRpm), 2);
    if (rpmWheel >= s.redline * 0.995) tq = 0;
    let drive = tq * s.maxTorque * this.throttle * ratio * 0.9 / s.wheelRadius * shiftCut * (this.boosting ? 1.5 : 1);
    if (rev) drive = -Math.min(drive, m * 4.5) * (vF < -14 ? 0 : 1);
    const engBrake = this.throttle < 0.05 ? -Math.sign(vF) * Math.min(1, Math.abs(vF)) * (0.5 + 1.1 * this.rpm / s.redline) * m * 0.55 : 0;
    const brakeF = this.brake * s.brakeG * m * G;
    const N0 = m * G / 4;
    const wetMu = 1 - 0.22 * this.wet;
    let spinAcc = 0;

    // ---- tyre pass
    for (let i = 0; i < 4; i++) {
      const w = ws[i];
      const steer = w.front ? this.steerAngle : 0; w.steer = steer;
      if (!w.grounded) { w.slide = 0; w.omega = damp(w.omega, this.throttle * 60 * (this.isDriven(w) ? 1 : 0), 2, dt); w.spin += w.omega * dt; continue; }
      const n = w.normal, N = w.load;
      F.addScaledVector(n, N);
      T.add(_a.copy(w.contact).sub(this.pos).cross(_b.copy(n).multiplyScalar(N)));
      // wheel frame on the ground plane
      const h = _a.copy(fwd).multiplyScalar(Math.cos(steer)).addScaledVector(right, Math.sin(steer));
      const fw = h.addScaledVector(n, -h.dot(n)).normalize();
      const sd = _b.copy(fw).cross(n);
      const rc = _c.copy(w.contact).sub(this.pos);
      const vc = _d.copy(this.ang).cross(rc).add(this.vel);
      const vLong = vc.dot(fw), vLat = vc.dot(sd), vAbs = Math.hypot(vLong, vLat);
      const off = s.offroad;
      const surfMu = w.surface === 0 ? 1 : w.surface === 1 ? 0.6 + 0.3 * off : 0.42 + 0.36 * off;
      const mu = s.grip * (w.front ? 1 : s.rearGrip) * surfMu * (w.surface === 0 ? wetMu : 1 - 0.1 * this.wet) * clamp(1.12 - 0.12 * N / N0, 0.82, 1.14);
      const maxF = mu * N;
      let Fx = 0, Fy = 0, slide = 0;
      const locked = inp.handbrake && !w.front;
      const peak = w.front ? 0.135 : 0.118;
      const alpha = Math.atan2(vLat, Math.max(Math.abs(vLong), 2.5));
      const xa = Math.abs(alpha) / peak;
      if (locked) {
        // locked rears: sliding friction along the travel direction, with reduced side bite so the tail steps out progressively
        const inv = maxF / Math.max(vAbs, 0.6);
        Fx = -vLong * inv * 0.42; Fy = -vLat * inv * 0.62; slide = vAbs;
      } else {
        const share = s.drive === 'rwd' ? (w.front ? 0 : 0.5) : (w.front ? (1 - s.rearBias) / 2 : s.rearBias / 2);
        const sgn = Math.abs(vLong) < 0.5 ? vLong / 0.5 : Math.sign(vLong);
        const crr = w.surface === 0 ? 0.013 : w.surface === 1 ? 0.03 : 0.085 - 0.05 * off;
        let req = (drive + engBrake) * share - sgn * (brakeF * (w.front ? 0.31 : 0.19) + crr * N);
        if (this.throttle < 0.02 && this.brake < 0.02 && Math.abs(vLong) < 0.6) req = -vLong * (N / G) * 6; // hold still
        const over = Math.abs(req) / Math.max(maxF, 1);
        // light traction control: full drive in a straight line, held back while cornering until the car is already sliding
        const tc = req > 0 && vLong > 0 ? Math.max(0.96 - 0.24 * Math.min(1, xa), 0.74 + 0.16 * clamp((Math.abs(beta) - 0.1) / 0.2, 0, 1)) : 1;
        Fx = clamp(req, -maxF, maxF * tc) * (over > 1 ? 0.96 : 1);
        if (share > 0 && over > 1 && this.throttle > 0.2) { spinAcc += Math.min(over - 1, 1.5) * share; slide += Math.min(over - 1, 1.5) * 6 + 2; }
        const used = Fx / Math.max(maxF, 1);
        const latCap = maxF * Math.sqrt(Math.max(0.1, 1 - used * used * 0.72));
        const curve = xa < 1 ? xa * (2 - xa) : 1 - 0.2 * Math.min(1, (xa - 1) / 4);
        Fy = -Math.sign(alpha) * curve * latCap;
        if (vAbs < 2) { const servo = clamp(-vLat * (N / G) * 9, -latCap, latCap); const t = vAbs / 2; Fy = servo * (1 - t) + Fy * t; }
        if (xa > 1.15) slide += Math.abs(vLat) * Math.min(1, (xa - 1.15) * 1.5);
        if (this.brake > 0.9 && over > 1 && Math.abs(vLong) > 6) slide += 3;
      }
      w.slide = damp(w.slide, slide, 12, dt);
      const tf = _e.copy(fw).multiplyScalar(Fx).addScaledVector(sd, Fy);
      F.add(tf);
      rc.addScaledVector(up, s.cgHeight * 0.6); // raise the tyre force application point: less body roll, more stability
      T.add(rc.cross(tf));
      const targetOmega = locked ? 0 : vLong / s.wheelRadius * (1 + (this.isDriven(w) ? this.wheelspin * 1.2 : 0));
      w.omega = damp(w.omega, targetOmega, 30, dt); w.spin += w.omega * dt;
    }
    slipDriven = spinAcc;
    this.wheelspin = damp(this.wheelspin, slipDriven, 10, dt);

    // ---- aero
    const offDrag = grounded && this.surface >= 2 ? 0.25 * (1.2 - s.offroad) : 0;
    F.addScaledVector(this.vel, -spd * s.drag * (this.boosting ? 0.85 : 1) - offDrag * m * 0.12);
    if (grounded) F.addScaledVector(up, -s.downforce * spd * spd);
    if (this.boosting) F.addScaledVector(fwd, m * 2.2);
    if (grounded === 0) { // gentle air stabilisation
      const tilt = _a.copy(up).cross(_b.set(0, 1, 0));
      T.addScaledVector(tilt, m * 2.2); this.ang.multiplyScalar(1 - 0.6 * dt);
    }

    // ---- integrate
    this.vel.addScaledVector(F, dt / m);
    this.ang.add(this.invInertia(T).multiplyScalar(dt));
    this.ang.multiplyScalar(1 - 0.35 * dt);
    // drift stability: damp yaw once the slide gets deep, so slides are catchable on a keyboard
    if (grounded >= 2) { const deep = clamp((Math.abs(beta) - 0.3) / 0.45, 0, 1); if (deep > 0 && this.ang.y * beta > 0) this.ang.y *= 1 - 3.2 * deep * dt; else if (deep > 0) this.ang.y *= 1 - 1.2 * deep * dt; }
    const wl = this.ang.length();
    if (wl > 9) this.ang.multiplyScalar(9 / wl);
    this.pos.addScaledVector(this.vel, dt);
    if (wl > 1e-6) { _q.setFromAxisAngle(_a.copy(this.ang).multiplyScalar(1 / wl), wl * dt); this.quat.premultiply(_q).normalize(); }

    // ---- body vs terrain / guardrails
    const hit0 = this.ground.at(this.pos.x, this.pos.z, this.pos.y, _g).hit;
    if (hit0) { this.road = hit0.road; this.roadS = hit0.s; this.roadLat = hit0.lateral; } else this.road = null;
    for (let i = 0; i < this.bodyPts.length; i++) {
      const p = _a.copy(this.bodyPts[i]).applyQuaternion(this.quat).add(this.pos);
      const g = this.ground.at(p.x, p.z, this.pos.y + 0.5, _g);
      const depth = (g.y - p.y) * g.ny;
      if (depth > 0) {
        const j = this.contact(p, _n.set(g.nx, g.ny, g.nz), depth, 0.08, 0.55);
        if (j > 1.2) this.impact = Math.max(this.impact, j * 0.5);
        if (i >= 4) this.scrape = Math.max(this.scrape, clamp(spd / 20, 0, 1));
      }
      const h = g.hit;
      if (i < 4 && h && (h.flags & (F_GUARD_L | F_GUARD_R))) {
        const side = h.lateral > 0 ? F_GUARD_R : F_GUARD_L;
        const tun = (h.flags & F_TUNNEL) !== 0;
        if ((h.flags & side) && p.y > h.y - 1.2 && (tun || p.y < h.y + 1.5)) {
          const lim = h.road.def.halfWidth + (tun ? 0.35 : 0.8);
          const d = Math.abs(h.lateral) - lim;
          if (d > 0 && d < 2.6) {
            const sg = h.lateral > 0 ? -1 : 1, r = h.road;
            const j = this.contact(p, _n.set(r.rx[h.i] * sg, 0, r.rz[h.i] * sg), d, 0.1, 0.22);
            if (j > 0.6) this.impact = Math.max(this.impact, j);
            this.scrape = Math.max(this.scrape, clamp(spd / 25, 0.15, 1));
          }
        }
      }
    }
    // ---- static props
    const cr = this.half.x + 0.05;
    for (let k = -1; k <= 1; k++) {
      const c = _a.copy(fwd).multiplyScalar(-k * (this.half.z - cr * 0.9)).add(this.pos);
      const ids = this.colliders.near(c.x, c.z); if (!ids) continue;
      const col = this.colliders;
      for (let q = 0; q < ids.length; q++) {
        const id = ids[q], dx = c.x - col.x[id], dz = c.z - col.z[id], rr = col.r[id] + cr, d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr || this.pos.y - s.cgHeight > col.top[id]) continue;
        if (col.kind[id] === 1) { this.vel.multiplyScalar(1 - 1.4 * dt); this.brush = Math.max(this.brush, clamp(spd / 15, 0, 1)); continue; }
        const d = Math.sqrt(d2) || 0.01;
        const j = this.contact(c, _n.set(dx / d, 0, dz / d), rr - d, 0.18, 0.3);
        if (j > 0.4) this.impact = Math.max(this.impact, j);
      }
    }
    // world bounds
    const B = 2225;
    if (Math.abs(this.pos.x) > B) { this.pos.x = Math.sign(this.pos.x) * B; this.vel.x *= -0.3; }
    if (Math.abs(this.pos.z) > B) { this.pos.z = Math.sign(this.pos.z) * B; this.vel.z *= -0.3; }
  }
  wheelspin = 0;
  isDriven(w: Wheel) { return this.spec.drive === 'awd' || !w.front; }
  get kmh() { return Math.abs(this.speed) * 3.6; }
  get upright() { return _a.set(0, 1, 0).applyQuaternion(this.quat).y; }
  get yaw() { const f = _a.set(0, 0, -1).applyQuaternion(this.quat); return Math.atan2(-f.x, -f.z); }
}
