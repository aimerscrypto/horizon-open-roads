// Visual car: either the downloaded concept-car GLB or a procedural body, with shared wheel rig and lights.
import * as THREE from 'three';
import { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { buildBody } from './carBody';
import { CarPhysics } from './physics';
import { CarSpec } from './specs';

const HERO_SCALE = 0.9, HERO_WHEEL_R = 0.384;

export class CarVisual {
  readonly group = new THREE.Group();
  /** wheel pivots in car frame: FL, FR, RL, RR */
  readonly wheels: THREE.Group[] = [];
  private restY: number[] = [];
  private brakeMats: THREE.MeshStandardMaterial[] = []; private headMats: THREE.MeshStandardMaterial[] = []; private revMats: THREE.MeshStandardMaterial[] = [];
  private steeringWheel: THREE.Object3D | null = null; private steerBase = new THREE.Quaternion();
  readonly headLight = new THREE.SpotLight(0xdfe9ff, 0, 130, 0.5, 0.6, 1.4);
  /** camera anchor points in car frame */
  readonly hoodCam = new THREE.Vector3(); readonly cockpitCam = new THREE.Vector3();
  paint: THREE.Material[] = [];

  constructor(readonly spec: CarSpec, hero: GLTF) {
    const s = spec, lf = s.wheelbase * 0.52, lr = s.wheelbase * 0.48, ht = s.track / 2;
    const wheelPos = [[-ht, -lf], [ht, -lf], [-ht, lr], [ht, lr]];
    const y0 = -s.cgHeight + s.wheelRadius;
    // hero scene, oriented so its nose points to -Z
    const src = hero.scene.clone(true);
    src.rotation.y = Math.PI; src.scale.setScalar(HERO_SCALE); src.updateMatrixWorld(true);
    const srcWheel = (name: string) => src.getObjectByName(name)!;
    const names = ['WheelFrontL', 'WheelFrontR', 'WheelRearL', 'WheelRearR'];

    if (s.model === 'glb') {
      const holder = new THREE.Group(); holder.add(src);
      // align model wheel midpoint with the physics wheel midpoint
      const fl = srcWheel('WheelFrontL').getWorldPosition(new THREE.Vector3()), rl = srcWheel('WheelRearL').getWorldPosition(new THREE.Vector3());
      holder.position.set(0, y0 - fl.y, (-lf + lr) / 2 - (fl.z + rl.z) / 2);
      this.group.add(holder); this.group.updateMatrixWorld(true);
      names.forEach((n, i) => {
        const node = srcWheel(n); node.quaternion.identity(); node.updateMatrixWorld(true);
        const piv = new THREE.Group(); node.getWorldPosition(piv.position); this.group.add(piv); piv.updateMatrixWorld(true);
        piv.attach(node); this.wheels.push(piv); this.restY.push(piv.position.y);
      });
      this.steeringWheel = src.getObjectByName('InteriorSteeringCylinder') ?? null;
      if (this.steeringWheel) this.steerBase.copy(this.steeringWheel.quaternion);
      src.traverse(o => {
        const m = o as THREE.Mesh; if (!m.isMesh) return;
        m.castShadow = true; m.receiveShadow = true;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        mats.forEach((mat, k) => {
          const pm = mat as THREE.MeshPhysicalMaterial;
          if (pm.name === 'Glass' || pm.transmission > 0) {
            const g = new THREE.MeshPhysicalMaterial({ color: 0x0b1014, metalness: 0.85, roughness: 0.03, transparent: true, opacity: 0.55, envMapIntensity: 1.5, name: 'Glass' });
            if (Array.isArray(m.material)) m.material[k] = g; else m.material = g; m.castShadow = false; return;
          }
          pm.iridescence = 0; pm.transmission = 0;
          if (/^Paint 1/.test(pm.name)) { pm.color.set(s.body.paint); pm.clearcoat = 1; pm.clearcoatRoughness = 0.04; pm.metalness = 0.6; pm.roughness = 0.3; pm.envMapIntensity = 1.3; this.paint.push(pm); }
          if (/^Paint 2/.test(pm.name)) { pm.color.set(0x101114); pm.clearcoat = 1; pm.roughness = 0.35; }
          if (pm.name === 'Brakelight') { pm.emissive.set(0xff1a12); this.brakeMats.push(pm); }
          if (pm.name === 'Headlight') { pm.emissive.set(0xdfe8ff); this.headMats.push(pm); }
        });
      });
      this.hoodCam.set(0, 0.52, -0.55); this.cockpitCam.set(-0.33, 0.56, 0.18);
      this.headLight.position.set(0, 0.2, -lf - 0.6);
    } else {
      const body = buildBody(s);
      body.group.position.y = -s.cgHeight; this.group.add(body.group);
      this.brakeMats.push(body.brake); this.headMats.push(body.head); this.revMats.push(body.reverse); this.paint.push(body.paint);
      const sc = s.wheelRadius / (HERO_WHEEL_R * HERO_SCALE);
      wheelPos.forEach((p, i) => {
        const node = srcWheel(names[i % 2 === 0 ? 0 : 1]).clone(true);
        node.quaternion.identity(); node.position.set(0, 0, 0); node.scale.setScalar(1);
        const fix = new THREE.Group(); fix.rotation.set(-Math.PI / 2, Math.PI, 0, 'YXZ'); fix.scale.setScalar(HERO_SCALE * sc); fix.add(node);
        const piv = new THREE.Group(); piv.position.set(p[0], y0, p[1]); piv.add(fix);
        this.group.add(piv); this.wheels.push(piv); this.restY.push(y0);
      });
      this.hoodCam.set(0, s.body.height * 0.72 - s.cgHeight, -0.35);
      this.cockpitCam.copy(this.hoodCam);
      this.headLight.position.set(0, body.headPos.y - s.cgHeight, body.headPos.z - 0.2);
    }
    this.group.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; } });
    this.headLight.target.position.set(0, this.headLight.position.y - 0.7, this.headLight.position.z - 30);
    this.group.add(this.headLight, this.headLight.target);
  }

  setPaint(color: number) { for (const p of this.paint) (p as THREE.MeshPhysicalMaterial).color.set(color); }

  update(car: CarPhysics, headOn: number) {
    this.group.position.copy(car.pos); this.group.quaternion.copy(car.quat);
    const s = this.spec, c0 = (s.mass * 9.81 / 4) / (Math.pow(2 * Math.PI * s.springHz, 2) * (s.mass / 4));
    for (let i = 0; i < 4; i++) {
      const w = car.wheels[i], piv = this.wheels[i];
      piv.position.y = this.restY[i] + (w.comp - c0);
      piv.rotation.set(-w.spin, -w.steer, 0, 'YXZ');
    }
    const rev = car.gear < 0;
    const brakeOn = (!rev && car.brake > 0.05) || (rev && car.brake > 0.05);
    for (const m of this.brakeMats) m.emissiveIntensity = brakeOn ? 5.5 : 0.35 + headOn * 0.6;
    for (const m of this.headMats) m.emissiveIntensity = 0.5 + headOn * 5;
    for (const m of this.revMats) m.emissiveIntensity = rev ? 4 : 0;
    this.headLight.intensity = headOn * 900;
    if (this.steeringWheel) this.steeringWheel.quaternion.copy(this.steerBase).multiply(_q.setFromAxisAngle(_ax, car.steerNorm * 1.6));
  }
  dispose() { this.group.removeFromParent(); }
}
const _q = new THREE.Quaternion(), _ax = new THREE.Vector3(0, 1, 0);
