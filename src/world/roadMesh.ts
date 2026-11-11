// Visual road network: asphalt/dirt ribbons, shoulders, guardrails, bridges, the summit tunnel and river water.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Assets } from '../core/assets';
import { F_BRIDGE, F_GUARD_L, F_GUARD_R, F_TUNNEL, Road, RoadNetwork, STEP } from './roads';
import { HeightField } from './terrain';

type Sec = [number, number][]; // lateral, dy

/** Sweep a cross-section along road samples i0..i1 (inclusive, may exceed n on closed roads). */
function sweep(road: Road, i0: number, i1: number, sec: Sec, uvScale: number, yOff = 0): THREE.BufferGeometry {
  const rows = i1 - i0 + 1, cols = sec.length;
  const pos = new Float32Array(rows * cols * 3), uv = new Float32Array(rows * cols * 2), rd = new Float32Array(rows * cols * 2);
  const acc: number[] = [0];
  for (let j = 1; j < cols; j++) acc.push(acc[j - 1] + Math.hypot(sec[j][0] - sec[j - 1][0], sec[j][1] - sec[j - 1][1]));
  for (let r = 0; r < rows; r++) {
    const i = road.wrapClamp(i0 + r), s = (i0 + r) * STEP;
    for (let j = 0; j < cols; j++) {
      const k = r * cols + j, lat = sec[j][0];
      pos[k * 3] = road.px[i] + road.rx[i] * lat; pos[k * 3 + 1] = road.py[i] + sec[j][1] + yOff; pos[k * 3 + 2] = road.pz[i] + road.rz[i] * lat;
      uv[k * 2] = acc[j] / uvScale; uv[k * 2 + 1] = s / uvScale; rd[k * 2] = lat; rd[k * 2 + 1] = s;
    }
  }
  const idx: number[] = [];
  for (let r = 0; r < rows - 1; r++) for (let j = 0; j < cols - 1; j++) {
    const a = r * cols + j, b = a + 1, c = a + cols, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('rd', new THREE.BufferAttribute(rd, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
/** Runs of consecutive samples where pred is true: [start, end] inclusive. */
function runs(road: Road, pred: (i: number) => boolean): [number, number][] {
  const out: [number, number][] = []; let st = -1;
  for (let i = 0; i <= road.n; i++) {
    const on = i < road.n && pred(i);
    if (on && st < 0) st = i;
    if (!on && st >= 0) { out.push([st, i - 1]); st = -1; }
  }
  return out;
}

export class RoadMeshes {
  readonly group = new THREE.Group();
  readonly uniforms = { uWet: { value: 0 } };
  readonly waterMat: THREE.MeshStandardMaterial;
  readonly asphalt: THREE.MeshStandardMaterial; private asphaltN: THREE.Texture;
  readonly tunnelLights: THREE.Vector3[] = [];

  constructor(net: RoadNetwork, hf: HeightField, A: Assets) {
    const U = this.uniforms;
    const asphalt = new THREE.MeshStandardMaterial({ map: A.tex.asphalt_04, normalMap: A.tex.asphalt_04_n, roughness: 0.86, color: 0x9a9a9e });
    asphalt.normalScale.set(0.8, 0.8); this.asphalt = asphalt; this.asphaltN = A.tex.asphalt_04_n;
    asphalt.onBeforeCompile = (sh) => {
      sh.uniforms.uWet = U.uWet;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 rd; varying vec2 vRd;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvRd = rd;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vRd; uniform float uWet; float gPuddle;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          float ax = abs(vRd.x);
          float wear = 0.55 + 0.45 * smoothstep(0.25, 0.6, diffuseColor.g * 2.2);
          float edge = 1.0 - smoothstep(0.075, 0.1, abs(ax - 4.95));
          float dash = step(fract(vRd.y / 12.0), 0.38);
          float centre = (1.0 - smoothstep(0.065, 0.09, ax)) * dash;
          // darker wheel tracks, lighter crown
          diffuseColor.rgb *= 0.86 + 0.14 * smoothstep(0.5, 1.4, abs(ax - 2.3));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.82, 0.82, 0.78), edge * wear * 0.9);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.62, 0.08), centre * wear * 0.92);
          gPuddle = uWet * (0.55 + 0.45 * smoothstep(0.42, 0.6, texture2D(map, vMapUv * 0.07).r * 1.7));
          diffuseColor.rgb *= mix(1.0, 0.5, gPuddle);`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.12, gPuddle);')
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(mix(normal, nonPerturbedNormal, gPuddle * 0.85));');
    };
    const dirt = new THREE.MeshStandardMaterial({ map: A.tex.gravel_road, normalMap: A.tex.gravel_road_n, roughness: 0.95, color: 0xc9b9a2 });
    const shoulder = new THREE.MeshStandardMaterial({ map: A.tex.gravel_road, normalMap: A.tex.gravel_road_n, roughness: 0.97, color: 0xcfc4b4 });
    const concrete = new THREE.MeshStandardMaterial({ map: A.tex.concrete_wall_008, normalMap: A.tex.concrete_wall_008_n, roughness: 0.82, color: 0xb9b6b0 });
    const timber = new THREE.MeshStandardMaterial({ map: A.tex.pine_bark, normalMap: A.tex.pine_bark_n, roughness: 0.9, color: 0x9a7a5c });
    const rail = new THREE.MeshStandardMaterial({ color: 0xaeb4ba, metalness: 0.85, roughness: 0.38, side: THREE.DoubleSide });
    const tunnelMat = new THREE.MeshStandardMaterial({ map: A.tex.concrete_wall_008, normalMap: A.tex.concrete_wall_008_n, roughness: 0.7, color: 0x8f8a82, emissive: 0xffa25a, emissiveIntensity: 0.07, side: THREE.DoubleSide });
    const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.2, 1.1), fog: false });
    this.waterMat = new THREE.MeshStandardMaterial({ color: 0x1d4a4f, roughness: 0.06, metalness: 0.15, transparent: true, opacity: 0.86, normalMap: A.tex.aerial_sand_n });
    this.waterMat.normalScale.set(0.35, 0.35);

    const add = (g: THREE.BufferGeometry | null, m: THREE.Material, cast = false, receive = true) => {
      if (!g) return; const mesh = new THREE.Mesh(g, m); mesh.castShadow = cast; mesh.receiveShadow = receive; mesh.matrixAutoUpdate = false; this.group.add(mesh); return mesh;
    };

    for (const road of net.roads) {
      const hw = road.def.halfWidth, isAsphalt = road.def.surface === 'asphalt';
      const end = road.def.closed ? road.n : road.n - 1;
      // surface in ~300 m pieces for culling
      for (let i = 0; i < end; i += 150) {
        const j = Math.min(end, i + 150);
        add(sweep(road, i, j, [[-hw, 0], [hw, 0]], isAsphalt ? 5.6 : 6.5, isAsphalt ? 0.04 : 0.015), isAsphalt ? asphalt : dirt);
      }
      // shoulders where the road sits on the ground (both sides merged per piece)
      const ground = runs(road, i => !(road.flags[i] & (F_BRIDGE | F_TUNNEL)));
      for (const [a, b0] of ground) for (let i = a; i < b0; i += 150) {
        const b = Math.min(b0, i + 150); if (b - i < 1) continue;
        const sm = isAsphalt ? shoulder : dirt;
        add(mergeGeometries([sweep(road, i, b, [[-hw - 3.4, -0.5], [-hw + 0.05, 0.03]], 4), sweep(road, i, b, [[hw - 0.05, 0.03], [hw + 3.4, -0.5]], 4)]), sm);
      }
      // bridges
      const piers: THREE.BufferGeometry[] = [];
      for (const [a, b] of runs(road, i => (road.flags[i] & F_BRIDGE) !== 0)) {
        const W = hw + 1.1, mat = isAsphalt ? concrete : timber;
        add(sweep(road, a, b, [[W, 0.02], [W, -1.3], [-W, -1.3], [-W, 0.02]], 5), mat, true);
        add(sweep(road, a, b, [[W - 0.45, 0], [W - 0.45, 0.95], [W, 0.95], [W, 0]], 3), mat, true);
        add(sweep(road, a, b, [[-W, 0], [-W, 0.95], [-W + 0.45, 0.95], [-W + 0.45, 0]], 3), mat, true);
        for (let i = a + 4; i < b - 3; i += 12) {
          const base = hf.sample(road.px[i], road.pz[i]) - 2, top = road.py[i] - 1.3, h = top - base;
          if (h < 2.5) continue;
          const g = new THREE.BoxGeometry(W * 1.5, h, 2.2);
          g.rotateY(Math.atan2(-road.tx[i], -road.tz[i])); g.translate(road.px[i], base + h / 2, road.pz[i]);
          piers.push(g);
        }
      }
      if (piers.length) add(mergeGeometries(piers), isAsphalt ? concrete : timber, true);
      // reflective delineator posts every 24 m: they whip past at speed
      if (isAsphalt) {
        const mk: THREE.Matrix4[] = [];
        for (let i = 0; i < road.n; i += 12) {
          if (road.flags[i] & (F_BRIDGE | F_TUNNEL)) continue;
          for (const sg of [-1, 1]) {
            if (road.flags[i] & (sg > 0 ? F_GUARD_R : F_GUARD_L)) continue;
            const m = new THREE.Matrix4().makeRotationY(Math.atan2(-road.tx[i], -road.tz[i]));
            m.setPosition(road.px[i] + road.rx[i] * (hw + 1.5) * sg, road.py[i] + 0.4, road.pz[i] + road.rz[i] * (hw + 1.5) * sg); mk.push(m);
          }
        }
        const postMat = new THREE.MeshLambertMaterial({ color: 0xf1f1ec, emissive: 0x2a2a28 });
        const pg = mergeGeometries([new THREE.BoxGeometry(0.11, 1.05, 0.05), new THREE.BoxGeometry(0.115, 0.16, 0.055).translate(0, 0.33, 0)])!;
        const cols = new Float32Array(pg.getAttribute('position').count * 3);
        for (let k = 0; k < cols.length / 3; k++) { const band = k >= 24; cols[k * 3] = band ? 1.0 : 1; cols[k * 3 + 1] = band ? 0.25 : 1; cols[k * 3 + 2] = band ? 0.05 : 1; }
        pg.setAttribute('color', new THREE.BufferAttribute(cols, 3)); postMat.vertexColors = true;
        const pim = new THREE.InstancedMesh(pg, postMat, mk.length);
        mk.forEach((m, k) => pim.setMatrixAt(k, m)); pim.frustumCulled = false; this.group.add(pim);
      }
      // guardrails
      const posts: THREE.Matrix4[] = [];
      for (const [flag, sgn] of [[F_GUARD_R, 1], [F_GUARD_L, -1]] as const) {
        for (const [a, b] of runs(road, i => (road.flags[i] & flag) !== 0 && !(road.flags[i] & (F_BRIDGE | F_TUNNEL)))) {
          if (b - a < 3) continue;
          const L = (hw + 0.8) * sgn;
          add(sweep(road, a, b, [[L, 0.44], [L - 0.07 * sgn, 0.6], [L, 0.76]], 2), rail, true);
          for (let i = a; i <= b; i += 2) {
            const m = new THREE.Matrix4().makeRotationY(Math.atan2(-road.tx[i], -road.tz[i]));
            m.setPosition(road.px[i] + road.rx[i] * (L + 0.06 * sgn), road.py[i] + 0.36, road.pz[i] + road.rz[i] * (L + 0.06 * sgn));
            posts.push(m);
          }
        }
      }
      if (posts.length) {
        const im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.09, 0.84, 0.12), rail, posts.length);
        posts.forEach((m, k) => im.setMatrixAt(k, m)); im.castShadow = true; im.frustumCulled = false; this.group.add(im);
      }
      // tunnel
      for (const [a, b] of runs(road, i => (road.flags[i] & F_TUNNEL) !== 0)) {
        const A2 = hw + 0.5, B2 = 6.5, arch: Sec = [];
        for (let k = 0; k <= 14; k++) {
          const th = Math.PI * k / 14, c = Math.cos(th), s = Math.sin(th);
          arch.push([A2 * Math.sign(c) * Math.pow(Math.abs(c), 0.62), B2 * Math.pow(s, 0.8)]);
        }
        for (let i = a; i < b; i += 40) add(sweep(road, i, Math.min(b, i + 40), arch, 6), tunnelMat, true);
        for (const sx of [-1, 1]) add(sweep(road, a + 2, b - 2, [[sx * 2.2 - 0.18, 6.2], [sx * 2.2 + 0.18, 6.2]], 1), lampMat, false, false);
        for (let i = a + 8; i < b; i += 16) this.tunnelLights.push(new THREE.Vector3(road.px[i], road.py[i] + 5.5, road.pz[i]));
        // portals
        const shape = new THREE.Shape();
        shape.moveTo(-34, -6); shape.lineTo(34, -6); shape.lineTo(34, 17); shape.lineTo(-34, 17); shape.closePath();
        const hole = new THREE.Path(); hole.moveTo(arch[0][0], -5.5);
        for (const p of arch) hole.lineTo(p[0], p[1]); hole.lineTo(arch[arch.length - 1][0], -5.5); hole.closePath();
        shape.holes.push(hole);
        for (const [i, dir] of [[a, -1], [b, 1]] as const) {
          const g = new THREE.ShapeGeometry(shape);
          const uvA = g.getAttribute('uv') as THREE.BufferAttribute; for (let k = 0; k < uvA.count; k++) uvA.setXY(k, uvA.getX(k) / 6, uvA.getY(k) / 6);
          // local +X must map to road right; plane normal along the road
          g.rotateY(Math.atan2(-road.tx[i], -road.tz[i]) + Math.PI);
          g.translate(road.px[i] + road.tx[i] * dir * 0.3, road.py[i], road.pz[i] + road.tz[i] * dir * 0.3);
          const pm = concrete.clone(); pm.side = THREE.DoubleSide;
          add(g, pm, true);
        }
      }
    }
    // rivers
    for (const rv of hf.rivers) {
      if (!rv.def.water) continue;
      const pts = rv.pts, n = pts.length, w = rv.def.bottom + 7;
      const pos = new Float32Array(n * 6), uv = new Float32Array(n * 4), idx: number[] = [];
      for (let i = 0; i < n; i++) {
        const p = pts[i], q = pts[Math.min(n - 1, i + 1)], o = pts[Math.max(0, i - 1)];
        let tx = q.x - o.x, tz = q.z - o.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
        pos.set([p.x + tz * w, p.y, p.z - tx * w, p.x - tz * w, p.y, p.z + tx * w], i * 6);
        uv.set([0, i * 3 / 14, w * 2 / 14, i * 3 / 14], i * 4);
        if (i < n - 1) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
      const m = add(g, this.waterMat, false, true)!; m.renderOrder = 1;
    }
  }
  setDetail(normals: boolean) { const want = normals ? this.asphaltN : null; if (this.asphalt.normalMap !== want) { this.asphalt.normalMap = want; this.asphalt.needsUpdate = true; } }
  update(dt: number, wet: number) {
    this.uniforms.uWet.value = wet;
    if (this.waterMat.normalMap) { this.waterMat.normalMap.offset.y -= dt * 0.05; }
  }
}
