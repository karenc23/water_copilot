// Multi-agent prompt optimizer vs a single agent, on one shared evaluator.
//
// Usage: npm run optimize:agents                 (20 train, A: 3 rounds, B: 12 candidates, all test)
//        npx tsx scripts/optimize_agents.ts --dry (3 train, A: 1 round, B: 2 candidates, 3 test, temp folder)
//        flags: --train N --rounds N --single N --test N --deadline HH:MM --out FILE
//
// Same scenarios, splits, pipeline, Judge and scoring as scripts/optimize.ts (scripts/lib/optimizer-core.ts).
// Both arms run at the same time and share one pool of CONCURRENCY LLM calls.
//
// A (multi-agent), each round:
//   1. Three Explorers (Threshold, Words, History) propose in parallel from the current best, the
//      failures in their specialty and the Critic's latest lesson. All three are scored in parallel.
//   2. The Synthesizer sees the current best and all three children with their per-scenario fixes
//      and regressions, and writes one merged strategy keeping the fixes that caused no regressions.
//   3. Best of {parent, 3 Explorers, synthesis} survives (elitism).
//   4. The Critic reads every result and writes a short shared lesson for the next round.
// B (single agent): one agent, one candidate at a time from the best so far, 12 candidates.
//
// Selection rule: the final strategy is the best TRAINING score across all runs (A's best, B's best,
// and b3 from the 5:22 PM run in data/results.json, re-scored here) — never chosen by test.
// Then the generic prompt, each run's best and the expert prompt are scored on all test scenarios;
// test-10 is the earlier 10-scenario subset of that run.
//
// Fixes vs results.json: (1) "fixed"/"broken" are per-scenario score changes against the parent, so
// fixes outside the targets are counted and already-passing targets don't inflate the hit rate;
// (2) each arm's time curve ends with a point at the arm's real end time.
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FAILURE_MODE_LIST, MAX_STEPS } from "@/lib/agents";
import { LIMITS } from "@/lib/rules";
import type { Scenario } from "@/types";
import {
  AbortRun,
  agentJSON,
  allTest,
  allTrain,
  asObj,
  better,
  checkErrorRate,
  compactScenario,
  DATA_DIR,
  GENERIC_STRATEGY,
  limit,
  parseSettings,
  passed,
  printHeader,
  printRow,
  r3,
  runStrategy,
  settingsStr,
  stratified,
  type Metrics,
  type ScenarioResult,
  type Strategy,
} from "@/scripts/lib/optimizer-core";

function intFlag(name: string): number | undefined {
  const i = process.argv.indexOf(name);
  const v = i === -1 ? NaN : Number(process.argv[i + 1]);
  return Number.isInteger(v) && v > 0 ? v : undefined;
}
function strFlag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

const DRY = process.argv.includes("--dry");
const ROUNDS = intFlag("--rounds") ?? (DRY ? 1 : 3);
const SINGLE_CANDIDATES = intFlag("--single") ?? (DRY ? 2 : 12);
const SEED = 42;
const FAILURES_PER_EXPLORER = 5;
// A dry run writes to the temp folder so it can never be mistaken for a real result.
const OUT_FILE = strFlag("--out") ? path.resolve(strFlag("--out")!) : DRY ? path.join(tmpdir(), "results_agents_dry.json") : path.join(DATA_DIR, "results_agents.json");
/** Repo-relative when inside the repo, absolute otherwise. */
const shown = (f: string) => (f.startsWith(process.cwd()) ? path.relative(process.cwd(), f) : f);

/** Hard stop: no new candidates once there's only time left to score the test set. */
const DEADLINE = (() => {
  const v = strFlag("--deadline");
  if (!v) return null;
  const [h, m] = v.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.getTime();
})();
const TEST_RESERVE_MS = 7 * 60_000; // time kept free at the end for test scoring + writing
const cutoff = DEADLINE ? DEADLINE - TEST_RESERVE_MS : Infinity;
const timeLeft = () => cutoff - Date.now();

const train = stratified(allTrain, intFlag("--train") ?? (DRY ? 3 : 20));
const test = stratified(allTest, intFlag("--test") ?? (DRY ? 3 : undefined));
/** The 10-scenario test set used by earlier runs; reported as a subset of the full test run. */
const TEST10 = new Set(stratified(allTest, 10).map((s) => s.id));

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

interface Explorer {
  key: "threshold" | "words" | "history";
  name: string;
  specialty: string;
  /** Which failed scenarios this Explorer is shown. */
  relevant: (s: Scenario, r: ScenarioResult) => boolean;
}

/** A reading within 20% of any rule limit (or past it). */
function nearThreshold(s: Scenario): boolean {
  const near = (v: number, lim: number) => Math.abs(v - lim) <= Math.abs(lim) * 0.2;
  return s.readings.some(
    (r) =>
      [LIMITS.chlorine.red_below, LIMITS.chlorine.yellow_below, LIMITS.chlorine.yellow_above, LIMITS.chlorine.red_above].some((l) => near(r.chlorine, l)) ||
      [LIMITS.turbidity.yellow_at, LIMITS.turbidity.red_above].some((l) => near(r.turbidity, l)) ||
      [LIMITS.ph.red_below, LIMITS.ph.yellow_below, LIMITS.ph.yellow_above, LIMITS.ph.red_above].some((l) => near(r.ph, l)),
  );
}

