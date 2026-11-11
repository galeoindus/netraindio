/**
 * tools/notes.js — small working memory the agent can write to.
 * Notes live in the session object; nothing is sent anywhere.
 */

export function noteSaveTool() {
  return {
    name: 'note_save',
    description: 'Save a short note in this session\'s memory, so later steps or later questions can use it.',
    risk: 'write',
    args: { text: { type: 'string', required: true, description: 'the note to keep' } },
    async run({ text }, ctx) {
      const value = String(text ?? '').trim();
      if (!value) throw new Error('empty note');
      ctx.memory.notes.push({ text: value, at: new Date().toISOString() });
      return { ok: true, answer: `नोट सहेज लिया (कुल ${ctx.memory.notes.length}).`, data: { notes: ctx.memory.notes.length } };
    },
  };
}

export function noteListTool() {
  return {
    name: 'note_list',
    description: 'List the notes saved in this session.',
    args: {},
    async run(_args, ctx) {
      if (!ctx.memory.notes.length) return { ok: true, answer: 'इस सत्र में कोई नोट नहीं है।', data: { notes: [] } };
      const lines = ctx.memory.notes.map((note, index) => `${index + 1}. ${note.text}`);
      return { ok: true, answer: lines.join('\n'), data: { notes: ctx.memory.notes } };
    },
  };
}
