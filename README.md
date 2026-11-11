# Swayam — एजेंटिक AI हार्नेस

**Swayam** एक एजेंटिक AI है: लक्ष्य मिलता है, योजना बनती है, औज़ार चलते हैं, ज़रूरत पड़े तो सबएजेंट समानांतर भेजे जाते हैं, और हर कदम एक अपरिवर्तनीय event log में दर्ज होता है।

Muse Spark / Muse Code जैसी एजेंटिक प्रणालियों की जो चार चीज़ें उन्हें चैटबॉट से अलग करती हैं, वही चारों यहाँ बनी हैं — अपने कोड से:

| वह चीज़ | यहाँ कहाँ है |
|---|---|
| **event log** — हर मॉडल कॉल, औज़ार, मंज़ूरी, जवाब दर्ज; replay-exact | `src/runtime/eventlog.js` |
| **plan gate** — पहले योजना, इंसान की मंज़ूरी, फिर कोई औज़ार नहीं | `src/runtime/kernel.js` + `skills.js` |
| **सबएजेंट** — मुख्य एजेंट काम बाँटता है, समानांतर चलता है | `src/runtime/subagents.js` |
| **context compaction** — लंबे काम में पुराने कदम सार बनकर सिकुड़ते हैं | `src/runtime/context.js` |

**लाइव:** https://swayam.movaindia.workers.dev — मुफ़्त Cloudflare Worker, ₹0/महीना।

[![License: MIT](https://img.shields.io/badge/license-MIT-7c9cff.svg)](LICENSE)

---

## अंदर कैसे चलता है

```
लक्ष्य
  │
  ├─ plan ────────────► योजना (औज़ार + args) ──► [मंज़ूरी?] ──► रुको
  │                                                    │
  ▼                                                    ▼
decide ◄──────────── context (digest + recent) ─── act ──► observe ──► event log
  │                                                              │
  └── final ───────────────────────────────────────────────────► जवाब + artifacts
```

- **8 कदम** की सीमा, **दो बार एक ही गलती** पर रुकना, और हर रुकने का कारण जवाब में लिखा जाता है।
- **लिखने वाले औज़ार** (`note_save`, `write_artifact`) मंज़ूरी के बिना नहीं चलते।
- **भरोसा-स्कोर** गणना से आता है: कोई सफल कदम नहीं = 0.12; साफ़ खत्म + दो सफल कदम = 0.7।

## तीन मॉडल बैकएंड (एक ही इंटरफ़ेस)

1. **Workers AI** — Cloudflare के भीतर, आपके ही खाते में, मुफ़्त दैनिक कोटा। लाइव ऐप इसी पर चल रहा है। *(वज़न Cloudflare के हैं, आपके नहीं — यह साफ़ लिखा है।)*
2. **LocalModel** — आपकी मशीन पर open weights (Ollama / llama.cpp / LM Studio, या Muse Spark Open / Qwen)। यही एकमात्र रास्ता है जहाँ मॉडल सचमुच आपका है।
3. **RuleModel** — हमारा ही deterministic planner। मॉडल न हो तो भी एजेंट ज़िंदा रहता है; जो नहीं कर सकता, साफ़ मना कर देता है।

`GET /api/health` बताता है कौन चल रहा है।

## 30 सेकंड में

```bash
git clone https://github.com/galeoindus/swayam.git
cd swayam
npm start          # http://localhost:8789 — कोई install नहीं
node --test test/  # 29 टेस्ट, नेटवर्क के बिना
npm run demo       # पूरा हार्नेस टर्मिनल में: योजना, gate, कदम, event log
```

## API

```bash
# सामान्य रन
curl -s -X POST https://swayam.movaindia.workers.dev/api/run \
  -H 'content-type: application/json' \
  -d '{"goal":"12 km को miles में बदलो"}' | jq '.answer, .steps'

# योजना मोड — कोई औज़ार नहीं चलेगा
curl -s -X POST .../api/run -d '{"goal":"https://example.com पढ़ो","mode":"plan"}' | jq '.plan'

# मंज़ूरी के बाद वही लक्ष्य
curl -s -X POST .../api/run -d '{"goal":"https://example.com पढ़ो","approved":true}' | jq '.status'

# पूरा event log
curl -s .../api/session/<sessionId> | jq '.events | length'
```

| रूट | क्या देता है |
|---|---|
| `POST /api/run` | `{goal, sessionId, mode, approved}` → जवाब, योजना, कदम, भरोसा, artifacts |
| `GET /api/session/:id` | event log + replay किया हुआ state |
| `GET /api/tools` | 12 औज़ार, जोखिम-स्तर के साथ |
| `GET /api/health` | मॉडल, रनटाइम, औज़ार |
| `GET /api/news?q=` | अपना RSS + BM25 इंडेक्स |

## ढाँचा

```
src/
  runtime/
    eventlog.js    अपरिवर्तनीय event log, replay, JSONL export
    kernel.js      plan → gate → decide → act → observe लूप
    subagents.js   समानांतर सबएजेंट (read-only औज़ार, 3 कदम)
    context.js     compaction: पुराने कदम सार बनकर, हाल के वैसे ही
    skills.js      /plan /grill /goal /research + योजना की जाँच
  model/index.js   Workers AI | LocalModel | RuleModel — एक इंटरफ़ेस
  tools/           fetch, summarise, news, calculator, units, clock,
                   text stats, artifacts, notes
  lib/             अपना text/rss/bm25/summarise
  server.js        Worker और Node, एक ही कोड
public/            workbench: योजना कार्ड, मंज़ूरी बटन, कदम, event log
```

डिज़ाइन: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · मॉडल: [docs/MODELS.md](docs/MODELS.md) · डिप्लॉय: [docs/DEPLOY.md](docs/DEPLOY.md)

## ईमानदार सीमाएँ

- सामान्य सोच मॉडल से आती है; हार्नेस उसे अनुशासित करता है — जवाब की गुणवत्ता मॉडल जितनी ही होगी।
- Workers AI का मुफ़्त कोटा सीमित है (रोज़ का allowance); खत्म होने पर rule planner चालू रहता है।
- event log इस वक़्त isolate की मेमोरी में है — बहुत सारे यूज़र के लिए KV/R2 जोड़ना होगा (मुफ़्त tier में भी)।
- सबएजेंट read-only औज़ारों तक सीमित हैं, ताकि समानांतर लिखाई आपस में टकराए नहीं।
- कोई shell नहीं, कोई फ़ाइल-सिस्टम नहीं — यह जान-बूझकर है: जो नहीं है, वह दुर्घटना नहीं कर सकता।

## लाइसेंस

MIT © 2026 Bhola Kumar — [LICENSE](LICENSE)

---

## English summary

**Swayam** is an agentic AI harness, not a chatbot: a goal is planned, the plan can be held at an approval gate, then a kernel loop decides one action at a time, executes it, observes, compacts context and repeats — with every event appended to an immutable, replayable log. Subagents fan out in parallel for independent work; write tools require approval; confidence is computed rather than claimed. Three interchangeable model backends sit behind one interface: Cloudflare Workers AI (free tier, inside your own account — what the live deployment uses), a local open-weights model on your own machine, and a deterministic rule planner so the agent still works with no model at all. Twelve tools, 29 tests, zero npm dependencies, MIT.