const RISK_WORDS = /sick|ill\b|illness|vomit|diarrh|taste|odou?r|smell|colou?r|brown|yellow water|frozen|freez|broken|break|leak|pressure|spill|complain|clinic|school|boil/i;

const EXPLORERS: Explorer[] = [
  {
    key: "threshold",
    name: "Threshold Explorer",
    specialty:
      "Counts, limits and near-threshold cases: applying the manual's numeric limits exactly (chlorine 0.2/0.5/2.0/4.0 mg/L, turbidity 0.25/1.0 NTU and 0.3 NTU after two backwashes, pH 6.5/6.8/8.0/8.5, pressure 20/35 psi), counting repeats correctly (3 in 30 days, 2 failed backwashes), values right at a limit, and readings that cannot be real.",
    relevant: (s, r) => nearThreshold(s) || (r.got.alerts ?? []).some((a) => !a.startsWith("LOG_")),
  },
  {
    key: "words",
    name: "Words Explorer",
    specialty:
      "Danger expressed only in the operator's description: illness reports, taste/odor/color complaints, frozen or broken lines, low pressure, spills — risk the readings don't show. Also the reverse: alarming words when the readings and context show a routine problem.",
    relevant: (s, r) => RISK_WORDS.test(s.description) || !(r.got.alerts ?? []).length,
  },
  {
    key: "history",
    name: "History Explorer",
    specialty:
      "Logbook patterns and recurrences: the same problem repeating within 30 days, fixes that didn't hold, past escalations, and seasonal events (breakup, turnover) that explain the symptoms.",
    relevant: (s, r) => s.log_history.length >= 2 || (r.got.alerts ?? []).some((a) => a.startsWith("LOG_")),
  },
];

const AGENT_CONTEXT = `You improve the system prompt and settings of a water-treatment troubleshooting assistant for operators at a small rural Alaska plant.

The assistant runs inside a pipeline: deterministic rules flag readings → the LLM (your prompt) → a safety layer. The safety layer takes the highest of the rule tier, the chosen failure mode's tier, and the LLM's escalate/health_risk flags, so the LLM can raise the tier but never lower it. It drops steps whose manual section doesn't exist and removes doses not in the manual. The user message the LLM sees contains the operator's description, recent readings, logbook entries, automated alerts, and the full plant MANUAL.

Code ALWAYS appends to the prompt: the step limit, the list of failure modes (ids, tiers, descriptions), and the exact JSON output format (diagnosis, failure_mode, steps with manual_section, health_risk, escalate). Do NOT include a JSON schema or the failure-mode list in the prompt.

Final tier: red if escalated, otherwise yellow if any alert or the failure mode is yellow, otherwise green.

Scoring per scenario (by the Judge): +3 escalate correct, −6 missed escalation, −2 false alarm; +2 exact tier; +2 correct failure_mode; +1 if any cited section matches the expected ones; +1 per expected key step the answer covers; −1 per step dropped by the safety layer. A scenario PASSES when escalate, tier and failure_mode are all correct.

Every prompt must keep these rules: use only the manual; cite a manual section number for every step; never invent chemical doses; escalate any possible health risk. Generalize — don't hard-code scenario details.

Settings:
- context_order: "description_first" | "readings_first" | "logbook_first"
- max_steps: integer 2–${MAX_STEPS}
- reasoning_effort: "none" (700-token cap) or "low" (brief reasoning, 1,500-token cap)`;

const STRATEGY_FORMAT = `Reply with ONLY JSON:
{"rationale": string (ONE line: what you changed and why), "targets": [ids of the FAILURES this should fix], "prompt": string (the full new prompt), "settings": {"context_order": string, "max_steps": number, "reasoning_effort": string}}`;

const explorerSystem = (ex: Explorer) => `${AGENT_CONTEXT}

You are the ${ex.name}, one of three Explorers working in parallel on the same CURRENT BEST strategy. Your specialty:
${ex.specialty}

You'll see the current best strategy, its FAILURES that fall in your specialty (expected vs. actual), and the Critic's LESSON from the last round. Write ONE new strategy that fixes failures in your specialty without breaking what already works.

${STRATEGY_FORMAT}`;

const SYNTH_SYSTEM = `${AGENT_CONTEXT}

You are the Synthesizer. Three Explorers each rewrote the CURRENT BEST strategy and the Judge scored all three. For each child you see its prompt, settings, and per-scenario FIXES (scenarios whose score went up vs. the current best) and REGRESSIONS (score went down).

Write ONE merged strategy that starts from the current best and keeps the specific changes that produced fixes WITHOUT causing regressions. Drop changes that caused regressions. Choose the settings of the child that did best unless you have a clear reason otherwise.

Reply with ONLY JSON:
{"rationale": string (ONE line: what you kept from which Explorer and what you dropped), "kept_from": [Explorer names], "prompt": string (the full merged prompt), "settings": {"context_order": string, "max_steps": number, "reasoning_effort": string}}`;

