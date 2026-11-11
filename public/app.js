/**
 * app.js — the workbench. Plain browser JavaScript, no framework, no CDN.
 * Shows the plan gate, the tool steps, subagents, artifacts and the event log.
 */

const state = {
  sessionId: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
  showEvents: false,
  busy: false,
  lastGoal: '',
};

const el = {
  log: document.getElementById('log'),
  form: document.getElementById('run-form'),
  input: document.getElementById('goal'),
  run: document.getElementById('run'),
  skill: document.getElementById('skill'),
  suggestions: document.getElementById('suggestions'),
  tools: document.getElementById('tools'),
  artifacts: document.getElementById('artifacts'),
  modelBadge: document.getElementById('model-badge'),
  eventsToggle: document.getElementById('events-toggle'),
};

const SUGGESTIONS = [
  'क्रिकेट की खबर',
  'latest news',
  '(1200-950)/950*100',
  '12 km को miles में बदलो',
  'दिल्ली में कितने बजे हैं',
  'https://example.com पढ़ो और सारांश दो',
  'नोट सहेजो: कल RBI की बैठक है',
];

const escapeHtml = (value) =>
  String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const renderText = (text) =>
  escapeHtml(text).replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br />');

function addEntry(role, html) {
  const wrap = document.createElement('article');
  wrap.className = `entry ${role}`;
  const body = document.createElement('div');
  body.className = 'entry-body';
  body.innerHTML = html;
  wrap.appendChild(body);
  el.log.appendChild(wrap);
  el.log.scrollTop = el.log.scrollHeight;
  return body;
}

function planCard(result) {
  if (!result.plan?.length) return '';
  const steps = result.plan
    .map((step, index) => `<li>${escapeHtml(step.title ?? step.tool)} — <code>${escapeHtml(step.tool)}</code> <span class="muted">${escapeHtml(JSON.stringify(step.args ?? {}))}</span></li>`)
    .join('');
  const warnings = (result.warnings ?? []).map((warning) => `<div class="plan-warn">⚠ ${escapeHtml(warning)}</div>`).join('');
  const approve = result.status === 'awaiting_approval'
    ? `<div class="approve"><button type="button" data-approve="1">मंज़ूर — चलाइए</button></div>`
    : '';
  return `<div class="plan-card"><h3>योजना</h3><ol>${steps}</ol>${warnings}${approve}</div>`;
}

function stepsHtml(steps) {
  if (!steps?.length) return '';
  const items = steps
    .map((step) => {
      const args = Object.keys(step.args ?? {}).length ? JSON.stringify(step.args) : '—';
      return `<li class="step ${step.ok ? '' : 'failed'}">
        <div class="step-head">${step.step}. ${escapeHtml(step.tool)} ${step.ok ? '✓' : '✗'} <span class="muted">${step.ms ?? 0} ms</span></div>
        <div class="step-args">${escapeHtml(args)}</div>
        <div class="step-obs">→ ${escapeHtml(String(step.observation ?? '').slice(0, 400))}</div>
      </li>`;
    })
    .join('');
  return `<ul class="steps">${items}</ul>`;
}

function renderResult(result) {
  const confidence = Math.round((result.confidence ?? 0) * 100);
  const body = document.createElement('div');
  body.className = 'entry-body';
  body.innerHTML = `
    <p>${renderText(result.answer ?? '')}</p>
    ${planCard(result)}
    ${stepsHtml(result.steps)}
    <div class="meta-row">
      <span class="pill">${escapeHtml(result.status ?? 'done')}</span>
      ${result.steps?.length ? `<span class="pill">${result.steps.length} कदम</span>` : ''}
      ${result.confidence !== undefined ? `<span class="pill ${confidence >= 55 ? 'good' : 'warn'}">भरोसा ${confidence}%</span>` : ''}
      <span class="pill">${escapeHtml(result.stopped ?? '')}</span>
      <span class="pill">${result.ms ?? 0} ms</span>
    </div>
    <div class="events ${state.showEvents ? 'open' : ''}">${escapeHtml((result.trace ?? []).join('\n') || 'event log सर्वर पर सुरक्षित है')}</div>`;

  body.addEventListener('click', (event) => {
    const button = event.target.closest('[data-approve]');
    if (button) {
      button.disabled = true;
      button.textContent = 'चल रहा है…';
      runGoal(state.lastGoal, { approved: true, mode: 'agent' });
    }
  });

  const wrap = document.createElement('article');
  wrap.className = 'entry bot';
  wrap.appendChild(body);
  el.log.appendChild(wrap);
  el.log.scrollTop = el.log.scrollHeight;
  renderArtifacts(result.artifacts ?? {});
}

