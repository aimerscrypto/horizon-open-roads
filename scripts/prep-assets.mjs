// Optimises source assets (assets-src/) into web-ready files under public/assets/.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, textureCompress, meshopt, flatten, join, resample } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

await MeshoptEncoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const SRC = 'assets-src', OUT = 'public/assets';
const tris = (doc) => { let t = 0; for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { const i = p.getIndices(); t += (i ? i.getCount() : p.getAttribute('POSITION').getCount()) / 3; } return Math.round(t); };

// target triangle budgets per model
const MODELS = {
  quiver_tree_01: 1600, wild_rooibos_bush: 420, shrub_02: 420, fern_02: 260,
  namaqualand_boulder_02: 420, namaqualand_boulder_05: 420, namaqualand_cliff_01: 760, namaqualand_cliff_02: 760,
  rock_face_01: 700, rock_face_02: 700, rock_07: 340, rock_moss_set_01: 700,
  concrete_road_barrier: 300, tree_stump_01: 320,
  wooden_picnic_table: 800, dead_tree_trunk: 520,
};
fs.mkdirSync(`${OUT}/models`, { recursive: true }); fs.mkdirSync(`${OUT}/tex`, { recursive: true }); fs.mkdirSync(`${OUT}/cars`, { recursive: true }); fs.mkdirSync(`${OUT}/hdri`, { recursive: true });

const only = process.argv[2];
for (const [id, budget] of Object.entries(MODELS)) {
  if (only && only !== 'models' && only !== id) continue;
  try {
    const doc = await io.read(`${SRC}/models/${id}/${id}.gltf`);
    const before = tris(doc);
    const ratio = Math.min(1, budget / before);
    await doc.transform(dedup(), flatten(), join(), weld(), simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.08, lockBorder: false }), prune(),
      textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 82 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
    await io.write(`${OUT}/models/${id}.glb`, doc);
    console.log(id.padEnd(28), before, '->', tris(doc), 'tris', (fs.statSync(`${OUT}/models/${id}.glb`).size / 1024).toFixed(0), 'KB', 'mats', doc.getRoot().listMaterials().length);
  } catch (e) { console.log('FAIL', id, e.message); }
}

if (!only || only === 'car') {
  const doc = await io.read(`${SRC}/cars/CarConcept.glb`);
  const before = tris(doc);
  for (const n of doc.getRoot().listNodes()) {
    const name = n.getName();
    if (/Wipers|License|Emblem|Engine$|Pedal/.test(name)) { n.setMesh(null); }
  }
  // strip third-party logos: any texture whose name mentions Khronos is replaced by flat colour
  for (const m of doc.getRoot().listMaterials()) {
    const t = m.getBaseColorTexture();
    if (t && /khronos/i.test(t.getName() + t.getURI())) { m.setBaseColorTexture(null); m.setBaseColorFactor([0.02, 0.02, 0.02, 1]); }
  }
  await doc.transform(dedup(), prune(), weld(), simplify({ simplifier: MeshoptSimplifier, ratio: 0.5, error: 0.0012 }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 85 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(`${OUT}/cars/concept.glb`, doc);
  console.log('car', before, '->', tris(doc), (fs.statSync(`${OUT}/cars/concept.glb`).size / 1024).toFixed(0), 'KB');
}
if (!only || only === 'tex') {
  for (const id of fs.readdirSync(`${SRC}/textures`)) for (const f of fs.readdirSync(`${SRC}/textures/${id}`)) {
    const name = f.replace('.jpg', ''); if (name === 'arm' || id === 'rock_face') continue;
    await sharp(`${SRC}/textures/${id}/${f}`).resize(1024, 1024).webp({ quality: name === 'nor' ? 88 : 80 }).toFile(`${OUT}/tex/${id}_${name}.webp`);
  }
  for (const f of fs.readdirSync(`${SRC}/hdri`)) fs.copyFileSync(`${SRC}/hdri/${f}`, `${OUT}/hdri/sky_1k.hdr`);
  console.log('textures done');
}