const CRITIC_SYSTEM = `${AGENT_CONTEXT}

You are the Critic. This round three Explorers (Threshold, Words, History) proposed strategies, the Synthesizer merged them, and the Judge scored all four. You see each one's rationale, score change versus the current best, and which scenarios it fixed and broke.

Write a short shared LESSON (at most 3 sentences) for the Explorers next round: what worked, what broke, and what to try or avoid. Be concrete and general — no scenario ids.

Reply with ONLY JSON: {"lesson": string}`;

const SINGLE_SYSTEM = `${AGENT_CONTEXT}

You are a single agent improving the CURRENT BEST strategy, one candidate at a time. Pick the ONE hypothesis you think explains the most FAILURES, for example:
${EXPLORERS.map((e) => `- ${e.name.replace(" Explorer", "").toLowerCase()}: ${e.specialty}`).join("\n")}
- other: a different explanation.

Rewrite the prompt to test it and choose all settings.

${STRATEGY_FORMAT}`;

/** Agent calls take a slot in the same pool as scoring calls. */
const callAgent = (system: string, user: string, seed: number, maxTokens = 3000) => limit(() => agentJSON(system, user, seed, maxTokens));

// ---------------------------------------------------------------------------
// Types and helpers
// ---------------------------------------------------------------------------

interface Evaluated extends Strategy {
  arm: "A" | "B" | "root" | "reference";
  round: number;
  score: number;
  metrics: Metrics;
  qualified: boolean;
  scenarios: ScenarioResult[];
  agent?: string;
  parent_id?: string;
  targets?: string[];
  kept_from?: string[];
}

/** Per-scenario change vs. the parent. "Fixed" = score went up, "broken" = went down. */
interface Change {
  fixed: string[];
  broken: string[];
  fixed_targets: string[];
  fixed_other: string[];
  hit_rate: number | null;
  newly_passing: string[];
  newly_failing: string[];
}

const scenarioById = new Map([...allTrain, ...allTest].map((s) => [s.id, s]));

function describe(r: ScenarioResult) {
  const s = scenarioById.get(r.id)!;
  return {
    id: r.id,
    passed: passed(r),
    score: `${r.score}/${r.max}`,
    difficulty: r.difficulty,
    description: s.description,
    readings: s.readings.map((x) => `${x.date}: Cl ${x.chlorine}, turb ${x.turbidity}, pH ${x.ph}`),
    logbook: s.log_history.map((l) => `${l.date}: ${l.problem} → ${l.steps_taken.join("; ")} → ${l.outcome}`),
    expected: { escalate: s.expected.escalate, tier: s.expected.tier, failure_mode: s.expected.failure_mode, key_steps: s.expected.key_steps },
    actual: {
      escalate: r.got.escalate,
      tier: r.got.tier,
      failure_mode: r.got.failure_mode,
      steps: r.got.steps,
      key_steps_covered: r.covered,
      rule_alerts: r.got.alerts,
      safety_warnings: r.got.warnings?.filter((w) => /Dropped|Removed/.test(w)),
      error: r.got.error,
    },
  };
}

const gap = (r: ScenarioResult) => r.score - r.max;

/** Failed first (worst gap first), then imperfect passes. */
function weakest(e: Evaluated): ScenarioResult[] {
  return [
    ...e.scenarios.filter((r) => !passed(r)).sort((a, b) => gap(a) - gap(b)),
    ...e.scenarios.filter((r) => passed(r) && r.score < r.max).sort((a, b) => gap(a) - gap(b)),
  ];
}

function failuresFor(ex: Explorer, best: Evaluated): { results: ScenarioResult[]; general: boolean } {
  const ranked = weakest(best);
  const mine = ranked.filter((r) => ex.relevant(scenarioById.get(r.id)!, r));
  return mine.length ? { results: mine.slice(0, FAILURES_PER_EXPLORER), general: false } : { results: ranked.slice(0, FAILURES_PER_EXPLORER), general: true };
}

function changeVs(parent: Evaluated, cand: Evaluated, targets: string[] = []): Change {
  const before = new Map(parent.scenarios.map((r) => [r.id, r]));
  const fixed: string[] = [];
  const broken: string[] = [];
  const newly_passing: string[] = [];
  const newly_failing: string[] = [];
  for (const r of cand.scenarios) {
    const p = before.get(r.id);
    if (!p) continue;
    if (r.score > p.score) fixed.push(r.id);
    if (r.score < p.score) broken.push(r.id);
    if (passed(r) && !passed(p)) newly_passing.push(r.id);
    if (!passed(r) && passed(p)) newly_failing.push(r.id);
  }
  const fixed_targets = fixed.filter((id) => targets.includes(id));
  return {
    fixed,
    broken,
    fixed_targets,
    fixed_other: fixed.filter((id) => !targets.includes(id)),
    hit_rate: targets.length ? r3(fixed_targets.length / targets.length) : null,
    newly_passing,
    newly_failing,
  };
}

const deltas = (parent: Evaluated, cand: Evaluated, ids: string[]) =>
  ids.map((id) => {
    const p = parent.scenarios.find((x) => x.id === id)!;
    const c = cand.scenarios.find((x) => x.id === id)!;
    return { id, before: `${p.score}/${p.max}`, after: `${c.score}/${c.max}`, description: scenarioById.get(id)!.description };
  });

let floor = 0; // escalation recall of the generic prompt: never accept a strategy that catches less danger

