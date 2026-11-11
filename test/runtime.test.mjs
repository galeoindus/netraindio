import assert from 'node:assert/strict';
import test from 'node:test';

import { EventLog } from '../src/runtime/eventlog.js';
import { buildContext, estimateTokens } from '../src/runtime/context.js';
import { grillPlan } from '../src/runtime/skills.js';
import { parseJson, RuleModel, createModel } from '../src/model/index.js';

test('event log appends immutable, sequenced records', () => {
  const log = new EventLog();
  log.append('s1', { type: 'goal', goal: 'a' });
  log.append('s1', { type: 'tool', tool: 'calculator', ok: true, observation: '42' });
  const events = log.events('s1');
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((event) => event.seq), [1, 2]);
  assert.ok(events[0].at);
});

test('event log replays a session back into state', () => {
  const log = new EventLog();
  log.append('s2', { type: 'goal', goal: 'read a page' });
  log.append('s2', { type: 'plan', steps: [{ tool: 'fetch_url', args: { url: 'https://x.test' } }] });
  log.append('s2', { type: 'tool', tool: 'fetch_url', ok: true, observation: 'text' });
  log.append('s2', { type: 'answer', text: 'done' });
  const state = log.replay('s2');
  assert.equal(state.goal, 'read a page');
  assert.equal(state.plan.length, 1);
  assert.equal(state.toolCalls.length, 1);
  assert.equal(state.answer, 'done');
});

test('event log serialises to JSONL', () => {
  const log = new EventLog();
  log.append('s3', { type: 'goal', goal: 'x' });
  const lines = log.toJSONL('s3').split('\n');
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).goal, 'x');
});

test('context compaction summarises old events and keeps recent ones', () => {
  const events = [];
  for (let index = 0; index < 20; index += 1) {
    events.push({ type: 'tool', tool: 'fetch_url', args: { url: `https://x.test/${index}` }, ok: true, observation: `Observation number ${index} about inflation and prices.` });
  }
  const context = buildContext(events, { keepRecent: 4 });
  assert.equal(context.recent.length, 4);
  assert.ok(context.digest.length > 0);
  assert.ok(context.compacted >= 16);
  assert.ok(context.digest.length < events.length * 60);
});

test('context of an empty log is empty, not broken', () => {
  const context = buildContext([]);
  assert.equal(context.digest, '');
  assert.deepEqual(context.recent, []);
});

test('token estimate is monotonic', () => {
  assert.ok(estimateTokens('abcdefgh') >= estimateTokens('abcd'));
});

test('grill catches unknown tools and missing arguments', () => {
  const tools = [{ name: 'fetch_url', args: { url: { type: 'string', required: true } } }];
  const bad = grillPlan({ goal: 'x', plan: { steps: [{ tool: 'rm_rf', args: {} }, { tool: 'fetch_url', args: {} }] }, tools });
  assert.equal(bad.ok, false);
  assert.ok(bad.warnings.some((warning) => warning.includes('unknown tool')));
  assert.ok(bad.warnings.some((warning) => warning.includes('missing required argument')));
});

test('grill passes a sound plan', () => {
  const tools = [{ name: 'fetch_url', args: { url: { type: 'string', required: true } } }];
  const good = grillPlan({ goal: 'x', plan: { steps: [{ tool: 'fetch_url', args: { url: 'https://x.test' } }] }, tools });
  assert.equal(good.ok, true);
  assert.deepEqual(good.warnings, []);
});

test('rule model plans, and refuses what it cannot do', () => {
  const model = new RuleModel();
  assert.equal(model.plan({ goal: 'what is 2+2' }).steps[0].tool, 'calculator');
  assert.equal(model.plan({ goal: 'read https://x.test' }).steps[0].tool, 'fetch_url');
  assert.equal(model.plan({ goal: '12 km to miles' }).steps[0].tool, 'convert_units');
  assert.deepEqual(model.plan({ goal: 'write a novel' }).steps, []);
});

test('parseJson survives fences and prose', () => {
  assert.deepEqual(parseJson('```json\n{"final":"ok"}\n```'), { final: 'ok' });
  assert.equal(parseJson('{"tool":"news_search","args":{}}').tool, 'news_search');
  assert.equal(parseJson('no json here'), null);
});

test('createModel picks the best available backend', () => {
  assert.equal(createModel({}).name, 'rule planner (own code, no model)');
  assert.match(createModel({ AI: { run: async () => ({}) } }).name, /workers-ai/);
  assert.match(createModel({ LOCAL_LLM_URL: 'http://127.0.0.1:11434' }).name, /local model/);
});
