// Tiny local receiver used to save canvas captures from the running game (screenshots, baked atlases).
import http from 'node:http';
import fs from 'node:fs';
http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method !== 'POST') { res.end('ok'); return; }
  const q = new URL(req.url, 'http://x').searchParams;
  const name = (q.get('name') || 'shot').replace(/[^a-z0-9-_]/gi, ''), ext = (q.get('ext') || 'jpg').replace(/[^a-z0-9]/gi, '');
  const dir = q.get('dir') === 'bake' ? 'assets-src/bake' : 'docs/screenshots';
  fs.mkdirSync(dir, { recursive: true });
  const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => { fs.writeFileSync(`${dir}/${name}.${ext}`, Buffer.concat(chunks)); res.end('saved'); });
}).listen(5191, '127.0.0.1');
