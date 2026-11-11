// Heightfield terrain generated around the authored roads, rendered as LOD chunks with a splat shader.
import * as THREE from 'three';
import { fbm, noise2, ridged, smoothstep, lerp } from '../core/noise';
import { biomeAt, CELL, CHUNK_CELLS, CHUNKS, GRID, HALF, RIVERS, TUNNEL, WORLD_SIZE } from './layout';
import { F_BRIDGE, F_GUARD_L, F_GUARD_R, F_TUNNEL, RoadNetwork, STEP } from './roads';

const G1 = GRID + 1;
const CG = 32, CN = WORLD_SIZE / CG + 1; // coarse grid

export interface RiverPath { def: (typeof RIVERS)[number]; pts: THREE.Vector3[]; }

export class HeightField {
  readonly h = new Float32Array(G1 * G1);
  /** distance to nearest road centreline (m), capped */
  readonly roadDist = new Float32Array(G1 * G1);
  readonly cutY = new Float32Array(G1 * G1);
  /** 1 where a river / canyon bed was carved */
  readonly water = new Uint8Array(G1 * G1);
  readonly rivers: RiverPath[] = [];
  private tmpB: [number, number, number] = [0, 0, 0];

  constructor(readonly net: RoadNetwork) { this.generate(); }

  private generate() {
    const { h, roadDist, cutY, net } = this;
    const roadY = new Float32Array(G1 * G1), tunnel = new Uint8Array(G1 * G1);
    roadDist.fill(1e9);
    // --- fine stamp: nearest road sample within R
    const R = 50;
    for (const r of net.roads) {
      const extra = r.def.halfWidth - 5.6;
      for (let i = 0; i < r.n; i++) {
        const x = r.px[i], z = r.pz[i], y = r.py[i];
        const gx0 = Math.max(0, Math.floor((x - R + HALF) / CELL)), gx1 = Math.min(GRID, Math.ceil((x + R + HALF) / CELL));
        const gz0 = Math.max(0, Math.floor((z - R + HALF) / CELL)), gz1 = Math.min(GRID, Math.ceil((z + R + HALF) / CELL));
        const tun = (r.flags[i] & F_TUNNEL) ? 1 : 0;
        for (let gz = gz0; gz <= gz1; gz++) for (let gx = gx0; gx <= gx1; gx++) {
          const dx = gx * CELL - HALF - x, dz = gz * CELL - HALF - z;
          const d = Math.sqrt(dx * dx + dz * dz) - extra;
          const k = gz * G1 + gx;
          if (d < roadDist[k]) { roadDist[k] = d; roadY[k] = y; tunnel[k] = tun; }
        }
      }
    }
    // --- coarse: distance + inverse-distance base elevation from road/river points
    const ptsX: number[] = [], ptsZ: number[] = [], ptsY: number[] = [];
    for (const r of net.roads) for (let i = 0; i < r.n; i += 12) { ptsX.push(r.px[i]); ptsZ.push(r.pz[i]); ptsY.push(r.py[i]); }
    for (const def of RIVERS) {
      const curve = new THREE.CatmullRomCurve3(def.pts.map(p => new THREE.Vector3(p[0], p[2], p[1])), false, 'centripetal');
      const pts = curve.getSpacedPoints(Math.round(curve.getLength() / 3));
      this.rivers.push({ def, pts });
      for (let i = 0; i < pts.length; i += 10) { ptsX.push(pts[i].x); ptsZ.push(pts[i].z); ptsY.push(pts[i].y + 9); }
    }
    const cB = new Float32Array(CN * CN), cD = new Float32Array(CN * CN);
    for (let cz = 0; cz < CN; cz++) for (let cx = 0; cx < CN; cx++) {
      const x = cx * CG - HALF, z = cz * CG - HALF;
      let sw = 0, sy = 0, md = 1e9;
      for (let i = 0; i < ptsX.length; i++) {
        const dx = x - ptsX[i], dz = z - ptsZ[i], d2 = dx * dx + dz * dz;
        if (d2 < md) md = d2;
        const w = 1 / ((d2 + 1600) * (d2 + 1600)); sw += w; sy += w * ptsY[i];
      }
      cB[cz * CN + cx] = sy / sw; cD[cz * CN + cx] = Math.sqrt(md);
    }
    const coarse = (a: Float32Array, x: number, z: number) => {
      const fx = Math.min(CN - 1.001, Math.max(0, (x + HALF) / CG)), fz = Math.min(CN - 1.001, Math.max(0, (z + HALF) / CG));
      const ix = Math.floor(fx), iz = Math.floor(fz); let tx = fx - ix, tz = fz - iz;
      tx = tx * tx * (3 - 2 * tx); tz = tz * tz * (3 - 2 * tz);
      const k = iz * CN + ix;
      return lerp(lerp(a[k], a[k + 1], tx), lerp(a[k + CN], a[k + CN + 1], tx), tz);
    };
    // tunnel ridge axis
    const tr = net.byId(TUNNEL.road);
    let ti = 0, td = 1e9;
    for (let i = 0; i < tr.n; i++) { const d = Math.hypot(tr.px[i] - TUNNEL.x, tr.pz[i] - TUNNEL.z); if (d < td) { td = d; ti = i; } }
    const tcx = tr.px[ti], tcz = tr.pz[ti], ttx = -tr.rz[ti], ttz = tr.rx[ti];

    const b = this.tmpB;
    for (let gz = 0; gz <= GRID; gz++) for (let gx = 0; gx <= GRID; gx++) {
      const k = gz * G1 + gx, x = gx * CELL - HALF, z = gz * CELL - HALF;
      let d = roadDist[k];
      if (d > R - 6) { d = Math.max(R - 6, coarse(cD, x, z)); roadDist[k] = d; }
      biomeAt(x, z, b);
      let nat = coarse(cB, x, z);
      // desert: dunes + two-tier mesas
      if (b[0] > 0.01) {
        const dunes = fbm(x / 240, z / 240, 3, 11) * 9 + noise2(x / 55, z / 55, 12) * 1.3;
        const m = fbm(x / 430 + 3.1, z / 430 - 1.7, 3, 13) + noise2(x / 90, z / 90, 14) * 0.035;
        const mesa = smoothstep(0.1, 0.17, m) * 58 + smoothstep(0.27, 0.32, m) * 44 + smoothstep(0.1, 0.5, m) * 20;
        nat += b[0] * (dunes * smoothstep(12, 90, d) + mesa * smoothstep(55, 170, d));
      }
      if (b[1] > 0.01) {
        const rg = ridged(x / 760, z / 760, 5, 21);
        const mt = (rg - 0.4) * 430 * smoothstep(12, 230, d) + smoothstep(250, 900, d) * 150 * (0.5 + 0.5 * noise2(x / 900, z / 900, 22));
        nat += b[1] * mt;
      }
      if (b[2] > 0.01) {
        const hills = fbm(x / 390, z / 390, 4, 31) * 52 * smoothstep(14, 170, d) + noise2(x / 38, z / 38, 32) * 1.1 * smoothstep(10, 30, d);
        nat += b[2] * hills;
      }
      nat += noise2(x / 9, z / 9, 41) * 0.22 * smoothstep(10, 22, d);
      // summit ridge the tunnel bores through
      const along = (x - tcx) * ttx + (z - tcz) * ttz, across = Math.abs(-(x - tcx) * ttz + (z - tcz) * ttx);
      nat += TUNNEL.ridge * Math.exp(-(along * along) / (112 * 112)) * smoothstep(900, 350, across);
      // rim wall
      const rim = smoothstep(1900, 2240, Math.max(Math.abs(x), Math.abs(z)));
      nat += rim * rim * 300 * smoothstep(20, 130, d);
      let wr = 1 - smoothstep(10.5, 46, d);
      if (tunnel[k]) { wr = 0; if (d < 9) cutY[k] = roadY[k] + 7.6; }
      h[k] = lerp(nat, roadY[k] - 0.28, wr);
    }
    // widen the tunnel cut-out by two cells so the wall at each portal is removed cleanly
    for (let pass = 0; pass < 2; pass++) {
      const src = cutY.slice();
      for (let gz = 1; gz < GRID; gz++) for (let gx = 1; gx < GRID; gx++) {
        const k = gz * G1 + gx; if (src[k] > 0) continue;
        const m = Math.max(src[k - 1], src[k + 1], src[k - G1], src[k + G1]); if (m > 0) cutY[k] = m;
      }
    }
    // --- rivers & canyons
    const rd = new Float32Array(G1 * G1).fill(1e9), ry = new Float32Array(G1 * G1);
    for (const rv of this.rivers) {
      const top = rv.def.top;
      for (const p of rv.pts) {
        const gx0 = Math.max(0, Math.floor((p.x - top + HALF) / CELL)), gx1 = Math.min(GRID, Math.ceil((p.x + top + HALF) / CELL));
        const gz0 = Math.max(0, Math.floor((p.z - top + HALF) / CELL)), gz1 = Math.min(GRID, Math.ceil((p.z + top + HALF) / CELL));
        for (let gz = gz0; gz <= gz1; gz++) for (let gx = gx0; gx <= gx1; gx++) {
          const dx = gx * CELL - HALF - p.x, dz = gz * CELL - HALF - p.z, d = Math.sqrt(dx * dx + dz * dz), k = gz * G1 + gx;
          if (d < rd[k]) { rd[k] = d; ry[k] = p.y - (rv.def.water ? 1.8 : 0); }
        }
      }
      for (let k = 0; k < rd.length; k++) if (rd[k] < top) {
        const w = 1 - smoothstep(rv.def.bottom, top, rd[k]);
        if (ry[k] < h[k]) { h[k] = lerp(h[k], ry[k], w); if (w > 0.2) this.water[k] = 1; }
        rd[k] = 1e9;
      }
    }
    // --- derive bridge + guardrail flags
    for (const r of net.roads) {
      const hw = r.def.halfWidth;
      for (let i = 0; i < r.n; i++) {
        const x = r.px[i], z = r.pz[i], y = r.py[i];
        if (y - this.sample(x, z) > 1.3) r.flags[i] |= F_BRIDGE;
        if (r.flags[i] & F_TUNNEL) { r.flags[i] |= F_GUARD_L | F_GUARD_R; continue; }
        if (r.def.surface !== 'asphalt' && !(r.flags[i] & F_BRIDGE)) continue;
        const o = hw + 7;
        if (y - this.sample(x + r.rx[i] * o, z + r.rz[i] * o) > 2.2) r.flags[i] |= F_GUARD_R;
        if (y - this.sample(x - r.rx[i] * o, z - r.rz[i] * o) > 2.2) r.flags[i] |= F_GUARD_L;
      }
      const src = r.flags.slice();
      for (let i = 0; i < r.n; i++) {
        let f = 0;
        for (let k = -5; k <= 5; k++) { const j = r.wrap(i + k); if (j >= 0) f |= src[j]; }
        r.flags[i] |= f & (F_BRIDGE | F_GUARD_L | F_GUARD_R);
        if (r.flags[i] & F_BRIDGE) r.flags[i] |= F_GUARD_L | F_GUARD_R;
      }
    }
  }

