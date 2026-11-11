# Architecture

Swayam is a harness. The model supplies judgement; the harness supplies discipline.
Four properties make it agentic rather than a chat wrapper, and each is a module here.

## 1. Event log (`src/runtime/eventlog.js`)

Every goal, plan, thought, tool call, subagent result, approval and answer is
appended once with a sequence number and an ISO timestamp. Nothing is mutated.

```
{ seq: 4, at: "2026-11-11T08:47:58.350Z", type: "tool",
  tool: "fetch_url", args: { url: "..." }, ok: true, observation: "...", ms: 57 }
```

Because the log is the source of truth, `replay(sessionId)` rebuilds the working
state from it, `toJSONL()` ships a session to a debugger, and a resumed session
never has to guess what already happened. In-memory now; swap in KV or R2 and the
runtime becomes restart-safe across isolates.

## 2. Plan gate (`src/runtime/kernel.js` + `skills.js`)

`mode: "plan"` plans, records the plan, and returns `status: "awaiting_approval"`
without executing a single tool. `grillPlan()` reviews the plan deterministically
first: unknown tool, missing required argument, empty plan, too many steps. The
UI shows the plan as a card with an approve button; approval re-runs the same
goal with `approved: true`.

Write tools (`note_save`, `write_artifact`) hit the same gate even in agent mode.

## 3. Subagents (`src/runtime/subagents.js`)

The main agent can call `delegate` with up to three tasks. Each subagent gets its
own plan, its own three-step budget and a read-only tool set (no writes, no
further delegation, so fan-out cannot recurse). They run with `Promise.allSettled`
and report one summary each, which lands in the parent's steps and log.

## 4. Context compaction (`src/runtime/context.js`)

Before every decision the kernel builds context from the log: the last six events
verbatim, everything older reduced to a five-sentence digest by our extractive
summariser. A long task therefore keeps its thread without resending everything.

## The loop

```
goal → plan → [gate] → decide → act → observe → compact → decide → … → answer
```

Stop conditions, all reported in the response as `stopped`:

| value | meaning |
|---|---|
| `final` | the model produced an answer |
| `no-plan` | nothing in the tool set can serve this goal; the agent says so |
| `repeated-failure` | the same tool failed twice in a row |
| `budget` | eight steps used |
| `model-error` | the backend threw; the harness answers from what it has |
| `approval` | paused for a human |

## Tools

Twelve tools, each declaring `{name, description, args, risk}`:

read: `fetch_url`, `summarise_text`, `news_search`, `calculator`,
`convert_units`, `datetime`, `text_stats`, `list_artifacts`, `read_artifact`
write (approval): `write_artifact`, `note_save`, plus `note_list`

No shell, no filesystem, no arbitrary code execution — deliberately. A capability
that does not exist cannot be abused or crash the runtime.

## Models (`src/model/index.js`)

One interface, three backends, chosen automatically:

- `WorkersAiModel` when `env.AI` exists (free daily allowance, your account)
- `LocalModel` when `LOCAL_LLM_URL` is set (open weights on your machine)
- `RuleModel` otherwise — deterministic planning, honest refusals

`plan()` and `decide()` are the only two calls the kernel makes, which is why a
backend can be swapped without touching the runtime.

## Free-tier reality

The Worker holds the log and sessions in isolate memory, refreshes the news index
on a ten-minute TTL, and caps runs at 30/minute per IP. That is enough for a
personal agent; a multi-user deployment needs KV for the log and a queue for long
runs — both available on free plans.
