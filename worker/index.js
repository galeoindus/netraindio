/**
 * netraindio — Cloudflare Worker entry point.
 *
 * The API is served by our own handler. Static files come from the assets
 * binding when the platform provides one; otherwise they are served from the
 * map that scripts/build-worker.mjs embeds, so the app cannot end up with a
 * working page and a dead API because of a routing setting.
 */

import { createApp, handleApi } from '../src/server.js';

let app = null;

function embedded(request) {
  const table = typeof __ASSETS === 'undefined' ? null : __ASSETS;
  if (!table) return null;
  const path = new URL(request.url).pathname === '/' ? '/index.html' : new URL(request.url).pathname;
  const hit = table[path];
  if (!hit) return null;
  return new Response(hit.body, {
    headers: { 'content-type': hit.type, 'cache-control': 'public, max-age=300' },
  });
}

export default {
  async fetch(request, env) {
    if (!app) app = createApp(env);

    const apiResponse = await handleApi(request, app);
    if (apiResponse) return apiResponse;

    const fromTable = embedded(request);
    if (fromTable) return fromTable;

    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  },
};
