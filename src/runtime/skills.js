/**
 * runtime/skills.js — the bundled behaviours.
 *
 *   /plan    turn a goal into an approval-gated plan
 *   /grill   stress-test that plan before a single tool runs
 *   /goal    work until the objective is actually done
 *   /research  plan, fetch several sources, then answer
 *
 * A skill is a small policy around the kernel, not a prompt trick: it decides
 * what is allowed to run and what must be shown to a human first.
 */

export const SKILLS = {
  plan: {
    name: 'plan',
    description: 'Draft a plan and stop for approval before any tool runs.',
    mode: 'plan',
  },
  grill: {
    name: 'grill',
    description: 'Critique a plan: unknown tools, missing arguments, too many steps.',
    mode: 'agent',
  },
  goal: {
    name: 'goal',
    description: 'Run the loop until the objective is complete or the budget ends.',
    mode: 'agent',
  },
  research: {
    name: 'research',
    description: 'Plan, read several sources, then answer with the sources attached.',
    mode: 'agent',
  },
};

/**
 * Deterministic plan review. No model: these are the failures a plan actually
 * has in practice, and a machine can catch every one of them.
 */
export function grillPlan({ goal, plan, tools }) {
  const warnings = [];
  const steps = plan?.steps ?? [];
  const known = new Set(tools.map((tool) => tool.name));

  if (!steps.length) {
    warnings.push('the plan is empty — no tool can serve this goal');
  }
  if (steps.length > 5) {
    warnings.push(`the plan has ${steps.length} steps; fewer, larger steps finish faster`);
  }

  steps.forEach((step, index) => {
    if (!step?.tool) {
      warnings.push(`step ${index + 1} has no tool`);
      return;
    }
    if (!known.has(step.tool)) {
      warnings.push(`step ${index + 1} uses an unknown tool "${step.tool}"`);
      return;
    }
    const spec = tools.find((tool) => tool.name === step.tool);
    for (const [key, arg] of Object.entries(spec.args ?? {})) {
      if (arg.required && (step.args?.[key] === undefined || step.args?.[key] === '')) {
        warnings.push(`step ${index + 1} (${step.tool}) is missing required argument "${key}"`);
      }
    }
  });

  const covered = new Set(steps.map((step) => step.tool));
  if (goal && !covered.size && steps.length) {
    warnings.push('no step addresses the goal');
  }

  return { ok: warnings.length === 0, warnings };
}

/** Should this goal stop for human approval before running? */
export function needsApproval(mode, skill) {
  return mode === 'plan' || skill === 'plan';
}