async function evaluate(st: Strategy, meta: Omit<Evaluated, keyof Strategy | "score" | "metrics" | "qualified" | "scenarios">): Promise<Evaluated> {
  const run = await runStrategy(st, train);
  return { ...st, ...meta, score: run.metrics.score, metrics: run.metrics, qualified: run.metrics.escalation_recall >= floor, scenarios: run.results };
}

const pickBest = (all: Evaluated[]) => {
  const pool = all.some((e) => e.qualified) ? all.filter((e) => e.qualified) : all;
  return pool.reduce((a, b) => (better(b, a) ? b : a));
};

function strategyFrom(o: Record<string, unknown> | null, id: string, shownIds: string[]): { strategy: Strategy; targets: string[]; kept_from: string[] } | { error: string } {
  if (!o || typeof o.prompt !== "string" || o.prompt.trim().length < 50) return { error: "no usable prompt in the reply" };
  const settings = parseSettings(o.settings);
  if (!settings) return { error: `invalid settings ${JSON.stringify(o.settings)}` };
  const allowed = new Set(shownIds);
  const targets = [...new Set((Array.isArray(o.targets) ? o.targets : []).map(String))].filter((t) => allowed.has(t));
  const rationale = typeof o.rationale === "string" && o.rationale.trim() ? o.rationale.trim().split("\n")[0] : "(no rationale given)";
  const kept_from = Array.isArray(o.kept_from) ? o.kept_from.map(String) : [];
  return { strategy: { id, prompt: o.prompt.trim(), settings, rationale }, targets, kept_from };
}

const parentView = (best: Evaluated) => ({ id: best.id, prompt: best.prompt, settings: best.settings, score: `${best.score}/${best.metrics.max_score}`, metrics: best.metrics });

// ---------------------------------------------------------------------------
// Time curves
// ---------------------------------------------------------------------------

interface TracePoint {
  candidates: number;
  seconds: number;
  best_score: number;
  best_id: string;
  candidate_id: string | null;
  candidate_score: number | null;
}

class Trace {
  points: TracePoint[] = [];
  count = 0;
  constructor(
    readonly t0: number,
    root: Evaluated,
  ) {
    this.points.push({ candidates: 0, seconds: 0, best_score: root.score, best_id: root.id, candidate_id: null, candidate_score: null });
  }
  /** Called the moment a candidate's score is known. */
  add(best: Evaluated, cand: Evaluated) {
    this.count++;
    this.points.push({ candidates: this.count, seconds: r3((Date.now() - this.t0) / 1000), best_score: best.score, best_id: best.id, candidate_id: cand.id, candidate_score: cand.score });
  }
  /** Closing point at the arm's real end time, so the curve and the arm's total seconds agree. */
  close(best: Evaluated) {
    const seconds = r3((Date.now() - this.t0) / 1000);
    this.points.push({ candidates: this.count, seconds, best_score: best.score, best_id: best.id, candidate_id: null, candidate_score: null });
    return seconds;
  }
}

const entry = (e: Evaluated) => ({
  id: e.id,
  arm: e.arm,
  agent: e.agent ?? null,
  score: e.score,
  metrics: e.metrics,
  qualified: e.qualified,
  prompt: e.prompt,
  settings: e.settings,
  rationale: e.rationale ?? null,
  parent_id: e.parent_id ?? null,
  scenarios: e.scenarios.map(compactScenario),
});

// ---------------------------------------------------------------------------
// Arm A: Explorers + Synthesizer + Critic
// ---------------------------------------------------------------------------