function renderArtifacts(artifacts) {
  const names = Object.keys(artifacts ?? {});
  if (!names.length) {
    el.artifacts.innerHTML = '<p class="muted">अभी कुछ नहीं।</p>';
    return;
  }
  el.artifacts.innerHTML = names
    .map((name) => `<div class="artifact"><h4>${escapeHtml(name)}</h4><p>${escapeHtml(artifacts[name])}</p></div>`)
    .join('');
}

async function runGoal(goal, options = {}) {
  if (state.busy) return;
  state.busy = true;
  state.lastGoal = goal;
  el.run.disabled = true;

  const mode = options.mode ?? (el.skill.value === 'plan' ? 'plan' : 'agent');
  const approved = Boolean(options.approved);

  if (!options.silent) addEntry('user', `<p>${escapeHtml(goal)}</p>`);
  const thinking = addEntry('bot', '<p class="hint">योजना बना रहा हूँ…</p>');

  try {
    const response = await fetch('/api/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ goal, sessionId: state.sessionId, mode, approved }),
    });
    const result = await response.json();
    thinking.parentElement.remove();
    if (!response.ok) {
      addEntry('bot', `<p>कर्नेल में दिक्कत: ${escapeHtml(result.error ?? 'unknown')}</p>`);
    } else {
      renderResult(result);
    }
  } catch (error) {
    thinking.parentElement.remove();
    addEntry('bot', `<p>नेटवर्क से बात नहीं हो पाई: ${escapeHtml(String(error.message ?? error))}</p>`);
  } finally {
    state.busy = false;
    el.run.disabled = false;
    el.input.focus();
  }
}

async function loadHealth() {
  try {
    const data = await (await fetch('/api/health')).json();
    el.modelBadge.textContent = `model: ${data.model ?? '?'}`;
    el.modelBadge.title = (data.runtime ?? []).join(', ');
  } catch {
    el.modelBadge.textContent = 'model: offline';
  }
}

async function loadTools() {
  try {
    const data = await (await fetch('/api/tools')).json();
    el.tools.innerHTML = (data.tools ?? [])
      .map((tool) => `<li><code>${escapeHtml(tool.name)}</code>${tool.risk === 'write' ? ' <span class="muted">(मंज़ूरी चाहिए)</span>' : ''}<small>${escapeHtml(tool.description)}</small></li>`)
      .join('');
  } catch {
    el.tools.innerHTML = '<li class="muted">लोड नहीं हो सका।</li>';
  }
}

el.suggestions.innerHTML = SUGGESTIONS.map((text) => `<button type="button">${escapeHtml(text)}</button>`).join('');
el.suggestions.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  el.input.value = button.textContent;
  runGoal(button.textContent);
});

el.form.addEventListener('submit', (event) => {
  event.preventDefault();
  const goal = el.input.value.trim();
  if (!goal) return;
  el.input.value = '';
  runGoal(goal);
});

el.eventsToggle.addEventListener('click', () => {
  state.showEvents = !state.showEvents;
  el.eventsToggle.setAttribute('aria-pressed', String(state.showEvents));
  document.querySelectorAll('.events').forEach((node) => node.classList.toggle('open', state.showEvents));
});

loadHealth();
loadTools();
