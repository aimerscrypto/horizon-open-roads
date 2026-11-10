// Downloads CC0 source assets from Poly Haven and the CC-BY Khronos CarConcept into assets-src/ (untracked).
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('assets-src');
const MODELS = ['quiver_tree_01',
  'wild_rooibos_bush', 'shrub_02', 'fern_02', 'namaqualand_boulder_02', 'namaqualand_boulder_05', 'namaqualand_cliff_01',
  'namaqualand_cliff_02', 'rock_face_01', 'rock_face_02', 'boulder_01', 'rock_07', 'rock_moss_set_01', 'concrete_road_barrier',
  'street_lamp_01', 'modular_electricity_poles', 'tree_stump_01', 'wooden_picnic_table', 'dead_tree_trunk'];
const TEXTURES = ['asphalt_04', 'red_sand', 'forest_ground_04', 'cliff_side', 'gravel_road', 'rock_face', 'aerial_grass_rock', 'concrete_wall_008', 'pine_bark', 'aerial_sand'];
const HDRIS = ['kloofendal_48d_partly_cloudy_puresky'];

async function dl(url, file) {
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const r = await retry(() => fetch(url));
  if (!r.ok) throw new Error(r.status + ' ' + url);
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
}
async function retry(fn, n = 6) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) { if (i >= n) throw e; await new Promise(r => setTimeout(r, 2000 * (i + 1))); }
  }
}
const api = async (p) => (await retry(() => fetch('https://api.polyhaven.com' + p))).json();

for (const id of MODELS) {
  try {
    const f = await api('/files/' + id);
    const g = f.gltf['1k'].gltf;
    const dir = path.join(OUT, 'models', id);
    await dl(g.url, path.join(dir, id + '.gltf'));
    for (const [rel, inc] of Object.entries(g.include || {})) await dl(inc.url, path.join(dir, rel));
    console.log('model', id);
  } catch (e) { console.log('FAIL model', id, e.message); }
}
for (const id of TEXTURES) {
  try {
    const f = await api('/files/' + id);
    for (const [k, name] of [['Diffuse', 'diff'], ['nor_gl', 'nor'], ['arm', 'arm']]) {
      const e = f[k]?.['1k']?.jpg; if (!e) { console.log('  no', k, id); continue; }
      await dl(e.url, path.join(OUT, 'textures', id, name + '.jpg'));
    }
    console.log('tex', id);
  } catch (e) { console.log('FAIL tex', id, e.message); }
}
for (const id of HDRIS) {
  const f = await api('/files/' + id);
  await dl(f.hdri['1k'].hdr.url, path.join(OUT, 'hdri', id + '_1k.hdr'));
  console.log('hdri', id);
}
await dl('https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CarConcept/glTF-Binary/CarConcept.glb', path.join(OUT, 'cars', 'CarConcept.glb'));
console.log('car ok');