async function runMulti(root: Evaluated) {
  const t0 = Date.now();
  const trace = new Trace(t0, root);
  const all: Evaluated[] = [root];
  let best = root;
  let lesson: string | null = null;
  const rounds: object[] = [];
  const wins: Record<string, { round_wins: number; new_best: number }> = Object.fromEntries(
    [...EXPLORERS.map((e) => e.name), "Synthesizer"].map((n) => [n, { round_wins: 0, new_best: 0 }]),
  );
  let agentSeconds = 0;
  let lastRound = 0;
  let dropped = 0;

  for (let round = 1; round <= ROUNDS; round++) {
    if (round > 1 && timeLeft() < lastRound * 1.1) {
      dropped = ROUNDS - round + 1;
      console.log(`[A] Deadline: skipping round ${round}${dropped > 1 ? `–${ROUNDS}` : ""} (last round took ${Math.round(lastRound / 1000)} s).`);
      break;
    }
    const tr = Date.now();
    const parent = best;
    const addCandidate = (e: Evaluated) => {
      all.push(e);
      trace.add(pickBest(all), e);
    };

    // 1. Explorers propose in parallel; each is scored as soon as it arrives.
    const rows = await Promise.all(
      EXPLORERS.map(async (ex) => {
        const { results, general } = failuresFor(ex, parent);
        const ta = Date.now();
        let o: Record<string, unknown> | null = null;
        let error: string | undefined;
        try {
          o = asObj(
            await callAgent(
              explorerSystem(ex),
              JSON.stringify(
                {
                  current_best: parentView(parent),
                  failures: results.map(describe),
                  failures_note: general ? "None of the current failures fall clearly in your specialty; these are the overall weakest." : undefined,
                  critic_lesson: lesson ?? "(none yet: this is the first round)",
                  failure_modes: FAILURE_MODE_LIST,
                },
                null,
                1,
              ),
              SEED + round * 10 + EXPLORERS.indexOf(ex),
            ),
          );
        } catch (err) {
          error = String(err).slice(0, 200);
        }
        agentSeconds += (Date.now() - ta) / 1000;
        const p = error ? { error } : strategyFrom(o, `r${round}-${ex.key}`, results.map((r) => r.id));
        if ("error" in p) return { name: ex.name, cand: null, error: p.error, general, change: null as Change | null };
        const cand = await evaluate(p.strategy, { arm: "A", round, agent: ex.name, parent_id: parent.id, targets: p.targets });
        addCandidate(cand);
        return { name: ex.name, cand, error: undefined as string | undefined, general, change: changeVs(parent, cand, p.targets) };
      }),
    );
    const scored = rows.filter((r) => r.cand) as (typeof rows[number] & { cand: Evaluated; change: Change })[];
    checkErrorRate(`A round ${round}`, scored.map((r) => ({ results: r.cand.scenarios })));

    // 2. Synthesizer merges the fixes that caused no regressions.
    let synth: { cand: Evaluated | null; change: Change | null; error?: string; kept_from: string[] } = { cand: null, change: null, kept_from: [] };
    if (scored.length) {
      const ta = Date.now();
      try {
        const o = asObj(
          await callAgent(
            SYNTH_SYSTEM,
            JSON.stringify(
              {
                current_best: parentView(parent),
                children: scored.map((r) => ({
                  explorer: r.name,
                  rationale: r.cand.rationale,
                  prompt: r.cand.prompt,
                  settings: r.cand.settings,
                  score: `${r.cand.score}/${r.cand.metrics.max_score}`,
                  change_vs_best: r.cand.score - parent.score,
                  fixes: deltas(parent, r.cand, r.change.fixed),
                  regressions: deltas(parent, r.cand, r.change.broken),
                })),
              },
              null,
              1,
            ),
            SEED + round * 10 + 5,
            4000,
          ),
        );
        agentSeconds += (Date.now() - ta) / 1000;
        const p = strategyFrom(o, `r${round}-synth`, []);
        if ("error" in p) synth.error = p.error;
        else {
          const cand = await evaluate(p.strategy, { arm: "A", round, agent: "Synthesizer", parent_id: parent.id, kept_from: p.kept_from });
          addCandidate(cand);
          synth = { cand, change: changeVs(parent, cand), kept_from: p.kept_from };
        }
      } catch (err) {
        synth.error = String(err).slice(0, 200);
      }
      if (synth.cand) checkErrorRate(`A round ${round} synthesis`, [{ results: synth.cand.scenarios }]);
    }

    // 3. Elitism: best of {parent, Explorers, synthesis}.
    const contenders = [...scored.map((r) => ({ name: r.name, cand: r.cand })), ...(synth.cand ? [{ name: "Synthesizer", cand: synth.cand }] : [])];
    const roundWinner = contenders.filter((c) => c.cand.qualified).reduce<(typeof contenders)[number] | null>((a, c) => (!a || better(c.cand, a.cand) ? c : a), null);
    const improved = !!roundWinner && better(roundWinner.cand, parent);
    if (roundWinner) wins[roundWinner.name].round_wins++;
    if (improved) {
      best = roundWinner!.cand;
      wins[roundWinner!.name].new_best++;
    }

    // 4. Critic writes the shared lesson.
    const ta = Date.now();
    let criticError: string | undefined;
    const results = [
      ...scored.map((r) => ({ agent: r.name, cand: r.cand, change: r.change })),
      ...(synth.cand ? [{ agent: "Synthesizer", cand: synth.cand, change: synth.change! }] : []),
    ];
    try {
      const o = asObj(
        await callAgent(
          CRITIC_SYSTEM,
          JSON.stringify(
            {
              current_best: { id: parent.id, score: `${parent.score}/${parent.metrics.max_score}` },
              previous_lesson: lesson,
              results: results.map((r) => ({
                agent: r.agent,
                rationale: r.cand.rationale,
                score: `${r.cand.score}/${r.cand.metrics.max_score}`,
                change_vs_best: r.cand.score - parent.score,
                escalation_recall: r.cand.metrics.escalation_recall,
                false_alarms: r.cand.metrics.false_alarms,
                fixed: deltas(parent, r.cand, r.change.fixed),
                broken: deltas(parent, r.cand, r.change.broken),
              })),
              errors: rows.filter((r) => r.error).map((r) => ({ agent: r.name, error: r.error })),
            },
            null,
            1,
          ),
          SEED + round * 10 + 9,
          600,
        ),
      );
      if (typeof o?.lesson === "string" && o.lesson.trim()) lesson = o.lesson.trim();
      else criticError = "no lesson in the reply";
    } catch (err) {
      criticError = String(err).slice(0, 200);
    }
    agentSeconds += (Date.now() - ta) / 1000;

    for (const r of [...rows, { name: "Synthesizer", cand: synth.cand, error: synth.error, general: false, change: synth.change }]) {
      if (!r.cand) {
        console.log(`[A] ${String(round).padEnd(3)}${r.name.padEnd(28)}  failed: ${r.error}`);
        continue;
      }
      const mark = [r.cand.qualified ? "" : "DQ (recall)", roundWinner?.cand === r.cand ? (improved ? "★ new best" : "round winner (not better than best)") : ""].filter(Boolean).join(" ");
      printRow(`A ${round}`, r.name, r.cand.metrics, `${settingsStr(r.cand.settings)}${mark ? `  ${mark}` : ""}`);
      const c = r.change!;
      console.log(`       ↳ ${r.cand.rationale}`);
      console.log(
        `       ↳ fixed [${c.fixed.join(", ")}] · broken [${c.broken.join(", ")}]` +
          (r.cand.targets?.length ? ` · targets hit ${c.fixed_targets.length}/${r.cand.targets.length}, other fixes ${c.fixed_other.length}` : ""),
      );
    }
    console.log(`       Critic lesson: ${criticError ? `(none: ${criticError})` : lesson}`);

    const entryWith = (name: string, cand: Evaluated | null, change: Change | null, error?: string, extra: object = {}) => ({
      agent: name,
      error: error ?? null,
      ...(cand ? { strategy: entry(cand), targets: cand.targets ?? [], change } : { strategy: null }),
      ...extra,
    });
    rounds.push({
      round,
      best_before: { id: parent.id, score: parent.score },
      explorers: rows.map((r) => entryWith(r.name, r.cand, r.change, r.error, { general_failures: r.general })),
      synthesis: entryWith("Synthesizer", synth.cand, synth.change, synth.error, { kept_from: synth.kept_from }),
      critic_lesson: criticError ? null : lesson,
      critic_error: criticError ?? null,
      winner: roundWinner?.name ?? null,
      winner_id: roundWinner?.cand.id ?? null,
      improved_best: improved,
      best_after: { id: best.id, score: best.score },
      seconds: r3((Date.now() - tr) / 1000),
    });
    lastRound = Date.now() - tr;
  }
  const seconds = trace.close(best);
  return { best, rounds, wins, trace: trace.points, seconds, agent_seconds: r3(agentSeconds), rounds_run: rounds.length, rounds_dropped: dropped };
}

