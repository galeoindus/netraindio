/**
 * app.js — netraindio workbench.
 * Plain browser JavaScript. No framework, no CDN, no build step.
 *
 * The interface follows the patterns the strongest agent products converged on:
 * a live step ledger, tool-call cards with inputs and durations, reasoning
 * behind a disclosure, an editable plan behind an approval gate, risk-graded
 * permissions, and a verified / assumed / could-not-do footer on every result.
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
  thread: $('thread'),
  empty: $('empty'),
  starters: $('starters'),
  form: $('composer'),
  goal: $('goal'),
  send: $('send'),
  effort: $('effort'),
  status: $('status'),
  statusDot: $('status-dot'),
  statusText: $('status-text'),
  statusMore: $('status-more'),
  drawer: $('status-drawer'),
  drawerNow: $('drawer-now'),
  drawerDone: $('drawer-done'),
  drawerAsk: $('drawer-ask'),
  modelChip: $('model-chip'),
  themeBtn: $('theme-btn'),
  sessions: $('session-list'),
  newRun: $('new-run'),
  paneArtifacts: $('pane-artifacts'),
  panePlan: $('pane-plan'),
  paneEvents: $('pane-events'),
};

const STARTERS = [
  'https://example.com पढ़ो और सारांश दो',
  'क्रिकेट की खबर',
  '12 km को miles में बदलो',
  'दिल्ली में कितने बजे हैं',
  '(1200-950)/950*100',
  'नोट सहेजो: कल बैठक है',
];

function newSessionId() {
  return crypto.randomUUID ? crypto.randomUUID() : `s-${Date.now()}`;
}

const esc = (value) =>
  String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const paragraphs = (text) => esc(text).split(/\n{2,}/).map((part) => `<p>${part.replace(/\n/g, '<br />')}</p>`).join('');

/* ── status ──────────────────────────────────────────────── */

function setStatus(kind, text) {
  el.statusDot.className = `dot ${kind}`;
  el.statusText.textContent = text;
}

function renderDrawer(result) {
  const now = result.status === 'awaiting_approval' ? 'आपकी मंज़ूरी का इंतज़ार' : 'कुछ नहीं';
  el.drawerNow.innerHTML = `<li>${esc(now)}</li>`;
  el.drawerDone.innerHTML = (result.steps ?? []).length
    ? result.steps.map((step) => `<li>${step.ok ? '✓' : '✗'} ${esc(step.tool)} · ${step.ms ?? 0} ms</li>`).join('')
    : '<li class="muted">कुछ नहीं</li>';
  el.drawerAsk.innerHTML = result.status === 'awaiting_approval'
    ? `<li>${result.pending ? esc(result.pending.tool) : 'योजना'} — थ्रेड में मंज़ूरी दें</li>`
    : '<li class="muted">कुछ नहीं</li>';
}

/* ── ledger ──────────────────────────────────────────────── */

function glyph(step) {
  if (step.ok) return '✓';
  return '✗';
}

function stepRow(step) {
  const args = Object.keys(step.args ?? {}).length ? JSON.stringify(step.args) : '';
  return `
    <div class="step-row ${step.ok ? 'ok' : 'bad'}" data-step="${step.step}">
      <span class="glyph">${glyph(step)}</span>
      <span class="step-title">${esc(step.tool)}${args ? ` <code>${esc(args.slice(0, 60))}</code>` : ''}</span>
      <span class="step-dur">${step.ms ?? 0} ms</span>
    </div>
    <div class="step-detail">
      ${step.thought ? `<p class="thought">${esc(step.thought)}</p>` : ''}
      <p class="kv">args ${esc(args || '—')}</p>
      <div class="out">${esc(step.observation ?? '')}</div>
    </div>`;
}

function ledger(result) {
  if (!result.steps?.length) return '';
  const failed = result.steps.filter((step) => !step.ok).length;
  return `
    <div class="ledger">
      <div class="ledger-head">
        <span>कदम</span>
        <span class="meta">
          <span>${result.steps.length} कदम</span>
          ${failed ? `<span style="color:var(--bad)">${failed} विफल</span>` : ''}
          <span>${result.ms ?? 0} ms</span>
        </span>
      </div>
      ${result.steps.map(stepRow).join('')}
    </div>`;
}

/* ── plan ────────────────────────────────────────────────── */

