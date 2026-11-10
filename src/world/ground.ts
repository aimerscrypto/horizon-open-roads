// Physics-facing queries: ground height / normal / surface, wall limits, and static circle colliders.
import { biomeAt, HALF } from './layout';
import { F_BRIDGE, F_TUNNEL, newHit, RoadHit, RoadNetwork } from './roads';
import { HeightField } from './terrain';

export const SURF_ASPHALT = 0, SURF_DIRT = 1, SURF_SAND = 2, SURF_GRASS = 3;
export interface GroundInfo { y: number; nx: number; ny: number; nz: number; surface: number; onRoad: boolean; hit: RoadHit | null; }
export const newGround = (): GroundInfo => ({ y: 0, nx: 0, ny: 1, nz: 0, surface: 0, onRoad: false, hit: null });

export class Ground {
  private hit = newHit();
  private b: [number, number, number] = [0, 0, 0];
  constructor(readonly hf: HeightField, readonly net: RoadNetwork) {}

  /** refY: height of the querying object, used to tell a bridge deck from the river bed below it. */
  at(x: number, z: number, refY: number, out: GroundInfo): GroundInfo {
    const hf = this.hf;
    const hit = this.net.query(x, z, this.hit, refY);
    out.hit = hit; out.onRoad = false;
    if (hit && Math.abs(hit.lateral) <= hit.road.def.halfWidth + 0.9 && refY > hit.y - 2.2) {
      const special = hit.flags & (F_BRIDGE | F_TUNNEL);
      if (special || refY < hit.y + 6) {
        const r = hit.road, i = hit.i;
        out.y = hit.y; out.onRoad = true;
        out.surface = r.def.surface === 'asphalt' ? SURF_ASPHALT : SURF_DIRT;
        // normal from road pitch (roads are not banked)
        const tx = r.tx[i], ty = r.ty[i], tz = r.tz[i], rx = r.rx[i], rz = r.rz[i];
        // n = right x tangent (points up)
        let nx = -rz * ty, ny = rz * tx - rx * tz, nz = rx * ty;
        if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
        const l = Math.hypot(nx, ny, nz) || 1;
        out.nx = nx / l; out.ny = ny / l; out.nz = nz / l;
        return out;
      }
    }
    out.y = hf.sample(x, z);
    const e = 1.5;
    const dx = hf.sample(x + e, z) - hf.sample(x - e, z), dz = hf.sample(x, z + e) - hf.sample(x, z - e);
    const l = Math.hypot(dx, 2 * e, dz);
    out.nx = -dx / l; out.ny = (2 * e) / l; out.nz = -dz / l;
    biomeAt(x, z, this.b);
    out.surface = this.b[0] > 0.5 ? SURF_SAND : SURF_GRASS;
    return out;
  }
}

/** Static circle colliders (trees, rocks, poles) in a uniform grid. */
export class Colliders {
  private cells = new Map<number, number[]>();
  readonly x: number[] = []; readonly z: number[] = []; readonly r: number[] = []; readonly top: number[] = [];
  /** 0 = solid (tree/rock), 1 = light (bush/sign: slows but passes) */
  readonly kind: number[] = [];
  private static readonly S = 16;
  add(x: number, z: number, r: number, top: number, kind = 0) {
    const id = this.x.length;
    this.x.push(x); this.z.push(z); this.r.push(r); this.top.push(top); this.kind.push(kind);
    const S = Colliders.S;
    const p = r + 1.4;
    for (let cx = Math.floor((x - p + HALF) / S); cx <= Math.floor((x + p + HALF) / S); cx++)
      for (let cz = Math.floor((z - p + HALF) / S); cz <= Math.floor((z + p + HALF) / S); cz++) {
        const k = cx * 4096 + cz; let a = this.cells.get(k); if (!a) this.cells.set(k, a = []); a.push(id);
      }
  }
  near(x: number, z: number): number[] | undefined {
    const S = Colliders.S;
    return this.cells.get(Math.floor((x + HALF) / S) * 4096 + Math.floor((z + HALF) / S));
  }
}
