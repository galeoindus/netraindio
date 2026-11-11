# Models: what runs the thinking

The harness is ours. The judgement comes from a model, and there are three
choices. Pick with your eyes open — this is the one part of the system that
cannot be both free and fully yours.

## 1. Workers AI (what the live demo uses)

Cloudflare's hosted models, called from inside your own Cloudflare account, on
the free daily allowance. No API key to manage, no card, no per-token bill.

```toml
# wrangler.toml
[ai]
binding = "AI"
```

The harness tries, in order:

```
@cf/meta/llama-3.3-70b-instruct-fp8-fast
@cf/meta/llama-3.1-8b-instruct
@cf/qwen/qwen2.5-coder-32b-instruct
```

**Honest note:** the weights are Cloudflare's, not yours. Your prompts go to
their inference, inside your account. That is a real dependency — it is just the
cheapest one that gives you a general agent.

## 2. Local open weights (the model that is actually yours)

Anything that speaks the OpenAI chat API on your machine:

```bash
ollama run qwen2.5:7b-instruct
```

```bash
# local dev
LOCAL_LLM_URL=http://127.0.0.1:11434 LOCAL_LLM_MODEL=qwen2.5:7b-instruct npm start
```

Meta's Muse Spark Open (816B total / 42B active) is the frontier open-weight
option, but it needs serious hardware. On a laptop, a 3B–7B model plans tool calls
well enough; the harness keeps it on a short leash either way.

## 3. Rule planner (no model at all)

Deterministic, instant, free forever, works offline. It handles the goals it
knows — read a page, summarise, search the news index, calculate, convert, clock,
count, notes — and refuses everything else in plain words. This is the floor:
the agent never dies because a backend is missing.

## What the model is allowed to do

Whichever backend runs, it only ever returns one of two things:

```json
{"thought": "...", "tool": "fetch_url", "args": {"url": "https://..."}}
{"thought": "...", "final": "the answer"}
```

The harness then checks the tool exists, validates and coerces the arguments,
executes it, records the observation, and asks again. A malformed reply is a
failed step, not a crash; two in a row and the run ends honestly.

## Choosing

| Situation | Use |
|---|---|
| You want it working right now, free | Workers AI |
| You want the model to be yours | local open weights |
| You have no model and no internet | rule planner |
| You want to compare | `GET /api/health` names the active backend |