function planCard(result) {
  const steps = state.plan.length ? state.plan : result.plan ?? [];
  if (!steps.length) return '';
  const awaiting = result.status === 'awaiting_approval';
  const items = steps
    .map(
      (step, index) => `<li data-plan-index="${index}">
        ${esc(step.title ?? step.tool)} <code>${esc(step.tool)}(${esc(JSON.stringify(step.args ?? {}))})</code>
        ${awaiting ? '<button class="drop" type="button" title="हटाएँ">×</button>' : ''}
      </li>`
    )
    .join('');
  const warnings = (result.warnings ?? []).map((warning) => `<li>${esc(warning)}</li>`).join('');
  const estimate = result.estimate ? `${result.estimate.steps} कदम · ${result.estimate.effort}` : '';
  return `
    <div class="plan">
      <h4><span>योजना${result.planSource === 'user' ? ' (आपकी)' : ''}</span><span class="estimate">${esc(estimate)}</span></h4>
      <ol>${items}</ol>
      ${warnings ? `<ul class="warn-list">${warnings}</ul>` : ''}
      ${awaiting ? `<div class="plan-actions"><button class="run-btn" type="button" data-approve="1">मंज़ूर — चलाइए</button><span class="estimate">लिखने वाले औज़ार मंज़ूरी के बाद</span></div>` : ''}
    </div>`;
}

/* ── report ──────────────────────────────────────────────── */

function reportBlock(result) {
  const report = result.report;
  if (!report) return '';
  const list = (items) => (items?.length ? `<ul>${items.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>` : '<p class="none">कुछ नहीं</p>');
  return `
    <div class="report">
      <div><h5>सत्यापित</h5>${list(report.verified)}</div>
      <div><h5>मान लिया</h5>${list(report.assumed)}</div>
      <div><h5>नहीं कर सका</h5>${list(report.couldNot)}</div>
    </div>`;
}

/* ── render ──────────────────────────────────────────────── */

function addTurn(goal) {
  el.empty?.remove();
  const turn = document.createElement('div');
  turn.className = 'turn';
  turn.innerHTML = `<div class="you"><div class="bubble">${esc(goal)}</div></div>
    <div class="agent" data-agent><div class="muted small">सोच रहा हूँ…</div></div>`;
  el.thread.appendChild(turn);
  scrollThread();
  return turn.querySelector('[data-agent]');
}

function renderAgent(slot, result) {
  const confidence = result.confidence !== undefined ? Math.round(result.confidence * 100) : null;
  slot.innerHTML = `
    ${result.answer ? `<div class="answer">${paragraphs(result.answer)}</div>` : ''}
    ${planCard(result)}
    ${ledger(result)}
    ${reportBlock(result)}
    <div class="ledger-head" style="border:0;padding:8px 0 0">
      <span class="muted small">${esc(result.status ?? 'done')} · ${esc(result.stopped ?? '')} · ${result.ms ?? 0} ms</span>
      <span class="muted small">${confidence !== null ? `भरोसा ${confidence}%` : ''}</span>
    </div>`;

  slot.querySelectorAll('.step-row').forEach((row) => {
    row.addEventListener('click', () => row.classList.toggle('open'));
  });

  slot.querySelector('[data-approve]')?.addEventListener('click', (event) => {
    event.currentTarget.disabled = true;
    event.currentTarget.textContent = 'चल रहा है…';
    runGoal(state.lastGoal, { approved: true, mode: 'agent', plan: state.plan, silent: true });
  });

  slot.querySelectorAll('.drop').forEach((button) => {
    button.addEventListener('click', (event) => {
      const index = Number(event.target.closest('li').dataset.planIndex);
      state.plan = state.plan.filter((_, position) => position !== index);
      renderAgent(slot, { ...result, plan: state.plan });
    });
  });

  state.steps = result.steps ?? [];
  state.plan = result.plan ?? [];
  state.artifacts = result.artifacts ?? {};
  renderInspector();
  renderDrawer(result);
  scrollThread();
}

function renderInspector() {
  const names = Object.keys(state.artifacts ?? {});
  el.paneArtifacts.innerHTML = names.length
    ? names
        .map(
          (name) => `<div class="artifact"><header><h4>${esc(name)}</h4>
            <button class="copy" type="button" data-copy="${esc(name)}">कॉपी</button></header>
            <pre>${esc(state.artifacts[name])}</pre></div>`
        )
        .join('')
    : '<p class="muted small">अभी कुछ नहीं।</p>';

  el.paneArtifacts.querySelectorAll('[data-copy]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(state.artifacts[button.dataset.copy]);
        button.textContent = 'कॉपी हुआ';
      } catch {
        button.textContent = 'नहीं हो सका';
      }
    });
  });

  el.panePlan.innerHTML = state.plan.length
    ? `<ol class="small">${state.plan.map((step) => `<li>${esc(step.title ?? step.tool)} <code>${esc(step.tool)}</code></li>`).join('')}</ol>`
    : '<p class="muted small">कोई योजना नहीं।</p>';

  el.paneEvents.innerHTML = state.events.length
    ? `<div class="events-log">${state.events
        .map((event) => `<div class="event-line">${event.seq}. ${esc(event.type)} ${esc(event.tool ?? '')} ${event.ok === false ? '✗' : ''}</div>`)
        .join('')}</div>`
    : '<p class="muted small">कोई इवेंट नहीं।</p>';
}

function scrollThread() {
  el.thread.scrollTop = el.thread.scrollHeight;
}

/* ── running ─────────────────────────────────────────────── */

