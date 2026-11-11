// World dressing: procedural conifers (near mesh + baked impostors), photoscanned rocks and plants,
// all instanced per 140 m cell with distance-based visibility, plus circle colliders for physics.
import * as THREE from 'three';
import { Assets } from '../core/assets';
import { fbm, hash2, mulberry32, noise2 } from '../core/noise';
import { Colliders } from './ground';
import { biomeAt, HALF, WORLD_SIZE } from './layout';
import { HeightField } from './terrain';

const CS = 140, CN = WORLD_SIZE / CS; // 32

// ---------------------------------------------------------------- firs
// Trees are billboards baked from the Poly Haven "Fir Tree 01" photoscan (see scripts/bake-trees.html):
// a 6x2 atlas holding 3 tree variants x 4 view angles. Each tree is two crossed quads showing two perpendicular views.
const FIR = { cols: 6, rows: 2, halfW: 3.214 / 19.304 };
function firGeometry(): THREE.BufferGeometry {
  const w = FIR.halfW, pos: number[] = [], uv: number[] = [], nrm: number[] = [], quad: number[] = [], idx: number[] = [];
  for (let q = 0; q < 2; q++) {
    const ax = q === 0 ? 1 : 0, az = q === 0 ? 0 : 1, b = q * 4;
    pos.push(-w * ax, 0, -w * az, w * ax, 0, w * az, -w * ax, 1, -w * az, w * ax, 1, w * az);
    uv.push(0, 0, 1, 0, 0, 1, 1, 1);
    for (let k = 0; k < 4; k++) { nrm.push(0, 1, 0); quad.push(q); }
    idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); g.setAttribute('quad', new THREE.Float32BufferAttribute(quad, 1)); g.setIndex(idx);
  return g;
}
function patchFir(m: THREE.Material, uTime: { value: number }) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float quad; attribute float aTile; uniform float uTime;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        float fv = floor(aTile / 2.0), fp = aTile - fv * 2.0, tile = fv * 4.0 + mod(fp + quad * 2.0, 4.0);
        vMapUv = vec2((mod(tile, ${FIR.cols}.0) + uv.x) / ${FIR.cols}.0, 1.0 - (floor(tile / ${FIR.cols}.0) + 1.0 - uv.y) / ${FIR.rows}.0);`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float sway = sin(uTime * 1.1 + instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.21) * 0.011 * uv.y * uv.y;
        transformed.x += sway; transformed.z += sway * 0.6;`);
    // the atlas is loaded premultiplied so filtered edges keep the right colour
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb /= max(diffuseColor.a, 0.04);');
  };
}

interface PropType { geos: THREE.BufferGeometry[]; mats: THREE.Material[]; range: number; cast: boolean; height: number; }
interface Inst { type: string; m: THREE.Matrix4; c: THREE.Color; }
interface Cell { cx: number; cz: number; center: THREE.Vector3; insts: Map<string, Inst[]>; meshes: Map<string, THREE.InstancedMesh[]>; trees: number[]; tree: THREE.InstancedMesh | null; }

export class Props {
  readonly group = new THREE.Group();
  private types = new Map<string, PropType>();
  private cells: Cell[] = [];
  private treeGeo: THREE.BufferGeometry; private treeMat: THREE.Material; private treeDepth: THREE.Material; readonly treeU = { value: 0 };
  nearRange = 190; farRange = 1150; treeShadows = true; density = 1; rangeScale = 1;
  treeCount = 0; propCount = 0;

