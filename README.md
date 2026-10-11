# Water Copilot

**A safety assistant and memory for the people who keep drinking water safe in remote Alaska villages, with self-improving AI agents behind it.**

Water Copilot helps a village water plant operator troubleshoot problems from their plant's own manual. It escalates real health risks under safety rules the AI can't override, and it remembers every fix so knowledge stays when operators leave. Behind the scenes, DeepSeek agents on Luminal train on practice breakdowns. On 20 unseen scenarios they cut errors by **56%** compared with a generic prompt.

> ⚠️ Hackathon prototype. All plant data is synthetic (see [Data](#data)). It is not operating guidance for a real water system.

---

## The problem

- In rural Alaska, safe drinking water often depends on **one or two local operators** per village.
- Many village plants **lack a certified operator**, and turnover is high.
- The state's Remote Maintenance Worker program supports roughly **190 communities**, so expert help can be days away.
- When an experienced operator leaves, **what they knew about the plant leaves with them.**

## What it does

| Page | What it shows |
|---|---|
| **Story intro** (`/`) | The problem in three scenes, then the agents introduce themselves |
| **Troubleshoot** | The operator describes a problem in plain words, the agents work it out live, and the answer fills in: danger level, steps citing the manual, and a drafted message to the expert |
| **Plant Status** | Latest chlorine, turbidity and pH, 30-day charts with safe-range bands, and rule-based alerts |
| **Plant Memory** | Every incident and fix, stored in MongoDB, searchable, with an "Escalated only" filter |
| **Handoff Guide** | One click writes a "Welcome to this plant" guide for a new operator from the logbook |
| **Proof** | Generic prompt vs. evolved strategy on unseen scenarios |
| **Agent Evolution** | Replay of the training: each round's strategies, hypotheses, lineage and fixes |

## How it works

### The live team (runs on every question)

| Agent | Job | Type |
|---|---|---|
| 🛰️ **Sentinel** | Checks readings against fixed rules (out-of-range values, chlorine falling 3 days in a row, …) | Code |
| 📖 **Librarian** | Pulls the relevant manual sections | Code |
| 🗂️ **Keeper** | Recalls this plant's past incidents from MongoDB | Code + database |
| 🧠 **Diagnostician** | Proposes a diagnosis, failure mode and steps citing the manual | **AI** (DeepSeek-V4.1-Flash on Luminal) |
| 🛡️ **Governor** | Sets the final danger level and removes invented doses and fake citations | Code |
| 📝 **Courier** | Drafts the message to the expert from a template, for the operator to copy, download or email | Code |

**The safety rule:** the final danger level is the **highest** of Sentinel's alerts, the failure mode's fixed tier, and the AI's own call. **The AI can raise the alarm but never lower it.** On red, "Contact your Remote Maintenance Worker" is always step 1. The app **never sends anything itself.** A human decides.

### The training team (self-improving loop)

A **strategy** is the Diagnostician's hidden instructions plus settings (what context it reads first, step limit, reasoning on or off).

Each round:
1. **Explorer agents** propose new strategies. In the parallel arm, three specialists run at once: *Threshold* (counts and limits), *Words* (danger stated only in the operator's description) and *History* (logbook patterns). A **Synthesizer** merges their fixes.
2. The **Judge** scores every strategy on 20 training scenarios through the real pipeline (rules → AI → safety layer), running evaluations in parallel.
3. The **Critic** reads the failures and writes a shared lesson for the next round.
4. The best strategy survives.

**Scoring:** points for the correct escalation decision, exact danger tier, failure mode and expected steps. **Missing a health risk carries the largest penalty**, and false alarms are penalized too, so a strategy can't win by escalating everything.

**Selection rule:** the final strategy is the one with the best **training** score across all runs. It is **never chosen by test score.**

## Results

On 20 held-out test scenarios never used during optimization (max 220; error change is relative to the generic prompt):

| Strategy | Train (/222) | Test-20 (/220) | Test-20 hard (/66) |
|---|---|---|---|
| Generic prompt (baseline) | 167 | 179 | 53 |
| Parallel multi-agent best | 204 | 193 (−34% errors) | 52 |
| Single-agent best (fresh run) | 205 | 195 (−39% errors) | 61 |
| **★ b3, selected by training score** | **215** | **202 (−56% errors)** | **60** |
| Hand-written expert prompt (reference) | 188 | 206 | 62 |

- **Concurrency:** evaluating scenarios in parallel was **4.06× faster** than one at a time (measured: 13.2 s vs. 3.2 s on 5 scenarios).
- **Reproducibility:** b3 scored 214/222 on training originally and 215/222 when re-scored.
- **Parallel vs. single agent:** with the same budget, the specialist parallel arm explored more but a single agent combining fixes in one lineage scored higher on training, so that's what the selection rule kept.
- **The expert prompt** was written by us with knowledge of the scenarios. It scores slightly higher on test but lower on training, where it missed escalations, so the selection rule doesn't pick it.

## Data

Everything is **synthetic**. Real village plant logs aren't public, and measuring improvement requires scenarios with known correct answers. Safe ranges are based on EPA drinking-water standards.

| File | Contents |
|---|---|
| `data/manual.md` | Fictional operator manual with numbered sections |
| `data/failure_modes.json` | Failure modes (F1–F13) with fixed danger tiers |
| `data/readings_seed.json` | 30 days of chlorine, turbidity and pH, including a slow chlorine drift |
| `data/logs_seed.json` | Past incidents, seeded into MongoDB |
| `data/scenarios_train.json` / `scenarios_test.json` | Labeled breakdown scenarios; about half are deliberately hard (danger only in words, logbook recurrences, broken instruments) |
| `data/results*.json` | Optimizer outputs that the Proof and Agent Evolution pages read |

## Tech stack

- **Next.js** (App Router, TypeScript) + **Tailwind**, **Recharts**, **framer-motion**
- **DeepSeek-V4.1-Flash** via **Luminal Cloud** (OpenAI-compatible API)
- **MongoDB Atlas** for the logbook, with a JSON fallback
- Optimizer scripts in TypeScript, run with `tsx`

## Run it

```bash
npm install
cp .env.example .env   # then fill in the values below
npm run seed           # loads the seed logbook into MongoDB (safe to repeat)
npm run dev            # http://localhost:3000
```

`.env`:
```
LUMINAL_BASE_URL=https://flash.luminal.cloud/v1
LUMINAL_API_KEY=your-key
LUMINAL_MODEL=deepseek-ai/DeepSeek-V4.1-Flash
MONGODB_URI=mongodb+srv://...
MONGODB_DB=water-copilot
```

If `MONGODB_URI` is empty or unreachable, the app falls back to the seed files.

### Reproduce the training results

```bash
npm run try-scenarios     # run a few scenarios through the live pipeline
npm run optimize          # parallel vs. single-agent optimizer
npm run optimize:agents   # specialist Explorers + Synthesizer vs. single agent
```

## Repo layout

```
app/                 pages and API routes (troubleshoot stream, logs, handoff, …)
components/          UI, including the Agent Room and live answer
lib/rules.ts         Sentinel: deterministic alert rules
lib/agents.ts        Diagnostician: the LLM call
lib/safety.ts        Governor: final tier, citation and dose checks
lib/llm.ts, db.ts    Luminal client and MongoDB access
scripts/             optimizers, seeding, scenario runner
data/                manual, failure modes, readings, logbook, scenarios, results
qa-screenshots/      screenshots from the automated click-through QA
```

## Limitations

- **Synthetic data** and a small test set (20 scenarios); scores vary a few points between runs.
- The evolved strategy reasons before answering, so it takes about 9 s per answer vs. about 2 s for the original prompt.
- Sentinel's "same problem 3 times in 30 days" rule counts from the readings history, so a newly saved logbook entry is recalled by the Keeper but doesn't trigger that alert yet.
- It doesn't contact anyone. It drafts messages for a human to send.

## What's next

- Pilot with real operators and real logbooks, with community permission
- **Offline mode:** the rule-based safety layer already runs without AI; add a small on-device model for villages with unreliable internet
- Voice notes so experienced operators can record plant quirks before they leave
- Chemical supply tracking timed to barge and flight deliveries
- A multi-plant view for remote experts

---

*Built in one day at a hackathon. Synthetic data only; not for operating a real water system.*
