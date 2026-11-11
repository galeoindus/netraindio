/**
 * runtime/subagents.js — delegation.
 *
 * The main agent can hand a narrow goal to a subagent. Each subagent gets its
 * own short loop, its own step budget and a read-only tool set, and returns one
 * summary. They run in parallel, which is how a hard task gets done in the time
 * of its slowest part instead of the sum of all parts.
 */

const MAX_PARALLEL = 3;

export class Subagents {
  constructor(options = {}) {
    this.model = options.model;
    this.registry = options.registry;
    this.maxSteps = options.maxSteps ?? 3;
    this.readOnlyOnly = options.readOnlyOnly !== false;
  }

  /** Tools a subagent may use: no writes, no delegation (no infinite fan-out). */
  toolSpecs() {
    return [...this.registry.values()]
      .filter((tool) => tool.name !== 'delegate')
      .filter((tool) => !(this.readOnlyOnly && tool.risk === 'write'))
      .map((tool) => ({ name: tool.name, description: tool.description, args: tool.args ?? {} }));
  }

  async runOne(task, ctx) {
    const tools = this.toolSpecs();
    const steps = [];
    const plan = await this.model
      .plan({ goal: task.goal, tools })
      .catch(() => ({ steps: [] }));

    for (let index = 0; index < this.maxSteps; index += 1) {
      let decision;
      try {
        decision = await this.model.decide({ goal: task.goal, plan: plan.steps ?? [], steps, tools, digest: '' });
      } catch (error) {
        return { goal: task.goal, ok: false, summary: `subagent failed: ${error.message}`, steps };
      }

      if (decision.final) return { goal: task.goal, ok: true, summary: String(decision.final), steps };
      if (!decision.tool) break;

      const tool = this.registry.get(decision.tool);
      if (!tool) {
        steps.push({ step: index + 1, tool: decision.tool, ok: false, observation: 'unknown tool' });
        break;
      }

      try {
        const result = await tool.run(decision.args ?? {}, ctx);
        steps.push({ step: index + 1, tool: tool.name, ok: result?.ok !== false, observation: String(result?.answer ?? '') });
      } catch (error) {
        steps.push({ step: index + 1, tool: tool.name, ok: false, observation: String(error?.message ?? error) });
      }
    }

    const useful = steps.filter((step) => step.ok).map((step) => step.observation);
    return {
      goal: task.goal,
      ok: useful.length > 0,
      summary: useful.length ? useful[useful.length - 1] : 'no result',
      steps,
    };
  }

  /** Run up to MAX_PARALLEL tasks at once. One failing task never sinks the rest. */
  async run(tasks, ctx) {
    const list = (Array.isArray(tasks) ? tasks : []).filter((task) => task?.goal).slice(0, MAX_PARALLEL);
    if (!list.length) return [];
    const results = await Promise.allSettled(list.map((task) => this.runOne(task, ctx)));
    return results.map((result, index) =>
      result.status === 'fulfilled'
        ? result.value
        : { goal: list[index].goal, ok: false, summary: `subagent crashed: ${result.reason?.message ?? result.reason}`, steps: [] }
    );
  }
}