// ---------------------------------------------------------------------------
// Arm B: single agent
// ---------------------------------------------------------------------------

async function runSingle(root: Evaluated) {
  const t0 = Date.now();
  const trace = new Trace(t0, root);
  const candidates: object[] = [];
  let best = root;
  let agentSeconds = 0;
  let failed = 0;
  let stoppedAt: number | null = null;
  const durations: number[] = [];

  for (let i = 1; i <= SINGLE_CANDIDATES; i++) {
    const avg = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
    if (i > 1 && timeLeft() < avg * 1.1) {
      stoppedAt = i;
      console.log(`[B] Deadline: stopping after ${i - 1} candidates.`);
      break;
    }
    const tc = Date.now();
    const parent = best;
    const failures = weakest(parent).slice(0, FAILURES_PER_EXPLORER);
    let p: ReturnType<typeof strategyFrom>;
    try {
      const o = asObj(
        await callAgent(SINGLE_SYSTEM, JSON.stringify({ current_best: parentView(parent), failures: failures.map(describe), failure_modes: FAILURE_MODE_LIST }, null, 1), SEED + 1000 + i),
      );
      p = strategyFrom(o, `s${i}`, failures.map((r) => r.id));
    } catch (err) {
      p = { error: String(err).slice(0, 200) };
    }
    agentSeconds += (Date.now() - tc) / 1000;
    if ("error" in p) {
      failed++;
      console.log(`[B] s${i}: agent failed (${p.error})`);
      candidates.push({ id: `s${i}`, error: p.error });
      durations.push(Date.now() - tc);
      continue;
    }
    const cand = await evaluate(p.strategy, { arm: "B", round: i, agent: "Single agent", parent_id: parent.id, targets: p.targets });
    checkErrorRate(`B candidate ${i}`, [{ results: cand.scenarios }]);
    const change = changeVs(parent, cand, p.targets);
    const improved = cand.qualified && better(cand, best);
    if (improved) best = cand;
    trace.add(best, cand);
    printRow(`B ${i}`, cand.id, cand.metrics, `${settingsStr(cand.settings)}${cand.qualified ? "" : "  DQ (recall)"}${improved ? "  ★ new best" : ""}`);
    console.log(`       ↳ ${cand.rationale}`);
    console.log(`       ↳ fixed [${change.fixed.join(", ")}] · broken [${change.broken.join(", ")}] · targets hit ${change.fixed_targets.length}/${p.targets.length}, other fixes ${change.fixed_other.length}`);
    candidates.push({ ...entry(cand), targets: p.targets, change, improved_best: improved });
    durations.push(Date.now() - tc);
  }
  const seconds = trace.close(best);
  return { best, candidates, trace: trace.points, seconds, agent_seconds: r3(agentSeconds), failed_agent_calls: failed, stopped_at: stoppedAt };
}

// ---------------------------------------------------------------------------
// Report helpers
// ---------------------------------------------------------------------------

interface Sub {
  n: number;
  score: number;
  max: number;
  pct: number;
  errors: number;
}

