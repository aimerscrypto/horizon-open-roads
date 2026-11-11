// Headless handling checks: launch, top speed, braking, handbrake entry and drift hold for every car.
import { RoadNetwork } from '../src/world/roads';
import { HeightField } from '../src/world/terrain';
import { Ground, Colliders } from '../src/world/ground';
import { CarPhysics } from '../src/vehicle/physics';
import { CARS } from '../src/vehicle/specs';
const net = new RoadNetwork(), hf = new HeightField(net), ground = new Ground(hf, net), road = net.byId('loop');
const dt = 1 / 120;
for (const spec of CARS) {
  const car = new CarPhysics(spec, ground, new Colliders());
  const p = road.pointAt(620); car.place(p.x, p.z, road.headingAt(620), p.y + 2);
  const run = (sec: number, inp: any) => { for (let t = 0; t < sec; t += dt) car.step(dt, { accel: 0, decel: 0, steer: 0, handbrake: false, boost: false, ...inp }); };
  // keep the car pointed down the road while accelerating
  let t = 0, t100 = -1, t200 = -1; let top = 0;
  const steerTo = () => { const tp = road.pointAt(car.roadS + 30); let w = Math.atan2(-(tp.x - car.pos.x), -(tp.z - car.pos.z)) - car.yaw; while (w > Math.PI) w -= 2 * Math.PI; while (w < -Math.PI) w += 2 * Math.PI; return Math.max(-1, Math.min(1, -w * 6)); };
  run(1, {});
  for (; t < 9; t += dt) { car.step(dt, { accel: 1, decel: 0, steer: steerTo(), handbrake: false, boost: false }); if (t100 < 0 && car.kmh >= 100) t100 = t; if (t200 < 0 && car.kmh >= 200) t200 = t; }
  const v0 = car.kmh; let bd = 0; const s0 = car.pos.clone();
  // handbrake flick at ~95 km/h, then hands-off-steering recovery under power (keyboard-style)
  car.place(p.x, p.z, road.headingAt(620), p.y + 2); run(0.5, {}); while (car.kmh < 95) car.step(dt, { accel: 1, decel: 0, steer: steerTo(), handbrake: false, boost: false });
  run(0.5, { steer: 1, handbrake: true, accel: 0.5 }); const hbK = car.kmh, hbA = car.driftAngle;
  const trace: string[] = [];
  for (let k = 0; k < 5; k++) { run(0.5, { steer: 0, accel: 1 }); trace.push(`${car.driftAngle.toFixed(2)}@${car.kmh.toFixed(0)}`); }
  const holdK = car.kmh, holdA = trace.join(' ');
  // straight line braking from 100
  car.place(p.x, p.z, road.headingAt(620), p.y + 2); run(0.5, {}); while (car.kmh < 100) car.step(dt, { accel: 1, decel: 0, steer: steerTo(), handbrake: false, boost: false });
  const b0 = car.pos.clone(); while (car.kmh > 2) car.step(dt, { accel: 0, decel: 1, steer: 0, handbrake: false, boost: false }); bd = b0.distanceTo(car.pos);
  console.log(`${spec.id.padEnd(6)} 0-100 ${t100.toFixed(1)}s  0-200 ${t200 < 0 ? ' n/a' : t200.toFixed(1) + 's'}  9s: ${v0.toFixed(0)} km/h | handbrake 0.9s -> ${hbK.toFixed(0)} km/h angle ${hbA.toFixed(2)} | +1.5s power -> ${holdK.toFixed(0)} km/h trace ${holdA} | 100-0 in ${bd.toFixed(0)} m  upright ${car.upright.toFixed(2)}`);
  void top; void s0;
}
