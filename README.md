# water-copilot

An AI copilot for water treatment plant operators: troubleshooting help, a shared logbook, water-quality readings, and shift handoff notes.

Built with Next.js (App Router), TypeScript, and Tailwind. The LLM is reached through an OpenAI-compatible API (Luminal), and data is stored in MongoDB.

## Getting started

```bash
npm install
cp .env.example .env   # fill in the values
npm run seed           # load data/readings_seed.json and data/logs_seed.json into MongoDB
npm run dev            # http://localhost:3000
```

`npm run seed` is safe to re-run: readings are upserted on `(plant_id, date)`, logs on `(plant_id, date, problem)`.

### Environment variables

| Variable           | Purpose                                      |
| ------------------ | -------------------------------------------- |
| `LUMINAL_BASE_URL` | Base URL of the Luminal OpenAI-compatible API |
| `LUMINAL_API_KEY`  | Luminal API key                              |
| `LUMINAL_MODEL`    | Model name to request                        |
| `LUMINAL_REASONING_EFFORT` | `none` (default), `low`, `medium`, `high` |
| `MONGODB_URI`      | MongoDB connection string                    |
| `MONGODB_DB`       | Database name (default `water-copilot`)      |

`.env` is gitignored. Never commit real keys.

## Project structure

```
app/
  page.tsx              Home dashboard
  troubleshoot/         Troubleshooting assistant
  logbook/              Operator log entries
  readings/             Chlorine / turbidity / pH readings
  handoff/              Shift handoff notes
  results/              Evaluation results against scenarios
  api/
    troubleshoot/       POST: problem -> diagnosis, steps, escalate?
    readings/           GET ?plant_id= / POST a reading
    logs/               GET ?plant_id= / POST a log entry
    handoff/            POST: generate a handoff note
components/             Shared UI
lib/
  llm.ts                OpenAI SDK client pointed at Luminal
  db.ts                 MongoDB client
  agents.ts             Agent logic (troubleshoot, handoff)
  rules.ts              Deterministic alerts from readings and the logbook
  safety.ts             Final tier, step filtering, dose checks
  pipeline.ts           rules → LLM → safety, plus the escalation packet
  validate.ts           Runtime validation for request bodies and seed data
scripts/seed.ts         Seeds MongoDB from data/readings_seed.json and data/logs_seed.json
scripts/try-scenarios.ts  Runs training scenarios through the pipeline, prints result vs expected
types/index.ts          Shared TypeScript types for the data formats below
optimize/               Standalone Python script (separate from the web app)
data/                   Sample data and test scenarios
```

## Troubleshoot API

`POST /api/troubleshoot` runs **rules → LLM → safety**:

1. **Rules** ([lib/rules.ts](lib/rules.ts), no LLM): `checkReadings` flags out-of-range values on the latest reading (thresholds from manual Section 1.2) and chlorine falling or turbidity rising 3 days in a row. `checkLogs` flags the manual's escalation conditions in the logbook: the same problem 3+ times in 30 days, or 2+ failed backwashes in 7 days.
2. **LLM** ([lib/agents.ts](lib/agents.ts)): one-sentence diagnosis, a failure mode from [data/failure_modes.json](data/failure_modes.json), and up to 5 steps citing manual sections. Capped at 700 tokens with reasoning off (`LUMINAL_REASONING_EFFORT`); invalid JSON is retried once.
3. **Safety** ([lib/safety.ts](lib/safety.ts), no LLM): `finalTier` takes the highest of the alert tiers, the failure mode's tier, and the model's escalation call, so the model can raise the tier but never lower it. It drops steps that cite sections not in the manual, flags every dose, and removes doses not in the manual. On red, code puts "Contact your Remote Maintenance Worker now (Manual §X)" first.

The escalation packet is built by code from a template ([lib/pipeline.ts](lib/pipeline.ts)), never written by the LLM. It contains the operator's own words, recent readings, alerts, steps from the logbook, and the app's suggestions, which are labeled "NOT yet done".

Request (readings and logs currently come from `data/*_seed.json`; the manual is `data/manual.md`):

```json
{ "description": "Chlorine keeps dropping", "plant_id": "plant-a" }
```

Response:

```json
{
  "diagnosis": "One sentence.",
  "failure_mode": "F4",
  "steps": [{ "action": "...", "manual_section": "3.2", "source": "safety | llm", "flags": ["dose: 5%"] }],
  "tier": "green | yellow | red",
  "alerts": [{ "rule_id": "CL_FALLING", "tier": "yellow", "parameter": "chlorine", "message": "...", "manual_section": "3.5" }],
  "escalate": true,
  "escalation_packet": { "message": "...", "operator_report": "...", "steps_reported_done": [], "steps_recommended": [] },
  "warnings": ["Dropped step citing nonexistent section 9.9: ..."]
}
```

Try it on training scenarios: `npm run try-scenarios` (or `npm run try-scenarios -- train-05 train-18`).

## Team ownership

| Area                                  | Paths                                      | Owner |
| ------------------------------------- | ------------------------------------------ | ----- |
| Frontend pages and UI                 | `app/*/page.tsx`, `components/`            | TBD   |
| API routes and database               | `app/api/`, `lib/db.ts`                    | TBD   |
| LLM and agents                        | `lib/llm.ts`, `lib/agents.ts`              | TBD   |
| Optimization script                   | `optimize/`                                | TBD   |
| Data and scenarios                    | `data/`                                    | TBD   |

## Data formats

All dates are ISO 8601 strings (`YYYY-MM-DD`). The TypeScript definitions live in [`types/index.ts`](types/index.ts).

### Reading

```json
{
  "plant_id": "plant-a",
  "date": "2026-10-01",
  "chlorine": 1.2,
  "turbidity": 0.3,
  "ph": 7.4
}
```

| Field       | Type   | Notes                     |
| ----------- | ------ | ------------------------- |
| `plant_id`  | string |                           |
| `date`      | string | ISO 8601                  |
| `chlorine`  | number | Residual chlorine, mg/L   |
| `turbidity` | number | NTU                       |
| `ph`        | number |                           |

### Log entry

```json
{
  "plant_id": "plant-a",
  "date": "2026-10-02",
  "operator": "J. Doe",
  "problem": "Chlorine residual below target",
  "steps_taken": ["Checked chlorinator feed rate", "Increased dose 10%"],
  "outcome": "Residual did not recover",
  "escalated": false
}
```

| Field         | Type     |
| ------------- | -------- |
| `plant_id`    | string   |
| `date`        | string   |
| `operator`    | string   |
| `problem`     | string   |
| `steps_taken` | string[] |
| `outcome`     | string   |
| `escalated`   | boolean  |

### Scenario

Test cases used by `optimize/` and the `/results` page, stored as arrays in `data/scenarios_train.json` and `data/scenarios_test.json`.

```json
{
  "id": "example-001",
  "description": "Chlorine residual dropping over three days with rising turbidity.",
  "readings": [ /* Reading[] */ ],
  "log_history": [ /* LogEntry[] */ ],
  "expected": {
    "diagnosis": "...",
    "escalate": true,
    "key_steps": ["..."]
  }
}
```

| Field                | Type       |
| -------------------- | ---------- |
| `id`                 | string     |
| `description`        | string     |
| `readings`           | Reading[]  |
| `log_history`        | LogEntry[] |
| `expected.diagnosis` | string     |
| `expected.escalate`  | boolean    |
| `expected.key_steps` | string[]   |

See [`data/scenarios/example.json`](data/scenarios/example.json) for a full example.

## Optimization script

```bash
cd optimize
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python optimize.py
```
