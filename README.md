# water-copilot

An AI copilot for water treatment plant operators: troubleshooting help, a shared logbook, water-quality readings, and shift handoff notes.

Built with Next.js (App Router), TypeScript, and Tailwind. The LLM is reached through an OpenAI-compatible API (Luminal), and data is stored in MongoDB.

## Getting started

```bash
npm install
cp .env.example .env   # fill in the values
npm run dev            # http://localhost:3000
```

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
    readings/           GET/POST readings
    logs/               GET/POST log entries
    handoff/            POST: generate a handoff note
components/             Shared UI
lib/
  llm.ts                OpenAI SDK client pointed at Luminal
  db.ts                 MongoDB client
  agents.ts             Agent logic (troubleshoot, handoff)
types/index.ts          Shared TypeScript types for the data formats below
optimize/               Standalone Python script (separate from the web app)
data/                   Sample data and test scenarios
```

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

Test cases used by `optimize/` and the `/results` page. One JSON file per scenario in `data/scenarios/`.

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
