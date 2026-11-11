/**
 * scripts/dev-server.mjs — run the harness locally. `npm start`.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp, handleApi } from '../src/server.js';

const PORT = Number(process.env.PORT ?? 8789);
const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const app = createApp(process.env);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host ?? `localhost:${PORT}`}`);
    const body = req.method === 'POST' ? await readBody(req) : undefined;
    const request = new Request(url, { method: req.method, headers: req.headers, body });

    const apiResponse = await handleApi(request, app);
    if (apiResponse) {
      res.writeHead(apiResponse.status, Object.fromEntries(apiResponse.headers));
      res.end(await apiResponse.text());
      return;
    }

    const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
    const filePath = join(PUBLIC_DIR, normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
    if (!filePath.startsWith(PUBLIC_DIR)) return res.writeHead(403).end('Forbidden');
    const info = await stat(filePath).catch(() => null);
    if (!info?.isFile()) return res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    res.writeHead(200, { 'content-type': MIME[extname(filePath)] ?? 'application/octet-stream' });
    res.end(await readFile(filePath));
  } catch (error) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: String(error?.message ?? error) }));
  }
});

server.listen(PORT, () => console.log(`Swayam on http://localhost:${PORT}`));
