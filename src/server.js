/**
 * server.js — the HTTP surface, shared by the Worker and the local server.
 *
 *   POST /api/run            run a goal (mode: "agent" | "plan", approved: bool)
 *   GET  /api/session/:id    the full event log, plan, answer and artifacts
 *   GET  /api/tools          tool catalogue
 *   GET  /api/health         model, tools, counters
 *   GET  /api/news?q=        the agent's own news index
 */

import { EventLog } from './runtime/eventlog.js';
import { Kernel } from './runtime/kernel.js';
import { createModel } from './model/index.js';
import { createTools, toolSpecs } from './tools/index.js';

const MAX_GOAL = 800;
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;

export function createApp(env = {}) {
  const log = new EventLog();
  const model = createModel(env);
  const { registry, newsStore } = createTools({ fetchImpl: env.fetchImpl });
  const kernel = new Kernel({ model, registry, log, env });
  return { log, model, registry, newsStore, kernel, env, rate: new Map() };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'cache-control': 'no-store',
    },
  });
}

function limited(app, key) {
  const now = Date.now();
  const entry = app.rate.get(key) ?? { count: 0, resetAt: now + WINDOW_MS };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + WINDOW_MS;
  }
  entry.count += 1;
  app.rate.set(key, entry);
  if (app.rate.size > 1000) app.rate.clear();
  return entry.count > MAX_PER_WINDOW;
}

export async function handleApi(request, app) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) return null;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'content-type',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
      },
    });
  }

  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'local';
  if (limited(app, ip)) return json({ error: 'Too many requests — wait a minute.' }, 429);

  try {
    if (url.pathname === '/api/health') {
      return json({
        ok: true,
        engine: 'netraindio/3.0',
        model: app.model.name,
        modelAvailable: app.model.available !== false,
        tools: toolSpecs(app.registry).map((tool) => tool.name),
        sessions: app.log.sessions.size,
        runtime: ['event-log', 'plan-gate', 'subagents', 'context-compaction'],
      });
    }

    if (url.pathname === '/api/tools') {
      return json({ tools: toolSpecs(app.registry) });
    }

    if (url.pathname === '/api/sessions') {
      return json({ sessions: app.log.list() });
    }

    if (url.pathname.startsWith('/api/session/')) {
      const sessionId = decodeURIComponent(url.pathname.slice('/api/session/'.length)).slice(0, 64) || 'anonymous';
      const state = app.log.replay(sessionId);
      return json({
        sessionId,
        goal: state.goal,
        plan: state.plan,
        answer: state.answer,
        artifacts: state.artifacts,
        events: app.log.events(sessionId),
      });
    }

    if (url.pathname === '/api/run') {
      if (request.method !== 'POST') return json({ error: 'Use POST with {"goal": "..."}' }, 405);
      let body = {};
      try {
        body = await request.json();
      } catch {
        return json({ error: 'Body must be JSON: {"goal": "..."}' }, 400);
      }
      const goal = String(body.goal ?? '').trim();
      if (!goal) return json({ error: 'goal is required' }, 400);
      if (goal.length > MAX_GOAL) return json({ error: `goal must be under ${MAX_GOAL} characters` }, 400);

      const sessionId = String(body.sessionId ?? '').slice(0, 64) || 'anonymous';
      const mode = body.mode === 'plan' ? 'plan' : 'agent';
      const result = await app.kernel.run(goal, {
        sessionId,
        mode,
        approved: Boolean(body.approved),
        plan: Array.isArray(body.plan) ? body.plan.slice(0, 8) : undefined,
      });
      return json(result);
    }

    if (url.pathname === '/api/news') {
      const query = url.searchParams.get('q') ?? '';
      const limit = Math.min(20, Number(url.searchParams.get('limit') ?? 10) || 10);
      const store = await app.newsStore.ensureFresh();
      const hits = app.newsStore.search(query, limit);
      return json({
        read: store.docs.length,
        failures: store.failures,
        articles: hits.map((hit) => ({
          title: hit.doc.title,
          link: hit.doc.link,
          source: hit.doc.source,
          publishedAt: hit.doc.publishedAt,
        })),
      });
    }

    return json({ error: 'Not found' }, 404);
  } catch (error) {
    return json({ error: 'The kernel crashed', detail: String(error?.message ?? error) }, 500);
  }
}
