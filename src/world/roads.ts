// Road splines sampled every STEP metres, with a spatial hash for fast nearest-road queries.
import * as THREE from 'three';
import { ROADS, RoadDef, TUNNEL } from './layout';

export const STEP = 2;
export const F_BRIDGE = 1, F_TUNNEL = 2, F_GUARD_L = 4, F_GUARD_R = 8;

export class Road {
  readonly n: number;
  readonly length: number;
  readonly px: Float32Array; readonly py: Float32Array; readonly pz: Float32Array;
  readonly tx: Float32Array; readonly ty: Float32Array; readonly tz: Float32Array;
  /** horizontal unit right vector */
  readonly rx: Float32Array; readonly rz: Float32Array;
  readonly flags: Uint8Array;
  /** signed curvature (1/m), + = turning right */
  readonly curv: Float32Array;

  constructor(readonly def: RoadDef, readonly index: number) {
    const curve = new THREE.CatmullRomCurve3(def.pts.map(p => new THREE.Vector3(p[0], p[2], p[1])), def.closed, 'centripetal');
    curve.arcLengthDivisions = 6000;
    const len = curve.getLength();
    const n = Math.round(len / STEP);
    this.n = n; this.length = n * STEP;
    const pts = curve.getSpacedPoints(def.closed ? n : n - 1); // closed: last == first
    this.px = new Float32Array(n); this.py = new Float32Array(n); this.pz = new Float32Array(n);
    this.tx = new Float32Array(n); this.ty = new Float32Array(n); this.tz = new Float32Array(n);
    this.rx = new Float32Array(n); this.rz = new Float32Array(n);
    this.flags = new Uint8Array(n); this.curv = new Float32Array(n);
    for (let i = 0; i < n; i++) { this.px[i] = pts[i].x; this.py[i] = pts[i].y; this.pz[i] = pts[i].z; }
    // Smooth elevation so grades are gentle.
    const tmp = new Float32Array(n);
    for (let pass = 0; pass < 3; pass++) {
      const W = 14;
      for (let i = 0; i < n; i++) {
        let s = 0, c = 0;
        for (let k = -W; k <= W; k++) { const j = this.wrap(i + k); if (j < 0) continue; s += this.py[j]; c++; }
        tmp[i] = s / c;
      }
      this.py.set(tmp);
    }
    for (let i = 0; i < n; i++) {
      const a = this.wrapClamp(i - 1), b = this.wrapClamp(i + 1);
      let dx = this.px[b] - this.px[a], dy = this.py[b] - this.py[a], dz = this.pz[b] - this.pz[a];
      const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
      this.tx[i] = dx; this.ty[i] = dy; this.tz[i] = dz;
      const h = Math.hypot(dx, dz) || 1;
      this.rx[i] = -dz / h; this.rz[i] = dx / h;
    }
    for (let i = 0; i < n; i++) {
      const a = this.wrapClamp(i - 2), b = this.wrapClamp(i + 2);
      const cross = this.tx[a] * this.tz[b] - this.tz[a] * this.tx[b];
      this.curv[i] = Math.asin(Math.max(-1, Math.min(1, cross))) / (4 * STEP);
    }
    if (TUNNEL.road === def.id) {
      for (let i = 0; i < n; i++) if (Math.hypot(this.px[i] - TUNNEL.x, this.pz[i] - TUNNEL.z) < TUNNEL.r) this.flags[i] |= F_TUNNEL;
    }
  }
  wrap(i: number): number { if (this.def.closed) return ((i % this.n) + this.n) % this.n; return i < 0 || i >= this.n ? -1 : i; }
  wrapClamp(i: number): number { if (this.def.closed) return ((i % this.n) + this.n) % this.n; return i < 0 ? 0 : i >= this.n ? this.n - 1 : i; }
  wrapS(s: number): number { return this.def.closed ? ((s % this.length) + this.length) % this.length : Math.max(0, Math.min(this.length - STEP, s)); }

