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
  readonly headLight = new THREE.SpotLight(0xe6eeff, 0, 260, 0.52, 0.55, 1.0);
  /** camera anchor points in car frame */
  readonly hoodCam = new THREE.Vector3(); readonly cockpitCam = new THREE.Vector3();
  paint: THREE.Material[] = [];

  constructor(readonly spec: CarSpec, hero: GLTF, models: Record<string, GLTF> = {}) {
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
    } else if (models['car_' + s.id]) {
      this.buildScan(models['car_' + s.id]);
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
    this.headLight.target.position.set(0, this.headLight.position.y - 1.6, this.headLight.position.z - 60);
    this.group.add(this.headLight, this.headLight.target);
  }

  /**
   * Rig a downloaded concept car. The prep step tags wheel parts with a WHEEL_ material prefix and merges
   * meshes per material, so the four wheels are separated here by splitting triangles into quadrants.
   */
  private buildScan(gltf: GLTF) {
    const s = this.spec, cfg = s.scan!;
    const src = gltf.scene.clone(true); src.scale.setScalar(cfg.scale);
    const holder = new THREE.Group(); holder.add(src); holder.updateMatrixWorld(true);
    const v = new THREE.Vector3(), box = new THREE.Box3(), head = new THREE.Vector3(); let headN = 0;
    const wheelMeshes: THREE.Mesh[] = [];
    src.traverse(o => {
      const m = o as THREE.Mesh; if (!m.isMesh) return;
      const name = (m.material as THREE.Material).name;
      if (name.startsWith('WHEEL_')) { wheelMeshes.push(m); const p = m.geometry.getAttribute('position'); for (let i = 0; i < p.count; i += 7) box.expandByPoint(v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld)); }
      else if (/headlight/i.test(name)) { const p = m.geometry.getAttribute('position'); for (let i = 0; i < p.count; i += 11) { head.add(v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld)); headN++; } }
    });
    const mid = box.getCenter(new THREE.Vector3());
    // nose towards -Z: use the headlights to tell front from back
    const frontIsPlusZ = cfg.flip ?? (headN > 0 ? head.z / headN > mid.z : false);
    if (frontIsPlusZ) { holder.rotation.y = Math.PI; holder.updateMatrixWorld(true); box.makeEmpty(); for (const m of wheelMeshes) { const p = m.geometry.getAttribute('position'); for (let i = 0; i < p.count; i += 7) box.expandByPoint(v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld)); } box.getCenter(mid); }
    // split every wheel mesh into four quadrant meshes (FL, FR, RL, RR) in car space
    const quad: { pos: number[]; nrm: number[]; uv: number[]; mat: THREE.Material }[][] = [[], [], [], []];
    const qBox = [new THREE.Box3(), new THREE.Box3(), new THREE.Box3(), new THREE.Box3()];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3();
    for (const m of wheelMeshes) {
      const g = m.geometry, P = g.getAttribute('position'), N = g.getAttribute('normal'), U = g.getAttribute('uv'), I = g.index;
      nm.getNormalMatrix(m.matrixWorld);
      const parts = [0, 1, 2, 3].map(() => ({ pos: [] as number[], nrm: [] as number[], uv: [] as number[], mat: m.material as THREE.Material }));
      const count = I ? I.count : P.count;
      for (let t = 0; t < count; t += 3) {
        const i0 = I ? I.getX(t) : t, i1 = I ? I.getX(t + 1) : t + 1, i2 = I ? I.getX(t + 2) : t + 2;
        a.fromBufferAttribute(P, i0).applyMatrix4(m.matrixWorld); b.fromBufferAttribute(P, i1).applyMatrix4(m.matrixWorld); c.fromBufferAttribute(P, i2).applyMatrix4(m.matrixWorld);
        const q = ((a.z + b.z + c.z) / 3 < mid.z ? 0 : 2) + ((a.x + b.x + c.x) / 3 < mid.x ? 0 : 1), part = parts[q];
        for (const [pt, idx] of [[a, i0], [b, i1], [c, i2]] as const) {
          part.pos.push(pt.x, pt.y, pt.z); qBox[q].expandByPoint(pt);
          if (N) { n.fromBufferAttribute(N, idx).applyMatrix3(nm).normalize(); part.nrm.push(n.x, n.y, n.z); }
          if (U) part.uv.push(U.getX(idx), U.getY(idx));
        }
      }
      parts.forEach((p, q) => { if (p.pos.length) quad[q].push(p); });
      m.removeFromParent();
    }
    const cen = qBox.map(bx => bx.getCenter(new THREE.Vector3()));
    const radius = qBox.reduce((r, bx) => r + (bx.max.y - bx.min.y) / 2, 0) / 4;
    // adopt the model's real proportions for the physics
    s.wheelbase = Math.abs((cen[2].z + cen[3].z) / 2 - (cen[0].z + cen[1].z) / 2); s.track = Math.abs((cen[1].x + cen[3].x) / 2 - (cen[0].x + cen[2].x) / 2);
    s.wheelRadius = radius; s.wheelWidth = (qBox[0].max.x - qBox[0].min.x);
    const lf = s.wheelbase * 0.52, lr = s.wheelbase * 0.48, y0 = -s.cgHeight + s.wheelRadius;
    const off = new THREE.Vector3(-(cen[0].x + cen[1].x) / 2, y0 - (cen[0].y + cen[2].y) / 2, (-lf + lr) / 2 - (cen[0].z + cen[1].z + cen[2].z + cen[3].z) / 4);
    holder.position.copy(off); this.group.add(holder);
    const full = new THREE.Box3().setFromObject(holder);
    s.body.length = full.max.z - full.min.z; s.body.width = Math.max(full.max.x - full.min.x, s.track + s.wheelWidth); s.body.height = full.max.y - (y0 - radius);
    for (let q = 0; q < 4; q++) {
      const piv = new THREE.Group(); piv.position.copy(cen[q]).add(off);
      for (const p of quad[q]) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(p.pos, 3)); if (p.nrm.length) g.setAttribute('normal', new THREE.Float32BufferAttribute(p.nrm, 3)); else g.computeVertexNormals();
        if (p.uv.length) g.setAttribute('uv', new THREE.Float32BufferAttribute(p.uv, 2));
        g.translate(-cen[q].x, -cen[q].y, -cen[q].z);
        piv.add(new THREE.Mesh(g, p.mat));
      }
      this.group.add(piv); this.wheels.push(piv); this.restY.push(piv.position.y);
    }
    src.traverse(o => {
      const m = o as THREE.Mesh; if (!m.isMesh) return;
      const pm = m.material as THREE.MeshPhysicalMaterial, name = pm.name;
      m.castShadow = true; m.receiveShadow = true;
      if (/^glass$/i.test(name) || cfg.glass.includes(name)) { m.material = new THREE.MeshPhysicalMaterial({ color: 0x0a0e12, metalness: 0.85, roughness: 0.03, transparent: true, opacity: 0.6, envMapIntensity: 1.5, name: 'Glass' }); m.castShadow = false; return; }
      if (cfg.paint.includes(name)) { pm.color.set(s.body.paint); pm.map = null; pm.metalness = 0.6; pm.roughness = 0.3; if ('clearcoat' in pm) { pm.clearcoat = 1; pm.clearcoatRoughness = 0.04; } pm.envMapIntensity = 1.3; this.paint.push(pm); }
      if (/stop|tail/i.test(name)) { pm.emissive.set(0xff1a12); this.brakeMats.push(pm); }
      if (/^headlights?$/i.test(name)) { pm.emissive.set(0xdfe8ff); this.headMats.push(pm); }
    });
    const top = full.max.y + off.y * 0;
    this.hoodCam.set(0, y0 + radius + (full.max.y - full.min.y) * 0.42, -lf * 0.35);
    this.cockpitCam.set(-s.track * 0.22, y0 + radius + (full.max.y - full.min.y) * 0.34, lr * 0.02);
    this.headLight.position.set(0, y0 + radius * 0.9, full.min.z + off.z - 0.3); void top;
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
    this.headLight.intensity = headOn * 520;
    if (this.steeringWheel) this.steeringWheel.quaternion.copy(this.steerBase).multiply(_q.setFromAxisAngle(_ax, car.steerNorm * 1.6));
  }
  dispose() { this.group.removeFromParent(); }
}
const _q = new THREE.Quaternion(), _ax = new THREE.Vector3(0, 1, 0);
