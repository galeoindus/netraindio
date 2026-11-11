/**
 * scripts/demo.mjs — the whole harness, in a terminal, with no network.
 * Shows the event log, the plan, the tool loop, subagents and compaction.
 */

import { Kernel } from '../src/runtime/kernel.js';
import { EventLog } from '../src/runtime/eventlog.js';
import { RuleModel } from '../src/model/index.js';
import { createTools } from '../src/tools/index.js';

const PAGE = `<html><head><title>Inflation cools to 4.1%</title></head><body>
<p>Retail inflation eased to 4.1 per cent in October, the statistics ministry said on Monday, the lowest in eight months.</p>
<p>Food inflation slowed to 5.2 per cent from 6.8 per cent, helped by cheaper vegetables and pulses.</p>
<p>Economists said the Reserve Bank of India is now likely to hold the repo rate through December.</p>
</body></html>`;

const fetchStub = async () => new Response(PAGE, { headers: { 'content-type': 'text/html' } });

const { registry } = createTools({ fetchImpl: fetchStub });
const log = new EventLog();
const kernel = new Kernel({ model: new RuleModel(), registry, log, fetchImpl: fetchStub });

async function show(label, goal, options = {}) {
  const result = await kernel.run(goal, { sessionId: 'demo', ...options });
  console.log('\n' + '═'.repeat(76));
  console.log(`${label}\nGOAL: ${goal}`);
  console.log('═'.repeat(76));
  console.log(`status=${result.status} model=${result.model} stopped=${result.stopped} confidence=${result.confidence ?? '-'}`);
  if (result.plan?.length) {
    console.log('\nPLAN');
    result.plan.forEach((step, index) => console.log(`  ${index + 1}. ${step.title ?? step.tool} → ${step.tool}(${JSON.stringify(step.args ?? {})})`));
  }
  if (result.warnings?.length) console.log(`  warnings: ${result.warnings.join('; ')}`);
  if (result.steps?.length) {
    console.log('\nSTEPS');
    for (const step of result.steps) {
      console.log(`  ${step.step}. ${step.tool} ${step.ok ? '✓' : '✗'} (${step.ms} ms)`);
      console.log(`     ${String(step.observation).split('\n')[0].slice(0, 140)}`);
    }
  }
  console.log(`\nANSWER: ${String(result.answer).slice(0, 600)}`);
  if (Object.keys(result.artifacts ?? {}).length) {
    console.log(`ARTIFACTS: ${Object.keys(result.artifacts).join(', ')}`);
  }
}

await show('SKILL /goal — read a page and summarise', 'https://example.com/inflation पढ़ो और सारांश दो');
await show('SKILL /plan — approval gate, nothing runs', 'https://example.com/inflation पढ़ो और सारांश दो', { mode: 'plan' });
await show('SAME GOAL, APPROVED', 'https://example.com/inflation पढ़ो और सारांश दो', { approved: true });
await show('EXACT TOOL — arithmetic', 'what is (1200-950)/950*100');
await show('EXACT TOOL — conversion', '12 km को miles में बदलो');
await show('HONEST REFUSAL', 'write me a novel about the sea');

const events = log.events('demo');
console.log('\n' + '═'.repeat(76));
console.log(`EVENT LOG: ${events.length} immutable events`);
console.log(`types: ${[...new Set(events.map((event) => event.type))].join(', ')}`);
console.log(`replay() rebuilt: goal="${log.replay('demo').goal}", toolCalls=${log.replay('demo').toolCalls.length}`);
console.log('Every event above was produced by our own kernel, tools and planner.');
