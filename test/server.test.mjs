import assert from 'node:assert/strict';
import test from 'node:test';

import { createApp, handleApi } from '../src/server.js';

async function post(app, body, path = '/api/run') {
  return handleApi(
    new Request(`https://netraindio.test${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    app
  );
}

test('health reports the runtime and the model', async () => {
  const app = createApp({});
  const body = await (await handleApi(new Request('https://netraindio.test/api/health'), app)).json();
  assert.equal(body.ok, true);
  assert.match(body.model, /rule planner|workers-ai|local model/);
  assert.ok(body.tools.includes('fetch_url'));
  assert.ok(body.runtime.includes('subagents'));
});

test('tools are published with their risk level', async () => {
  const app = createApp({});
  const body = await (await handleApi(new Request('https://netraindio.test/api/tools'), app)).json();
  const note = body.tools.find((tool) => tool.name === 'note_save');
  assert.equal(note.risk, 'write');
  assert.equal(body.tools.find((tool) => tool.name === 'fetch_url').risk, 'read');
});

test('run endpoint answers a simple goal', async () => {
  const app = createApp({});
  const response = await post(app, { goal: 'what is 6*7', sessionId: 'h1' });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, 'done');
  assert.match(body.answer, /42/);
});

test('run endpoint validates input', async () => {
  const app = createApp({});
  assert.equal((await post(app, {})).status, 400);
  assert.equal((await handleApi(new Request('https://netraindio.test/api/run'), app)).status, 405);
});

test('plan mode returns a plan and no steps', async () => {
  const app = createApp({});
  const body = await (await post(app, { goal: 'what is 6*7', mode: 'plan' })).json();
  assert.equal(body.status, 'awaiting_approval');
  assert.equal(body.steps.length, 0);
});

test('session endpoint replays the event log', async () => {
  const app = createApp({});
  await post(app, { goal: 'what is 6*7', sessionId: 'h2' });
  const body = await (await handleApi(new Request('https://netraindio.test/api/session/h2'), app)).json();
  assert.equal(body.goal, 'what is 6*7');
  assert.ok(body.events.length >= 4);
  assert.ok(body.events.every((event) => typeof event.seq === 'number'));
});

test('non-api paths fall through to static assets', async () => {
  const app = createApp({});
  assert.equal(await handleApi(new Request('https://netraindio.test/'), app), null);
});
