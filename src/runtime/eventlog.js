/**
 * runtime/eventlog.js — the append-only record of everything the agent does.
 *
 * Modelled on how a serious agent harness works: every model call, tool run,
 * plan and approval is appended once, with a sequence number and a timestamp.
 * Nothing is edited afterwards. The log is the single source of truth, so a
 * session can be replayed exactly, inspected by a human, or resumed after a
 * failure without guessing what had already happened.
 */

const MAX_EVENTS = 400;
const MAX_SESSIONS = 200;

export class EventLog {
  constructor(options = {}) {
    this.sessions = new Map();
    this.maxEvents = options.maxEvents ?? MAX_EVENTS;
    this.maxSessions = options.maxSessions ?? MAX_SESSIONS;
  }

  session(sessionId = 'anonymous') {
    const key = sessionId || 'anonymous';
    let entry = this.sessions.get(key);
    if (!entry) {
      entry = { id: key, seq: 0, events: [], createdAt: Date.now(), touchedAt: Date.now(), state: {} };
      this.sessions.set(key, entry);
      this.evict();
    }
    entry.touchedAt = Date.now();
    return entry;
  }

  /** Append one immutable event. Returns the stored record. */
  append(sessionId, event) {
    const entry = this.session(sessionId);
    entry.seq += 1;
    const record = { seq: entry.seq, at: new Date().toISOString(), ...event };
    entry.events.push(record);
    if (entry.events.length > this.maxEvents) entry.events = entry.events.slice(-this.maxEvents);
    return record;
  }

  events(sessionId) {
    return this.session(sessionId).events;
  }

  /** Everything of one type, in order — handy for the UI and for tests. */
  ofType(sessionId, type) {
    return this.events(sessionId).filter((event) => event.type === type);
  }

  /** Rebuild the working state from the log alone (replay-exact). */
  replay(sessionId) {
    const state = { goal: '', plan: [], toolCalls: [], approvals: [], answer: '', artifacts: {} };
    for (const event of this.events(sessionId)) {
      if (event.type === 'goal') state.goal = event.goal;
      if (event.type === 'plan') state.plan = event.steps ?? [];
      if (event.type === 'tool') state.toolCalls.push(event);
      if (event.type === 'approval') state.approvals.push(event);
      if (event.type === 'answer') state.answer = event.text;
      if (event.type === 'artifact') state.artifacts[event.name] = event.content;
    }
    return state;
  }

  /** The whole session as JSONL — what you would ship to a debugger. */
  toJSONL(sessionId) {
    return this.events(sessionId).map((event) => JSON.stringify(event)).join('\n');
  }

  /** Session summaries for the sidebar: newest first. */
  list() {
    return [...this.sessions.values()]
      .map((entry) => {
        const goal = entry.events.find((event) => event.type === 'goal');
        const answer = [...entry.events].reverse().find((event) => event.type === 'answer');
        return {
          id: entry.id,
          goal: goal?.goal ?? '',
          events: entry.events.length,
          steps: entry.events.filter((event) => event.type === 'tool').length,
          answered: Boolean(answer),
          updatedAt: new Date(entry.touchedAt).toISOString(),
        };
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  evict() {
    if (this.sessions.size <= this.maxSessions) return;
    const oldest = [...this.sessions.entries()].sort((a, b) => a[1].touchedAt - b[1].touchedAt)[0];
    if (oldest) this.sessions.delete(oldest[0]);
  }
}
