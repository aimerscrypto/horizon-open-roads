// Procedural lofted car bodies for the three original designs that have no downloaded model.
// Frame: forward -Z, up +Y, y = 0 at ground. The caller offsets by -cgHeight.
import * as THREE from 'three';
import { CarSpec } from './specs';

type Knots = [number, number][];
function prof(k: Knots, u: number): number {
  if (u <= k[0][0]) return k[0][1];
  for (let i = 0; i < k.length - 1; i++) {
    if (u <= k[i + 1][0]) {
      const p0 = k[Math.max(0, i - 1)][1], p1 = k[i][1], p2 = k[i + 1][1], p3 = k[Math.min(k.length - 1, i + 2)][1];
      const t = (u - k[i][0]) / (k[i + 1][0] - k[i][0]);
      // Catmull-Rom with clamped tangents to avoid overshoot
      const m1 = (p2 - p0) * 0.5 * 0.7, m2 = (p3 - p1) * 0.5 * 0.7, t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * p1 + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2 + (t3 - t2) * m2;
    }
  }
  return k[k.length - 1][1];
}
const spow = (v: number, p: number) => Math.sign(v) * Math.pow(Math.abs(v), p);

interface Style { top: Knots; width: Knots; cab: [number, number]; roof: Knots; cabW: [number, number]; px: number; py: number; tailUp: number; noseUp: number; }
const STYLES: Record<string, Style> = {
  coupe: {
    top: [[0, 0.42], [0.05, 0.5], [0.24, 0.575], [0.4, 0.63], [0.7, 0.66], [0.88, 0.7], [0.955, 0.69], [1, 0.58]],
    width: [[0, 0.7], [0.06, 0.9], [0.2, 0.985], [0.5, 0.97], [0.76, 1], [0.94, 0.93], [1, 0.76]],
    cab: [0.34, 0.9], roof: [[0, 0], [0.22, 0.82], [0.42, 1], [0.62, 0.9], [0.85, 0.42], [1, 0]], cabW: [0.86, 0.62], px: 0.44, py: 0.52, tailUp: 0.3, noseUp: 0.2,
  },
  gt: {
    top: [[0, 0.44], [0.05, 0.505], [0.28, 0.575], [0.43, 0.63], [0.75, 0.65], [0.92, 0.645], [1, 0.54]],
    width: [[0, 0.72], [0.06, 0.9], [0.2, 0.98], [0.5, 0.975], [0.78, 1], [0.95, 0.9], [1, 0.74]],
    cab: [0.37, 0.93], roof: [[0, 0], [0.2, 0.8], [0.38, 1], [0.6, 0.95], [0.82, 0.55], [1, 0]], cabW: [0.86, 0.64], px: 0.44, py: 0.52, tailUp: 0.28, noseUp: 0.2,
  },
  suv: {
    top: [[0, 0.44], [0.03, 0.53], [0.22, 0.585], [0.29, 0.6], [0.6, 0.615], [0.97, 0.62], [1, 0.55]],
    width: [[0, 0.82], [0.05, 0.95], [0.2, 1], [0.8, 1], [0.96, 0.96], [1, 0.86]],
    cab: [0.26, 0.992], roof: [[0, 0], [0.14, 0.8], [0.26, 0.99], [0.6, 1], [0.9, 0.97], [0.975, 0.7], [1, 0]], cabW: [0.9, 0.78], px: 0.26, py: 0.4, tailUp: 0.36, noseUp: 0.3,
  },
};

export interface BodyParts { group: THREE.Group; paint: THREE.MeshPhysicalMaterial; brake: THREE.MeshStandardMaterial; head: THREE.MeshStandardMaterial; reverse: THREE.MeshStandardMaterial; headPos: THREE.Vector3; width: number; }

