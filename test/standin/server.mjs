// A stand-in SillyTavern host: just enough page, context and API for the Duet Stage extension to boot.
// Usage: node server.mjs [extension dir] [port]   (defaults: this repo, 8765)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const extDir = path.resolve(process.argv[2] || path.join(here, '..', '..'));
const port = Number(process.argv[3] || 8765);   // not 8000: a real SillyTavern may be running there
const EXT = '/scripts/extensions/third-party/SillyTavern-Duet-Stage/';
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jsonl': 'text/plain', '.html': 'text/html', '.md': 'text/plain' };

const portrait = (name, hue) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600" width="400" height="600">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue} 70% 62%)"/><stop offset="1" stop-color="hsl(${hue} 60% 28%)"/></linearGradient></defs>
<circle cx="200" cy="150" r="84" fill="url(#g)"/><path d="M70 600 C70 380 130 270 200 270 C270 270 330 380 330 600 Z" fill="url(#g)"/>
<text x="200" y="560" font-family="sans-serif" font-size="34" fill="#fff" text-anchor="middle" opacity=".85">${name}</text></svg>`;

const send = (res, code, type, body) => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };

http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const p = decodeURIComponent(url.pathname);
    if (p === '/' || p === '/index.html') return send(res, 200, 'text/html', fs.readFileSync(path.join(here, 'host.html')));
    if (p === '/script.js') return send(res, 200, 'text/javascript', "export function getRequestHeaders(){return {'Content-Type':'application/json','X-CSRF-Token':'mock'}}\n");
    if (p.startsWith(EXT)) {
        const file = path.join(extDir, p.slice(EXT.length));
        if (!file.startsWith(extDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'text/plain', 'not found');
        return send(res, 200, types[path.extname(file)] || 'application/octet-stream', fs.readFileSync(file));
    }
    if (p === '/thumbnail' || p.startsWith('/characters/') || p.startsWith('/User Avatars/')) {
        const file = url.searchParams.get('file') || p.split('/').pop() || '';
        const hue = /bambi/i.test(file) ? 325 : /sera/i.test(file) ? 265 : /del|you|user/i.test(file) ? 85 : 200;
        return send(res, 200, 'image/svg+xml', portrait(file.replace(/\.\w+$/, ''), hue));
    }
    if (p === '/api/extensions/version') return send(res, 200, 'application/json', JSON.stringify({ isUpToDate: true, currentBranchName: 'main', currentCommitHash: 'mock' }));
    if (p === '/api/sprites/get') return send(res, 200, 'application/json', '[]');
    if (p === '/api/characters/chats') return send(res, 200, 'application/json', JSON.stringify([{ file_name: 'Bambi - 2026-11-13.jsonl', mes: 'Hi babe', last_mes: '2026-11-13' }]));
    if (p.startsWith('/api/')) return send(res, 200, 'application/json', '{}');
    send(res, 404, 'text/plain', 'not found');
}).listen(port, '127.0.0.1', () => console.log(`mock SillyTavern on http://127.0.0.1:${port} serving ${extDir}`));
