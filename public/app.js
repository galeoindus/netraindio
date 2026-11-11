/**
 * app.js — netraindio workbench. Plain browser JavaScript, no framework, no CDN.
 *
 * Interface rules taken from the agent products that got this right:
 * a live step ledger, tool cards with arguments and durations, reasoning behind
 * a disclosure, an editable plan behind an approval gate, and a
 * verified / assumed / could-not-do footer on every result.
 */

const state = {
  sessionId: newSessionId(),
  mode: 'agent',
  busy: false,
  lastGoal: '',
  plan: [],
  artifacts: {},
  events: [],
  steps: [],
};

const $ = (id) => document.getElementById(id);
const el = {
  thread: $('thread'), intro: $('intro'), starters: $('starters'),
  form: $('composer'), goal: $('goal'), send: $('send'), effort: $('effort'),
  dot: $('status-dot'), statusText: $('status-text'),
  modelChip: $('model-chip'), themeBtn: $('theme-btn'),
  sessions: $('session-list'), newRun: $('new-run'),
  paneArtifacts: $('pane-artifacts'), panePlan: $('pane-plan'), paneEvents: $('pane-events'),
};

const STARTERS = [
  'Read https://example.com and summarise it',
  'What is happening in cricket news?',
  'Convert 12 km to miles',
  'What time is it in Delhi?',
  '(1200-950)/950*100',
  'Save a note: RBI meeting tomorrow',
];

const newSessionId = () => (crypto.randomUUID ? crypto.randomUUID() : `s-${Date.now()}`);
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const prose = (text) => esc(text).split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br />')}</p>`).join('');

/* ── status ─────────────────────────────────────────────── */
function setStatus(kind, text) {
  el.dot.className = `dot ${kind}`;
  el.statusText.textContent = text;
}

/* ── cards ──────────────────────────────────────────────── */
function stepBlock(step) {
  const args = Object.keys(step.args ?? {}).length ? JSON.stringify(step.args) : '';
  return `
    <div class="step">
      <div class="step-row ${step.ok ? 'ok' : 'bad'}" data-step="${step.step}">
        <span class="glyph">${step.ok ? '✓' : '✗'}</span>
        <span class="step-title">${esc(step.tool)}${args ? ` <code>${esc(args.slice(0, 54))}</code>` : ''}</span>
        <span class="step-dur">${step.ms ?? 0} ms</span>
      </div>
      <div class="step-detail">
        ${step.thought ? `<p class="thought">${esc(step.thought)}</p>` : ''}
        <p class="kv">args ${esc(args || '—')}</p>
        <div class="out">${esc(step.observation ?? '')}</div>
      </div>
    </div>`;
}

function stepsCard(result) {
  if (!result.steps?.length) return '';
  const failed = result.steps.filter((s) => !s.ok).length;
  return `<div class="card">
    <div class="card-head"><span>Steps</span>
      <span class="meta"><span>${result.steps.length}</span>${failed ? `<span style="color:var(--bad)">${failed} failed</span>` : ''}<span>${result.ms ?? 0} ms</span></span>
    </div>
    ${result.steps.map(stepBlock).join('')}
  </div>`;
}

function planCard(result) {
  const steps = state.plan.length ? state.plan : result.plan ?? [];
  if (!steps.length) return '';
  const awaiting = result.status === 'awaiting_approval';
  const items = steps.map((step, index) => `<li data-i="${index}">
      ${esc(step.title ?? step.tool)} <code>${esc(step.tool)}</code>
      ${awaiting ? '<button class="drop" type="button" title="Remove step">×</button>' : ''}
    </li>`).join('');
  const warnings = (result.warnings ?? []).map((w) => `<li>${esc(w)}</li>`).join('');
  const estimate = result.estimate ? `${result.estimate.steps} steps · ${result.estimate.effort}` : '';
  return `<div class="card plan">
    <div class="card-head"><span>Plan${result.planSource === 'user' ? ' (yours)' : ''}</span><span class="meta">${esc(estimate)}</span></div>
    <div class="card-body">
      <ol>${items}</ol>
      ${warnings ? `<ul class="warn-list">${warnings}</ul>` : ''}
      ${awaiting ? `<div class="plan-actions"><button class="run-btn" type="button" data-approve="1">Approve and run</button><span class="estimate">Write tools ask first</span></div>` : ''}
    </div>
  </div>`;
}

function reportCard(result) {
  const report = result.report;
  if (!report) return '';
  const list = (items) => (items?.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '<p class="none">none</p>');
  return `<div class="card">
    <div class="card-head"><span>Report</span></div>
    <div class="report">
      <div><h5>Verified</h5>${list(report.verified)}</div>
      <div><h5>Assumed</h5>${list(report.assumed)}</div>
      <div><h5>Could not do</h5>${list(report.couldNot)}</div>
    </div>
  </div>`;
}

