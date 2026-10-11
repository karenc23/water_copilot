# data/

Sample readings, log entries, and test scenarios. Formats are defined in the root README and `types/index.ts`.

All data here is **fictional**, for the made-up Kettle Creek plant (`plant-a`) in rural Alaska. Thresholds follow U.S. EPA drinking water standards.

- `manual.md` — fictional operator manual with numbered sections. `/api/troubleshoot` uses it when a request doesn't send `manual_text`.
- `scenarios_train.json` (20) / `scenarios_test.json` (10) — evaluation scenarios. Each `expected.key_steps` entry cites manual sections as `(Manual X.Y)`. About a third escalate; several are tricky (slow drifts, frozen sensors, problems that recur in `log_history`).
- `readings_seed.json` — 30 days of readings (Sept 2026) with a slow chlorine drift over the last ~18 days. Loaded by `npm run seed`.
- `logs_seed.json` — 8 past incidents, including a filter 2 problem that recurred 3 times in 30 days. Loaded by `npm run seed`.
- `scenarios/example.json` — the original format example.

