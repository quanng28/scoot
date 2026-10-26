import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const root = resolve('dist/pose-demo');
const port=Number(process.env.POSE_PREVIEW_PORT??4173);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('POSE_PREVIEW_PORT must be 1024–65535');
const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.task': 'application/octet-stream' };
createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const file = resolve(root, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`);
    if (!file.startsWith(root + sep)) { response.writeHead(403).end(); return; }
    const bytes = await readFile(file);
    response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store',
      'Content-Security-Policy': "connect-src 'self'" }); response.end(bytes);
  } catch { response.writeHead(404).end('Not found'); }
}).listen(port, '127.0.0.1', () => process.stdout.write(`Local developer preview: http://127.0.0.1:${port}\n`));