/* ── rendering ──────────────────────────────────────────── */
function addTurn(goal) {
  el.intro?.remove();
  const turn = document.createElement('div');
  turn.className = 'turn';
  turn.innerHTML = `<div class="you"><div class="bubble">${esc(goal)}</div></div>
    <div class="agent"><div class="card"><div class="card-body" style="color:var(--muted)">Working…</div></div></div>`;
  el.thread.appendChild(turn);
  scroll();
  return turn.querySelector('[data-agent], .agent');
}

function renderAgent(slot, result) {
  const confidence = result.confidence !== undefined ? Math.round(result.confidence * 100) : null;
  slot.innerHTML = `
    ${result.answer ? `<div class="card"><div class="card-body">${prose(result.answer)}</div></div>` : ''}
    ${planCard(result)}
    ${stepsCard(result)}
    ${reportCard(result)}
    <div class="meta-row">
      <span class="pill">${esc(result.status ?? 'done')}</span>
      <span class="pill">${esc(result.stopped ?? '')}</span>
      ${result.language ? `<span class="pill">${esc(result.language)}</span>` : ''}
      <span class="pill">${result.ms ?? 0} ms</span>
      ${confidence !== null ? `<span class="pill ${confidence >= 55 ? 'good' : 'warn'}">confidence ${confidence}%</span>` : ''}
    </div>`;

  slot.querySelectorAll('.step-row').forEach((row) => row.addEventListener('click', () => row.classList.toggle('open')));

  slot.querySelector('[data-approve]')?.addEventListener('click', (event) => {
    event.currentTarget.disabled = true;
    event.currentTarget.textContent = 'Running…';
    runGoal(state.lastGoal, { approved: true, mode: 'agent', plan: state.plan, silent: true });
  });

  slot.querySelectorAll('.drop').forEach((button) => {
    button.addEventListener('click', (event) => {
      const index = Number(event.target.closest('li').dataset.i);
      state.plan = state.plan.filter((_, position) => position !== index);
      renderAgent(slot, { ...result, plan: state.plan });
    });
  });

  state.steps = result.steps ?? [];
  state.plan = result.plan ?? [];
  state.artifacts = result.artifacts ?? {};
  renderInspector();
  scroll();
}

function renderInspector() {
  const names = Object.keys(state.artifacts ?? {});
  el.paneArtifacts.innerHTML = names.length
    ? names.map((name) => `<div class="artifact"><header><h4>${esc(name)}</h4>
        <button class="copy" type="button" data-copy="${esc(name)}">copy</button></header>
        <pre>${esc(state.artifacts[name])}</pre></div>`).join('')
    : '<p class="empty-row">Nothing yet</p>';

  el.paneArtifacts.querySelectorAll('[data-copy]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(state.artifacts[button.dataset.copy]);
        button.textContent = 'copied';
      } catch {
        button.textContent = 'failed';
      }
    });
  });

  el.panePlan.innerHTML = state.plan.length
    ? `<ol style="margin:0;padding-left:16px;font-size:12.5px">${state.plan.map((s) => `<li>${esc(s.title ?? s.tool)} <code>${esc(s.tool)}</code></li>`).join('')}</ol>`
    : '<p class="empty-row">No plan</p>';

  el.paneEvents.innerHTML = state.events.length
    ? `<div class="events-log">${state.events.map((e) => `<div class="event-line">${e.seq}. ${esc(e.type)} ${esc(e.tool ?? '')}${e.ok === false ? ' ✗' : ''}</div>`).join('')}</div>`
    : '<p class="empty-row">No events</p>';
}

const scroll = () => { el.thread.scrollTop = el.thread.scrollHeight; };

/* ── run ────────────────────────────────────────────────── */
async function runGoal(goal, options = {}) {
  if (state.busy) return;
  state.busy = true;
  state.lastGoal = goal;
  el.send.disabled = true;
  setStatus('working', state.mode === 'plan' ? 'Planning…' : 'Working…');

  const slot = options.silent ? document.querySelector('.turn:last-child .agent') : addTurn(goal);

  try {
    const response = await fetch('/api/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        goal,
        sessionId: state.sessionId,
        mode: options.mode ?? state.mode,
        approved: Boolean(options.approved),
        plan: options.plan?.length ? options.plan : undefined,
      }),
    });
    const result = await response.json();

    if (!response.ok) {
      slot.innerHTML = `<div class="card"><div class="card-body">Engine error: ${esc(result.error ?? 'unknown')}</div></div>`;
      setStatus('waiting', 'Error');
    } else {
      renderAgent(slot, result);
      setStatus(result.status === 'awaiting_approval' ? 'waiting' : 'done',
        result.status === 'awaiting_approval' ? 'Waiting for approval' : 'Done');
    }
    refreshSession();
  } catch (error) {
    slot.innerHTML = `<div class="card"><div class="card-body">Network error: ${esc(String(error.message ?? error))}</div></div>`;
    setStatus('waiting', 'Offline');
  } finally {
    state.busy = false;
    el.send.disabled = false;
    el.goal.focus();
  }
}

