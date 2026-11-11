/**
 * worker/index.js — Cloudflare Worker entry point.
 * The AI binding (env.AI) is optional: with it the agent reasons generally on
 * the free daily allowance; without it, the rule planner keeps it working.
 */

import { createApp, handleApi } from '../src/server.js';

let app = null;

export default {
  async fetch(request, env) {
    if (!app) app = createApp(env);

    const apiResponse = await handleApi(request, app);
    if (apiResponse) return apiResponse;

    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Static assets are not bound.', { status: 404 });
  },
};
