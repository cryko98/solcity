// Minimal static file server: `node server.js` then open http://localhost:8080
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8080;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.mp3': 'audio/mpeg',
  '.webp': 'image/webp',
};

http
  .createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    // trailer recorder: POST /capture/<frame>.jpg saves rendered frames to captures/trailer
    if (req.method === 'POST' && url.startsWith('/capture/')) {
      const name = path.basename(url);
      if (!/^[\w.-]+$/.test(name)) {
        res.writeHead(400).end();
        return;
      }
      const dir = path.join(ROOT, 'captures', 'trailer');
      fs.mkdirSync(dir, { recursive: true });
      const out = fs.createWriteStream(path.join(dir, name));
      req.pipe(out);
      out.on('finish', () => res.writeHead(200).end('ok'));
      out.on('error', () => res.writeHead(500).end());
      return;
    }
    const file = path.normalize(path.join(ROOT, url === '/' ? 'index.html' : url));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end();
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404).end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  })
  .listen(PORT, () => console.log(`Sol City running at http://localhost:${PORT}`));