async function refreshSession() {
  try {
    const data = await (await fetch(`/api/session/${encodeURIComponent(state.sessionId)}`)).json();
    state.events = data.events ?? [];
    if (data.artifacts) state.artifacts = data.artifacts;
    renderInspector();
    loadSessions();
  } catch { /* the answer already landed */ }
}

async function loadSessions() {
  try {
    const data = await (await fetch('/api/sessions')).json();
    const sessions = (data.sessions ?? []).filter((s) => s.goal).slice(0, 14);
    el.sessions.innerHTML = sessions.length
      ? sessions.map((s) => `<li><button type="button" data-session="${esc(s.id)}" class="${s.id === state.sessionId ? 'is-on' : ''}">${esc(s.goal.slice(0, 40))}</button></li>`).join('')
      : '<li class="empty-row">No runs yet</li>';
    el.sessions.querySelectorAll('[data-session]').forEach((button) => {
      button.addEventListener('click', () => openSession(button.dataset.session));
    });
  } catch { /* ignore */ }
}

async function openSession(sessionId) {
  state.sessionId = sessionId;
  try {
    const data = await (await fetch(`/api/session/${encodeURIComponent(sessionId)}`)).json();
    const goalEvent = (data.events ?? []).find((e) => e.type === 'goal');
    const answer = [...(data.events ?? [])].reverse().find((e) => e.type === 'answer');
    const tools = (data.events ?? []).filter((e) => e.type === 'tool');
    el.intro?.remove();
    const slot = addTurn(goalEvent?.goal ?? sessionId);
    renderAgent(slot, {
      status: 'replayed',
      stopped: 'from log',
      answer: answer?.text ?? '',
      plan: data.plan ?? [],
      steps: tools.map((event, index) => ({
        step: index + 1, tool: event.tool, args: event.args, ok: event.ok,
        observation: event.observation, ms: event.ms,
      })),
      artifacts: data.artifacts,
    });
    loadSessions();
  } catch { /* ignore */ }
}

/* ── wiring ─────────────────────────────────────────────── */
const autosize = () => {
  el.goal.style.height = 'auto';
  el.goal.style.height = `${Math.min(140, el.goal.scrollHeight)}px`;
};

el.goal.addEventListener('input', () => {
  autosize();
  const length = el.goal.value.trim().length;
  el.effort.textContent = length ? `${Math.max(1, Math.round(length / 40))} steps` : '';
});

el.goal.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    el.form.requestSubmit();
  }
});

el.form.addEventListener('submit', (event) => {
  event.preventDefault();
  const goal = el.goal.value.trim();
  if (!goal) return;
  el.goal.value = '';
  autosize();
  el.effort.textContent = '';
  runGoal(goal);
});

document.querySelectorAll('.mode').forEach((button) => {
  button.addEventListener('click', () => {
    state.mode = button.dataset.mode;
    document.querySelectorAll('.mode').forEach((other) => other.classList.toggle('is-on', other === button));
  });
});

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((other) => other.classList.toggle('is-on', other === tab));
    document.querySelectorAll('.pane').forEach((pane) => pane.classList.toggle('is-on', pane.id === `pane-${tab.dataset.tab}`));
  });
});

el.newRun.addEventListener('click', () => {
  state.sessionId = newSessionId();
  state.steps = [];
  state.plan = [];
  state.artifacts = {};
  state.events = [];
  el.thread.innerHTML = '';
  if (el.intro) el.thread.appendChild(el.intro);
  renderInspector();
  setStatus('idle', 'ready');
  loadSessions();
});

el.themeBtn.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('netraindio-theme', next); } catch { /* private mode */ }
});

try {
  const saved = localStorage.getItem('netraindio-theme');
  if (saved) document.documentElement.dataset.theme = saved;
} catch { /* ignore */ }

el.starters.innerHTML = STARTERS.map((text) => `<button type="button">${esc(text)}</button>`).join('');
el.starters.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  runGoal(button.textContent);
});

(async function boot() {
  try {
    const health = await (await fetch('/api/health')).json();
    const label = /workers-ai|local model/.test(health.model) ? 'cloud reasoning' : 'own engine';
    el.modelChip.textContent = label;
    el.modelChip.title = health.model;
    setStatus('idle', `${(health.tools ?? []).length} tools ready`);
  } catch {
    el.modelChip.textContent = 'offline';
    setStatus('waiting', 'Server unreachable');
  }
  loadSessions();
})();
