import assert from 'node:assert/strict';
import test from 'node:test';

import { EventLog } from '../src/runtime/eventlog.js';
import { Kernel } from '../src/runtime/kernel.js';
import { RuleModel } from '../src/model/index.js';
import { createTools } from '../src/tools/index.js';

const PAGE = `<html><head><title>Inflation report</title></head><body>
<p>Retail inflation eased to 4.1 per cent in October, the statistics ministry said on Monday, the lowest in eight months.</p>
<p>Food inflation slowed to 5.2 per cent from 6.8 per cent, helped by cheaper vegetables.</p>
<p>Economists expect the RBI to hold the repo rate through December.</p>
</body></html>`;

const htmlFetch = async () => new Response(PAGE, { headers: { 'content-type': 'text/html' } });

function build(fetchImpl = htmlFetch, model = new RuleModel()) {
  const { registry } = createTools({ fetchImpl });
  const log = new EventLog();
  return { kernel: new Kernel({ model, registry, log, fetchImpl }), log, registry };
}

test('goal mode runs a two-step plan and answers', async () => {
  const { kernel } = build();
  const result = await kernel.run('https://example.com/r पढ़ो और सारांश दो', { sessionId: 'k1' });
  assert.equal(result.status, 'done');
  assert.equal(result.plan.length, 2);
  assert.equal(result.steps.length, 2);
  assert.equal(result.steps[0].tool, 'fetch_url');
  assert.ok(result.steps.every((step) => step.ok));
  assert.match(result.answer, /inflation/i);
});

test('plan mode stops at the approval gate without running a tool', async () => {
  const { kernel, log } = build();
  const result = await kernel.run('https://example.com/r पढ़ो', { sessionId: 'k2', mode: 'plan' });
  assert.equal(result.status, 'awaiting_approval');
  assert.equal(result.steps.length, 0);
  assert.ok(result.plan.length > 0);
  assert.ok(log.ofType('k2', 'approval').length === 1);
  assert.equal(log.ofType('k2', 'tool').length, 0, 'no tool may run before approval');
});

test('the same goal runs once approved', async () => {
  const { kernel } = build();
  const result = await kernel.run('https://example.com/r पढ़ो', { sessionId: 'k3', mode: 'plan', approved: true });
  assert.equal(result.status, 'done');
  assert.equal(result.steps.length, 1);
});

test('a goal with no plan is refused honestly', async () => {
  const { kernel } = build();
  const result = await kernel.run('write me a novel about the sea', { sessionId: 'k4' });
  assert.equal(result.stopped, 'no-plan');
  assert.equal(result.steps.length, 0);
  assert.match(result.answer, /कोई योजना|no plan/);
});

test('a failing tool yields an honest failure, low confidence', async () => {
  const { kernel } = build(async () => new Response('gone', { status: 404 }));
  const result = await kernel.run('read https://example.com/missing', { sessionId: 'k5' });
  assert.equal(result.steps[0].ok, false);
  assert.match(result.answer, /404/);
  assert.ok(result.confidence < 0.3);
});

test('every step is written to the event log', async () => {
  const { kernel, log } = build();
  await kernel.run('what is 6*7', { sessionId: 'k6' });
  const types = log.events('k6').map((event) => event.type);
  assert.ok(types.includes('goal'));
  assert.ok(types.includes('plan'));
  assert.ok(types.includes('tool'));
  assert.ok(types.includes('answer'));
});

test('a write tool pauses for approval and says why', async () => {
  const { kernel } = build();
  const result = await kernel.run('नोट सहेजो: कल बैठक है', { sessionId: 'k7' });
  assert.equal(result.status, 'awaiting_approval');
  assert.equal(result.pending.tool, 'note_save');
});

test('approved write runs and lands in the event log', async () => {
  const { kernel, log } = build();
  const result = await kernel.run('नोट सहेजो: कल बैठक है', { sessionId: 'k8', approved: true });
  assert.equal(result.status, 'done');
  assert.equal(result.steps[0].tool, 'note_save');
  assert.equal(log.ofType('k8', 'tool').length, 1);
});

test('a broken model does not crash the kernel', async () => {
  const model = {
    name: 'broken',
    async plan() { throw new Error('planner exploded'); },
    async decide() { throw new Error('decider exploded'); },
  };
  const { kernel } = build(htmlFetch, model);
  const result = await kernel.run('do something', { sessionId: 'k9' });
  assert.equal(result.status, 'done');
  assert.equal(result.stopped, 'model-error');
  assert.ok(typeof result.answer === 'string' && result.answer.length > 0);
});

test('subagents run in parallel and report back as steps', async () => {
  const model = {
    name: 'delegating',
    plan: () => ({ steps: [{ title: 'delegate', tool: 'delegate', args: {} }] }),
    calls: 0,
    async decide({ steps }) {
      if (!steps.length) {
        return { thought: 'fan out', tool: 'delegate', args: { tasks: [{ goal: 'a' }, { goal: 'b' }] } };
      }
      return { thought: 'done', final: 'both subagents reported' };
    },
  };
  const { kernel } = build(htmlFetch, model);
  const result = await kernel.run('do two things at once', { sessionId: 'k10' });
  assert.equal(result.status, 'done');
  assert.equal(result.steps.length, 2);
  assert.ok(result.steps.every((step) => step.tool === 'subagent'));
  assert.match(result.answer, /both subagents/);
});

test('confidence reflects failures, not optimism', async () => {
  const { kernel } = build(async () => new Response('nope', { status: 500 }));
  const result = await kernel.run('read https://example.com/x', { sessionId: 'k11' });
  assert.ok(result.confidence <= 0.2);
});
