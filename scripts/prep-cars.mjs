// Prepares the Sketchfab concept cars (Unity Fan, public domain) for the game:
// strips animation/skins, tags wheel parts, merges meshes per material, simplifies and compresses.
// Input: assets-src/cars/dl/<id>/scene.gltf   Output: public/assets/cars/<id>.glb
import fs from 'node:fs';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, textureCompress, meshopt, flatten, join } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

await MeshoptEncoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const CARS = { coupe: 95000, gt: 110000, suv: 190000 };
const WHEEL_NODE = /wheel/i, NOT_WHEEL = /wheel_well|steering/i, WHEEL_MAT = /^(rims|rubber___tires|brakeCalipers|tireProtector)/i;
const tris = (doc) => { let t = 0; for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { const i = p.getIndices(); t += (i ? i.getCount() : p.getAttribute('POSITION').getCount()) / 3; } return Math.round(t); };

for (const [id, budget] of Object.entries(CARS)) {
  if (process.argv[2] && process.argv[2] !== id) continue;
  const doc = await io.read(`assets-src/cars/dl/${id}/scene.gltf`);
  const root = doc.getRoot();
  // The models ship posed with doors open and an opening animation: bake one keyframe as the static pose.
  const KEY = { coupe: 'first', gt: process.env.GT_KEY || 'first', suv: process.env.SUV_KEY || 'first' }[id];
  // only the first clip is the door action; the SUV's other 168 clips are per-mesh export leftovers
  for (const anim of root.listAnimations().slice(0, process.env.NO_ANIM ? 0 : 1)) for (const ch of anim.listChannels()) {
    const node = ch.getTargetNode(), sm = ch.getSampler(), path = ch.getTargetPath(); if (!node || !sm) continue;
    const out = sm.getOutput(), n = out.getCount(), el = out.getElement(KEY === 'first' ? 0 : n - 1, []);
    if (path === 'translation') node.setTranslation(el); else if (path === 'rotation') node.setRotation(el); else if (path === 'scale') node.setScale(el);
  }
  for (const a of root.listAnimations()) a.dispose();
  // Doors and hatches are skinned to bones. Bake the skin at this pose into plain vertices so the model can be flattened.
  const mul = (a, b) => { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]; return o; };
  const scene = root.listScenes()[0];
  let baked = 0;
  for (const n of root.listNodes()) {
    const skin = n.getSkin(), mesh = n.getMesh(); if (!skin || !mesh) continue;
    const joints = skin.listJoints(), ibm = skin.getInverseBindMatrices();
    const mats = joints.map((j, i) => mul(j.getWorldMatrix(), ibm ? ibm.getElement(i, []) : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
    const own = mesh.clone(); n.setMesh(own);
    for (const p of own.listPrimitives()) {
      const J = p.getAttribute('JOINTS_0'), W = p.getAttribute('WEIGHTS_0'); if (!J || !W) continue;
      const P = p.getAttribute('POSITION').clone(), N = p.getAttribute('NORMAL')?.clone();
      const v = [0, 0, 0], nn = [0, 0, 0], jj = [0, 0, 0, 0], ww = [0, 0, 0, 0];
      for (let i = 0; i < P.getCount(); i++) {
        P.getElement(i, v); J.getElement(i, jj); W.getElement(i, ww); if (N) N.getElement(i, nn);
        let x = 0, y = 0, z = 0, nx = 0, ny = 0, nz = 0, ws = ww[0] + ww[1] + ww[2] + ww[3] || 1;
        for (let k = 0; k < 4; k++) {
          const w = ww[k] / ws; if (w === 0) continue; const m = mats[jj[k]];
          x += w * (m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12]); y += w * (m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13]); z += w * (m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]);
          if (N) { nx += w * (m[0] * nn[0] + m[4] * nn[1] + m[8] * nn[2]); ny += w * (m[1] * nn[0] + m[5] * nn[1] + m[9] * nn[2]); nz += w * (m[2] * nn[0] + m[6] * nn[1] + m[10] * nn[2]); }
        }
        P.setElement(i, [x, y, z]);
        if (N) { const l = Math.hypot(nx, ny, nz) || 1; N.setElement(i, [nx / l, ny / l, nz / l]); }
      }
      p.setAttribute('POSITION', P); if (N) p.setAttribute('NORMAL', N);
    }
    // skinned vertices are now in world space: hang the node off the scene root with no transform
    n.setSkin(null); const holder = doc.createNode(n.getName() + '_baked').setMesh(own); n.setMesh(null); scene.addChild(holder); baked++;
  }
  for (const s of root.listSkins()) s.dispose();
  if (baked) console.log(`  baked ${baked} skinned meshes`);
  const wheelMats = new Map();
  const tag = (mat) => { if (!mat) return mat; if (mat.getName().startsWith('WHEEL_')) return mat; let c = wheelMats.get(mat); if (!c) { c = mat.clone().setName('WHEEL_' + mat.getName()); wheelMats.set(mat, c); } return c; };
  const underWheel = (n) => { for (let p = n; p; p = p.getParentNode ? p.getParentNode() : null) { const nm = p.getName(); if (WHEEL_NODE.test(nm) && !NOT_WHEEL.test(nm)) return true; } return false; };
  for (const n of root.listNodes()) {
    const mesh = n.getMesh(); if (!mesh) continue;
    const inWheel = underWheel(n);
    for (const p of mesh.listPrimitives()) {
      for (const sem of p.listSemantics()) if (/^(JOINTS|WEIGHTS)_/.test(sem)) p.setAttribute(sem, null);
      const m = p.getMaterial(); if (!m) continue;
      if (/^shadow$/i.test(m.getName())) { p.dispose(); continue; }
      if (inWheel || WHEEL_MAT.test(m.getName())) p.setMaterial(tag(m));
    }
  }
  // drop stray export leftovers that sit far away from the car
  for (const n of root.listNodes()) {
    const mesh = n.getMesh(); if (!mesh) continue; const w = n.getWorldMatrix();
    for (const p of mesh.listPrimitives()) {
      const P = p.getAttribute('POSITION'), v = [0, 0, 0]; let far = false;
      for (let i = 0; i < P.getCount(); i += 5) { P.getElement(i, v); const x = w[0] * v[0] + w[4] * v[1] + w[8] * v[2] + w[12], y = w[1] * v[0] + w[5] * v[1] + w[9] * v[2] + w[13], z = w[2] * v[0] + w[6] * v[1] + w[10] * v[2] + w[14]; if (Math.abs(x) > 4 || Math.abs(z) > 6 || y > 4 || y < -1) { far = true; break; } }
      if (far) p.dispose();
    }
  }
  const before = tris(doc);
  await doc.transform(dedup({ propertyTypes: ['Accessor', 'Texture'] }), flatten(), join({ keepNamed: false }), weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, budget / before), error: 0.0012 }), prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 84 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  // measure the wheel layout (world space) for the physics spec
  const pts = [];
  for (const n of root.listNodes()) {
    const mesh = n.getMesh(); if (!mesh) continue; const w = n.getWorldMatrix();
    for (const p of mesh.listPrimitives()) {
      if (!p.getMaterial()?.getName().startsWith('WHEEL_')) continue;
      const a = p.getAttribute('POSITION'), v = [0, 0, 0];
      for (let i = 0; i < a.getCount(); i += 3) { a.getElement(i, v); pts.push([w[0] * v[0] + w[4] * v[1] + w[8] * v[2] + w[12], w[1] * v[0] + w[5] * v[1] + w[9] * v[2] + w[13], w[2] * v[0] + w[6] * v[1] + w[10] * v[2] + w[14]]); }
    }
  }
  const mm = (k) => [Math.min(...pts.map(p => p[k])), Math.max(...pts.map(p => p[k]))];
  const [x0, x1] = mm(0), [y0, y1] = mm(1), [z0, z1] = mm(2);
  await io.write(`public/assets/cars/${id}.glb`, doc);
  console.log(`${id}: ${before} -> ${tris(doc)} tris, ${root.listMeshes().length} meshes, ${root.listMaterials().length} materials, ${(fs.statSync(`public/assets/cars/${id}.glb`).size / 1024).toFixed(0)} KB`);
  console.log(`  wheel verts ${pts.length}; extent x ${(x1 - x0).toFixed(2)} y ${(y1 - y0).toFixed(2)} z ${(z1 - z0).toFixed(2)}  (min y ${y0.toFixed(2)})`);
  console.log('  materials:', root.listMaterials().map(m => m.getName()).join(', '));
}
