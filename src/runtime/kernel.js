/**
 * runtime/kernel.js — the agent loop.
 *
 *   goal -> plan (approval gate) -> decide -> act -> observe -> compact -> repeat -> answer
 *
 * Everything that happens is appended to the event log first, then reported.
 * The loop stops on a final answer, on a repeated failure, or when the step
 * budget runs out — and it says which one happened.
 */

import { toolSpecs, validateArgs } from '../tools/index.js';
import { buildContext } from './context.js';
import { grillPlan, needsApproval } from './skills.js';
import { Subagents } from './subagents.js';

const DEFAULT_MAX_STEPS = 8;

function blankMemory() {
  return { lastFetchedUrl: '', lastFetchedTitle: '', lastFetchedText: '', notes: [] };
}

export class Kernel {
  constructor(options = {}) {
    this.model = options.model;
    this.registry = options.registry;
    this.log = options.log;
    this.maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
    this.subagents = options.subagents ?? new Subagents({ model: options.model, registry: options.registry });
    this.env = options.env ?? {};
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  specs() {
    return toolSpecs(this.registry);
  }

  /** Build the per-run context the tools receive. */
  context(sessionId) {
    const session = this.log.session(sessionId);
    if (!session.state.memory) session.state.memory = blankMemory();
    if (!session.state.artifacts) session.state.artifacts = {};
    return {
      session,
      memory: session.state.memory,
      artifacts: session.state.artifacts,
      fetch: this.fetchImpl,
      isGlobalFetch: true,
      env: this.env,
    };
  }

  async callTool(name, args, ctx) {
    const started = Date.now();
    let clean = args ?? {};
    try {
      const tool = this.registry.get(name);
      if (!tool) throw new Error(`unknown tool "${name}"`);
      clean = validateArgs(tool, args);
      const result = await tool.run(clean, ctx);
      return { tool: name, args: clean, ok: result?.ok !== false, observation: String(result?.answer ?? ''), data: result?.data ?? null, ms: Date.now() - started };
    } catch (error) {
      return { tool: name, args: clean, ok: false, observation: String(error?.message ?? error), data: null, ms: Date.now() - started };
    }
  }

  /**
   * Run one goal to completion (or to an approval gate).
   */
  async run(goal, options = {}) {
    const started = Date.now();
    const sessionId = options.sessionId || 'anonymous';
    const mode = options.mode ?? 'agent';
    const approved = Boolean(options.approved);
    const tools = this.specs();
    const ctx = this.context(sessionId);
    const session = ctx.session;

    this.log.append(sessionId, { type: 'goal', goal, mode, approved });

    // ── 1. plan ──────────────────────────────────────────────────────────
    let plan = { steps: [] };
    const planSource = Array.isArray(options.plan) && options.plan.length ? 'user' : 'model';
    try {
      plan = planSource === 'user' ? { steps: options.plan } : await this.model.plan({ goal, tools });
    } catch (error) {
      this.log.append(sessionId, { type: 'error', where: 'plan', message: String(error?.message ?? error) });
    }
    const review = grillPlan({ goal, plan, tools });
    this.log.append(sessionId, { type: 'plan', steps: plan.steps ?? [], warnings: review.warnings, source: planSource });

    if (needsApproval(mode) && !approved) {
      this.log.append(sessionId, { type: 'approval', decision: 'requested', plan: plan.steps ?? [] });
      return {
        status: 'awaiting_approval',
        sessionId,
        plan: plan.steps ?? [],
        planSource,
        estimate: this.estimate(plan.steps ?? []),
        warnings: review.warnings,
        answer: 'योजना तैयार है। मंज़ूरी मिलने पर मैं इसे चलाऊँगा — तब तक कोई औज़ार नहीं चलेगा।',
        steps: [],
        stopped: 'approval',
        model: this.model.name,
        ms: Date.now() - started,
        artifacts: session.state.artifacts,
      };
    }

    // ── 2. act ───────────────────────────────────────────────────────────
    const steps = [];
    let stopped = 'budget';
    let answer = '';

    for (let index = 0; index < this.maxSteps; index += 1) {
      const { digest } = buildContext(this.log.events(sessionId));

      let decision;
      try {
        decision = await this.model.decide({ goal, plan: plan.steps ?? [], steps, tools, digest });
      } catch (error) {
        this.log.append(sessionId, { type: 'error', where: 'decide', message: String(error?.message ?? error) });
        stopped = 'model-error';
        break;
      }

      if (decision.thought) this.log.append(sessionId, { type: 'thought', text: decision.thought });

      if (decision.final !== null && decision.final !== undefined) {
        answer = String(decision.final);
        stopped = 'final';
        break;
      }
      if (!decision.tool) {
        stopped = decision.noPlan ? 'no-plan' : 'no-action';
        if (decision.noPlan) answer = this.noPlanAnswer(goal);
        break;
      }

      // Delegation: fan out to subagents instead of calling a tool directly.
      if (decision.tool === 'delegate') {
        const tasks = decision.args?.tasks ?? [];
        const results = await this.subagents.run(tasks, ctx);
        for (const result of results) {
          this.log.append(sessionId, { type: 'subagent', goal: result.goal, ok: result.ok, summary: result.summary, steps: result.steps?.length ?? 0 });
          steps.push({
            step: steps.length + 1,
            tool: 'subagent',
            args: { goal: result.goal },
            ok: result.ok,
            observation: result.summary,
            ms: 0,
          });
        }
        continue;
      }

      const tool = this.registry.get(decision.tool);

      // A write tool needs a human yes the first time it runs.
      if (tool?.risk === 'write' && !approved) {
        this.log.append(sessionId, { type: 'approval', decision: 'requested', tool: tool.name, args: decision.args ?? {} });
        return {
          status: 'awaiting_approval',
          sessionId,
          plan: plan.steps ?? [],
          warnings: review.warnings,
          pending: { tool: tool.name, args: decision.args ?? {} },
          answer: `"${tool.name}" लिखने वाला औज़ार है। मंज़ूरी दीजिए तो चलाऊँगा।`,
          steps,
          stopped: 'approval',
          model: this.model.name,
          ms: Date.now() - started,
          artifacts: session.state.artifacts,
        };
      }

      const observation = await this.callTool(decision.tool, decision.args ?? {}, ctx);
      this.log.append(sessionId, {
        type: 'tool',
        tool: observation.tool,
        args: observation.args,
        ok: observation.ok,
        observation: observation.observation,
        ms: observation.ms,
      });
      steps.push({ step: steps.length + 1, thought: String(decision.thought ?? ''), ...observation });

      const lastTwo = steps.slice(-2);
      if (lastTwo.length === 2 && lastTwo.every((step) => !step.ok) && lastTwo[0].tool === lastTwo[1].tool) {
        stopped = 'repeated-failure';
        break;
      }
    }

    if (!answer) {
      answer = this.composeAnswer(goal, steps, stopped);
    }

    this.log.append(sessionId, { type: 'answer', text: answer, stopped });

    return {
      status: 'done',
      sessionId,
      plan: plan.steps ?? [],
      planSource,
      warnings: review.warnings,
      answer,
      steps,
      report: this.report(steps, stopped, planSource),
      stopped,
      model: this.model.name,
      confidence: this.score(steps, stopped),
      ms: Date.now() - started,
      artifacts: session.state.artifacts,
      events: this.log.events(sessionId).length,
    };
  }

  /** How big is this job? Shown next to Run so nobody waits blind. */
  estimate(planSteps) {
    const seconds = Math.max(1, planSteps.length * 2);
    return { steps: planSteps.length, effort: `~${seconds}s`, note: planSteps.length > 3 ? 'multi-step' : 'short' };
  }

  /** Verified / assumed / could not do — the trust footer. */
  report(steps, stopped, planSource) {
    const verified = steps
      .filter((step) => step.ok)
      .map((step) => `${step.tool}${step.ms ? ` (${step.ms} ms)` : ''}`);
    const couldNot = steps.filter((step) => !step.ok).map((step) => `${step.tool}: ${step.observation}`);
    if (stopped === 'no-plan') couldNot.push('no tool in this runtime can serve the goal');
    if (stopped === 'budget') couldNot.push('step budget ran out before the goal was finished');
    if (stopped === 'repeated-failure') couldNot.push('the same tool failed twice; the run was stopped');
    if (stopped === 'model-error') couldNot.push('the model backend failed; the answer uses only what was already collected');
    const assumed = [];
    if (planSource === 'model') assumed.push('the plan was proposed by the model and not edited by you');
    if (!steps.length) assumed.push('nothing was executed');
    assumed.push(`reasoning backend: ${this.model.name}`);
    return { verified, assumed, couldNot };
  }

  composeAnswer(goal, steps, stopped) {
    const successful = steps.filter((step) => step.ok);
    if (!successful.length) {
      const reason = steps[steps.length - 1]?.observation ?? 'सभी कदम विफल रहे';
      return `यह काम पूरा नहीं हो सका (${stopped})। अंतिम कारण: ${reason}`;
    }
    const unique = [];
    for (const part of successful.map((step) => step.observation)) {
      const existing = unique.findIndex((kept) => kept.includes(part) || part.includes(kept));
      if (existing === -1) unique.push(part);
      else if (part.length > unique[existing].length) unique[existing] = part;
    }
    return unique.join('\n\n');
  }

  noPlanAnswer(goal) {
    return [
      `"${goal}" के लिए मेरे पास कोई योजना नहीं बनी — और मैं बिना योजना कुछ नहीं करता।`,
      '',
      'जो काम मेरे औज़ारों से हो सकते हैं:',
      '• कोई सार्वजनिक पेज पढ़ना और सार देना',
      '• अपने न्यूज़ इंडेक्स में खोजना',
      '• गणना, इकाई बदलना, समय, पाठ की गिनती',
      '• नोट और आर्टिफ़ैक्ट सहेजना',
      '',
      'सामान्य सोच के लिए भाषा-मॉडल चाहिए: Cloudflare Workers AI (मुफ़्त tier, आपके ही खाते में) या अपनी मशीन पर open weights।',
    ].join('\n');
  }

  score(steps, stopped) {
    if (!steps.length) return 0.1;
    const ok = steps.filter((step) => step.ok).length;
    const failed = steps.length - ok;
    if (!ok) return 0.12;
    const base = stopped === 'final' ? 0.65 : 0.4;
    return Number(Math.max(0.05, Math.min(0.95, base - failed * 0.2 + (ok >= 2 ? 0.05 : 0))).toFixed(2));
  }
}
