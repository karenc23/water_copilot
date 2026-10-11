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
  validate.ts           Runtime validation for request bodies and seed data
scripts/seed.ts         Seeds MongoDB from data/readings_seed.json and data/logs_seed.json
types/index.ts          Shared TypeScript types for the data formats below
optimize/               Standalone Python script (separate from the web app)
data/                   Sample data and test scenarios
```

## Troubleshoot API

`POST /api/troubleshoot`

```json
{
  "plant_id": "plant-b",
  "description": "Chlorine residual keeps dropping",
  "readings": [],      // optional: defaults to the plant's last 30 readings in MongoDB
  "logs": [],          // optional: defaults to the plant's last 20 log entries
  "manual_text": "..." // optional: defaults to data/manual.md
}
```

Response:

```json
{
  "diagnosis": "...",
  "steps": [{ "action": "...", "manual_section": "4.2 Chlorine Feed" }],
  "escalate": true,
  "escalation_message": "...",
  "warnings": ["..."]
}
```

### Safety rules

The model is told both rules, and `lib/agents.ts` also enforces them in code:

- **No invented doses.** Any amount with a dose/volume/mass unit (`mg/L`, `ppm`, `lb`, `gal`, `%`, ...) in the diagnosis, steps, or escalation message whose number doesn't appear in the manual (or in the readings) is replaced with `[amount not in manual — confirm with supervisor]`. With no manual, every amount is removed and every `manual_section` is `null`.
- **Always escalate possible health risks.** Escalation is forced if the model reports a health risk, or if the latest reading breaches `HEALTH_LIMITS`: chlorine below 0.2 or above 4.0 mg/L, turbidity above 1.0 NTU, pH outside 6.5–8.5. These defaults follow EPA limits; confirm them against your plant's permit. If the model's reply can't be parsed, the result escalates by default.

Every forced change is listed in `warnings`.

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
