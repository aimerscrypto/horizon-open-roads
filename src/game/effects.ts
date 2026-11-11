// Tyre smoke, dust, sparks and skid marks.
import * as THREE from 'three';
import { CarPhysics } from '../vehicle/physics';

const MAXP = 520, MAXSKID = 1400;
export class Effects {
  readonly group = new THREE.Group();
  private pos = new Float32Array(MAXP * 3); private vel = new Float32Array(MAXP * 3); private col = new Float32Array(MAXP * 4);
  private size = new Float32Array(MAXP); private life = new Float32Array(MAXP); private max = new Float32Array(MAXP); private grow = new Float32Array(MAXP); private grav = new Float32Array(MAXP);
  private next = 0; private points: THREE.Points;
  private skidPos = new Float32Array(MAXSKID * 12); private skidGeo = new THREE.BufferGeometry(); private skidNext = 0; private skidCount = 0;
  private last: (THREE.Vector3 | null)[] = [null, null, null, null];
  private acc = 0;
  private streakU = { uCam: { value: new THREE.Vector3() }, uVel: { value: new THREE.Vector3() }, uAmount: { value: 0 } }; private streaks!: THREE.LineSegments;

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aCol', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uScale: { value: 600 }, uLight: { value: new THREE.Color(1, 1, 1) } },
      vertexShader: `attribute vec4 aCol; attribute float aSize; varying vec4 vC; uniform float uScale;
        void main(){ vC = aCol; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aSize * uScale / max(0.1, -mv.z); }`,
      fragmentShader: `varying vec4 vC; uniform vec3 uLight;
        void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d, d) * 4.0; if (r > 1.0) discard; float a = (1.0 - r); a *= a;
          gl_FragColor = vec4(vC.rgb * (vC.r > 1.5 ? vec3(1.0) : uLight), vC.a * a); }`,
    });
    this.points = new THREE.Points(g, mat); this.points.frustumCulled = false; this.points.renderOrder = 5;
    this.skidGeo.setAttribute('position', new THREE.BufferAttribute(this.skidPos, 3).setUsage(THREE.DynamicDrawUsage));
    const idx = new Uint16Array(MAXSKID * 6);
    for (let i = 0; i < MAXSKID; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2], i * 6);
    this.skidGeo.setIndex(new THREE.BufferAttribute(idx, 1)); this.skidGeo.setDrawRange(0, 0);
    const skid = new THREE.Mesh(this.skidGeo, new THREE.MeshBasicMaterial({ color: 0x050505, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    skid.frustumCulled = false; skid.renderOrder = 2;
    // wind streaks: world-fixed motes stretched along the velocity, visible only at speed
    const N = 420, sp = new Float32Array(N * 6), se = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) { const x = Math.random() * 60, y = Math.random() * 14, z = Math.random() * 60; sp.set([x, y, z, x, y, z], i * 6); se[i * 2 + 1] = 1; }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3)); sg.setAttribute('end', new THREE.BufferAttribute(se, 1));
    this.streaks = new THREE.LineSegments(sg, new THREE.ShaderMaterial({
      uniforms: this.streakU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `uniform vec3 uCam, uVel; attribute float end; varying float vA;
        void main(){ vec3 box = vec3(60.0, 14.0, 60.0);
          vec3 p = mod(position - uCam, box) - box * 0.5 + uCam; p.y += 3.0;
          p -= uVel * 0.045 * end;
          float d = length(p - uCam); vA = smoothstep(3.0, 9.0, d) * (1.0 - smoothstep(20.0, 30.0, d)) * (1.0 - end * 0.7);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0); }`,
      fragmentShader: 'uniform float uAmount; varying float vA; void main(){ gl_FragColor = vec4(vec3(0.9, 0.93, 1.0) * 0.5, 1.0) * uAmount * vA; }',
    }));
    this.streaks.frustumCulled = false; this.streaks.renderOrder = 6;
    this.group.add(skid, this.points, this.streaks);
  }

  private emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, r: number, g: number, b: number, a: number, size: number, life: number, grow: number, grav = 0) {
    const i = this.next; this.next = (this.next + 1) % MAXP;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z; this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b; this.col[i * 4 + 3] = a;
    this.size[i] = size; this.life[i] = life; this.max[i] = life; this.grow[i] = grow; this.grav[i] = grav;
  }
  sparks(p: THREE.Vector3, v: THREE.Vector3, n: number) {
    for (let i = 0; i < n; i++) this.emit(p.x, p.y, p.z, v.x * 0.4 + (Math.random() - 0.5) * 7, 1 + Math.random() * 4, v.z * 0.4 + (Math.random() - 0.5) * 7, 3, 1.6, 0.5, 1, 0.07, 0.3 + Math.random() * 0.4, 0, 12);
  }

  update(dt: number, car: CarPhysics, light: THREE.Color, viewportH: number, wet: number, cam?: THREE.Vector3) {
    if (cam) this.streakU.uCam.value.copy(cam);
    const m = this.points.material as THREE.ShaderMaterial; m.uniforms.uScale.value = viewportH * 0.9; m.uniforms.uLight.value.copy(light);
    this.acc += dt;
    { const v = car.vel.length(), a = Math.min(1, Math.max(0, (v - 38) / 45)); this.streaks.visible = a > 0.01; this.streakU.uAmount.value = a * 0.55; this.streakU.uVel.value.copy(car.vel); }
    const emitNow = this.acc > 1 / 50; if (emitNow) this.acc = 0;
    const spd = car.vel.length();
    for (let i = 0; i < 4; i++) {
      const w = car.wheels[i];
      if (!w.grounded) { this.last[i] = null; continue; }
      const c = w.contact;
      const hard = w.surface === 0;
      if (emitNow) {
        if (hard && w.slide > 3.5) {
          const k = Math.min(1, (w.slide - 3.5) / 10);
          this.emit(c.x, c.y + 0.15, c.z, car.vel.x * 0.25 + (Math.random() - 0.5), 0.6 + Math.random(), car.vel.z * 0.25 + (Math.random() - 0.5), 0.86, 0.87, 0.9, 0.2 + 0.25 * k, 0.7, 1.1 + Math.random() * 0.7, 2.6);
        } else if (!hard && spd > 5 && (i >= 2 || w.slide > 2)) {
          const k = Math.min(1, spd / 40 + w.slide / 12) * (1 - wet * 0.8);
          const sand = w.surface !== 3;
          if (k > 0.05) this.emit(c.x, c.y + 0.2, c.z, car.vel.x * 0.3 + (Math.random() - 0.5) * 2, 0.8 + Math.random() * 1.4, car.vel.z * 0.3 + (Math.random() - 0.5) * 2,
            sand ? 0.74 : 0.5, sand ? 0.6 : 0.44, sand ? 0.44 : 0.33, 0.3 * k, 0.9, 1.4 + Math.random(), 3.4);
        } else if (hard && wet > 0.4 && spd > 14 && i >= 2) {
          this.emit(c.x, c.y + 0.2, c.z, car.vel.x * 0.5 + (Math.random() - 0.5), 1 + Math.random() * 1.5, car.vel.z * 0.5 + (Math.random() - 0.5), 0.8, 0.85, 0.9, 0.16 * wet, 0.6, 0.7, 3);
        }
      }
      // skid marks on tarmac
      if (hard && w.slide > 4.5) {
        const l = this.last[i];
        if (l && l.distanceToSquared(c) > 0.09 && l.distanceToSquared(c) < 9) {
          const dx = c.x - l.x, dz = c.z - l.z, len = Math.hypot(dx, dz) || 1, nx = -dz / len * 0.13, nz = dx / len * 0.13, o = this.skidNext * 12, p = this.skidPos;
          p[o] = l.x - nx; p[o + 1] = l.y + 0.05; p[o + 2] = l.z - nz; p[o + 3] = l.x + nx; p[o + 4] = l.y + 0.05; p[o + 5] = l.z + nz;
          p[o + 6] = c.x - nx; p[o + 7] = c.y + 0.05; p[o + 8] = c.z - nz; p[o + 9] = c.x + nx; p[o + 10] = c.y + 0.05; p[o + 11] = c.z + nz;
          this.skidNext = (this.skidNext + 1) % MAXSKID; this.skidCount = Math.min(MAXSKID, this.skidCount + 1);
          this.skidGeo.setDrawRange(0, this.skidCount * 6); (this.skidGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
          l.copy(c);
        } else if (!l || l.distanceToSquared(c) >= 9) this.last[i] = c.clone();
      } else this.last[i] = null;
    }
    for (let i = 0; i < MAXP; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.col[i * 4 + 3] = 0; this.size[i] = 0; continue; }
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const damp = 1 - 1.6 * dt; this.vel[i * 3] *= damp; this.vel[i * 3 + 2] *= damp;
      this.size[i] += this.grow[i] * dt;
      this.col[i * 4 + 3] *= 1 - dt / Math.max(0.05, this.life[i]) * 0.9;
    }
    const g = this.points.geometry;
    (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true; (g.getAttribute('aCol') as THREE.BufferAttribute).needsUpdate = true; (g.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
  }
}
