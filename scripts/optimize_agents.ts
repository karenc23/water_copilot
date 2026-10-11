// Multi-agent prompt optimizer: three specialist Explorers propose in parallel, the Judge scores,
// and a Critic writes a shared lesson for the next round.
//
// Usage: npm run optimize:agents                       (20 train scenarios, 3 rounds, all test scenarios)
//        npx tsx scripts/optimize_agents.ts --dry       (3 train, 1 round, 3 test, writes to the temp folder)
//        flags: --train N --rounds N --test N --out FILE
//
// Same scenarios, splits, pipeline, Judge and scoring as scripts/optimize.ts (via scripts/lib/optimizer-core.ts).
//
// Round 0 scores the generic prompt. Then each round:
//   1. Three Explorers (separate DeepSeek calls, in parallel), each with a fixed specialty, get the
//      current best strategy, the failures relevant to their specialty and the Critic's latest
//      lesson, and each write a new strategy with a one-line rationale.
//   2. All three are scored in parallel on the training scenarios.
//   3. The Critic reads every result and writes a short shared lesson for the next round.
//   4. Elitism: the best strategy overall (including the previous best) carries forward.
// At the end the generic baseline and the final best are scored on the test scenarios.
// Output: data/results_agents.json (or --out), plus tables on stdout.
import { writeFileSync } from "node:fs";
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
const SEED = 42;
const FAILURES_PER_EXPLORER = 5;
// A dry run writes to the temp folder so it can never be mistaken for a real result.
const OUT_FILE = strFlag("--out") ? path.resolve(strFlag("--out")!) : DRY ? path.join(tmpdir(), "results_agents_dry.json") : path.join(DATA_DIR, "results_agents.json");

/** Repo-relative when inside the repo, absolute otherwise. */
const shown = (f: string) => (f.startsWith(process.cwd()) ? path.relative(process.cwd(), f) : f);

const train = stratified(allTrain, intFlag("--train") ?? (DRY ? 3 : 20));
const test = stratified(allTest, intFlag("--test") ?? (DRY ? 3 : undefined));

// ---------------------------------------------------------------------------
// Explorers
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
  const near = (v: number, limit: number) => Math.abs(v - limit) <= Math.abs(limit) * 0.2;
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

const explorerSystem = (ex: Explorer) => `${AGENT_CONTEXT}

You are the ${ex.name}, one of three Explorers working in parallel on the same CURRENT BEST strategy. Your specialty:
${ex.specialty}

You'll see the current best strategy, its FAILURES that fall in your specialty (expected vs. actual), and the Critic's LESSON from the last round. Write ONE new strategy that fixes failures in your specialty without breaking what already works.

Reply with ONLY JSON:
{"rationale": string (ONE line: what you changed and why), "targets": [ids of the FAILURES this should fix], "prompt": string (the full new prompt), "settings": {"context_order": string, "max_steps": number, "reasoning_effort": string}}`;

const CRITIC_SYSTEM = `${AGENT_CONTEXT}

You are the Critic. Three Explorers (Threshold, Words, History) each proposed a strategy this round and the Judge scored them. You see each Explorer's rationale, score change versus the current best, and which scenarios it fixed and broke.

Write a short shared LESSON (at most 3 sentences) for all Explorers next round: what worked, what broke, and what to try or avoid. Be concrete and general — no scenario ids.

Reply with ONLY JSON: {"lesson": string}`;

// ---------------------------------------------------------------------------
// Types and helpers
// ---------------------------------------------------------------------------

