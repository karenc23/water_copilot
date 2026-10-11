# data/

Sample readings, log entries, and test scenarios. Formats are defined in the root README and `types/index.ts`.

All data here is **fictional**, for the made-up Kettle Creek plant (`plant-a`) in rural Alaska. Thresholds follow U.S. EPA drinking water standards.

- `manual.md` — fictional operator manual with numbered sections. `/api/troubleshoot` uses it when a request doesn't send `manual_text`.
- `scenarios_train.json` (40) / `scenarios_test.json` (20) — evaluation scenarios. `expected` has `diagnosis`, `failure_mode`, `tier` (red = escalate, otherwise the failure mode's tier), `escalate`, and `key_steps` citing `(Manual X.Y)`. About 38% escalate. `difficulty: "hard"` marks 18 scenarios: danger only in the operator's words, misleading descriptions, instrument errors that look real, near-threshold counts, two problems at once, and answers that depend on the logbook.
- `readings_seed.json` — 30 days of readings (Sept 2026) with a slow chlorine drift over the last ~18 days. Loaded by `npm run seed`.
- `logs_seed.json` — 8 past incidents, including a filter 2 problem that recurred 3 times in 30 days. Loaded by `npm run seed`.
- `failure_modes.json` — 13 failure modes (F1–F13), each with a tier (green/yellow/red) and manual section. The LLM picks one, and its tier sets the minimum final tier.
- `scenarios/example.json` — the original format example.
- `results.json` / `results_quick.json` — output of `npx tsx scripts/optimize.ts [--quick]`. Scoring per scenario: escalate +3 (miss −6, false alarm −2), exact tier +2, failure mode +2, any expected section cited +1, +1 per expected key step covered (DeepSeek judge), −1 per step the safety layer dropped.

