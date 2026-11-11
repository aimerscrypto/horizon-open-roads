// Downloads photoscanned Poly Haven trees (CC0) used only to bake billboard atlases; the raw scans are far too heavy to ship.
import fs from 'node:fs';
import path from 'node:path';
const ids = process.argv.slice(2);
for (const id of ids) {
  const f = await (await fetch('https://api.polyhaven.com/files/' + id)).json();
  const g = f.gltf['1k'].gltf, dir = path.join('assets-src/models', id);
  const all = [[g.url, id + '.gltf'], ...Object.entries(g.include || {}).map(([rel, inc]) => [inc.url, rel])];
  for (const [url, rel] of all) {
    const file = path.join(dir, rel); if (fs.existsSync(file) && fs.statSync(file).size > 0) continue;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    for (let i = 0; ; i++) { try { const r = await fetch(url); fs.writeFileSync(file, Buffer.from(await r.arrayBuffer())); break; } catch (e) { if (i > 5) throw e; await new Promise(r => setTimeout(r, 3000)); } }
  }
  console.log('tree', id);
}