export function buildBody(spec: CarSpec): BodyParts {
  const b = spec.body, st = STYLES[b.kind] ?? STYLES.coupe;
  const L = b.length, H = b.height, R = spec.wheelRadius, tw = spec.wheelWidth;
  const halfW = spec.track / 2 + tw / 2 + 0.035;
  const lf = spec.wheelbase * 0.52, lr = spec.wheelbase * 0.48;
  const zNose = -lf - (L - spec.wheelbase) * 0.47, zOf = (u: number) => zNose + u * L;
  const endScale = (u: number) => { const e = 0.065; const t = u < e ? u / e : u > 1 - e ? (1 - u) / e : 1; return Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t))); };
  const botOf = (u: number) => b.ride + (u < 0.07 ? (1 - u / 0.07) ** 2 * st.noseUp * H * 0.5 : u > 0.9 ? ((u - 0.9) / 0.1) ** 2 * st.tailUp * H * 0.5 : 0);
  const topOf = (u: number) => prof(st.top, u) * H;
  const wOf = (u: number) => prof(st.width, u) * halfW;
  const suv = b.kind === 'suv';

  const paint = new THREE.MeshPhysicalMaterial({ color: b.paint, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.04, vertexColors: true, envMapIntensity: 1.25 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x06090c, metalness: 0.9, roughness: 0.04, envMapIntensity: 1.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x0a0a0b, roughness: 0.6, metalness: 0.3 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xdadde2, roughness: 0.15, metalness: 1 });
  const head = new THREE.MeshStandardMaterial({ color: 0xf4f7ff, emissive: 0xdfe8ff, emissiveIntensity: 0.4, roughness: 0.2 });
  const brake = new THREE.MeshStandardMaterial({ color: 0x5a0508, emissive: 0xff1a12, emissiveIntensity: 0.5, roughness: 0.3 });
  const reverse = new THREE.MeshStandardMaterial({ color: 0xbfc4c8, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.3 });
  const group = new THREE.Group();

  // ---- lower body loft
  const NS = 132, NR = 44;
  const pos = new Float32Array((NS + 1) * NR * 3), col = new Float32Array((NS + 1) * NR * 3);
  const xin = spec.track / 2 - tw / 2 - 0.06, Ra = R + 0.065;
  for (let i = 0; i <= NS; i++) {
    const u = i / NS, z = zOf(u), es = endScale(u);
    const w = wOf(u), yb = botOf(u), yt = topOf(u), yc = (yb + yt) / 2, hh = (yt - yb) / 2;
    for (let j = 0; j < NR; j++) {
      const th = j / NR * Math.PI * 2;
      let x = w * spow(Math.cos(th), st.px) * (0.35 + 0.65 * es), y = yc + hh * spow(Math.sin(th), st.py) * es;
      // shoulder line: pull the upper flank inward a touch for a waist
      const flank = Math.max(0, Math.sin(th)); x *= 1 - 0.06 * flank * flank;
      let c = 1;
      for (const zw of [-lf, lr]) {
        const dz = z - zw, dy = y - R, d2 = dz * dz + dy * dy;
        if (Math.abs(x) > xin * 0.9 && d2 < Ra * Ra) { x = Math.sign(x) * xin; c = 0.02; }
        else if (suv && Math.abs(x) > xin && d2 < (Ra + 0.11) * (Ra + 0.11)) c = 0.06;
      }
      if (suv && y < b.ride + 0.17 && c === 1) c = 0.06;
      if (y < b.ride + 0.02 && Math.abs(x) < w * 0.9) c = Math.min(c, 0.05);
      const k = (i * NR + j) * 3;
      pos[k] = x; pos[k + 1] = y; pos[k + 2] = z; col[k] = col[k + 1] = col[k + 2] = c;
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < NS; i++) for (let j = 0; j < NR; j++) {
    const a = i * NR + j, bb = i * NR + (j + 1) % NR, c = a + NR, d = bb + NR;
    idx.push(a, bb, c, bb, d, c);
  }
  const bg = new THREE.BufferGeometry();
  bg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); bg.setAttribute('color', new THREE.BufferAttribute(col, 3)); bg.setIndex(idx); bg.computeVertexNormals();
  const body = new THREE.Mesh(bg, paint); body.castShadow = true; body.receiveShadow = true; group.add(body);

  // ---- greenhouse (glass canopy + painted roof)
  const CS = 56, CR = 22, [c0, c1] = st.cab;
  const cp = new Float32Array((CS + 1) * (CR + 1) * 3), gIdx: number[] = [], rIdx: number[] = [];
  const roofMax = H - Math.max(...st.top.map(k => k[1])) * H * 0.0; // roof top = H
  for (let i = 0; i <= CS; i++) {
    const t = i / CS, u = c0 + (c1 - c0) * t, z = zOf(u), belt = topOf(u) - 0.035;
    const rh = Math.max(0, prof(st.roof, t)) * (roofMax - belt), wb = wOf(u) * st.cabW[0] * (0.55 + 0.45 * Math.min(1, Math.sin(Math.PI * t) * 2.2 + 0.25));
    for (let j = 0; j <= CR; j++) {
      const th = j / CR * Math.PI, s = Math.sin(th);
      const k = (i * (CR + 1) + j) * 3;
      cp[k] = wb * spow(Math.cos(th), 0.42) * (1 - (1 - st.cabW[1] / st.cabW[0]) * Math.pow(s, 1.3)); cp[k + 1] = belt + rh * Math.pow(s, 0.55); cp[k + 2] = z;
    }
  }
  for (let i = 0; i < CS; i++) for (let j = 0; j < CR; j++) {
    const a = i * (CR + 1) + j, bb = a + 1, c = a + CR + 1, d = c + 1;
    const t = (i + 0.5) / CS, mid = Math.sin((j + 0.5) / CR * Math.PI);
    const isRoof = mid > 0.9 && t > 0.3 && t < (suv ? 0.93 : 0.62);
    const pillar = suv ? (Math.abs(t - 0.5) < 0.018 || Math.abs(t - 0.74) < 0.018 || t > 0.93) : false;
    (isRoof || pillar ? rIdx : gIdx).push(a, bb, c, bb, d, c);
  }
  const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.BufferAttribute(cp, 3)); cg.setIndex([...gIdx, ...rIdx]);
  cg.addGroup(0, gIdx.length, 0); cg.addGroup(gIdx.length, rIdx.length, 1); cg.computeVertexNormals();
  const roofPaint = paint.clone(); roofPaint.vertexColors = false; if (!suv) roofPaint.color.set(0x0b0c0e);
  const cab = new THREE.Mesh(cg, [glass, roofPaint]); cab.castShadow = true; group.add(cab);

  // ---- details
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, ry = 0, rx = 0) => {
    const me = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); me.position.set(x, y, z); me.rotation.set(rx, ry, 0); me.castShadow = true; group.add(me); return me;
  };
  const noseZ = zOf(0.012), tailZ = zOf(0.992), wn = wOf(0.05), wt = wOf(0.97);
  const hy = topOf(0.05) - 0.075;
  for (const sx of [-1, 1]) {
    box(wn * 0.42, 0.055, 0.16, sx * wn * 0.62, hy, zOf(0.045), head, sx * -0.42, -0.2);
    box(0.07, 0.035, 0.05, sx * wt * 0.3, botOf(0.99) + 0.13, tailZ + 0.03, reverse);
    const mz = zOf(c0 + (c1 - c0) * 0.16), my = topOf(c0 + 0.02) + 0.06;
    box(0.2, 0.1, 0.09, sx * (wOf(c0 + 0.05) * 0.92 + 0.08), my, mz, paint.clone(), 0, 0);
    const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.2, 14), chrome); ex.rotation.x = Math.PI / 2;
    ex.position.set(sx * wt * (b.kind === 'gt' ? 0.55 : 0.4), botOf(0.985) + 0.06, tailZ + 0.0); group.add(ex);
  }
  const tailTop = topOf(0.985), tailBot = botOf(0.985);
  box(wt * 1.5, 0.05, 0.07, 0, tailTop - 0.12, tailZ + 0.02, brake);               // full-width light bar
  box(wt * 1.56, (tailTop - tailBot) * 0.34, 0.05, 0, tailTop - 0.14 - (tailTop - tailBot) * 0.2, tailZ + 0.0, dark); // rear fascia
  box(0.42, 0.11, 0.02, 0, tailTop - 0.16 - (tailTop - tailBot) * 0.2, tailZ + 0.03, chrome);  // plate
  box(wn * 1.15, 0.13, 0.08, 0, botOf(0.03) + 0.14, noseZ + 0.03, dark);          // grille
  box(wOf(0.02) * 1.7, 0.03, 0.22, 0, botOf(0.04) - 0.0, zOf(0.03), dark);         // splitter
  box(wt * 1.5, 0.12, 0.1, 0, botOf(0.985) + 0.09, tailZ - 0.01, dark);           // diffuser
  if (b.kind === 'coupe') box(wOf(0.94) * 1.5, 0.025, 0.2, 0, topOf(0.955) + 0.035, zOf(0.955), dark, 0, 0.12);
  if (suv) {
    for (const sx of [-1, 1]) box(0.05, 0.04, L * 0.42, sx * wOf(0.6) * st.cabW[1] * 0.92, H + 0.015, zOf(0.62), dark);
    box(wn * 1.5, 0.1, 0.12, 0, b.ride + 0.02, zOf(0.02), chrome); // skid plate
  }
  const headPos = new THREE.Vector3(0, hy, zOf(0.03));
  (paint.userData as any).isPaint = true;
  return { group, paint, brake, head, reverse, headPos, width: halfW * 2 };
}