  constructor(private hf: HeightField, A: Assets, readonly colliders: Colliders, renderer: THREE.WebGLRenderer, density: number) {
    this.density = density;
    const atlas = A.tex.fir_atlas;
    atlas.wrapS = atlas.wrapT = THREE.ClampToEdgeWrapping; atlas.premultiplyAlpha = true; atlas.anisotropy = 4; atlas.needsUpdate = true;
    this.treeGeo = firGeometry();
    this.treeMat = new THREE.MeshLambertMaterial({ map: atlas, alphaTest: 0.42, side: THREE.DoubleSide, color: 0xffffff, emissive: 0x10140c });
    this.treeDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: atlas, alphaTest: 0.42, side: THREE.DoubleSide });
    patchFir(this.treeMat, this.treeU); patchFir(this.treeDepth, this.treeU);
    void renderer;
    // GLB prop types
    const reg = (id: string, range: number, cast: boolean, sink = 0.08) => {
      const g = A.models[id]; if (!g) return;
      g.scene.updateMatrixWorld(true);
      const geos: THREE.BufferGeometry[] = [], mats: THREE.Material[] = [];
      const box = new THREE.Box3().setFromObject(g.scene), size = box.getSize(new THREE.Vector3()), cen = box.getCenter(new THREE.Vector3());
      g.scene.traverse(o => {
        const m = o as THREE.Mesh; if (!m.isMesh) return;
        const geo = m.geometry.clone(); geo.applyMatrix4(m.matrixWorld); geo.translate(-cen.x, -box.min.y - size.y * sink, -cen.z);
        const mat = (m.material as THREE.MeshStandardMaterial).clone();
        if (mat.map && (mat.alphaTest > 0 || mat.transparent)) { mat.alphaTest = 0.5; mat.transparent = false; mat.side = THREE.DoubleSide; }
        geos.push(geo); mats.push(mat);
      });
      (g as any).__size = size;
      this.types.set(id, { geos, mats, range, cast, height: size.y * (1 - sink) });
    };
    reg('namaqualand_boulder_02', 520, true, 0.18); reg('namaqualand_boulder_05', 520, true, 0.18);
    reg('namaqualand_cliff_01', 800, true, 0.12); reg('namaqualand_cliff_02', 800, true, 0.12);
    reg('rock_face_01', 760, true, 0.15); reg('rock_face_02', 760, true, 0.15); reg('rock_07', 380, true, 0.2);
    reg('rock_moss_set_01', 320, true, 0.12); reg('quiver_tree_01', 420, true, 0.02); reg('wild_rooibos_bush', 230, false, 0.05);
    reg('shrub_02', 210, false, 0.05); reg('fern_02', 110, false, 0.03); reg('tree_stump_01', 180, true, 0.05); reg('dead_tree_trunk', 320, true, 0.1);
    reg('wooden_picnic_table', 300, true, 0); reg('concrete_road_barrier', 400, true, 0);
    const sizeOf = (id: string): THREE.Vector3 => (A.models[id] as any)?.__size ?? new THREE.Vector3(1, 1, 1);

    for (let cz = 0; cz < CN; cz++) for (let cx = 0; cx < CN; cx++) {
      const x = cx * CS - HALF + CS / 2, z = cz * CS - HALF + CS / 2;
      this.cells.push({ cx, cz, center: new THREE.Vector3(x, hf.sample(x, z), z), insts: new Map(), meshes: new Map(), trees: [], tree: null });
    }
    this.scatter(sizeOf);
    this.buildMeshes();
  }

  private place(cell: Cell, type: string, x: number, y: number, z: number, scale: THREE.Vector3 | number, rotY: number, tint: THREE.Color, tilt = 0) {
    if (!this.types.has(type)) return;
    const s = typeof scale === 'number' ? new THREE.Vector3(scale, scale, scale) : scale;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt * Math.sin(rotY * 3), rotY, tilt * Math.cos(rotY * 5)));
    let a = cell.insts.get(type); if (!a) cell.insts.set(type, a = []);
    a.push({ type, m: new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, s), c: tint });
    this.propCount++;
  }

  private scatter(sizeOf: (id: string) => THREE.Vector3) {
    const hf = this.hf, b: [number, number, number] = [0, 0, 0], n = new THREE.Vector3();
    const D = this.density;
    for (const cell of this.cells) {
      const rnd = mulberry32(cell.cx * 7919 + cell.cz * 104729 + 13);
      const x0 = cell.cx * CS - HALF, z0 = cell.cz * CS - HALF;
      const pick = () => {
        const x = x0 + rnd() * CS, z = z0 + rnd() * CS;
        if (Math.abs(x) > HALF - 30 || Math.abs(z) > HALF - 30) return null;
        biomeAt(x, z, b);
        return { x, z, y: hf.sample(x, z), d: hf.distToRoad(x, z), ny: hf.normal(x, z, n).y, water: hf.inWater(x, z) };
      };
      // ---- conifers
      const nTree = Math.round(340 * D);
      for (let i = 0; i < nTree; i++) {
        const p = pick(); if (!p || p.water || p.d < 9.5 || p.ny < 0.74) continue;
        const clump = 0.35 + 0.65 * (0.5 + 0.5 * fbm(p.x / 170, p.z / 170, 2, 77));
        let prob = b[2] * clump * (p.d < 60 ? 1.0 : 0.62) + b[1] * 0.24 * clump * (p.y < 450 ? 1 : 0) * (p.d < 120 ? 1.2 : 0.7);
        if (p.d < 16) prob *= 0.55;
        if (rnd() > prob) continue;
        const h = (17 + rnd() * 13) * (b[1] > 0.5 ? 0.82 : 1), tint = 0.74 + rnd() * 0.34;
        cell.trees.push(p.x, p.y - 0.25, p.z, h, rnd() * 6.28, tint);
        this.colliders.add(p.x, p.z, 0.26 + h * 0.006, p.y + h);
        this.treeCount++;
      }
      // ---- rocks, plants
      const nProp = Math.round(30 * D);
      for (let i = 0; i < nProp; i++) {
        const p = pick(); if (!p || p.water) continue;
        const r = rnd(), rot = rnd() * 6.28, steep = p.ny < 0.82;
        if (b[0] > 0.5) { // desert
          const warm = new THREE.Color().setRGB(1.25 + rnd() * 0.2, 0.86 + rnd() * 0.1, 0.62 + rnd() * 0.1);
          if (steep && p.d > 40 && r < 0.75) {
            const id = rnd() < 0.5 ? 'namaqualand_cliff_01' : 'namaqualand_cliff_02', sz = sizeOf(id), s = (14 + rnd() * 20) / Math.max(sz.x, sz.z);
            this.place(cell, id, p.x, p.y, p.z, new THREE.Vector3(s, s * (1 + rnd() * 0.7), s), rot, warm);
            this.colliders.add(p.x, p.z, Math.max(sz.x, sz.z) * s * 0.36, p.y + sz.y * s);
          } else if (r < 0.2 && p.d > 14) {
            const id = rnd() < 0.5 ? 'namaqualand_boulder_02' : 'namaqualand_boulder_05', sz = sizeOf(id), big = rnd() < 0.18;
            const s = (big ? 5 + rnd() * 7 : 1.2 + rnd() * 2.6) / Math.max(sz.x, sz.z);
            this.place(cell, id, p.x, p.y, p.z, new THREE.Vector3(s, s * (big ? 1.3 + rnd() * 1.6 : 1), s), rot, warm, 0.2);
            this.colliders.add(p.x, p.z, Math.max(sz.x, sz.z) * s * 0.4, p.y + sz.y * s);
          } else if (r < 0.62 && p.d > 8.5) {
            const sz = sizeOf('wild_rooibos_bush'), s = (0.9 + rnd() * 1.3) / Math.max(sz.x, sz.z, 0.01);
            this.place(cell, 'wild_rooibos_bush', p.x, p.y, p.z, s, rot, new THREE.Color().setRGB(1.1, 1.0, 0.7));
            if (p.d < 40) this.colliders.add(p.x, p.z, 0.5, p.y + 1, 1);
          } else if (r < 0.7 && p.d > 12 && !steep) {
            const sz = sizeOf('quiver_tree_01'), s = (4 + rnd() * 3.5) / sz.y;
            this.place(cell, 'quiver_tree_01', p.x, p.y, p.z, s, rot, new THREE.Color(1, 1, 1));
            this.colliders.add(p.x, p.z, 0.4, p.y + 5);
          } else if (r < 0.73 && p.d > 12) {
            const sz = sizeOf('dead_tree_trunk'), s = (2.5 + rnd() * 2) / Math.max(sz.x, sz.y, sz.z);
            this.place(cell, 'dead_tree_trunk', p.x, p.y, p.z, s, rot, new THREE.Color(1.1, 1, 0.9));
            this.colliders.add(p.x, p.z, 0.7, p.y + 1.2);
          }
        } else if (b[1] > 0.5) { // mountain
          const cool = new THREE.Color().setRGB(0.9 + rnd() * 0.15, 0.9 + rnd() * 0.15, 0.95 + rnd() * 0.15);
          if (steep && p.d > 26 && r < 0.6) {
            const id = rnd() < 0.5 ? 'rock_face_01' : 'rock_face_02', sz = sizeOf(id), s = (10 + rnd() * 18) / Math.max(sz.x, sz.z);
            this.place(cell, id, p.x, p.y, p.z, new THREE.Vector3(s, s * (0.9 + rnd() * 0.8), s), rot, cool, 0.15);
            this.colliders.add(p.x, p.z, Math.max(sz.x, sz.z) * s * 0.34, p.y + sz.y * s);
          } else if (r < 0.3 && p.d > 12) {
            const sz = sizeOf('rock_07'), s = (1 + rnd() * 3.5) / Math.max(sz.x, sz.z);
            this.place(cell, 'rock_07', p.x, p.y, p.z, s, rot, cool, 0.3);
            this.colliders.add(p.x, p.z, Math.max(sz.x, sz.z) * s * 0.4, p.y + sz.y * s);
          } else if (r < 0.55 && p.d > 8.5 && p.y < 470) {
            const sz = sizeOf('shrub_02'), s = (0.8 + rnd() * 1.1) / Math.max(sz.x, sz.z, 0.01);
            this.place(cell, 'shrub_02', p.x, p.y, p.z, s, rot, new THREE.Color(0.9, 1, 0.8));
          }
        } else { // forest
          if (r < 0.14 && p.d > 12) {
            const sz = sizeOf('rock_moss_set_01'), s = (2.5 + rnd() * 4) / Math.max(sz.x, sz.z);
            this.place(cell, 'rock_moss_set_01', p.x, p.y, p.z, s, rot, new THREE.Color(1, 1, 1));
            this.colliders.add(p.x, p.z, Math.max(sz.x, sz.z) * s * 0.3, p.y + sz.y * s);
          } else if (r < 0.52 && p.d > 8) {
            const sz = sizeOf('shrub_02'), s = (0.9 + rnd() * 1.4) / Math.max(sz.x, sz.z, 0.01);
            this.place(cell, 'shrub_02', p.x, p.y, p.z, s, rot, new THREE.Color(0.85 + rnd() * 0.3, 1, 0.8));
            if (p.d < 30) this.colliders.add(p.x, p.z, 0.5, p.y + 1, 1);
          } else if (r < 0.9 && p.d > 7.5 && p.d < 70) {
            const sz = sizeOf('fern_02'), s = (0.8 + rnd() * 0.9) / Math.max(sz.x, sz.z, 0.01);
            this.place(cell, 'fern_02', p.x, p.y, p.z, s, rot, new THREE.Color(0.9, 1.05, 0.8));
          } else if (r < 0.94 && p.d > 10) {
            const sz = sizeOf('tree_stump_01'), s = (0.9 + rnd() * 0.6) / Math.max(sz.x, sz.z, 0.01);
            this.place(cell, 'tree_stump_01', p.x, p.y, p.z, s, rot, new THREE.Color(1, 1, 1));
            this.colliders.add(p.x, p.z, 0.45, p.y + 0.7);
          }
        }
      }
    }
    void noise2;
  }

  /** Place a specific prop (used by set dressing). */
  addProp(type: string, x: number, z: number, height: number, rotY: number, solidR = 0) {
    const cx = Math.min(CN - 1, Math.max(0, Math.floor((x + HALF) / CS))), cz = Math.min(CN - 1, Math.max(0, Math.floor((z + HALF) / CS)));
    const cell = this.cells[cz * CN + cx], y = this.hf.sample(x, z);
    const t = this.types.get(type); if (!t) return;
    this.place(cell, type, x, y, z, height / t.height, rotY, new THREE.Color(1, 1, 1));
    if (solidR > 0) this.colliders.add(x, z, solidR, y + height);
  }

  buildMeshes() {
    const dummy = new THREE.Object3D(), col = new THREE.Color();
    for (const cell of this.cells) {
      for (const [type, list] of cell.insts) {
        if (cell.meshes.has(type)) continue;
        const t = this.types.get(type)!; const arr: THREE.InstancedMesh[] = [];
        t.geos.forEach((geo, gi) => {
          const im = new THREE.InstancedMesh(geo, t.mats[gi], list.length);
          list.forEach((it, k) => { im.setMatrixAt(k, it.m); im.setColorAt(k, it.c); });
          im.castShadow = t.cast; im.receiveShadow = true; im.visible = false; im.computeBoundingSphere();
          this.group.add(im); arr.push(im);
        });
        cell.meshes.set(type, arr);
      }
      const nt = cell.trees.length / 6;
      if (nt && !cell.tree) {
        const im = new THREE.InstancedMesh(this.treeGeo, this.treeMat, nt), tiles = new Float32Array(nt);
        for (let i = 0; i < nt; i++) {
          const o = i * 6, h = cell.trees[o + 3];
          dummy.position.set(cell.trees[o], cell.trees[o + 1], cell.trees[o + 2]); dummy.rotation.set(0, cell.trees[o + 4], 0); dummy.scale.set(h, h, h); dummy.updateMatrix();
          im.setMatrixAt(i, dummy.matrix);
          const tn = cell.trees[o + 5]; col.setRGB(tn * 1.5, tn * 1.5, tn * 1.3); im.setColorAt(i, col);
          tiles[i] = Math.floor(hash2(i, cell.cx * 131 + cell.cz, 5) * 6); // variant (0-2) x view pair (0-1)
        }
        im.geometry = this.treeGeo.clone(); im.geometry.setAttribute('aTile', new THREE.InstancedBufferAttribute(tiles, 1));
        im.computeBoundingSphere(); im.customDepthMaterial = this.treeDepth; im.receiveShadow = false; im.visible = false;
        this.group.add(im); cell.tree = im;
      }
    }
  }

  update(cam: THREE.Vector3) {
    const rs = this.rangeScale;
    for (const cell of this.cells) {
      const d = Math.max(0, Math.hypot(cell.center.x - cam.x, cell.center.z - cam.z) - CS * 0.71);
      if (cell.tree) { cell.tree.visible = d < this.farRange * rs; cell.tree.castShadow = this.treeShadows && d < this.nearRange * rs; }
      for (const [type, arr] of cell.meshes) { const on = d < this.types.get(type)!.range * rs; for (const m of arr) m.visible = on; }
    }
  }
}