  /** Position at distance s and lateral offset (right +). */
  pointAt(s: number, lateral = 0, out = new THREE.Vector3()): THREE.Vector3 {
    s = this.wrapS(s);
    const f = s / STEP, i = Math.floor(f), t = f - i, j = this.wrapClamp(i + 1), i0 = this.wrapClamp(i);
    const rx = this.rx[i0] + (this.rx[j] - this.rx[i0]) * t, rz = this.rz[i0] + (this.rz[j] - this.rz[i0]) * t;
    return out.set(this.px[i0] + (this.px[j] - this.px[i0]) * t + rx * lateral, this.py[i0] + (this.py[j] - this.py[i0]) * t, this.pz[i0] + (this.pz[j] - this.pz[i0]) * t + rz * lateral);
  }
  headingAt(s: number): number { const i = this.wrapClamp(Math.round(this.wrapS(s) / STEP)); return Math.atan2(-this.tx[i], -this.tz[i]); }
  /** Shortest signed distance from s0 forward to s1 along a closed road. */
  forwardDist(s0: number, s1: number): number { let d = s1 - s0; if (this.def.closed) d = ((d % this.length) + this.length) % this.length; return d; }
}

export interface RoadHit { road: Road; i: number; s: number; lateral: number; dist: number; y: number; flags: number; }

const HASH = 32;
export class RoadNetwork {
  readonly roads: Road[];
  private cells = new Map<number, number[]>();
  constructor() {
    this.roads = ROADS.map((d, i) => new Road(d, i));
    for (const r of this.roads) for (let i = 0; i < r.n; i++) {
      const k = this.key(Math.floor(r.px[i] / HASH), Math.floor(r.pz[i] / HASH));
      let a = this.cells.get(k); if (!a) this.cells.set(k, a = []);
      a.push((r.index << 20) | i);
    }
  }
  byId(id: string): Road { return this.roads.find(r => r.def.id === id)!; }
  private key(cx: number, cz: number) { return (cx + 512) * 4096 + (cz + 512); }

  /** Nearest road within ~32 m of (x,z). Reuses `out`. Returns null if none. */
  query(x: number, z: number, out: RoadHit, preferY = NaN): RoadHit | null {
    const cx = Math.floor(x / HASH), cz = Math.floor(z / HASH);
    let best = 1e18, bestRoad: Road | null = null, bi = 0;
    for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
      const a = this.cells.get(this.key(cx + ox, cz + oz)); if (!a) continue;
      for (let k = 0; k < a.length; k++) {
        const v = a[k], r = this.roads[v >> 20], i = v & 0xfffff;
        const dx = x - r.px[i], dz = z - r.pz[i];
        let d = dx * dx + dz * dz;
        if (preferY === preferY) { const dy = preferY - r.py[i]; d += dy * dy * 4; } // disambiguate stacked roads
        if (d < best) { best = d; bestRoad = r; bi = i; }
      }
    }
    if (!bestRoad) return null;
    const r = bestRoad;
    // refine along the segment
    const dxp = x - r.px[bi], dzp = z - r.pz[bi];
    const h = Math.hypot(r.tx[bi], r.tz[bi]) || 1;
    let along = (dxp * r.tx[bi] + dzp * r.tz[bi]) / h;
    along = Math.max(-STEP, Math.min(STEP, along));
    const j = r.wrapClamp(bi + (along >= 0 ? 1 : -1)), t = Math.abs(along) / STEP;
    const qx = r.px[bi] + (r.px[j] - r.px[bi]) * t, qz = r.pz[bi] + (r.pz[j] - r.pz[bi]) * t;
    const lat = (x - qx) * r.rx[bi] + (z - qz) * r.rz[bi];
    out.road = r; out.i = bi; out.s = r.wrapS(bi * STEP + along * h); out.lateral = lat;
    out.dist = Math.hypot(x - qx, z - qz); out.y = r.py[bi] + (r.py[j] - r.py[bi]) * t; out.flags = r.flags[bi];
    return out;
  }
}
export const newHit = (): RoadHit => ({ road: null as unknown as Road, i: 0, s: 0, lateral: 0, dist: 0, y: 0, flags: 0 });
