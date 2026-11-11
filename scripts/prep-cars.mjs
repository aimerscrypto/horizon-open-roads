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
const CARS = { coupe: 95000, gt: 110000, suv: 120000 };
const WHEEL_NODE = /wheel/i, NOT_WHEEL = /wheel_well|steering/i, WHEEL_MAT = /^(rims|rubber___tires|brakeCalipers|tireProtector)/i;
const tris = (doc) => { let t = 0; for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { const i = p.getIndices(); t += (i ? i.getCount() : p.getAttribute('POSITION').getCount()) / 3; } return Math.round(t); };

for (const [id, budget] of Object.entries(CARS)) {
  if (process.argv[2] && process.argv[2] !== id) continue;
  const doc = await io.read(`assets-src/cars/dl/${id}/scene.gltf`);
  const root = doc.getRoot();
  // The models ship posed with doors open and an opening animation: bake one keyframe as the static pose.
  const KEY = { coupe: 'first', gt: process.env.GT_KEY || 'first', suv: process.env.SUV_KEY || 'first' }[id];
  for (const anim of root.listAnimations()) for (const ch of anim.listChannels()) {
    const node = ch.getTargetNode(), sm = ch.getSampler(), path = ch.getTargetPath(); if (!node || !sm) continue;
    const out = sm.getOutput(), n = out.getCount(), el = out.getElement(KEY === 'first' ? 0 : n - 1, []);
    if (path === 'translation') node.setTranslation(el); else if (path === 'rotation') node.setRotation(el); else if (path === 'scale') node.setScale(el);
  }
  for (const a of root.listAnimations()) a.dispose();
  for (const n of root.listNodes()) n.setSkin(null);
  for (const s of root.listSkins()) s.dispose();
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
  const before = tris(doc);
  await doc.transform(dedup({ propertyTypes: ['Accessor', 'Texture'] }), flatten(), join({ keepNamed: false }), weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, budget / before), error: 0.002 }), prune(),
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
