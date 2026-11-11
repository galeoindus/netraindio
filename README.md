# netraindio

**netraindio** is an agentic AI workbench. You give it a goal; it plans, calls tools, delegates to subagents when the work splits, and shows every step in a live ledger — with an approval gate before anything writes, and a verified / assumed / could-not-do footer on every result.

**Live:** https://netraindio.movaindia.workers.dev

Zero npm dependencies. Zero vendor SDKs. The harness, the tools and the interface are all in this repository.

---

## What was studied, and what changed

The interface was rebuilt after reading teardowns of how the strongest agent products handle the same problems. The patterns that mattered, and where they live here:

| Pattern observed in the wild | What this build does |
|---|---|
| **Live step ledger** — a vertical list with pending / running / done / failed glyphs, collapsing to one line and expanding to detail (Claude Code, Cursor, Manus) | `.ledger` in the thread: one row per step, click to open thought, arguments and output |
| **Tool-call cards** — name, input, output, duration; failures stay visible instead of being retried away (Claude Code, ChatGPT Agent) | every row carries its tool, its args, its duration and a red ✗ when it failed — failed steps are never hidden |
| **Reasoning disclosure** — thinking collapsed by default, never in the main flow (Claude, Cursor, Manus) | `thought` sits inside the expanded step, styled as an aside, not as prose |
| **Editable plan behind approval** — numbered steps, remove or reorder, one Run button (Devin, Claude Code plan mode, Replit) | plan card with a `×` per step, an effort estimate, and Run — the edited plan is what executes |
| **Effort preview** — tell the user whether this is 30 seconds or 30 minutes (Manus credits, Setproduct pattern 4) | `~Ns · N कदम` next to Run and above the plan |
| **Risk-graded permissions** — read is silent, write asks, destructive always asks (Claude Code, Perplexity tool settings) | tools declare `risk: "read" \| "write"`; write tools stop at the gate every time |
| **Progressive disclosure of status** — one line at the top, tap for the list, tap again for detail (Meta Muse's status display) | header status pill → drawer with *doing / done / needs approval* → full event log in the inspector |
| **Trust footer** — verified, assumed, could not do, in three parts (Devin's blockers report, Setproduct pattern 14) | `report` object on every response, rendered as three columns |
| **Sessions as places, not threads** — a sidebar of ongoing work (Meta Muse Spaces, Manus tasks) | left rail lists runs; clicking one replays its event log into the thread |
| **Auditable action trail** — every action recorded and replayable (Muse Code's local event log) | append-only `EventLog` with `replay()` and JSONL export |

The visual direction is deliberately quiet: one accent (clay), hairline rules, monospace for machine facts, 15px text on a near-black or warm-paper canvas, and no gradient furniture. A tool that shows you its work should not shout.

---

## How it runs

```
goal → plan → [approval gate] → decide → act → observe → compact → decide → … → answer
                                                        │
                                                   subagents (parallel)
```

- **8 steps** per run, **3** per subagent; the run stops on a final answer, on the same tool failing twice, or on the budget — and names which in `stopped`.
- **Event log** (`src/runtime/eventlog.js`): every goal, plan, thought, tool call, subagent result, approval and answer appended once with a sequence number; `replay()` rebuilds state, `toJSONL()` exports a session.
- **Context compaction** (`src/runtime/context.js`): last six events verbatim, everything older reduced to a five-sentence digest by our own extractive summariser.
- **Subagents** (`src/runtime/subagents.js`): up to three in parallel, read-only tools, own budget, one summary each.
- **Plan review** (`src/runtime/skills.js`): unknown tools, missing arguments and bloated plans are caught before a single tool runs.

## Models

Three backends behind one interface (`src/model/index.js`), chosen automatically:

1. **Workers AI** — Cloudflare's hosted models on the free daily allowance, inside your own account. What the live demo uses. *The weights are Cloudflare's, not yours.*
2. **LocalModel** — any OpenAI-compatible server on your own machine (Ollama, llama.cpp, LM Studio, or open weights such as Muse Spark Open). The only option where the model is genuinely yours.
3. **RuleModel** — our deterministic planner. No model at all: it does what the tools allow and refuses the rest in plain words.

`GET /api/health` always names the active backend.

## Run it

```bash
git clone https://github.com/galeoindus/netraindio.git
cd netraindio
npm start           # http://localhost:8789, nothing to install
node --test test/   # 29 tests, no network
npm run demo        # plan, gate, approval, steps and event log in the terminal
```

## API

```bash
# run a goal
curl -s -X POST https://netraindio.movaindia.workers.dev/api/run \
  -H 'content-type: application/json' \
  -d '{"goal":"12 km को miles में बदलो"}' | jq '.answer, .report'

# plan first, no tool runs
curl -s -X POST .../api/run -d '{"goal":"https://example.com पढ़ो","mode":"plan"}' | jq '.plan, .estimate'

# approve, optionally with an edited plan
curl -s -X POST .../api/run -d '{"goal":"...","approved":true,"plan":[{"tool":"fetch_url","args":{"url":"https://example.com"}}]}'

# the audit trail
curl -s .../api/session/<id> | jq '.events | length'
curl -s .../api/sessions | jq '.sessions[0]'
```

| Route | Returns |
|---|---|
| `POST /api/run` | answer, plan, steps, report, confidence, stop reason |
| `GET /api/session/:id` | full event log, replayed state, artifacts |
| `GET /api/sessions` | session list for the rail |
| `GET /api/tools` | 12 tools with risk levels |
| `GET /api/health` | model, tools, runtime |
| `GET /api/news?q=` | own RSS + BM25 index |

## Structure

```
src/
  runtime/eventlog.js   append-only log, replay, JSONL
  runtime/kernel.js     plan → gate → decide → act → observe loop, report footer
  runtime/subagents.js  parallel delegation, read-only tools
  runtime/context.js    compaction: digest + recent
  runtime/skills.js     /plan /grill /goal /research, plan review
  model/index.js        Workers AI | local open weights | rule planner
  tools/                fetch, summarise, news, calculator, units, clock,
                        text stats, artifacts, notes
  lib/                  own text, RSS, BM25, summariser
  server.js             one handler for Worker and Node
public/                 the workbench: ledger, plan gate, report, inspector
```

Design notes: `docs/ARCHITECTURE.md` · models: `docs/MODELS.md` · deploy: `docs/DEPLOY.md`

## Honest limits

- General reasoning comes from a model; the harness only disciplines it. Answer quality tracks the model.
- Workers AI's free allowance is finite; when it runs out the rule planner takes over.
- The event log lives in isolate memory — durable history needs KV or R2.
- Subagents are read-only so parallel writes cannot collide.
- No shell, no filesystem, no arbitrary code execution. A capability that does not exist cannot be abused.

## Licence

MIT © 2026 Bhola Kumar — see `LICENSE`.
