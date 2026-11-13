# Deploy for free

## Cloudflare Workers (the live demo)

```bash
npm run build          # dist/worker.js, built by our own flattener
npx wrangler login     # free account, no card
npx wrangler deploy    # reads wrangler.toml, binds AI + assets
```

### Moving to a new Cloudflare account

A Worker belongs to the account that deployed it, so a new account starts with
none — and the things that fail first are never the code:

| Symptom | Cause | Fix |
|---|---|---|
| `Authentication error` / `10000` | the API token belongs to the old account | `npx wrangler login` again, or make a new token |
| `Could not find account` / wrong account id | `CLOUDFLARE_ACCOUNT_ID` still points at the deleted account | copy the id from Workers & Pages → Account ID |
| `binding AI not found` / `AI is not enabled` | Workers AI is off in the new account | dashboard → Workers AI → Enable |
| `assets directory not found` | `wrangler deploy` ran outside the repository | run it from the repository root |
| the site still shows the old build | the old account's route/custom domain is gone | the new Worker answers on `<name>.<subdomain>.workers.dev` |

`wrangler deploy` creates the Worker on the first successful run, so there is no
"project not found" step here. The workflow in `.github/workflows/deploy.yml`
does the same on every push once `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` are set as repository secrets.

Free plan: 100,000 requests/day, static assets, HTTPS on `*.workers.dev`, and a
daily Workers AI allowance for the model.

Turn the model off (rule planner only) by deleting the `[ai]` block from
`wrangler.toml` and redeploying.

## Your own machine

```bash
npm start                                   # http://localhost:8789
LOCAL_LLM_URL=http://127.0.0.1:11434 npm start   # with a local model
```

## Verify a deployment

```bash
curl -s https://your-app.workers.dev/api/health | jq '{model, tools: (.tools|length)}'

curl -s -X POST https://your-app.workers.dev/api/run \
  -H 'content-type: application/json' \
  -d '{"goal":"what is 23*47+12"}' | jq '{status, answer, steps: (.steps|length)}'

curl -s -X POST https://your-app.workers.dev/api/run \
  -H 'content-type: application/json' \
  -d '{"goal":"https://example.com पढ़ो","mode":"plan"}' | jq '{status, plan}'
```

## Limits on the free tier

- 30 runs/minute per IP per isolate (`src/server.js`).
- 8 steps per run, 3 per subagent, 12-second fetch timeout.
- Event log and sessions live in isolate memory; they vanish on redeploy. For
  durable history, bind KV or R2 and swap the store in `src/server.js`.
- Workers AI has a daily allowance; when it is exhausted the harness falls back
  to the rule planner instead of failing.

## Cost

Nothing here bills at this size. The only outbound traffic is RSS feeds and the
pages you ask the agent to read.
