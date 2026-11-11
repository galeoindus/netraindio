/**
 * model/index.js — the only place where "intelligence" enters the system.
 *
 * Three interchangeable backends, picked automatically:
 *
 *  1. WorkersAiModel — Cloudflare Workers AI, inside your own account, on the
 *     free daily allowance. This is what makes the deployed agent reason
 *     generally. The weights are Cloudflare's, not yours: stated plainly.
 *  2. LocalModel — an OpenAI-compatible server on your own machine (Ollama,
 *     llama.cpp, LM Studio, or open weights such as Muse Spark Open / Qwen).
 *     This is the only option where the model is genuinely yours.
 *  3. RuleModel — our own deterministic planner. No model at all: it handles
 *     the tools it knows and refuses the rest. Always available, so the agent
 *     never dies because a backend is missing.
 *
 * Every backend exposes the same two methods:
 *   plan({goal, tools})                -> { steps: [{title, tool, args}] }
 *   decide({goal, plan, steps, tools}) -> { thought, tool, args } | { thought, final }
 */

const LANGUAGE_LINE = (language) =>
  language && language.code !== 'en'
    ? `Write every user-facing string (thought, final) in ${language.name}. Tool names and arguments stay in English.`
    : 'Write every user-facing string in English.';

const DECISION_SCHEMA = `Reply with ONLY a JSON object.
To act:   {"thought": "...", "tool": "<name>", "args": {...}}
To finish:{"thought": "...", "final": "the complete answer for the user"}`;

function toolBlock(tools) {
  return tools
    .map((tool) => {
      const args = Object.entries(tool.args ?? {})
        .map(([key, spec]) => `${key}:${spec.type}${spec.required ? '' : '?'}`)
        .join(', ');
      return `- ${tool.name}(${args}) — ${tool.description}`;
    })
    .join('\n');
}

/** Pull the first JSON object out of a model reply, fences and prose included. */
export function parseJson(text) {
  const raw = String(text ?? '');
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

/* ────────────────────────────── Workers AI ────────────────────────────── */

export class WorkersAiModel {
  constructor(env, options = {}) {
    this.ai = env?.AI;
    this.name = 'workers-ai (Cloudflare, free tier)';
    this.models = options.models ?? [
      '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      '@cf/meta/llama-3.1-8b-instruct',
      '@cf/qwen/qwen2.5-coder-32b-instruct',
    ];
  }

  get available() {
    return Boolean(this.ai?.run);
  }

  async complete(prompt) {
    let lastError;
    for (const model of this.models) {
      try {
        const result = await this.ai.run(model, {
          messages: [
            { role: 'system', content: 'You are a careful agent. You never invent tool output.' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.2,
          max_tokens: 700,
        });
        const text = result?.response ?? result?.choices?.[0]?.message?.content ?? '';
        if (String(text).trim()) return String(text);
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(`Workers AI unavailable: ${lastError?.message ?? 'no model answered'}`);
  }

  async plan({ goal, tools, language }) {
    const prompt = [
      'Break this goal into at most 4 concrete steps. Each step names one tool.',
      LANGUAGE_LINE(language),
      DECISION_SCHEMA.replace('"tool"', '"tool" (one of the list)'),
      '',
      `Goal: ${goal}`,
      '',
      'Tools:',
      toolBlock(tools),
      '',
      'Reply as {"steps":[{"title":"...","tool":"...","args":{...}}]}',
    ].join('\n');
    const parsed = parseJson(await this.complete(prompt));
    const steps = Array.isArray(parsed?.steps) ? parsed.steps : [];
    return { steps: steps.filter((step) => step?.tool).slice(0, 4) };
  }

  async decide({ goal, plan, steps, tools, digest, language }) {
    const prompt = [
      'You are running a tool loop. Decide the single next action, or finish.',
      DECISION_SCHEMA,
      LANGUAGE_LINE(language),
      '',
      `Goal: ${goal}`,
      `Plan: ${plan.map((step, index) => `${index + 1}) ${step.title ?? step.tool}`).join(' | ') || '(none)'}`,
      '',
      'Tools:',
      toolBlock(tools),
      '',
      digest ? `Earlier context (compacted): ${digest}` : '',
      'Steps so far:',
      steps.length
        ? steps.map((step) => `${step.step}. ${step.tool} -> ${step.ok ? 'OK' : 'ERROR'}: ${String(step.observation).slice(0, 300)}`).join('\n')
        : '(none)',
      '',
      'Use only the tools listed. If the goal is already answered, finish.',
    ].join('\n');

    const parsed = parseJson(await this.complete(prompt));
    if (!parsed) return { thought: 'the model reply was not usable JSON', final: null, malformed: true };
    if (typeof parsed.final === 'string' && parsed.final.trim()) {
      return { thought: String(parsed.thought ?? ''), final: parsed.final };
    }
    if (typeof parsed.tool === 'string') {
      return { thought: String(parsed.thought ?? ''), tool: parsed.tool, args: parsed.args ?? {} };
    }
    return { thought: 'no action proposed', final: null, malformed: true };
  }
}

/* ───────────────────────────── local model ───────────────────────────── */

export class LocalModel {
  constructor(options = {}) {
    this.baseUrl = (options.baseUrl ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
    this.model = options.model ?? 'qwen2.5:7b-instruct';
    this.name = `local model (${this.model})`;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.timeout = options.timeout ?? 90_000;
  }

  get available() {
    return true; // assumed; a failed call surfaces as a normal error
  }

  async complete(prompt) {
    const init = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }],
      }),
    };
    if (AbortSignal?.timeout) init.signal = AbortSignal.timeout(this.timeout);
    const response = await this.fetchImpl(`${this.baseUrl}/v1/chat/completions`, init);
    if (!response.ok) throw new Error(`local model answered HTTP ${response.status}`);
    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content ?? data?.message?.content ?? '';
    if (!String(text).trim()) throw new Error('local model returned nothing');
    return String(text);
  }

  async plan(payload) {
    return WorkersAiModel.prototype.plan.call(this, payload);
  }

  async decide(payload) {
    return WorkersAiModel.prototype.decide.call(this, payload);
  }
}

