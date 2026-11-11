// Chase / hood / cockpit cameras with speed FOV, drift lag and impact shake.
import * as THREE from 'three';
import { clamp, damp } from '../core/noise';
import { Ground, newGround } from '../world/ground';
import { CarPhysics } from '../vehicle/physics';
import { CarVisual } from '../vehicle/carVisual';

const _f = new THREE.Vector3(), _t = new THREE.Vector3(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _g = newGround();
export const CAM_NAMES = ['Chase', 'Far chase', 'Hood', 'Cockpit'];
export class CameraRig {
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.12, 14000);
  mode = 0; shakeEnabled = true;
  private yaw = 0; private shake = 0; private pitch = 0; private first = true; private t = 0;
  private pos = new THREE.Vector3(); private look = new THREE.Vector3(); private fov = 60;
  orbit = 0;
  constructor(private ground: Ground) {}
  cycle(hasCockpit: boolean) { this.mode = (this.mode + 1) % 4; if (this.mode === 3 && !hasCockpit) this.mode = 0; this.first = true; }
  kick(strength: number) { this.shake = Math.min(1, this.shake + strength); }
  snap() { this.first = true; }

  /** Slow orbit used by menus / garage. */
  updateOrbit(dt: number, target: THREE.Vector3, radius: number, height: number, speed: number) {
    this.orbit += dt * speed;
    this.pos.set(target.x + Math.cos(this.orbit) * radius, target.y + height, target.z + Math.sin(this.orbit) * radius);
    const g = this.ground.at(this.pos.x, this.pos.z, this.pos.y, _g); if (this.pos.y < g.y + 0.5) this.pos.y = g.y + 0.5;
    this.camera.position.copy(this.pos); this.camera.fov = damp(this.camera.fov, 38, 4, dt); this.camera.updateProjectionMatrix();
    this.camera.up.set(0, 1, 0); this.camera.lookAt(target.x, target.y + 0.35, target.z); this.first = true;
  }

  update(dt: number, car: CarPhysics, vis: CarVisual) {
    this.t += dt;
    const cam = this.camera, spd = car.vel.length();
    const fwd = _f.set(0, 0, -1).applyQuaternion(car.quat);
    this.shake = Math.max(0, this.shake - dt * 2.4);
    const fast = clamp((spd - 30) / 55, 0, 1);
    const rumble = this.shakeEnabled ? this.shake * this.shake * 0.35 + fast * fast * 0.034 + (car.boosting ? 0.02 : 0) + (car.surface >= 1 && car.grounded ? clamp(spd / 40, 0, 1) * 0.016 : 0) : 0;
    let targetFov = 60;
    if (this.mode <= 1) {
      // yaw follows a blend of heading and velocity so slides show the car's angle
      let hx = fwd.x, hz = fwd.z;
      if (spd > 6 && car.speed > 0) { const k = clamp((spd - 6) / 14, 0, 0.6); hx = hx * (1 - k) + car.vel.x / spd * k; hz = hz * (1 - k) + car.vel.z / spd * k; }
      const want = Math.atan2(-hx, -hz);
      if (this.first) { this.yaw = want; }
      let d = want - this.yaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      this.yaw += d * (1 - Math.exp(-(3.2 + spd * 0.045) * dt));
      const far = this.mode === 1;
      const dist = (far ? 9.4 : 5.9) - clamp(spd / 85, 0, 1) * 1.5 + (car.boosting ? 0.6 : 0), height = (far ? 3.3 : 1.95) + vis.spec.body.height * 0.3 - clamp(spd / 85, 0, 1) * 0.42;
      this.pitch = damp(this.pitch, fwd.y, 3, dt);
      _p.set(car.pos.x + Math.sin(this.yaw) * dist, car.pos.y + height - this.pitch * dist * 0.55, car.pos.z + Math.cos(this.yaw) * dist);
      const g = this.ground.at(_p.x, _p.z, _p.y + 2, _g); if (_p.y < g.y + 0.7) _p.y = g.y + 0.7;
      if (this.first) this.pos.copy(_p); else { this.pos.x = _p.x; this.pos.z = _p.z; this.pos.y = damp(this.pos.y, _p.y, 9, dt); }
      _t.copy(car.pos).addScaledVector(fwd, 3.2); _t.y += 0.95;
      if (this.first) this.look.copy(_t); else this.look.lerp(_t, 1 - Math.exp(-14 * dt));
      cam.position.copy(this.pos);
      cam.up.set(0, 1, 0); cam.lookAt(this.look);
      targetFov = (far ? 56 : 58) + Math.pow(clamp(spd / 88, 0, 1), 1.25) * 27 + (car.boosting ? 8 : 0);
    } else {
      const a = this.mode === 2 ? vis.hoodCam : vis.cockpitCam;
      cam.position.copy(a).applyQuaternion(car.quat).add(car.pos);
      _q.copy(car.quat);
      if (this.first) cam.quaternion.copy(_q); else cam.quaternion.slerp(_q, 1 - Math.exp(-22 * dt));
      targetFov = (this.mode === 2 ? 66 : 70) + Math.pow(clamp(spd / 88, 0, 1), 1.25) * 30 + (car.boosting ? 8 : 0);
    }
    if (rumble > 0) {
      cam.position.x += (Math.sin(this.t * 71) + Math.sin(this.t * 113)) * rumble * 0.5;
      cam.position.y += (Math.sin(this.t * 89) + Math.sin(this.t * 137)) * rumble * 0.5;
      cam.rotateZ(Math.sin(this.t * 97) * rumble * 0.06); cam.rotateX(Math.sin(this.t * 61) * rumble * 0.05);
    }
    this.fov = this.first ? targetFov : damp(this.fov, targetFov, 2.6, dt);
    if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
    this.first = false;
  }
}
