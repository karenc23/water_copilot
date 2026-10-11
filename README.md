# Chena Copilot — a water-plant *memory*, not a chatbot

An AI copilot for rural Alaska village water-plant operators. The operator
describes a problem in plain words and the app gives cited steps from *their*
plant's manual, decides whether to escalate to a remote expert, and logs every
fix so the next operator inherits the plant's history.

> "ChatGPT doesn't know your plant. Our copilot remembers every fix, spots
> problems before they happen, and makes sure that when an operator leaves,
> their knowledge doesn't."

## Why it's not just ChatGPT

- **Plant logbook** — every problem/fix stored per plant. Ask "what fixed this last time?"
- **Readings tracker + drift alerts** — rule-based warnings (chlorine down 3 days), *not* AI guessing at health thresholds.
- **Handoff handbook** — one click generates a "Welcome to this plant" guide for the next operator from the logs.
- **Expert handoff packet** — escalations ship a structured summary (readings, steps tried) to the remote expert.

## Hackathon tracks

- **Luminal self-improving agents (1A)** — `optimize/optimize.py` scores strategies over rounds; see `/results`.
- **MongoDB** — `readings`, `logs`, and `manual_chunks` (with vector search) collections.
- **AGI on-device** — `OFFLINE_MODE=true` runs agents with local fallbacks, no network.

## Architecture

```
Browser → Next.js pages → /api/* → lib/agents.ts → lib/llm.ts → Luminal (DeepSeek/GLM)
                                        ↓
                                   lib/db.ts → MongoDB (readings, logs, manual_chunks)
```

Four agents in `lib/agents.ts`: **Manual** (vector search), **Troubleshooting**
(cited steps), **Safety** (hard rules first, LLM second), **Logbook**
(save/recall). Drift rules are plain code — the AI never decides a health limit.

## Run it

```bash
npm install
cp .env.example .env       # fill in MONGODB_URI and (optionally) LUMINAL_API_KEY
npm run seed               # loads manual chunks + 6 months of Joe's history
npm run dev                # http://localhost:3000
```

Works with no `LUMINAL_API_KEY` — the LLM and embeddings fall back to
deterministic local versions so the whole app and benchmark run offline.

### MongoDB vector search (MongoDB track)

On Atlas, create a vector search index named `manual_vector_index` on the
`manual_chunks` collection:

```json
{
  "fields": [
    { "type": "vector", "path": "embedding", "numDimensions": 256, "similarity": "cosine" },
    { "type": "filter", "path": "plant_id" }
  ]
}
```

`numDimensions` is 256 for the offline hash embedding; match it to your model's
dimension if you switch on a real Luminal embedding model. Without the index,
`lib/db.ts` falls back to in-process cosine ranking so the demo still works.

### Benchmark (Track 1A)

```bash
python3 optimize/optimize.py   # writes optimize/results.local.json
```

The `/results` page reads `results.local.json`, falling back to the committed
`results.sample.json`.

## Data

- `data/manual/plant_manual.md` — the fake plant manual (page-numbered thresholds).
- `data/scenarios.json` — 12 training + 3 fresh benchmark scenarios with known-correct answers.
```