/* ───────────────────────────── rule model ───────────────────────────── */

const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/i;

function stripWords(text, words) {
  let value = text;
  for (const word of words) value = value.replace(new RegExp(word, 'gi'), ' ');
  return value.replace(/[?।.,!]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Our own planner: no model, no network, no key. Deterministic.
 * It is the floor of the system — the agent always works, even offline.
 */
export class RuleModel {
  constructor() {
    this.name = 'rule planner (own code, no model)';
  }

  get available() {
    return true;
  }

  plan({ goal }) {
    const text = String(goal ?? '').trim();
    const url = (text.match(URL_PATTERN) ?? [])[0];
    const wantsSummary = /(summar|सारांश|संक्षेप|key points|मुख्य बिंदु|shorten)/i.test(text);

    if (url) {
      const steps = [{ title: `पेज पढ़ना: ${url}`, tool: 'fetch_url', args: { url } }];
      if (wantsSummary) steps.push({ title: 'सार बनाना', tool: 'summarise_text', args: { sentences: 4 } });
      return { steps };
    }
    if (/(news|headline|खबर|सुर्खिय|समाचार)/i.test(text)) {
      const query = stripWords(text, ['latest', 'news', 'headlines', 'top', 'khabar', 'khabrein', 'खबर', 'सुर्खियाँ', 'सुर्खियां', 'समाचार', 'ताज़ा', 'आज', 'की', 'बताओ']);
      return { steps: [{ title: 'न्यूज़ इंडेक्स में खोज', tool: 'news_search', args: { query, limit: 5 } }] };
    }
    if (/(save (a )?note|नोट सहेज|याद रख)/i.test(text)) {
      return { steps: [{ title: 'नोट सहेजना', tool: 'note_save', args: { text: stripWords(text, ['save (a )?note', 'नोट सहेजो', 'नोट सहेज', 'याद रखो']) || text } }] };
    }
    if (/(my notes|show notes|नोट्स)/i.test(text)) {
      return { steps: [{ title: 'नोट देखना', tool: 'note_list', args: {} }] };
    }
    const conversion = text.match(/(-?\d[\d,.]*)\s*([a-zA-Z°]+)\s*(?:to|in|को|में|से|->|→)\s*([a-zA-Z°]+)/i);
    if (conversion) {
      return {
        steps: [{
          title: 'इकाई बदलना',
          tool: 'convert_units',
          args: { value: Number(conversion[1].replace(/,/g, '')), from: conversion[2].replace('°', '').toLowerCase(), to: conversion[3].replace('°', '').toLowerCase() },
        }],
      };
    }
    if (/-?\d[\d,.]*\s*[+\-*/^%]\s*\(?\s*-?\d/.test(text)) {
      const expression = (text.match(/-?[\d(][\d\s+\-*/^%().]*[\d)]/) ?? [])[0];
      if (expression) return { steps: [{ title: 'गणना', tool: 'calculator', args: { expression: expression.trim() } }] };
    }
    if (/(what time|current time|कितने बजे|समय क्या|तारीख)/i.test(text)) {
      const city = (text.match(/\b(delhi|mumbai|kolkata|bengaluru|chennai|hyderabad|patna|london|tokyo|dubai|sydney|new york|singapore)\b/i) ?? [])[1];
      return { steps: [{ title: 'समय देखना', tool: 'datetime', args: { city: city ?? 'india' } }] };
    }
    if (/(word count|how many words|कितने शब्द|शब्द गिन|reading time)/i.test(text)) {
      return { steps: [{ title: 'पाठ की गिनती', tool: 'text_stats', args: {} }] };
    }
    if (/(summar|सारांश|संक्षेप)/i.test(text)) {
      return { steps: [{ title: 'उपलब्ध पाठ का सार', tool: 'summarise_text', args: { sentences: 4 } }] };
    }
    return { steps: [] };
  }

  async decide({ goal, steps, tools }) {
    const plan = this.plan({ goal, tools });
    if (!plan.steps.length) {
      return { thought: 'no plan for this goal', final: null, noPlan: true };
    }
    if (steps.length < plan.steps.length) {
      const next = plan.steps[steps.length];
      return { thought: next.title ?? 'next step', tool: next.tool, args: next.args ?? {} };
    }
    const successful = steps.filter((step) => step.ok);
    if (!successful.length) {
      const reason = steps[steps.length - 1]?.observation ?? 'all steps failed';
      return { thought: 'finished with failures', final: `यह काम पूरा नहीं हो सका। कारण: ${reason}` };
    }
    return { thought: 'finished', final: successful.map((step) => step.observation).join('\n\n') };
  }
}

/* ───────────────────────────── factory ───────────────────────────── */

/**
 * A hosted model is powerful and unreliable in the same breath: one malformed
 * JSON reply and a run used to die. HybridModel keeps the model for judgement
 * and hands the wheel to the rule planner the moment it stops making sense.
 * The user never sees a dead end because a model had a bad day.
 */
export class HybridModel {
  constructor(primary, fallback = new RuleModel()) {
    this.primary = primary;
    this.fallback = fallback;
    this.name = `${primary.name} + rule fallback`;
    this.failures = 0;
  }

  get available() {
    return true;
  }

  reset() {
    this.failures = 0;
  }

  async plan(payload) {
    try {
      const plan = await this.primary.plan(payload);
      if (plan?.steps?.length) return plan;
    } catch {
      this.failures += 1;
    }
    return this.fallback.plan(payload);
  }

  async decide(payload) {
    if (this.failures >= 2) return this.fallback.decide(payload);
    try {
      const decision = await this.primary.decide(payload);
      const usable = decision && ((decision.final !== null && decision.final !== undefined) || decision.tool);
      if (usable) return decision;
      this.failures += 1;
    } catch {
      this.failures += 1;
    }
    return this.fallback.decide(payload);
  }
}

export function createModel(env = {}) {
  if (env.AI?.run) return new HybridModel(new WorkersAiModel(env));
  if (env.LOCAL_LLM_URL) return new HybridModel(new LocalModel({ baseUrl: env.LOCAL_LLM_URL, model: env.LOCAL_LLM_MODEL }));
  return new RuleModel();
}