function sub(results: ScenarioResult[], keep: (r: ScenarioResult) => boolean = () => true): Sub {
  const rs = results.filter(keep);
  const score = rs.reduce((a, r) => a + r.score, 0);
  const max = rs.reduce((a, r) => a + r.max, 0);
  return { n: rs.length, score, max, pct: max ? Math.round((score / max) * 1000) / 10 : 0, errors: max - score };
}
const reduction = (base: Sub, fin: Sub) => (base.errors > 0 ? r3((base.errors - fin.errors) / base.errors) : null);
const fmtSub = (s: Sub) => (s.n ? `${s.score}/${s.max}` : "—");
const fmtRed = (x: number | null) => (x === null ? "" : `${x >= 0 ? "−" : "+"}${Math.abs(Math.round(x * 100))}%`);
const hard = (r: ScenarioResult) => r.difficulty === "hard";
const t10 = (r: ScenarioResult) => TEST10.has(r.id);

/** b3 from the 5:22 PM run and the expert prompt it was compared with, read from data/results.json (never written). */
function loadReferences(): { b3: Strategy & { recorded_train: number | null }; expert: Strategy | null } {
  const d = JSON.parse(readFileSync(path.join(DATA_DIR, "results.json"), "utf8"));
  const b3 = (d.single_agent_rounds ?? []).flatMap((r: { strategies: unknown[] }) => r.strategies).find((s: { id: string }) => s.id === "b3");
  if (!b3 || typeof b3.prompt !== "string" || !parseSettings(b3.settings)) throw new AbortRun("data/results.json has no usable b3 strategy");
  const expertId = d.test?.expert_reference?.id;
  const ex = (d.expert_reference ?? []).find((e: { id: string }) => e.id === expertId);
  return {
    b3: { id: "b3", prompt: b3.prompt, settings: parseSettings(b3.settings)!, rationale: b3.change ?? b3.rationale, recorded_train: typeof b3.score === "number" ? b3.score : null },
    expert: ex && typeof ex.prompt === "string" && parseSettings(ex.settings) ? { id: ex.id, prompt: ex.prompt, settings: parseSettings(ex.settings)!, rationale: ex.rationale } : null,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const started = Date.now();
  const refs = loadReferences();
  console.log(
    `Multi-agent vs single-agent optimizer${DRY ? " (DRY RUN)" : ""}: ${train.length} train, A ${ROUNDS} round(s) × (3 Explorers + Synthesizer), ` +
      `B ${SINGLE_CANDIDATES} candidates, ${test.length} test → ${shown(OUT_FILE)}` +
      (DEADLINE ? ` · deadline ${new Date(DEADLINE).toLocaleTimeString()}` : ""),
  );

  // Round 0 (shared root) plus the references on train, concurrently.
  const [root, b3, expertTrain] = await Promise.all([
    evaluate(GENERIC_STRATEGY, { arm: "root", round: 0 }),
    evaluate(refs.b3, { arm: "reference", round: 0, agent: "b3 (5:22 PM run)" }),
    refs.expert ? evaluate(refs.expert, { arm: "reference", round: 0, agent: "expert prompt" }) : Promise.resolve(null),
  ]);
  checkErrorRate("Round 0", [{ results: root.scenarios }, { results: b3.scenarios }]);
  floor = root.metrics.escalation_recall;
  root.qualified = true;
  b3.qualified = b3.metrics.escalation_recall >= floor;
  if (expertTrain) expertTrain.qualified = expertTrain.metrics.escalation_recall >= floor;
  printHeader();
  printRow("0", root.id, root.metrics, settingsStr(root.settings));
  printRow("ref", `b3 (recorded ${refs.b3.recorded_train ?? "?"})`, b3.metrics, settingsStr(b3.settings));
  if (expertTrain) printRow("ref", expertTrain.id, expertTrain.metrics, settingsStr(expertTrain.settings));

  // Both arms at once, sharing the call pool.
  const [A, B] = await Promise.all([runMulti(root), runSingle(root)]);

  // Selection: best training score across all runs, never test.
  const finalists = [
    { label: "A · multi-agent best", e: A.best },
    { label: "B · single-agent best", e: B.best },
    { label: "b3 (5:22 PM run, re-scored)", e: b3 },
  ];
  const eligible = finalists.filter((f) => f.e.qualified);
  const winner = (eligible.length ? eligible : finalists).reduce((a, f) => (better(f.e, a.e) ? f : a));
  console.log(`\nSelection (best training score across all runs, never test): ${winner.e.id} — ${winner.label}, train ${winner.e.score}/${winner.e.metrics.max_score}`);

  // Test: generic, each run's best, b3, expert. Each distinct strategy is scored once.
  const toTest = new Map<string, Strategy>([
    [root.id, root],
    [A.best.id, A.best],
    [B.best.id, B.best],
    [b3.id, b3],
    ...(refs.expert ? ([[refs.expert.id, refs.expert]] as [string, Strategy][]) : []),
  ]);
  console.log(`Scoring ${[...toTest.keys()].join(", ")} on ${test.length} test scenarios…`);
  const testRuns = new Map(await Promise.all([...toTest].map(async ([id, st]) => [id, await runStrategy(st, test)] as const)));
  checkErrorRate("Test", [...testRuns.values()]);

  const rows = [
    { key: "generic", label: "Generic prompt (round 0)", trainE: root },
    { key: "multi", label: "A · multi-agent best", trainE: A.best },
    { key: "single", label: "B · single-agent best", trainE: B.best },
    { key: "b3", label: "b3 (5:22 PM run)", trainE: b3 },
    ...(expertTrain ? [{ key: "expert", label: "Expert prompt", trainE: expertTrain }] : []),
  ];
  const subsOf = (trainRes: ScenarioResult[], testRes: ScenarioResult[]) => ({
    train: sub(trainRes),
    train_hard: sub(trainRes, hard),
    test20: sub(testRes),
    test20_hard: sub(testRes, hard),
    test10: sub(testRes, t10),
    test10_hard: sub(testRes, (r) => hard(r) && t10(r)),
  });
  const base = subsOf(root.scenarios, testRuns.get(root.id)!.results);
  const report = rows.map((r) => {
    const s = subsOf(r.trainE.scenarios, testRuns.get(r.trainE.id)!.results);
    return {
      key: r.key,
      label: r.label,
      id: r.trainE.id,
      selected: r.trainE === winner.e,
      subsets: Object.fromEntries(Object.entries(s).map(([k, v]) => [k, { ...v, error_reduction: r.key === "generic" ? null : reduction(base[k as keyof typeof base], v) }])) as Record<string, Sub & { error_reduction: number | null }>,
      test_metrics: testRuns.get(r.trainE.id)!.metrics,
    };
  });

  const cols = ["train", "train_hard", "test20", "test20_hard", "test10", "test10_hard"] as const;
  console.log(`\nScore and relative error reduction vs. generic (errors = points lost) · ★ = selected by training score`);
  console.log(`${"strategy".padEnd(40)}${cols.map((c) => c.padStart(17)).join("")}`);
  for (const r of report) {
    const cells = cols.map((c) => `${fmtSub(r.subsets[c])} ${fmtRed(r.subsets[c].error_reduction)}`.trim().padStart(17));
    console.log(`${`${r.selected ? "★ " : "  "}${r.label} (${r.id})`.slice(0, 39).padEnd(40)}${cells.join("")}`);
  }
  printHeader("set", "strategy");
  for (const r of report) printRow("test20", r.id, r.test_metrics);

  console.log("\nBest so far vs. candidates and time (candidates@seconds→best)");
  for (const [name, arm] of [["A multi-agent", A], ["B single agent", B]] as const) {
    console.log(`  ${name}: ${arm.trace.map((p) => `${p.candidates}@${Math.round(p.seconds)}s→${p.best_score}`).join("  ")}  (arm total ${Math.round(arm.seconds)} s)`);
  }
  console.log("\nWins per agent in A (round wins / became new best)");
  for (const [n, w] of Object.entries(A.wins)) console.log(`  ${n.padEnd(20)} ${w.round_wins} / ${w.new_best}`);

  const out = {
    generated_at: new Date().toISOString(),
    dry_run: DRY,
    config: {
      train: train.length,
      test: test.length,
      test10: test.filter((s) => TEST10.has(s.id)).length,
      rounds_a: ROUNDS,
      rounds_a_run: A.rounds_run,
      candidates_b: SINGLE_CANDIDATES,
      candidates_b_run: B.candidates.length,
      concurrency_shared: 5,
      seed: SEED,
      deadline: DEADLINE ? new Date(DEADLINE).toISOString() : null,
    },
    selection_rule: "Final strategy = best training score across all runs (A's best, B's best, b3 re-scored); never chosen by test.",
    selected: { id: winner.e.id, label: winner.label, arm: winner.e.arm, train_score: winner.e.score, train_max: winner.e.metrics.max_score, prompt: winner.e.prompt, settings: winner.e.settings },
    train_scenarios: train.map((s) => s.id),
    test_scenarios: test.map((s) => s.id),
    test10_scenarios: test.map((s) => s.id).filter((id) => TEST10.has(id)),
    explorers: EXPLORERS.map((e) => ({ key: e.key, name: e.name, specialty: e.specialty })),
    round0: entry(root),
    references: { b3: { ...entry(b3), recorded_train_score: refs.b3.recorded_train }, expert: expertTrain ? entry(expertTrain) : null },
    multi_agent: { best_id: A.best.id, rounds: A.rounds, wins: A.wins, trace: A.trace, seconds: A.seconds, agent_seconds: A.agent_seconds, rounds_dropped: A.rounds_dropped },
    single_agent: { best_id: B.best.id, candidates: B.candidates, trace: B.trace, seconds: B.seconds, agent_seconds: B.agent_seconds, failed_agent_calls: B.failed_agent_calls, stopped_at: B.stopped_at },
    test: Object.fromEntries([...testRuns].map(([id, run]) => [id, { id, score: run.metrics.score, metrics: run.metrics, scenarios: run.results.map(compactScenario) }])),
    report,
    total_seconds: r3((Date.now() - started) / 1000),
  };
  writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + "\n");
  console.log(`\nSaved ${shown(OUT_FILE)} · ${Math.round((Date.now() - started) / 1000)} s total`);
}

main().catch((err) => {
  if (err instanceof AbortRun) console.error(`\n✗ ${err.message}`);
  else console.error(err);
  process.exitCode = 1;
});
