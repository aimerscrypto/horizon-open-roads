// Headless QA: world statistics + an AI driver lapping every road in every car.
import { RoadNetwork, STEP, F_BRIDGE, F_TUNNEL, F_GUARD_L, F_GUARD_R } from '../src/world/roads';
import { HeightField } from '../src/world/terrain';
import { Ground, Colliders } from '../src/world/ground';
import { CarPhysics } from '../src/vehicle/physics';
import { CARS } from '../src/vehicle/specs';
import { ROADS } from '../src/world/layout';

const t0 = Date.now();
const net = new RoadNetwork();
const hf = new HeightField(net);
console.log('world gen ms', Date.now() - t0);
const ground = new Ground(hf, net);
const mode = process.argv[2] || 'all';

for (const r of net.roads) {
  let maxGrade = 0, minR = 1e9, minRs = 0;
  const ranges = (flag: number) => { const out: string[] = []; let st = -1; for (let i = 0; i <= r.n; i++) { const on = i < r.n && (r.flags[i] & flag); if (on && st < 0) st = i; if (!on && st >= 0) { out.push(`${st * STEP}-${i * STEP}`); st = -1; } } return out.join(' '); };
  for (let i = 0; i < r.n; i++) { maxGrade = Math.max(maxGrade, Math.abs(r.ty[i])); const c = Math.abs(r.curv[i]); if (c > 1e-6 && 1 / c < minR) { minR = 1 / c; minRs = i * STEP; } }
  console.log(`road ${r.def.id}: length ${r.length} m, max grade ${(maxGrade * 100).toFixed(1)}%, min radius ${minR.toFixed(0)} m @${minRs}`);
  console.log('  bridges:', ranges(F_BRIDGE)); console.log('  tunnel:', ranges(F_TUNNEL));
  let gl = 0; for (let i = 0; i < r.n; i++) if (r.flags[i] & (F_GUARD_L | F_GUARD_R)) gl++;
  console.log('  guardrail samples:', gl, 'of', r.n);
  // control point distances
  const cps: string[] = [];
  ROADS[r.index].pts.forEach((p, k) => { let b = 0, bd = 1e9; for (let i = 0; i < r.n; i++) { const d = Math.hypot(r.px[i] - p[0], r.pz[i] - p[1]); if (d < bd) { bd = d; b = i; } } cps.push(`${k}:${b * STEP}`); });
  console.log('  cp s:', cps.join(' '));
}
let hmin = 1e9, hmax = -1e9; for (const v of hf.h) { if (v < hmin) hmin = v; if (v > hmax) hmax = v; }
console.log('height range', hmin.toFixed(0), hmax.toFixed(0));
if (mode === 'world') process.exit(0);

function drive(carIdx: number, roadId: string, skill: number) {
  const spec = CARS[carIdx], road = net.byId(roadId);
  const car = new CarPhysics(spec, ground, new Colliders());
  const p = road.pointAt(20);
  car.place(p.x, p.z, road.headingAt(20), p.y + 2);
  const dt = 1 / 120; let t = 0, lapS = 0, lastS = 20, maxKmh = 0, offTime = 0, flips = 0, stuck = 0, impacts = 0, t100 = -1, maxLat = 0;
  const inp = { accel: 0, decel: 0, steer: 0, handbrake: false, boost: false };
  let wasOn = true;
  const target = road.length - (road.def.closed ? 0 : 60);
  while (t < 900 && lapS < target - 30) {
    const spd = Math.max(0, car.speed);
    const s = car.road === road ? car.roadS : lastS;
    // pure pursuit steering
    const la = 9 + spd * 0.55;
    const tp = road.pointAt(s + la, 0);
    const yaw = car.yaw; const dx = tp.x - car.pos.x, dz = tp.z - car.pos.z;
    let want = Math.atan2(-dx, -dz) - yaw; while (want > Math.PI) want -= 2 * Math.PI; while (want < -Math.PI) want += 2 * Math.PI;
    const vfS = spec.steerFade * 0.4, lockNow = Math.max(0.03, spec.steerLock / (1 + (spd / vfS) * (spd / vfS)));
    inp.steer = Math.max(-1, Math.min(1, -Math.atan(2 * spec.wheelbase * Math.sin(want) / la) * 1.5 / lockNow));
    // speed target from upcoming curvature
    let vmax = 400;
    for (let d = 0; d < 20 + spd * 4.2; d += 6) {
      const i = road.wrapClamp(Math.round((s + d) / STEP)); const c = Math.abs(road.curv[i]) + 1e-4;
      const vc = Math.sqrt(spec.grip * 9.81 * skill / c); const vb = Math.sqrt(vc * vc + 2 * spec.brakeG * 9.81 * 0.75 * d);
      vmax = Math.min(vmax, vb);
    }
    inp.accel = Math.max(0, Math.min(1, (vmax - spd) / 4)); inp.decel = spd > vmax + 1.5 ? Math.min(1, (spd - vmax) / 6) : 0;
    car.step(dt, inp); t += dt;
    if (car.impact > 2) impacts++; car.impact = 0; car.scrape = 0;
    if (car.road === road) { const d = road.forwardDist(lastS, car.roadS); if (d < 50) { lapS += d; lastS = car.roadS; } }
    if (!car.onRoad) { offTime += dt; if (process.env.DBG && wasOn) console.log(`  off @s ${s.toFixed(0)} kmh ${car.kmh.toFixed(0)} vmax ${(vmax*3.6).toFixed(0)} lat ${car.roadLat.toFixed(1)} curv R ${(1/(Math.abs(road.curv[road.wrapClamp(Math.round(s/STEP))])+1e-5)).toFixed(0)} drift ${car.driftAngle.toFixed(2)} gnd ${car.grounded} up ${car.upright.toFixed(2)} flags ${road.flags[road.wrapClamp(Math.round(s/STEP))]}`); } wasOn = car.onRoad;
    if (car.upright < 0.2) { flips++; const q = road.pointAt(lastS + 4); car.place(q.x, q.z, road.headingAt(lastS + 4), q.y + 2); }
    if (spd < 1 && t > 5) { stuck += dt; if (stuck > 3) { stuck = 0; flips++; const q = road.pointAt(lastS + 10); car.place(q.x, q.z, road.headingAt(lastS + 10), q.y + 2); } } else stuck = 0;
    maxKmh = Math.max(maxKmh, car.kmh); if (t100 < 0 && car.kmh >= 100) t100 = t;
    if (!isFinite(car.pos.x)) { console.log('NaN!'); break; }
  }
  console.log(`${spec.id.padEnd(6)} ${roadId.padEnd(5)} skill ${skill}: ${lapS.toFixed(0)} m in ${t.toFixed(1)} s (avg ${(lapS / t * 3.6).toFixed(0)} km/h), max ${maxKmh.toFixed(0)}, 0-100 ${t100.toFixed(1)} s, off-road ${offTime.toFixed(1)} s, resets ${flips}, hard impacts ${impacts}`);
}
if (process.env.ONE) drive(Number(process.env.ONE), process.env.ROAD || 'loop', Number(process.env.SKILL || 0.8)); else { for (let c = 0; c < CARS.length; c++) { drive(c, 'loop', 0.8); }
drive(2, 'cut', 0.6); drive(0, 'cut', 0.5); }
