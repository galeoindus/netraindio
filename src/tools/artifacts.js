/**
 * tools/artifacts.js — the agent's output surface.
 * Anything worth keeping (a summary, a table, a draft) is written as a named
 * artifact instead of being buried in chat, so the UI can show it in a panel
 * and the user can copy it.
 */

const MAX_ARTIFACTS = 20;
const MAX_SIZE = 20000;

export function writeArtifactTool() {
  return {
    name: 'write_artifact',
    description: 'Save a named piece of output (summary, table, draft, notes) so the user can read and copy it in the artifacts panel.',
    risk: 'write',
    args: {
      name: { type: 'string', required: true, description: 'short title, e.g. "inflation-summary"' },
      content: { type: 'string', required: true, description: 'the text to keep (max 20,000 characters)' },
    },
    async run({ name, content }, ctx) {
      const title = String(name).trim().slice(0, 80) || 'artifact';
      const body = String(content).slice(0, MAX_SIZE);
      const artifacts = ctx.session.state.artifacts ?? {};
      artifacts[title] = body;
      const keys = Object.keys(artifacts);
      if (keys.length > MAX_ARTIFACTS) delete artifacts[keys[0]];
      ctx.session.state.artifacts = artifacts;
      return { ok: true, answer: `आर्टिफ़ैक्ट "${title}" सहेजा (${body.length} अक्षर)।`, data: { name: title, characters: body.length } };
    },
  };
}

export function listArtifactsTool() {
  return {
    name: 'list_artifacts',
    description: 'List the artifacts saved in this session.',
    args: {},
    async run(_args, ctx) {
      const artifacts = ctx.session.state.artifacts ?? {};
      const names = Object.keys(artifacts);
      if (!names.length) return { ok: true, answer: 'इस सत्र में कोई आर्टिफ़ैक्ट नहीं है।', data: { artifacts: [] } };
      return {
        ok: true,
        answer: names.map((name) => `• ${name} (${artifacts[name].length} अक्षर)`).join('\n'),
        data: { artifacts: names },
      };
    },
  };
}

export function readArtifactTool() {
  return {
    name: 'read_artifact',
    description: 'Read back one artifact by name.',
    args: { name: { type: 'string', required: true, description: 'artifact name' } },
    async run({ name }, ctx) {
      const artifacts = ctx.session.state.artifacts ?? {};
      const value = artifacts[String(name)];
      if (value === undefined) throw new Error(`no artifact named "${name}"`);
      return { ok: true, answer: value, data: { name, characters: value.length } };
    },
  };
}