  /** Bilinear terrain height. */
  sample(x: number, z: number): number {
    let fx = (x + HALF) / CELL, fz = (z + HALF) / CELL;
    fx = fx < 0 ? 0 : fx > GRID - 0.001 ? GRID - 0.001 : fx; fz = fz < 0 ? 0 : fz > GRID - 0.001 ? GRID - 0.001 : fz;
    const ix = fx | 0, iz = fz | 0, tx = fx - ix, tz = fz - iz, k = iz * G1 + ix, h = this.h;
    return (h[k] * (1 - tx) + h[k + 1] * tx) * (1 - tz) + (h[k + G1] * (1 - tx) + h[k + G1 + 1] * tx) * tz;
  }
  distToRoad(x: number, z: number): number {
    const ix = Math.min(GRID, Math.max(0, Math.round((x + HALF) / CELL))), iz = Math.min(GRID, Math.max(0, Math.round((z + HALF) / CELL)));
    return this.roadDist[iz * G1 + ix];
  }
  inWater(x: number, z: number): boolean {
    const ix = Math.min(GRID, Math.max(0, Math.round((x + HALF) / CELL))), iz = Math.min(GRID, Math.max(0, Math.round((z + HALF) / CELL)));
    return this.water[iz * G1 + ix] === 1;
  }
  normal(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    const e = 2;
    const dx = this.sample(x + e, z) - this.sample(x - e, z), dz = this.sample(x, z + e) - this.sample(x, z - e);
    return out.set(-dx, 2 * e, -dz).normalize();
  }
}

