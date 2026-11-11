// Tiny local receiver used to save canvas captures from the running game into docs/screenshots.
import http from 'node:http';
import fs from 'node:fs';
fs.mkdirSync('docs/screenshots', { recursive: true });
http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method !== 'POST') { res.end('ok'); return; }
  const name = (new URL(req.url, 'http://x').searchParams.get('name') || 'shot').replace(/[^a-z0-9-]/gi, '');
  const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => { fs.writeFileSync(`docs/screenshots/${name}.jpg`, Buffer.concat(chunks)); res.end('saved'); });
}).listen(5191, '127.0.0.1');