async function runGoal(goal, options = {}) {
  if (state.busy) return;
  state.busy = true;
  state.lastGoal = goal;
  el.send.disabled = true;
  setStatus('working', state.mode === 'plan' ? 'योजना बना रहा हूँ…' : 'काम कर रहा हूँ…');

  const slot = options.silent ? null : addTurn(goal);
  if (slot) slot.innerHTML = '<div class="muted small">योजना बना रहा हूँ…</div>';

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
      const target = slot ?? addTurn(goal);
      target.innerHTML = `<div class="answer"><p>कर्नेल में दिक्कत: ${esc(result.error ?? 'unknown')}</p></div>`;
      setStatus('waiting', 'त्रुटि');
    } else {
      const target = slot ?? document.querySelector('.turn:last-child [data-agent]');
      renderAgent(target, result);
      setStatus(result.status === 'awaiting_approval' ? 'waiting' : 'done',
        result.status === 'awaiting_approval' ? 'मंज़ूरी का इंतज़ार' : 'पूरा हुआ');
    }
    await refreshSession();
  } catch (error) {
    const target = slot ?? addTurn(goal);
    target.innerHTML = `<div class="answer"><p>नेटवर्क से बात नहीं हो पाई: ${esc(String(error.message ?? error))}</p></div>`;
    setStatus('waiting', 'ऑफ़लाइन');
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
  } catch {
    /* the log is a nicety; the answer already landed */
  }
}

async function loadSessions() {
  try {
    const data = await (await fetch('/api/sessions')).json();
    const sessions = (data.sessions ?? []).filter((session) => session.goal).slice(0, 12);
    el.sessions.innerHTML = sessions.length
      ? sessions
          .map(
            (session) => `<li><button type="button" data-session="${esc(session.id)}" class="${session.id === state.sessionId ? 'is-on' : ''}">${esc(session.goal.slice(0, 48))}</button></li>`
          )
          .join('')
      : '<li class="muted small">अभी खाली</li>';
    el.sessions.querySelectorAll('[data-session]').forEach((button) => {
      button.addEventListener('click', () => openSession(button.dataset.session));
    });
  } catch {
    /* ignore */
  }
}

async function openSession(sessionId) {
  state.sessionId = sessionId;
  const data = await (await fetch(`/api/session/${encodeURIComponent(sessionId)}`)).json();
  state.events = data.events ?? [];
  state.artifacts = data.artifacts ?? {};
  const goalEvent = state.events.find((event) => event.type === 'goal');
  const answerEvent = [...state.events].reverse().find((event) => event.type === 'answer');
  const tools = state.events.filter((event) => event.type === 'tool');

  el.empty?.remove();
  const slot = addTurn(goalEvent?.goal ?? sessionId);
  renderAgent(slot, {
    status: answerEvent ? 'done' : 'partial',
    stopped: 'replayed from log',
    answer: answerEvent?.text ?? '',
    plan: data.plan ?? [],
    steps: tools.map((event, index) => ({
      step: index + 1,
      tool: event.tool,
      args: event.args,
      ok: event.ok,
      observation: event.observation,
      ms: event.ms,
    })),
    artifacts: data.artifacts,
  });
  loadSessions();
}

/* ── wiring ──────────────────────────────────────────────── */

function autosize() {
  el.goal.style.height = 'auto';
  el.goal.style.height = `${Math.min(160, el.goal.scrollHeight)}px`;
}

el.goal.addEventListener('input', () => {
  autosize();
  const length = el.goal.value.trim().length;
  el.effort.textContent = length ? `${Math.max(1, Math.round(length / 40))} कदम अनुमान` : '';
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

el.statusMore.addEventListener('click', () => {
  const open = el.drawer.hidden;
  el.drawer.hidden = !open;
  el.statusMore.setAttribute('aria-expanded', String(open));
});

el.newRun.addEventListener('click', () => {
  state.sessionId = newSessionId();
  state.steps = [];
  state.plan = [];
  state.artifacts = {};
  state.events = [];
  el.thread.innerHTML = '';
  el.thread.appendChild(el.empty);
  renderInspector();
  setStatus('idle', 'ready');
  loadSessions();
});

el.themeBtn.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem('netraindio-theme', next);
  } catch {
    /* private mode */
  }
});

try {
  const saved = localStorage.getItem('netraindio-theme');
  if (saved) document.documentElement.dataset.theme = saved;
} catch {
  /* ignore */
}

el.starters.innerHTML = STARTERS.map((text) => `<button type="button">${esc(text)}</button>`).join('');
el.starters.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  runGoal(button.textContent);
});

(async function boot() {
  try {
    const health = await (await fetch('/api/health')).json();
    el.modelChip.textContent = health.model ?? 'model';
    el.modelChip.title = (health.runtime ?? []).join(' · ');
    setStatus('idle', `${(health.tools ?? []).length} औज़ार तैयार`);
  } catch {
    el.modelChip.textContent = 'offline';
    setStatus('waiting', 'सर्वर नहीं मिला');
  }
  loadSessions();
})();