// ---------------------------------------------------------------- rendering

export interface TerrainTextures {
  sand: THREE.Texture; sandN: THREE.Texture; forest: THREE.Texture; forestN: THREE.Texture;
  rock: THREE.Texture; rockN: THREE.Texture; grass: THREE.Texture;
}

const LOD_STEPS = [1, 2, 5, 10];

export class Terrain {
  readonly group = new THREE.Group();
  readonly material: THREE.MeshLambertMaterial;
  readonly uniforms = { uWet: { value: 0 }, uSnowLine: { value: 520 }, uDetail: { value: 1 } };
  private chunks: { cx: number; cz: number; center: THREE.Vector3; lods: (THREE.Mesh | null)[]; cur: number }[] = [];
  lodScale = 1; castShadows = false;
  setCastShadows(on: boolean) { this.castShadows = on; this.group.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = on && o.userData.lod === 0; }); }

  constructor(readonly hf: HeightField, tex: TerrainTextures) {
    const cut = new THREE.DataTexture(hf.cutY, G1, G1, THREE.RedFormat, THREE.FloatType);
    cut.magFilter = cut.minFilter = THREE.NearestFilter; cut.needsUpdate = true;
    const mat = new THREE.MeshLambertMaterial();
    const U = this.uniforms;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U, {
        tSand: { value: tex.sand }, tSandN: { value: tex.sandN }, tForest: { value: tex.forest }, tForestN: { value: tex.forestN },
        tRock: { value: tex.rock }, tRockN: { value: tex.rockN }, tGrass: { value: tex.grass }, tCut: { value: cut },
      });
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 biome;\nvarying vec3 vWPos;\nvarying vec3 vWNrm;\nvarying vec4 vBiome;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = position; vWNrm = normal; vBiome = biome;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform sampler2D tSand, tSandN, tForest, tForestN, tRock, tRockN, tGrass, tCut;
          uniform float uWet, uSnowLine, uDetail;
          varying vec3 vWPos; varying vec3 vWNrm; varying vec4 vBiome;
          vec3 gNrm;`)
        .replace('#include <map_fragment>', `
          float cdist = length(vWPos - cameraPosition);
          float farMix = smoothstep(25., 200., cdist);
          vec3 wn = normalize(vWNrm);
          float slope = 1.0 - wn.y;
          float bD = vBiome.x, bM = vBiome.y, bF = vBiome.z;
          vec3 macroS = texture2D(tSand, vWPos.xz / 870.).rgb;
          float macro = 0.7 + 0.6 * dot(macroS, vec3(0.6, 0.9, 1.2));
          // one planar rock sample: pick the projection by the dominant horizontal normal axis
          vec2 ruv = wn.y > 0.5 ? vWPos.xz : (abs(wn.x) > abs(wn.z) ? vWPos.zy : vWPos.xy);
          vec3 rock = texture2D(tRock, ruv / 13.0).rgb;
          vec3 grey = vec3(dot(rock, vec3(0.4, 0.4, 0.3)));
          vec3 terr = vec3(0.0);
          float snow = 0.0;
          if (bD > 0.02) {
            vec3 sand = texture2D(tSand, vWPos.xz / 9.0).rgb;
            float strata = 0.86 + 0.2 * sin(vWPos.y * 0.21 + macroS.r * 9.0) * sin(vWPos.y * 0.067 + 1.7);
            terr += bD * mix(sand * vec3(1.9, 1.5, 1.22) + vec3(0.05, 0.035, 0.02), rock * vec3(2.0, 1.12, 0.72) * strata, smoothstep(0.16, 0.36, slope));
          }
          if (bM > 0.02) {
            vec3 grass = texture2D(tGrass, vWPos.xz / 15.0).rgb;
            snow = smoothstep(uSnowLine - 40.0, uSnowLine + 50.0, vWPos.y + macroS.g * 120.0) * smoothstep(0.62, 0.3, slope);
            vec3 cM = mix(grass * vec3(0.72, 0.98, 0.5), grey * vec3(1.0, 1.02, 1.08), smoothstep(0.2, 0.42, slope));
            terr += bM * mix(cM, vec3(0.86, 0.89, 0.94), snow);
          }
          if (bF > 0.02) {
            vec3 forest = texture2D(tForest, vWPos.xz / 7.0).rgb;
            terr += bF * mix(forest * mix(vec3(0.95, 1.0, 0.8), vec3(0.55, 0.95, 0.42), clamp(0.9 * macroS.b + 0.25, 0.0, 1.0)), grey * vec3(0.74, 0.76, 0.72), smoothstep(0.3, 0.55, slope));
          }
          terr *= macro;
          terr = mix(terr, mix(vec3(0.33, 0.3, 0.27), terr, 0.45), vBiome.w * 0.75);
          terr *= mix(1.0, 0.62, uWet);
          diffuseColor.rgb = terr;
          gNrm = wn;
          if (uDetail > 0.5 && cdist < 90.0) {
            vec3 nm = texture2D(tRockN, vWPos.xz / 7.0).xyz * 2.0 - 1.0;
            gNrm = normalize(wn + vec3(nm.x, 0.0, nm.y) * 0.6 * (1.0 - cdist / 90.0));
          }
        `)
        .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize((viewMatrix * vec4(gNrm, 0.0)).xyz);');
    };
    this.material = mat;
    for (let cz = 0; cz < CHUNKS; cz++) for (let cx = 0; cx < CHUNKS; cx++) {
      const s = CHUNK_CELLS * CELL;
      const x = cx * s - HALF + s / 2, z = cz * s - HALF + s / 2;
      this.chunks.push({ cx, cz, center: new THREE.Vector3(x, hf.sample(x, z), z), lods: [null, null, null, null], cur: -1 });
    }
  }

  private build(cx: number, cz: number, lod: number): THREE.Mesh {
    const hf = this.hf, step = LOD_STEPS[lod], n = CHUNK_CELLS / step, n1 = n + 1;
    const gx0 = cx * CHUNK_CELLS, gz0 = cz * CHUNK_CELLS;
    const vcount = n1 * n1 + 4 * n1;
    const pos = new Float32Array(vcount * 3), nrm = new Float32Array(vcount * 3), bio = new Float32Array(vcount * 4);
    const b: [number, number, number] = [0, 0, 0];
    const H = (gx: number, gz: number) => hf.h[Math.min(GRID, Math.max(0, gz)) * G1 + Math.min(GRID, Math.max(0, gx))];
    let v = 0;
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const gx = gx0 + i * step, gz = gz0 + j * step, x = gx * CELL - HALF, z = gz * CELL - HALF;
      pos[v * 3] = x; pos[v * 3 + 1] = H(gx, gz); pos[v * 3 + 2] = z;
      const dx = H(gx + step, gz) - H(gx - step, gz), dz = H(gx, gz + step) - H(gx, gz - step);
      const e = 2 * step * CELL, l = Math.hypot(dx, e, dz);
      nrm[v * 3] = -dx / l; nrm[v * 3 + 1] = e / l; nrm[v * 3 + 2] = -dz / l;
      biomeAt(x, z, b);
      bio[v * 4] = b[0]; bio[v * 4 + 1] = b[1]; bio[v * 4 + 2] = b[2];
      bio[v * 4 + 3] = 1 - smoothstep(7, 15, hf.roadDist[gz * G1 + gx]);
      v++;
    }
    const idx: number[] = [];
    // the hillside is left open where the tunnel bores in (low overburden near each portal)
    const open = (i: number, j: number) => { const k = (gz0 + j * step) * G1 + gx0 + i * step, c = hf.cutY[k]; return c > 0 && hf.h[k] - (c - 7.6) < 13; };
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      if (open(i, j) || open(i + 1, j) || open(i, j + 1) || open(i + 1, j + 1)) continue;
      const a = j * n1 + i, c = a + n1;
      idx.push(a, c, a + 1, a + 1, c, c + 1);
    }
    // skirts
    const drop = 6 + step * 3;
    const edge = (get: (t: number) => number, flip: boolean) => {
      const base = v;
      for (let t = 0; t <= n; t++) {
        const s = get(t);
        pos[v * 3] = pos[s * 3]; pos[v * 3 + 1] = pos[s * 3 + 1] - drop; pos[v * 3 + 2] = pos[s * 3 + 2];
        nrm[v * 3] = nrm[s * 3]; nrm[v * 3 + 1] = nrm[s * 3 + 1]; nrm[v * 3 + 2] = nrm[s * 3 + 2];
        bio[v * 4] = bio[s * 4]; bio[v * 4 + 1] = bio[s * 4 + 1]; bio[v * 4 + 2] = bio[s * 4 + 2]; bio[v * 4 + 3] = bio[s * 4 + 3];
        v++;
      }
      for (let t = 0; t < n; t++) {
        const a = get(t), c = get(t + 1), d = base + t, e2 = base + t + 1;
        if (flip) idx.push(a, d, c, c, d, e2); else idx.push(a, c, d, c, e2, d);
      }
    };
    edge(t => t, false); edge(t => n * n1 + t, true); edge(t => t * n1, true); edge(t => t * n1 + n, false);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('biome', new THREE.BufferAttribute(bio, 4));
    geo.setIndex(vcount > 65535 ? new THREE.BufferAttribute(new Uint32Array(idx), 1) : new THREE.BufferAttribute(new Uint16Array(idx), 1));
    geo.computeBoundingSphere(); geo.computeBoundingBox();
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.receiveShadow = true; mesh.castShadow = lod === 0 && this.castShadows; mesh.userData.lod = lod; mesh.matrixAutoUpdate = false;
    return mesh;
  }

  /** Select chunk LODs around the camera. Builds at most `budget` new geometries per call. */
  update(cam: THREE.Vector3, budget = 2): boolean {
    let pending = false;
    const s = this.lodScale;
    for (const c of this.chunks) {
      const d = Math.hypot(c.center.x - cam.x, c.center.z - cam.z);
      const want = d < 330 * s ? 0 : d < 760 * s ? 1 : d < 1700 * s ? 2 : 3;
      if (want === c.cur) continue;
      if (!c.lods[want]) {
        if (budget <= 0) { pending = true; continue; }
        budget--; c.lods[want] = this.build(c.cx, c.cz, want); this.group.add(c.lods[want]!);
      }
      if (c.cur >= 0 && c.lods[c.cur]) c.lods[c.cur]!.visible = false;
      c.lods[want]!.visible = true; c.cur = want;
    }
    return pending;
  }
}