interface Evaluated extends Strategy {
  round: number;
  score: number;
  metrics: Metrics;
  qualified: boolean;
  scenarios: ScenarioResult[];
  explorer?: Explorer["key"];
  targets?: string[];
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

/** Failures (then imperfect passes) relevant to the Explorer's specialty; the overall worst if none are. */
function failuresFor(ex: Explorer, best: Evaluated): { results: ScenarioResult[]; general: boolean } {
  const ranked = [
    ...best.scenarios.filter((r) => !passed(r)).sort((a, b) => gap(a) - gap(b)),
    ...best.scenarios.filter((r) => passed(r) && r.score < r.max).sort((a, b) => gap(a) - gap(b)),
  ];
  const mine = ranked.filter((r) => ex.relevant(scenarioById.get(r.id)!, r));
  return mine.length ? { results: mine.slice(0, FAILURES_PER_EXPLORER), general: false } : { results: ranked.slice(0, FAILURES_PER_EXPLORER), general: true };
}

/** Scenarios the current best failed that the candidate passes, and vice versa. */
function fixedBroken(base: Evaluated, cand: Evaluated) {
  const before = new Set(base.scenarios.filter(passed).map((r) => r.id));
  const now = new Set(cand.scenarios.filter(passed).map((r) => r.id));
  return {
    fixed: cand.scenarios.filter((r) => now.has(r.id) && !before.has(r.id)).map((r) => r.id),
    broken: base.scenarios.filter((r) => before.has(r.id) && !now.has(r.id)).map((r) => r.id),
  };
}

async function evaluate(st: Strategy, round: number, floor: number, extra: Partial<Evaluated> = {}): Promise<Evaluated> {
  const run = await runStrategy(st, train);
  return { ...st, ...extra, round, score: run.metrics.score, metrics: run.metrics, qualified: run.metrics.escalation_recall >= floor, scenarios: run.results };
}

async function propose(ex: Explorer, best: Evaluated, lesson: string | null, round: number): Promise<{ strategy: Strategy; targets: string[]; general: boolean } | { error: string }> {
  const { results, general } = failuresFor(ex, best);
  const user = JSON.stringify(
    {
      current_best: { id: best.id, prompt: best.prompt, settings: best.settings, score: `${best.score}/${best.metrics.max_score}`, metrics: best.metrics },
      failures: results.map(describe),
      failures_note: general ? "None of the current failures fall clearly in your specialty; these are the overall weakest." : undefined,
      critic_lesson: lesson ?? "(none yet: this is the first round)",
      failure_modes: FAILURE_MODE_LIST,
    },
    null,
    1,
  );
  try {
    const o = asObj(await agentJSON(explorerSystem(ex), user, SEED + round * 10 + EXPLORERS.indexOf(ex)));
    if (!o || typeof o.prompt !== "string" || o.prompt.trim().length < 50) return { error: "no usable prompt in the reply" };
    const settings = parseSettings(o.settings);
    if (!settings) return { error: `invalid settings ${JSON.stringify(o.settings)}` };
    const shown = new Set(results.map((r) => r.id));
    const targets = [...new Set((Array.isArray(o.targets) ? o.targets : []).map(String))].filter((t) => shown.has(t));
    const rationale = typeof o.rationale === "string" && o.rationale.trim() ? o.rationale.trim().split("\n")[0] : "(no rationale given)";
    return { strategy: { id: `r${round}-${ex.key}`, prompt: o.prompt.trim(), settings, rationale }, targets, general };
  } catch (err) {
    return { error: String(err).slice(0, 200) };
  }
}

async function critique(best: Evaluated, rows: { ex: Explorer; cand: Evaluated | null; fixed: string[]; broken: string[]; error?: string }[], lesson: string | null, round: number) {
  const user = JSON.stringify(
    {
      current_best: { id: best.id, score: `${best.score}/${best.metrics.max_score}` },
      previous_lesson: lesson,
      explorers: rows.map((r) => ({
        explorer: r.ex.name,
        rationale: r.cand?.rationale ?? null,
        score: r.cand ? `${r.cand.score}/${r.cand.metrics.max_score}` : null,
        change_vs_best: r.cand ? r.cand.score - best.score : null,
        escalation_recall: r.cand?.metrics.escalation_recall ?? null,
        false_alarms: r.cand?.metrics.false_alarms ?? null,
        fixed: r.fixed.map((id) => describe(r.cand!.scenarios.find((x) => x.id === id)!)).map((d) => ({ id: d.id, description: d.description, expected: d.expected })),
        broken: r.broken.map((id) => describe(r.cand!.scenarios.find((x) => x.id === id)!)).map((d) => ({ id: d.id, description: d.description, expected: d.expected, actual: d.actual })),
        error: r.error,
      })),
    },
    null,
    1,
  );
  try {
    const o = asObj(await agentJSON(CRITIC_SYSTEM, user, SEED + round * 10 + 9, 600));
    return typeof o?.lesson === "string" && o.lesson.trim() ? { lesson: o.lesson.trim() } : { lesson: null, error: "no lesson in the reply" };
  } catch (err) {
    return { lesson: null, error: String(err).slice(0, 200) };
  }
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
const fmtSub = (s: Sub) => `${s.score}/${s.max} (${s.pct}%)`;
const fmtPct = (x: number | null) => (x === null ? "n/a" : `${x >= 0 ? "−" : "+"}${Math.abs(Math.round(x * 100))}% errors`);
const hard = (r: ScenarioResult) => r.difficulty === "hard";

const entry = (e: Evaluated) => ({
  id: e.id,
  score: e.score,
  metrics: e.metrics,
  qualified: e.qualified,
  prompt: e.prompt,
  settings: e.settings,
  rationale: e.rationale ?? null,
  scenarios: e.scenarios.map(compactScenario),
});

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const started = Date.now();
  console.log(
    `Multi-agent optimizer${DRY ? " (DRY RUN)" : ""}: ${train.length} train scenarios, ${ROUNDS} round(s), 3 Explorers per round, ` +
      `${test.length} test scenarios → ${shown(OUT_FILE)}`,
  );

  // Round 0: the generic prompt.
  const root = await evaluate(GENERIC_STRATEGY, 0, 0);
  checkErrorRate("Round 0", [{ results: root.scenarios }]);
  const floor = root.metrics.escalation_recall; // never accept a strategy that catches less danger than the start
  root.qualified = true;
  printHeader();
  printRow("0", root.id, root.metrics, settingsStr(root.settings));

  let best = root;
  let lesson: string | null = null;
  const rounds: object[] = [];
  const wins: Record<string, { round_wins: number; new_best: number }> = Object.fromEntries(EXPLORERS.map((e) => [e.name, { round_wins: 0, new_best: 0 }]));

  for (let round = 1; round <= ROUNDS; round++) {
    const roundStart = Date.now();
    const parent = best;
    // 1. Explorers propose in parallel. 2. Each proposal is scored as soon as it arrives (also in parallel).
    const rows = await Promise.all(
      EXPLORERS.map(async (ex) => {
        const p = await propose(ex, parent, lesson, round);
        if ("error" in p) return { ex, cand: null, targets: [] as string[], general: false, fixed: [] as string[], broken: [] as string[], error: p.error };
        const cand = await evaluate(p.strategy, round, floor, { explorer: ex.key, targets: p.targets });
        const fb = fixedBroken(parent, cand);
        return { ex, cand, targets: p.targets, general: p.general, ...fb, error: undefined as string | undefined };
      }),
    );
    const scored = rows.filter((r) => r.cand) as (typeof rows[number] & { cand: Evaluated })[];
    checkErrorRate(`Round ${round}`, scored.map((r) => ({ results: r.cand.scenarios })));
    if (!scored.length) console.log(`round ${round}: no Explorer produced a usable strategy.`);

    // 3. Critic writes the shared lesson.
    const critic = await critique(parent, rows, lesson, round);
    if (critic.lesson) lesson = critic.lesson;

    // 4. Elitism: best overall carries forward. Round winner = best qualified proposal this round.
    const qualified = scored.filter((r) => r.cand.qualified);
    const roundWinner = qualified.reduce<(typeof scored)[number] | null>((a, r) => (!a || better(r.cand, a.cand) ? r : a), null);
    const improved = !!roundWinner && better(roundWinner.cand, parent);
    if (roundWinner) wins[roundWinner.ex.name].round_wins++;
    if (improved) {
      best = roundWinner!.cand;
      wins[roundWinner!.ex.name].new_best++;
    }

    for (const r of rows) {
      if (!r.cand) {
        console.log(`${String(round).padEnd(7)}${r.ex.name.padEnd(28)}  failed: ${r.error}`);
        continue;
      }
      const mark = [r.cand.qualified ? "" : "DQ (recall)", r === roundWinner ? (improved ? "★ new best" : "round winner (not better than best)") : ""].filter(Boolean).join(" ");
      printRow(String(round), `${r.ex.name}`, r.cand.metrics, `${settingsStr(r.cand.settings)}${mark ? `  ${mark}` : ""}`);
      console.log(`       ↳ ${r.cand.rationale}`);
      console.log(`       ↳ fixed [${r.fixed.join(", ")}] · broken [${r.broken.join(", ")}]${r.general ? " · (no failures in its specialty; got the overall worst)" : ""}`);
    }
    console.log(`       Critic lesson: ${critic.lesson ?? `(none: ${critic.error})`}`);

    rounds.push({
      round,
      best_before: { id: parent.id, score: parent.score },
      explorers: rows.map((r) => ({
        explorer: r.ex.name,
        key: r.ex.key,
        error: r.error ?? null,
        targets: r.targets,
        general_failures: r.general,
        fixed: r.fixed,
        broken: r.broken,
        strategy: r.cand ? entry(r.cand) : null,
      })),
      critic_lesson: critic.lesson,
      critic_error: critic.error ?? null,
      winner: roundWinner?.ex.name ?? null,
      winner_id: roundWinner?.cand.id ?? null,
      improved_best: improved,
      best_after: { id: best.id, score: best.score },
      seconds: r3((Date.now() - roundStart) / 1000),
    });
  }

  // Final: generic baseline vs final best on the test scenarios.
  console.log(`\nScoring the generic baseline and ${best.id} on ${test.length} test scenarios…`);
  const [baseTest, bestTest] = await Promise.all([runStrategy(GENERIC_STRATEGY, test), runStrategy(best, test)]);
  checkErrorRate("Test", [baseTest, bestTest]);

  const report = {
    train: { baseline: sub(root.scenarios), final: sub(best.scenarios) },
    test: { baseline: sub(baseTest.results), final: sub(bestTest.results) },
    train_hard: { baseline: sub(root.scenarios, hard), final: sub(best.scenarios, hard) },
    test_hard: { baseline: sub(baseTest.results, hard), final: sub(bestTest.results, hard) },
  };
  const withReduction = Object.fromEntries(Object.entries(report).map(([k, v]) => [k, { ...v, error_reduction: reduction(v.baseline, v.final) }]));

  printHeader("set", "strategy");
  printRow("test", "baseline: r0-generic", baseTest.metrics);
  printRow("test", `final: ${best.id}`, bestTest.metrics);

  console.log("\nBaseline → final (relative error reduction; errors = points lost)");
  console.log(`${"subset".padEnd(12)}${"n".padStart(4)}  ${"baseline".padEnd(18)}${"final".padEnd(18)}change`);
  for (const [k, v] of Object.entries(withReduction)) {
    console.log(`${k.padEnd(12)}${String(v.baseline.n).padStart(4)}  ${fmtSub(v.baseline).padEnd(18)}${fmtSub(v.final).padEnd(18)}${fmtPct(v.error_reduction)}`);
  }
  console.log("\nWins per Explorer (round wins / became new best)");
  for (const [name, w] of Object.entries(wins)) console.log(`  ${name.padEnd(20)} ${w.round_wins} / ${w.new_best}`);

  const out = {
    generated_at: new Date().toISOString(),
    dry_run: DRY,
    config: { train: train.length, test: test.length, rounds: ROUNDS, explorers_per_round: EXPLORERS.length, seed: SEED, failures_per_explorer: FAILURES_PER_EXPLORER },
    train_scenarios: train.map((s) => s.id),
    test_scenarios: test.map((s) => s.id),
    explorers: EXPLORERS.map((e) => ({ key: e.key, name: e.name, specialty: e.specialty })),
    round0: entry(root),
    rounds,
    best_strategy: { ...entry(best), round: best.round, explorer: best.explorer ?? null },
    test: {
      baseline: { id: root.id, score: baseTest.metrics.score, metrics: baseTest.metrics, scenarios: baseTest.results.map(compactScenario) },
      final: { id: best.id, score: bestTest.metrics.score, metrics: bestTest.metrics, scenarios: bestTest.results.map(compactScenario) },
    },
    report: withReduction,
    wins,
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
