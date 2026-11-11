/**
 * runtime/context.js — context management.
 *
 * A long task fills the context window with observations. Instead of dropping
 * them (and losing the thread) or sending everything (and paying for it), older
 * events are compacted into a short digest while the recent ones stay verbatim.
 * The model always sees: the goal, the plan, the digest, the recent steps.
 */

import { summarize } from '../lib/summarize.js';
import { contentTokens, truncate } from '../lib/text.js';

const DEFAULT_BUDGET = 3500; // characters of recent history
const KEEP_RECENT = 6;

function describe(event) {
  switch (event.type) {
    case 'goal':
      return `GOAL: ${event.goal}`;
    case 'plan':
      return `PLAN: ${(event.steps ?? []).map((step, index) => `${index + 1}) ${step.title ?? step.tool}`).join(' ')}`;
    case 'thought':
      return `THOUGHT: ${event.text}`;
    case 'tool':
      return `TOOL ${event.tool}(${JSON.stringify(event.args ?? {})}) -> ${event.ok ? 'OK' : 'ERROR'}: ${truncate(event.observation ?? '', 400)}`;
    case 'subagent':
      return `SUBAGENT ${event.goal} -> ${truncate(event.summary ?? '', 300)}`;
    case 'approval':
      return `APPROVAL: ${event.decision}`;
    case 'answer':
      return `ANSWER: ${truncate(event.text ?? '', 300)}`;
    default:
      return '';
  }
}

/**
 * @returns {{ digest: string, recent: string[], usedChars: number, compacted: number }}
 */
export function buildContext(events, options = {}) {
  const budget = options.budget ?? DEFAULT_BUDGET;
  const keepRecent = options.keepRecent ?? KEEP_RECENT;

  const lines = events.map(describe).filter(Boolean);
  if (!lines.length) return { digest: '', recent: [], usedChars: 0, compacted: 0 };

  const recent = lines.slice(-keepRecent);
  const older = lines.slice(0, Math.max(0, lines.length - keepRecent));

  let recentChars = recent.join('\n').length;
  // If even the recent tail is too big, summarise it as well.
  if (recentChars > budget) {
    const squeezed = summarize(recent.join(' '), { maxSentences: 5 });
    return {
      digest: older.length ? summarize(older.join(' '), { maxSentences: 4 }) : '',
      recent: [squeezed],
      usedChars: squeezed.length,
      compacted: events.length,
    };
  }

  const digest = older.length ? summarize(older.join(' '), { maxSentences: 5 }) : '';
  return { digest, recent, usedChars: recentChars + digest.length, compacted: older.length };
}

/** Rough token estimate: cheap, and good enough to decide when to compact. */
export function estimateTokens(text) {
  return Math.ceil(String(text ?? '').length / 4);
}

/** Keyword overlap between two texts, used by the planner to keep focus. */
export function related(a, b) {
  const left = new Set(contentTokens(a));
  const right = new Set(contentTokens(b));
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const term of left) if (right.has(term)) shared += 1;
  return shared / Math.min(left.size, right.size);
}
