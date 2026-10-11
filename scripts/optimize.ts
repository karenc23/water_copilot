// Prompt/settings optimizer for the troubleshoot pipeline (rules → LLM → safety).
//
// Usage: npx tsx scripts/optimize.ts          (40 train scenarios, 4 rounds, 20 test)
//        npx tsx scripts/optimize.ts --quick  (5 hard train scenarios, 1 round)
//        npx tsx scripts/optimize.ts --train 20 --rounds 3 --test 10
//          (subsets are stratified by difficulty and escalation, so the mix stays the same)
//        npx tsx scripts/optimize.ts --rescore-test
//          (no rounds: re-score baselines, best expert and r3-s1 from results.json on all test scenarios)
//
// Round 0 scores one deliberately generic strategy on data/scenarios_train.json.
// Each later round asks a critic LLM call for 3 new strategies, based on the current
// best strategy's 5 worst-scored scenarios. Three hand-written strategies are scored
// alongside as an "expert reference" but are never candidates for best.
// data/scenarios_test.json is only used at the end, for the final comparison.
// Results go to data/results.json (data/results_quick.json with --quick).
import "dotenv/config"; // load .env before anything reads process.env
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { APIConnectionError } from "openai";
import {
  DEFAULT_INSTRUCTIONS,
  FAILURE_MODE_LIST,
  MAX_STEPS,
  type ContextOrder,
  type ReasoningEffort,
  type TroubleshootResult,
} from "@/lib/agents";
import { chatJSON, extractLastJSONObject, getLLM, LLMParseError, stripReasoning } from "@/lib/llm";
import { latestDate, runTroubleshoot } from "@/lib/pipeline";
import { checkLogs, checkReadings, FAILURE_MODES, maxTier, type Alert, type Tier } from "@/lib/rules";
import { finalTier } from "@/lib/safety";
import type { Scenario } from "@/types";

process.env.LLM_LOG = "off"; // thousands of calls; this script prints its own table

const QUICK = process.argv.includes("--quick");
function intFlag(name: string): number | undefined {
  const i = process.argv.indexOf(name);
  const v = i === -1 ? NaN : Number(process.argv[i + 1]);
  return Number.isInteger(v) && v > 0 ? v : undefined;
}
function strFlag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}
const SEED = 42; // critic sampling seed; the splits are deterministic
let ROUNDS_A = intFlag("--rounds-a") ?? (QUICK ? 1 : 3); // A: parallel, LANES.length candidates per round
let ROUNDS_B = intFlag("--rounds-b") ?? (QUICK ? 3 : 9); // B: single agent, 1 candidate per round
const BUDGET_MIN = intFlag("--budget-min") ?? 30;
const SPEEDUP_N = 5; // scenarios used to measure concurrent vs one-at-a-time evaluation
const CONCURRENCY = 5;
const MAX_ERROR_RATE = 0.3; // abort if more than this share of a phase's calls error
const CRITIC_WORST = 5; // scenarios shown to the critic each round
const QUICK_IDS = ["train-21", "train-24", "train-27", "train-28", "train-30"]; // hard mix, 3 escalate
const DATA_DIR = path.join(process.cwd(), "data");
// Written to results_v2.json and copied over results.json only once the run completes.
const OUT_FILE = strFlag("--out") ? path.resolve(strFlag("--out")!) : path.join(DATA_DIR, QUICK ? "results_quick.json" : "results_v2.json");
const COPY_TO_RESULTS = !QUICK && !strFlag("--out");

const manual = readFileSync(path.join(DATA_DIR, "manual.md"), "utf8");
const allTrain: Scenario[] = JSON.parse(readFileSync(path.join(DATA_DIR, "scenarios_train.json"), "utf8"));
const allTest: Scenario[] = JSON.parse(readFileSync(path.join(DATA_DIR, "scenarios_test.json"), "utf8"));

/**
 * Deterministic subset of n scenarios that keeps the same share of each
 * (difficulty, escalate) group as the full set (largest-remainder allocation).
 */
function stratified(scenarios: Scenario[], n: number | undefined): Scenario[] {
  if (!n || n >= scenarios.length) return scenarios;
  const groups = new Map<string, Scenario[]>();
  for (const s of scenarios) {
    const key = `${s.difficulty ?? "standard"}/${s.expected.escalate}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const alloc = [...groups].map(([key, rows]) => {
    const exact = (rows.length * n) / scenarios.length;
    return { key, rows, take: Math.floor(exact), rem: exact - Math.floor(exact) };
  });
  let left = n - alloc.reduce((k, a) => k + a.take, 0);
  for (const a of [...alloc].sort((x, y) => y.rem - x.rem)) if (left-- > 0) a.take++;
  // Spread picks across each group (every k-th) rather than taking the first few.
  const picked = new Set(alloc.flatMap((a) => Array.from({ length: a.take }, (_, i) => a.rows[Math.floor((i * a.rows.length) / a.take)].id)));
  return scenarios.filter((s) => picked.has(s.id));
}

const train = QUICK ? allTrain.filter((s) => QUICK_IDS.includes(s.id)) : stratified(allTrain, intFlag("--train") ?? 20);
const test = stratified(allTest, intFlag("--test"));
/** The 10-scenario test set used by earlier runs (--test 10); reported as a subset of the full test run. */
const TEST10 = new Set(stratified(allTest, 10).map((s) => s.id));

// ---------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------

interface Settings {
  context_order: ContextOrder;
  max_steps: number;
  reasoning_effort: ReasoningEffort;
}

interface Strategy {
  id: string;
  prompt: string;
  settings: Settings;
  rationale?: string;
}

/** Round 0: deliberately weak. The critic has to discover everything else. */
const GENERIC_STRATEGY: Strategy = {
  id: "r0-generic",
  rationale: "Weak starting point: no domain rules.",
  prompt: "You are a helpful assistant for water plant operators. Answer the question.",
  settings: { context_order: "description_first", max_steps: 5, reasoning_effort: "none" },
};

/** Hand-written strategies. Reported as a reference row only — never candidates, never shown to the critic. */
const EXPERT_STRATEGIES: Strategy[] = [
  {
    id: "expert-current",
    rationale: "The prompt currently in production.",
    prompt: DEFAULT_INSTRUCTIONS,
    settings: { context_order: "description_first", max_steps: 5, reasoning_effort: "none" },
  },
  {
    id: "expert-escalation-checklist",
    rationale: "Spell out the manual's escalation triggers so the model checks each one.",
    prompt: `You are a troubleshooting assistant for operators at a small rural water treatment plant.

Use ONLY the MANUAL. Every step must cite the manual section number it comes from. Never state a chemical dose or amount that is not written in the manual.

Before answering, check every escalation trigger from manual Section 8.1 against the readings, alerts, logbook and description:
- chlorine below 0.2 or above 4.0 mg/L
- filtered turbidity above 1.0 NTU, or above 0.3 NTU after two backwashes
- pH below 6.5 or above 8.5
- distribution pressure below 20 psi, a main break, or a frozen/broken line
- circulation lost for more than 2 hours
- both duty and standby pumps failed
- the same problem 3 or more times in 30 days in the logbook, even if fixed each time
- anything else that could affect public health
If any trigger is met, set "health_risk": true and "escalate": true. Otherwise set both false — routine problems the manual tells the operator to fix (a backwash, a fresh batch, re-priming a pump) are not escalations.

Write a one-sentence diagnosis. Put the most important step first. Keep each step under 25 words.`,
    settings: { context_order: "readings_first", max_steps: 4, reasoning_effort: "none" },
  },
  {
    id: "expert-diagnose-carefully",
    rationale: "Focus on picking the right failure mode, with brief reasoning allowed.",
    prompt: `You help water plant operators diagnose problems using only their plant's MANUAL.

How to diagnose:
1. Read the logbook first: is this a repeat of an earlier problem? Three of the same problem in 30 days means escalate (Manual 8.1).
2. Decide whether the readings are real. A reading stuck at one value, or an online meter that disagrees with the bench meter, is an instrument problem, not a water problem.
3. Separate expected seasonal behavior (breakup, turnover) from real faults.
4. Match the situation to the failure mode whose description fits best.

Rules: cite a manual section number for every step; never give a dose or amount that isn't in the manual; if there is any possible health risk, set "health_risk" and "escalate" to true. One-sentence diagnosis, most important step first, each step under 25 words.`,
    settings: { context_order: "logbook_first", max_steps: 5, reasoning_effort: "low" },
  },
];

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

interface Output {
  escalate: boolean;
  tier: Tier | null;
  failure_mode: string | null;
  sections: string[];
  steps: string[];
  drops: number;
  alerts?: string[];
  warnings?: string[];
  error?: string;
}

interface ScenarioResult {
  id: string;
  difficulty: string;
  score: number;
  max: number;
  expected: { escalate: boolean; tier: Tier; failure_mode: string; key_steps: string[] };
  got: Output;
  covered: boolean[];
  judge_error?: string;
}

interface Metrics {
  score: number;
  max_score: number;
  hard_score: string;
  escalation_recall: number;
  false_alarm_rate: number;
  tier_accuracy: number;
  failure_mode_accuracy: number;
  key_step_coverage: number;
  missed_escalations: number;
  false_alarms: number;
  dropped_steps: number;
  errors: number;
  judge_errors: number;
  avg_seconds: number;
}

// Per scenario: escalate +3 / miss −6 / false alarm −2; exact tier +2; failure mode +2;
// any expected section cited +1; +1 per expected key step covered (LLM judge); −1 per dropped step.
const maxFor = (s: Scenario) => 3 + 2 + 2 + 1 + s.expected.key_steps.length;

const expectedSections = (s: Scenario) =>
  new Set(s.expected.key_steps.flatMap((k) => [...k.matchAll(/\(Manual ([\d., ]+)\)/g)].flatMap((m) => m[1].match(/\d+\.\d+/g) ?? [])));

/** An errored call counts as a failed scenario: wrong escalation either way, no other points. */
function scoreOne(s: Scenario, got: Output, covered: boolean[], judge_error?: string): ScenarioResult {
  const exp = s.expected.escalate;
  let score: number;
  if (got.error) {
    score = exp ? -6 : -2;
  } else {
    score = got.escalate === exp ? 3 : exp ? -6 : -2;
    if (got.tier === s.expected.tier) score += 2;
    if (got.failure_mode === s.expected.failure_mode) score += 2;
    const want = expectedSections(s);
    if (got.sections.some((x) => want.has(x))) score += 1;
    score += covered.filter(Boolean).length;
    score -= got.drops;
  }
  return {
    id: s.id,
    difficulty: s.difficulty ?? "standard",
    score,
    max: maxFor(s),
    expected: { escalate: exp, tier: s.expected.tier, failure_mode: s.expected.failure_mode, key_steps: s.expected.key_steps },
    got,
    covered,
    judge_error,
  };
}

// Errored scenarios stay in every denominator and count as wrong: a miss if it should
// have escalated, a false alarm if it shouldn't, wrong tier, wrong failure mode, no steps covered.
function metricsOf(results: ScenarioResult[], seconds: number[]): Metrics {
  const ok = results.filter((r) => !r.got.error);
  const pos = results.filter((r) => r.expected.escalate);
  const neg = results.filter((r) => !r.expected.escalate);
  const tp = pos.filter((r) => !r.got.error && r.got.escalate).length;
  const fp = neg.filter((r) => r.got.error || r.got.escalate).length;
  const hard = results.filter((r) => r.difficulty === "hard");
  const keySteps = results.reduce((n, r) => n + r.expected.key_steps.length, 0);
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  const frac = (n: number, d: number) => r3(d ? n / d : 0);
  return {
    score: results.reduce((n, r) => n + r.score, 0),
    max_score: results.reduce((n, r) => n + r.max, 0),
    hard_score: `${hard.reduce((n, r) => n + r.score, 0)}/${hard.reduce((n, r) => n + r.max, 0)}`,
    escalation_recall: pos.length ? frac(tp, pos.length) : 1,
    false_alarm_rate: frac(fp, neg.length),
    tier_accuracy: frac(ok.filter((r) => r.got.tier === r.expected.tier).length, results.length),
    failure_mode_accuracy: frac(ok.filter((r) => r.got.failure_mode === r.expected.failure_mode).length, results.length),
    key_step_coverage: frac(ok.reduce((n, r) => n + r.covered.filter(Boolean).length, 0), keySteps),
    missed_escalations: pos.length - tp,
    false_alarms: fp,
    dropped_steps: ok.reduce((n, r) => n + r.got.drops, 0),
    errors: results.length - ok.length,
    judge_errors: results.filter((r) => r.judge_error).length,
    avg_seconds: r3(seconds.length ? seconds.reduce((a, b) => a + b, 0) / seconds.length : 0),
  };
}

// ---------------------------------------------------------------------------
// Concurrency + retries
// ---------------------------------------------------------------------------

function createLimiter(max: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  const next = () => {
    if (active >= max || !queue.length) return;
    active++;
    queue.shift()!();
  };
  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => fn().then(resolve, reject).finally(() => { active--; next(); }));
      next();
    });
}
const limit = createLimiter(CONCURRENCY);

/** Rate limits, server errors, network errors and unparseable replies are worth retrying; config errors aren't. */
function isRetryable(err: unknown): boolean {
  const status = (err as { status?: number }).status;
  return status === 429 || (status !== undefined && status >= 500) || err instanceof APIConnectionError || err instanceof LLMParseError;
}

/** Retry with exponential backoff; on 429 wait at least as long as the server's retry-after. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 6): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts - 1 || !isRetryable(err)) throw err;
      const e = err as { status?: number; headers?: { get?: (k: string) => string | null } };
      const retryAfter = Number(e.headers?.get?.("retry-after")) * 1000 || 0;
      const backoff = Math.min(2000 * 2 ** i, 30_000) + Math.random() * 1000;
      await new Promise((r) => setTimeout(r, Math.max(retryAfter, backoff)));
    }
  }
}

// ---------------------------------------------------------------------------
// Key-step judge (DeepSeek)
// ---------------------------------------------------------------------------

const JUDGE_PROMPT = `You grade a water-plant troubleshooting assistant. For each EXPECTED key step, decide whether any of the assistant's ACTUAL steps gives substantially the same instruction (same action and intent; wording and citations don't matter). Being vaguer than the expected step, or only partly covering it, counts as not covered.

Reply with ONLY JSON: {"covered": [true/false, ...]} with exactly one entry per expected step, in order.`;

const judgeCache = new Map<string, Promise<boolean[]>>();

function judge(expected: string[], actual: string[]): Promise<boolean[]> {
  if (!actual.length) return Promise.resolve(expected.map(() => false));
  const key = JSON.stringify([expected, actual]);
  let p = judgeCache.get(key);
  if (!p) {
    const user = `EXPECTED:\n${expected.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\nACTUAL:\n${actual.map((s, i) => `${i + 1}. ${s}`).join("\n")}`;
    p = limit(() =>
      withRetry(async () => {
        const raw = (await chatJSON(
          [
            { role: "system", content: JUDGE_PROMPT },
            { role: "user", content: user },
          ],
          { max_tokens: 200, reasoning_effort: "none" },
        )) as { covered?: unknown };
        const c = raw?.covered;
        if (!Array.isArray(c) || c.length !== expected.length) throw new LLMParseError("judge returned wrong shape", JSON.stringify(raw));
        return c.map((x) => x === true);
      }),
    );
    judgeCache.set(key, p);
    p.catch(() => judgeCache.delete(key));
  }
  return p;
}

/** Run fn on every scenario (≤ CONCURRENCY LLM calls at once, retried), timing each call, then judge key steps. */
async function runAll(scenarios: Scenario[], fn: (s: Scenario) => Promise<Output>) {
  const seconds: number[] = [];
  const results = await Promise.all(
    scenarios.map(async (s) => {
      const got = await limit(async () => {
        const started = Date.now();
        try {
          return await withRetry(() => fn(s));
        } catch (err) {
          return { escalate: false, tier: null, failure_mode: null, sections: [], steps: [], drops: 0, error: String(err).slice(0, 200) } as Output;
        } finally {
          seconds.push((Date.now() - started) / 1000);
        }
      });
      if (got.error) return scoreOne(s, got, s.expected.key_steps.map(() => false));
      try {
        return scoreOne(s, got, await judge(s.expected.key_steps, got.steps));
      } catch (err) {
        return scoreOne(s, got, s.expected.key_steps.map(() => false), String(err).slice(0, 200));
      }
    }),
  );
  return { results, metrics: metricsOf(results, seconds) };
}

// ---------------------------------------------------------------------------
// Runners: strategy (full pipeline), plain LLM, rules only
// ---------------------------------------------------------------------------

const inputOf = (s: Scenario) => ({
  plant_id: s.readings[0]?.plant_id ?? "plant-a",
  description: s.description,
  readings: s.readings,
  logs: s.log_history,
  manualText: manual,
});

function runStrategy(st: Strategy, scenarios: Scenario[]) {
  return runAll(scenarios, async (s) => {
    const r = await runTroubleshoot(inputOf(s), {
      instructions: st.prompt,
      contextOrder: st.settings.context_order,
      maxSteps: st.settings.max_steps,
      reasoningEffort: st.settings.reasoning_effort,
    });
    return {
      escalate: r.escalate,
      tier: r.tier,
      failure_mode: r.failure_mode,
      sections: r.steps.map((x) => x.manual_section),
      steps: r.steps.map((x) => `${x.action} (Manual ${x.manual_section})`),
      drops: r.safety_drops.invalid_citation + r.safety_drops.dose,
      alerts: r.alerts.map((a) => a.rule_id),
      warnings: r.warnings,
    };
  });
}

const PLAIN_PROMPT = `You help water treatment plant operators. Given the operator's problem, reply with ONLY a JSON object:
{"diagnosis": string, "failure_mode": string, "tier": "green" | "yellow" | "red", "steps": [{"action": string, "manual_section": string}], "escalate": boolean}
tier: green = normal, yellow = operator should act, red = escalate to a supervisor now. Cite a manual section number for each step if you can. Choose "failure_mode" from:
${FAILURE_MODES.map((f) => `${f.id} ${f.name}`).join("\n")}`;

/** Baseline (a): description only — no readings, logs, manual, rules or safety layer. */
function runPlainLLM(scenarios: Scenario[]) {
  return runAll(scenarios, async (s) => {
    const raw = (await chatJSON(
      [
        { role: "system", content: PLAIN_PROMPT },
        { role: "user", content: s.description },
      ],
      { max_tokens: 700, reasoning_effort: "none" },
    )) as Record<string, unknown>;
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.steps)) throw new LLMParseError("bad JSON shape", JSON.stringify(raw));
    const steps = (raw.steps as { action?: unknown; manual_section?: unknown }[]).map((x) => ({
      action: String(x?.action ?? ""),
      manual_section: String(x?.manual_section ?? "").match(/\d+(?:\.\d+)+/)?.[0] ?? null,
    }));
    const llm: TroubleshootResult = {
      diagnosis: String(raw.diagnosis ?? ""),
      failure_mode: String(raw.failure_mode ?? "").toUpperCase().match(/F\d+/)?.[0] ?? null,
      steps,
      escalate: raw.escalate === true,
      health_risk: false,
      warnings: [],
    };
    const tier = (["green", "yellow", "red"] as const).find((t) => t === raw.tier) ?? null;
    // The safety layer is NOT applied: only used to count steps it would have dropped.
    const measured = finalTier({ ...llm, escalate: false }, [], manual);
    return {
      escalate: llm.escalate,
      tier,
      failure_mode: llm.failure_mode,
      sections: steps.map((x) => x.manual_section).filter((x): x is string => !!x),
      steps: steps.map((x) => `${x.action}${x.manual_section ? ` (Manual ${x.manual_section})` : ""}`),
      drops: measured.dropped.invalid_citation + measured.dropped.dose,
    };
  });
}

/** Map rule alerts to a failure mode for the rules-only baseline. */
function failureModeFromAlerts(alerts: Alert[]): string {
  const top = alerts.find((a) => a.tier === "red") ?? alerts[0];
  if (!top) return "F1";
  const byRule: Record<string, string> = {
    CL_CRITICAL_LOW: "F5", CL_LOW: "F4", CL_FALLING: "F4", CL_HIGH: "F6", CL_CRITICAL_HIGH: "F6",
    TURB_CRITICAL: "F7", TURB_HIGH: "F2", TURB_RISING: "F2", PH_CRITICAL: "F9", PH_LOW: "F9", PH_HIGH: "F9",
    LOG_BACKWASH_FAILED: "F3",
  };
  if (top.rule_id === "LOG_RECURRING") {
    const cat = top.message.match(/Same (\S+) problem/)?.[1];
    return ({ filter: "F3", chlorine: "F4", circulation: "F10", pH: "F9", pressure: "F13", pump: "F12" } as Record<string, string>)[cat ?? ""] ?? "F1";
  }
  return byRule[top.rule_id] ?? "F1";
}

/** Baseline (b): rules only, no LLM. Tier from alerts; steps are the alert messages with their sections. */
function runRulesOnly(scenarios: Scenario[]) {
  return runAll(scenarios, async (s) => {
    const alerts = [...checkReadings(s.readings), ...checkLogs(s.log_history, latestDate(s.readings, s.log_history))];
    const tier = maxTier(...alerts.map((a) => a.tier));
    return {
      escalate: tier === "red",
      tier,
      failure_mode: failureModeFromAlerts(alerts),
      sections: [...new Set(alerts.map((a) => a.manual_section))],
      steps: [
        ...(tier === "red" ? ["Contact your Remote Maintenance Worker now"] : []),
        ...alerts.map((a) => `${a.message} — see Manual ${a.manual_section}`),
      ],
      drops: 0,
      alerts: alerts.map((a) => a.rule_id),
    };
  });
}

// ---------------------------------------------------------------------------
// Critic agents: each child tests ONE hypothesis and records its lineage
// ---------------------------------------------------------------------------

const CRITIC_CONTEXT = `You improve the system prompt and settings of a water-treatment troubleshooting assistant for operators at a small rural Alaska plant.

The assistant runs inside a pipeline: deterministic rules flag readings → the LLM (your prompt) → a safety layer. The safety layer takes the highest of the rule tier, the chosen failure mode's tier, and the LLM's escalate/health_risk flags, so the LLM can raise the tier but never lower it. It drops steps whose manual section doesn't exist and removes doses not in the manual. The user message the LLM sees contains the operator's description, recent readings, logbook entries, automated alerts, and the full plant MANUAL.

Code ALWAYS appends to your prompt: the step limit, the list of failure modes (ids, tiers, descriptions), and the exact JSON output format (diagnosis, failure_mode, steps with manual_section, health_risk, escalate). Do NOT include a JSON schema or the failure-mode list in your prompt.

Final tier: red if escalated, otherwise yellow if any alert or the failure mode is yellow, otherwise green.

Scoring per scenario: +3 escalate correct, −6 missed escalation, −2 false alarm; +2 exact tier; +2 correct failure_mode; +1 if any cited section matches the expected ones; +1 per expected key step the answer covers (judged by an LLM); −1 per step dropped by the safety layer. Missing an escalation is the worst outcome, but false alarms also cost points. A scenario PASSES when escalate, tier and failure_mode are all correct.

Every prompt you write must keep these rules: use only the manual; cite a manual section number for every step; never invent chemical doses; escalate any possible health risk. Generalize from the failures — don't hard-code scenario details.

Settings:
- context_order: "description_first" | "readings_first" | "logbook_first"
- max_steps: integer 2–${MAX_STEPS}
- reasoning_effort: "none" (700-token cap) or "low" (brief reasoning, 1,500-token cap)

You'll see the PARENT strategy and up to ${CRITIC_WORST} of its weakest training scenarios (FAILURES), expected vs. actual, with whether each passed.`;

interface Lane {
  key: "thresholds" | "operator_words" | "logbook";
  hypothesis: string;
  context_order: ContextOrder;
  reasoning_effort: ReasoningEffort;
}

/** Arm A's three agents: one hypothesis each, and different settings so the children differ in more than wording. */
const LANES: Lane[] = [
  {
    key: "thresholds",
    hypothesis:
      "Threshold and count discipline: failures come from not applying the manual's numeric limits and counts exactly (chlorine 0.2/4.0 mg/L, turbidity 1.0 NTU and 0.3 NTU after two backwashes, pH 6.5–8.5, the same problem 3 times in 30 days), including near-threshold values and readings that cannot be real.",
    context_order: "readings_first",
    reasoning_effort: "none",
  },
  {
    key: "operator_words",
    hypothesis:
      "Danger in the operator's words: failures come from missing risk that appears only in the description (illness reports, taste/odor/color complaints, frozen or broken lines, low pressure, chemical spills) while readings look normal — or from over-reacting to alarming words when the readings and context show a routine problem.",
    context_order: "description_first",
    reasoning_effort: "low",
  },
  {
    key: "logbook",
    hypothesis:
      "Logbook patterns: failures come from not reasoning over the logbook — repeats of the same problem within 30 days, fixes that didn't hold, past escalations, and seasonal events (breakup, turnover) that explain the symptoms.",
    context_order: "logbook_first",
    reasoning_effort: "low",
  },
];

const CHILD_FORMAT = `Reply with ONLY JSON:
{"hypothesis": string (one sentence: what you believe causes the failures), "lane": "thresholds" | "operator_words" | "logbook" | "other", "targets": [ids of the FAILURES this change should make pass], "change": string (ONE sentence: what you changed and why), "prompt": string (the full new prompt), "settings": {"context_order": string, "max_steps": number, "reasoning_effort": string}}`;

const laneSystem = (lane: Lane) => `${CRITIC_CONTEXT}

You are one of three agents working in parallel on the same PARENT. Each agent tests a DIFFERENT hypothesis. Yours:
${lane.hypothesis}

Rewrite the parent prompt to test this hypothesis. Keep what already works; target only the failures your hypothesis explains. Your settings are fixed: context_order "${lane.context_order}", reasoning_effort "${lane.reasoning_effort}". Choose max_steps (2–${MAX_STEPS}). Set "lane" to "${lane.key}".

${CHILD_FORMAT}`;

const SINGLE_SYSTEM = `${CRITIC_CONTEXT}

You are a single agent improving the PARENT, one candidate at a time. Pick the ONE hypothesis you think explains the most failures, for example:
${LANES.map((l) => `- "${l.key}": ${l.hypothesis}`).join("\n")}
- "other": a different explanation.

Rewrite the parent prompt to test it and choose all settings.

${CHILD_FORMAT}`;

interface Lineage {
  parent_id: string;
  hypothesis: string;
  lane: string;
  targets: string[];
  change: string;
  seed: number;
}

type Child = Strategy & Lineage;

interface Feedback {
  targets: number;
  now_pass: number;
  /** now_pass / targets: did the critic's targeted fixes land? */
  hit_rate: number | null;
  /** Parent failures outside the targets that now pass. */
  fixed_other: number;
  /** Scenarios the parent passed that this child fails. */
  regressions: number;
}

interface Evaluated extends Strategy, Partial<Lineage> {
  round: number;
  score: number;
  metrics: Metrics;
  qualified: boolean;
  scenarios: ScenarioResult[];
  feedback?: Feedback;
  /** Seconds since its arm started, when this candidate's evaluation finished. */
  elapsed_s?: number;
}

/** Escalation, tier and failure mode all right. */
const passed = (r: ScenarioResult) =>
  !r.got.error && r.got.escalate === r.expected.escalate && r.got.tier === r.expected.tier && r.got.failure_mode === r.expected.failure_mode;

/** Failed scenarios first (worst gap first), then imperfect passes, up to CRITIC_WORST. */
function failuresOf(e: Evaluated): ScenarioResult[] {
  const gap = (r: ScenarioResult) => r.score - r.max;
  const failed = e.scenarios.filter((r) => !passed(r)).sort((a, b) => gap(a) - gap(b));
  const weak = e.scenarios.filter((r) => passed(r) && r.score < r.max).sort((a, b) => gap(a) - gap(b));
  return [...failed, ...weak].slice(0, CRITIC_WORST);
}

function describe(r: ScenarioResult) {
  const s = train.find((x) => x.id === r.id)!;
  return {
    id: r.id,
    passed: passed(r),
    score: `${r.score}/${r.max}`,
    difficulty: r.difficulty,
    description: s.description,
    readings: s.readings.map((x) => `${x.date}: Cl ${x.chlorine}, turb ${x.turbidity}, pH ${x.ph}`),
    logbook: s.log_history.map((l) => `${l.date}: ${l.problem} → ${l.steps_taken.join("; ")} → ${l.outcome}`),
    expected: { escalate: s.expected.escalate, tier: s.expected.tier, failure_mode: s.expected.failure_mode, diagnosis: s.expected.diagnosis, key_steps: s.expected.key_steps },
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

const CONTEXT_ORDERS: ContextOrder[] = ["description_first", "readings_first", "logbook_first"];

function parseSettings(v: unknown): Settings | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const context_order = CONTEXT_ORDERS.find((c) => c === o.context_order);
  const max_steps = Math.round(Number(o.max_steps));
  const reasoning_effort = o.reasoning_effort === "low" ? "low" : o.reasoning_effort === "none" ? "none" : null;
  if (!context_order || !reasoning_effort || !(max_steps >= 2 && max_steps <= MAX_STEPS)) return null;
  return { context_order, max_steps, reasoning_effort };
}

const asObj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** Set to false if the server rejects `seed`; recorded in the results. */
let seedSupported = true;

/** Critic call with a fixed seed (lib/llm's chat() has no seed option, so this calls the client directly). */
async function criticJSON(system: string, user: string, seed: number): Promise<unknown> {
  const model = process.env.LUMINAL_MODEL;
  if (!model) throw new Error("LUMINAL_MODEL must be set in .env");
  const messages = [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];
  const create = (withSeed: boolean) =>
    getLLM().chat.completions.create(
      // "none" isn't in the SDK's type yet (see lib/llm.ts).
      { model, messages, temperature: 0.7, max_tokens: 3000, reasoning_effort: "none" as "low", ...(withSeed ? { seed } : {}) },
      { timeout: 300_000 },
    );
  return withRetry(async () => {
    let res;
    try {
      res = await create(seedSupported);
    } catch (err) {
      if (!seedSupported || (err as { status?: number }).status !== 400) throw err;
      seedSupported = false;
      res = await create(false);
    }
    const text = stripReasoning(res.choices[0]?.message?.content ?? "");
    const parsed = extractLastJSONObject(text);
    if (parsed === undefined) throw new LLMParseError(`critic did not return JSON: ${text.slice(0, 200)}`, text);
    return parsed;
  });
}

/** One critic agent → one child. lane = null for the single agent (it picks its own hypothesis and settings). */
async function makeChild(parent: Evaluated, failures: ScenarioResult[], lane: Lane | null, id: string, seed: number): Promise<Child | null> {
  const user = JSON.stringify(
    {
      parent: { id: parent.id, prompt: parent.prompt, settings: parent.settings, score: `${parent.score}/${parent.metrics.max_score}`, metrics: parent.metrics },
      failures: failures.map(describe),
      failure_modes: FAILURE_MODE_LIST,
    },
    null,
    1,
  );
  const o = asObj(await criticJSON(lane ? laneSystem(lane) : SINGLE_SYSTEM, user, seed));
  if (!o || typeof o.prompt !== "string" || o.prompt.trim().length < 50) return null;
  const raw = asObj(o.settings) ?? {};
  const settings = parseSettings(
    lane ? { max_steps: parent.settings.max_steps, ...raw, context_order: lane.context_order, reasoning_effort: lane.reasoning_effort } : raw,
  );
  if (!settings) return null;
  // Targets must be scenarios the parent actually failed (or, if it failed none, the ones shown).
  const failedIds = failures.filter((r) => !passed(r)).map((r) => r.id);
  const allowed = new Set(failedIds.length ? failedIds : failures.map((r) => r.id));
  const targets = [...new Set((Array.isArray(o.targets) ? o.targets : []).map(String))].filter((t) => allowed.has(t));
  const laneKey = lane?.key ?? ([...LANES.map((l) => l.key), "other"].find((k) => k === o.lane) ?? "other");
  const change = typeof o.change === "string" && o.change.trim() ? o.change.trim() : "(no explanation given)";
  return {
    id,
    prompt: o.prompt.trim(),
    settings,
    rationale: change,
    parent_id: parent.id,
    hypothesis: typeof o.hypothesis === "string" && o.hypothesis.trim() ? o.hypothesis.trim() : (lane?.hypothesis ?? ""),
    lane: laneKey,
    targets,
    change,
    seed,
  };
}

function feedbackOf(parent: Evaluated, child: Evaluated, targets: string[]): Feedback {
  const now = new Set(child.scenarios.filter(passed).map((r) => r.id));
  const before = new Set(parent.scenarios.filter(passed).map((r) => r.id));
  const nowPass = targets.filter((t) => now.has(t)).length;
  return {
    targets: targets.length,
    now_pass: nowPass,
    hit_rate: targets.length ? Math.round((nowPass / targets.length) * 1000) / 1000 : null,
    fixed_other: child.scenarios.filter((r) => now.has(r.id) && !before.has(r.id) && !targets.includes(r.id)).length,
    regressions: parent.scenarios.filter((r) => before.has(r.id) && !now.has(r.id)).length,
  };
}

// ---------------------------------------------------------------------------
// Progress table
// ---------------------------------------------------------------------------

const pct = (x: number) => `${Math.round(x * 100)}%`;
function printHeader() {
  const cols = ["score", "hard", "recall", "f.alarm", "tier", "fm", "steps", "drops", "err", "s/call"];
  const widths = [9, 9, 7, 8, 6, 6, 7, 6, 5, 7];
  console.log(`\n${"round".padEnd(7)}${"strategy".padEnd(28)}${cols.map((c, i) => c.padStart(widths[i])).join("")}  settings`);
  console.log("-".repeat(140));
}
function printRow(round: string, id: string, m: Metrics, settings = "", mark = "") {
  const vals = [
    `${m.score}/${m.max_score}`, m.hard_score, pct(m.escalation_recall), pct(m.false_alarm_rate), pct(m.tier_accuracy),
    pct(m.failure_mode_accuracy), pct(m.key_step_coverage), String(m.dropped_steps),
    String(m.errors + m.judge_errors), m.avg_seconds.toFixed(1),
  ];
  const widths = [9, 9, 7, 8, 6, 6, 7, 6, 5, 7];
  console.log(`${round.padEnd(7)}${id.slice(0, 27).padEnd(28)}${vals.map((v, i) => v.padStart(widths[i])).join("")}  ${settings}${mark ? `  ${mark}` : ""}`);
}
const settingsStr = (s: Settings) => `${s.context_order} · ${s.max_steps} steps · ${s.reasoning_effort}`;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const better = (a: { score: number; metrics: Metrics }, b: { score: number; metrics: Metrics }) =>
  a.score !== b.score ? a.score > b.score
  : a.metrics.escalation_recall !== b.metrics.escalation_recall ? a.metrics.escalation_recall > b.metrics.escalation_recall
  : a.metrics.false_alarm_rate !== b.metrics.false_alarm_rate ? a.metrics.false_alarm_rate < b.metrics.false_alarm_rate
  : a.metrics.tier_accuracy > b.metrics.tier_accuracy;

function pickBest(all: Evaluated[]): Evaluated {
  const pool = all.some((e) => e.qualified) ? all.filter((e) => e.qualified) : all;
  return pool.reduce((a, b) => (better(b, a) ? b : a));
}

const summary = (r: { metrics: Metrics }) => ({ score: r.metrics.score, metrics: r.metrics });
const compactScenario = (s: ScenarioResult) => ({
  id: s.id, difficulty: s.difficulty, score: s.score, max: s.max, expected: { escalate: s.expected.escalate, tier: s.expected.tier, failure_mode: s.expected.failure_mode },
  got: { escalate: s.got.escalate, tier: s.got.tier, failure_mode: s.got.failure_mode, drops: s.got.drops, error: s.got.error }, covered: s.covered, judge_error: s.judge_error,
});

class AbortRun extends Error {}

/** Stop the whole run if too many calls in a phase failed — the scores would be meaningless. */
function checkErrorRate(phase: string, runs: { results: ScenarioResult[] }[]) {
  const results = runs.flatMap((r) => r.results);
  const errored = results.filter((r) => r.got.error || r.judge_error);
  if (results.length && errored.length / results.length > MAX_ERROR_RATE) {
    const first = errored[0].got.error ?? `judge: ${errored[0].judge_error}`;
    throw new AbortRun(
      `${phase}: ${errored.length}/${results.length} scenarios errored (more than ${MAX_ERROR_RATE * 100}%). ` +
        `First error: ${first}\nAborting — fix the problem above and run again.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Arms: A = parallel agents, B = single agent (equal candidate budget)
// ---------------------------------------------------------------------------

interface TracePoint {
  candidates: number;
  seconds: number;
  best_score: number;
  best_id: string;
  candidate_id: string | null;
  candidate_score: number | null;
}

interface Arm {
  rounds: object[];
  candidates: Evaluated[];
  best: Evaluated;
  trace: TracePoint[];
  seconds: number;
  critic_seconds: number;
  failed_critic_calls: number;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const since = (t: number) => r3((Date.now() - t) / 1000);
const point = (candidates: number, seconds: number, best: Evaluated, cand: Evaluated | null): TracePoint => ({
  candidates,
  seconds,
  best_score: best.score,
  best_id: best.id,
  candidate_id: cand?.id ?? null,
  candidate_score: cand?.score ?? null,
});

const strategyEntry = (e: Evaluated) => ({
  id: e.id,
  score: e.score,
  metrics: e.metrics,
  qualified: e.qualified,
  prompt: e.prompt,
  settings: e.settings,
  rationale: e.rationale,
  parent_id: e.parent_id ?? null,
  hypothesis: e.hypothesis ?? null,
  lane: e.lane ?? null,
  targets: e.targets ?? [],
  change: e.change ?? null,
  seed: e.seed ?? null,
  feedback: e.feedback ?? null,
  elapsed_s: e.elapsed_s ?? null,
  scenarios: e.scenarios.map(compactScenario),
});
const roundEntry = (round: number, evaluated: Evaluated[], bestId: string) => ({ round, strategies: evaluated.map(strategyEntry), best_id: bestId });

async function evaluate(st: Strategy & Partial<Lineage>, round: number, parent: Evaluated | null, floor: number): Promise<Evaluated> {
  const run = await runStrategy(st, train);
  const e: Evaluated = {
    ...st,
    round,
    score: run.metrics.score,
    metrics: run.metrics,
    qualified: run.metrics.escalation_recall >= floor,
    scenarios: run.results,
  };
  if (parent && st.targets) e.feedback = feedbackOf(parent, e, st.targets);
  return e;
}

function printLineage(e: Evaluated, bestId: string) {
  const f = e.feedback;
  printRow(String(e.round), e.id, e.metrics, settingsStr(e.settings), [e.qualified ? "" : "DQ (recall)", e.id === bestId ? "★ best" : ""].filter(Boolean).join(" "));
  console.log(
    `       ↳ parent ${e.parent_id} · ${e.lane} · targets [${(e.targets ?? []).join(", ")}] → ` +
      `${f ? `${f.now_pass}/${f.targets} now pass, +${f.fixed_other} other fixed, ${f.regressions} regressions` : "n/a"}`,
  );
  console.log(`       ↳ ${(e.change ?? "").slice(0, 150)}`);
}

let reduced = false;

/** After A's first round: project the whole run and fall back to 2 rounds (A) / 6 (B) if it won't fit. */
function checkBudget(runStart: number, roundSeconds: number, criticSeconds: number) {
  const evalPer = Math.max(1, (roundSeconds - criticSeconds) / LANES.length);
  const remaining = (ROUNDS_A - 1) * roundSeconds + ROUNDS_B * (criticSeconds + evalPer) + 4 * evalPer;
  const projected = (Date.now() - runStart) / 1000 + remaining;
  console.log(
    `\nBudget check: ~${Math.round(evalPer)} s per candidate, ~${Math.round(criticSeconds)} s per critic call → ` +
      `projected ${(projected / 60).toFixed(1)} min for A ${LANES.length}×${ROUNDS_A} / B 1×${ROUNDS_B} (limit ${BUDGET_MIN} min).`,
  );
  if (projected > BUDGET_MIN * 60 && (ROUNDS_A > 2 || ROUNDS_B > 6)) {
    ROUNDS_A = Math.min(ROUNDS_A, 2);
    ROUNDS_B = Math.min(ROUNDS_B, 6);
    reduced = true;
    console.log(`→ Over budget: reducing to ${ROUNDS_A} rounds for A and ${ROUNDS_B} for B (still ${LANES.length * ROUNDS_A} candidates each).`);
  }
}

/** A: each round, the three lane agents work on the best-so-far in parallel; their children are scored concurrently. */
async function runParallel(root: Evaluated, floor: number, runStart: number): Promise<Arm> {
  const t0 = Date.now();
  const all: Evaluated[] = [root];
  const trace: TracePoint[] = [point(0, 0, root, null)];
  const rounds: object[] = [roundEntry(0, [root], root.id)];
  let criticTotal = 0;
  let failedCalls = 0;
  for (let round = 1; round <= ROUNDS_A; round++) {
    const tr = Date.now();
    const parent = pickBest(all);
    const failures = failuresOf(parent);
    const tc = Date.now();
    const children = await Promise.all(
      LANES.map((lane, i) =>
        makeChild(parent, failures, lane, `r${round}-${lane.key}`, SEED + round * 10 + i).catch((err) => {
          console.log(`  r${round}-${lane.key}: critic failed (${String(err).slice(0, 120)})`);
          return null;
        }),
      ),
    );
    const criticSec = since(tc);
    criticTotal += criticSec;
    const ok = children.filter((c): c is Child => c !== null);
    failedCalls += LANES.length - ok.length;
    const evaluated = await Promise.all(
      ok.map(async (c) => {
        const e = await evaluate(c, round, parent, floor);
        e.elapsed_s = since(t0);
        all.push(e);
        trace.push(point(trace.length, e.elapsed_s, pickBest(all), e));
        return e;
      }),
    );
    checkErrorRate(`A round ${round}`, evaluated.map((e) => ({ results: e.scenarios })));
    const best = pickBest(all);
    for (const e of evaluated) printLineage(e, best.id);
    rounds.push(roundEntry(round, evaluated, best.id));
    if (round === 1) checkBudget(runStart, since(tr), criticSec);
  }
  return { rounds, candidates: all.slice(1), best: pickBest(all), trace, seconds: since(t0), critic_seconds: r3(criticTotal), failed_critic_calls: failedCalls };
}

/** B: one agent, one child per round, each built from the previous candidate's failures. */
async function runSerial(root: Evaluated, floor: number): Promise<Arm> {
  const t0 = Date.now();
  const all: Evaluated[] = [root];
  const trace: TracePoint[] = [point(0, 0, root, null)];
  const rounds: object[] = [roundEntry(0, [root], root.id)];
  let criticTotal = 0;
  let failedCalls = 0;
  let prev = root;
  for (let round = 1; round <= ROUNDS_B; round++) {
    const tc = Date.now();
    const child = await makeChild(prev, failuresOf(prev), null, `b${round}`, SEED + round * 10).catch((err) => {
      console.log(`  b${round}: critic failed (${String(err).slice(0, 120)})`);
      return null;
    });
    criticTotal += since(tc);
    if (!child) {
      failedCalls++;
      continue;
    }
    const e = await evaluate(child, round, prev, floor);
    e.elapsed_s = since(t0);
    checkErrorRate(`B round ${round}`, [{ results: e.scenarios }]);
    all.push(e);
    const best = pickBest(all);
    trace.push(point(trace.length, e.elapsed_s, best, e));
    printLineage(e, best.id);
    rounds.push(roundEntry(round, [e], best.id));
    prev = e;
  }
  return { rounds, candidates: all.slice(1), best: pickBest(all), trace, seconds: since(t0), critic_seconds: r3(criticTotal), failed_critic_calls: failedCalls };
}

/** Same scenarios through the pipeline (no judge) with CONCURRENCY calls at once vs one at a time. */
async function measureConcurrency(st: Strategy, scenarios: Scenario[]) {
  const once = async (max: number) => {
    const lim = createLimiter(max);
    const t = Date.now();
    await Promise.all(
      scenarios.map((s) =>
        lim(() =>
          withRetry(() =>
            runTroubleshoot(inputOf(s), {
              instructions: st.prompt,
              contextOrder: st.settings.context_order,
              maxSteps: st.settings.max_steps,
              reasoningEffort: st.settings.reasoning_effort,
            }),
          ),
        ),
      ),
    );
    return since(t);
  };
  // Concurrent first, so any server warm-up favors the sequential run (conservative).
  const concurrent_s = await once(CONCURRENCY);
  const sequential_s = await once(1);
  return { strategy: st.id, scenarios: scenarios.map((s) => s.id), concurrency: CONCURRENCY, concurrent_s, sequential_s, speedup: r3(sequential_s / concurrent_s) };
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

interface Sub {
  n: number;
  score: number;
  max: number;
  pct: number;
  /** Points lost: max − score. */
  errors: number;
}

function sub(results: ScenarioResult[], keep: (r: ScenarioResult) => boolean): Sub {
  const xs = results.filter(keep);
  const score = xs.reduce((n, r) => n + r.score, 0);
  const max = xs.reduce((n, r) => n + r.max, 0);
  return { n: xs.length, score, max, pct: max ? Math.round((score / max) * 1000) / 10 : 0, errors: max - score };
}

/** (baseline errors − final errors) / baseline errors */
const errorReduction = (base: Sub, fin: Sub) => (base.errors > 0 ? r3((base.errors - fin.errors) / base.errors) : null);
const fmtSub = (s: Sub) => `${s.score}/${s.max} (${s.pct}%)`;
const fmtPct = (x: number | null) => (x === null ? "n/a" : `${Math.round(x * 100)}%`);

function hitRate(arm: Arm) {
  const fs = arm.candidates.flatMap((c) => (c.feedback ? [c.feedback] : []));
  const targets = fs.reduce((n, f) => n + f.targets, 0);
  const nowPass = fs.reduce((n, f) => n + f.now_pass, 0);
  return {
    targets,
    now_pass: nowPass,
    hit_rate: targets ? r3(nowPass / targets) : null,
    fixed_other: fs.reduce((n, f) => n + f.fixed_other, 0),
    regressions: fs.reduce((n, f) => n + f.regressions, 0),
  };
}

function writeOut(file: string, data: object) {
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

async function main() {
  const runStart = Date.now();
  console.log(
    `Rubric run · ${train.length} train scenarios (${train.filter((s) => s.difficulty === "hard").length} hard) · ${test.length} test · ` +
      `${CONCURRENCY} calls at once · seed ${SEED}${QUICK ? " · --quick" : ""}`,
  );
  console.log(`A (parallel): ${LANES.length} candidates × ${ROUNDS_A} rounds · B (single agent): 1 candidate × ${ROUNDS_B} rounds`);

  // 1. Concurrency speedup, measured before anything else runs.
  const speed = await measureConcurrency(GENERIC_STRATEGY, train.slice(0, SPEEDUP_N));
  console.log(
    `\nScenario-evaluation concurrency on ${speed.scenarios.length} scenarios: one at a time ${speed.sequential_s.toFixed(1)} s · ` +
      `${CONCURRENCY} at once ${speed.concurrent_s.toFixed(1)} s · speedup ×${speed.speedup.toFixed(2)}`,
  );

  // 2. Shared starting point: baselines, experts, and r0-generic (the root of both arms) on train.
  const [plainTrain, rulesTrain, rootRun, ...expertRuns] = await Promise.all([
    runPlainLLM(train),
    runRulesOnly(train),
    runStrategy(GENERIC_STRATEGY, train),
    ...EXPERT_STRATEGIES.map((st) => runStrategy(st, train)),
  ]);
  checkErrorRate("Baselines", [plainTrain, rulesTrain, rootRun, ...expertRuns]);
  const floor = rulesTrain.metrics.escalation_recall;
  const root: Evaluated = {
    ...GENERIC_STRATEGY,
    round: 0,
    score: rootRun.metrics.score,
    metrics: rootRun.metrics,
    qualified: rootRun.metrics.escalation_recall >= floor,
    scenarios: rootRun.results,
  };
  const experts = EXPERT_STRATEGIES.map((st, i) => ({ ...st, score: expertRuns[i].metrics.score, metrics: expertRuns[i].metrics }));
  const bestExpert = experts.reduce((a, b) => (better(b, a) ? b : a));
  printHeader();
  printRow("base", "plain LLM", plainTrain.metrics, "description only, no rules/safety");
  printRow("base", "rules only", rulesTrain.metrics, `no LLM · recall floor ${pct(floor)}`);
  for (const e of experts) printRow("expert", e.id, e.metrics, settingsStr(e.settings), "reference only");
  printRow("0", root.id, root.metrics, settingsStr(root.settings), "root of A and B");

  // 3. Arm A, then arm B (one after the other, so each gets the full call budget and its own clock).
  console.log(`\n=== A: parallel agents (${LANES.map((l) => l.key).join(" | ")}) ===`);
  printHeader();
  const A = await runParallel(root, floor, runStart);
  writeOut(OUT_FILE, { partial: true, stage: "after arm A", generated_at: new Date().toISOString(), rounds: A.rounds });

  console.log(`\n=== B: single agent, ${ROUNDS_B} candidates in sequence ===`);
  printHeader();
  const B = await runSerial(root, floor);

  // 4. Held-out test: everything on all test scenarios once; the 10-scenario set is a subset of the same run.
  console.log(`\nScoring on ${test.length} held-out test scenarios…`);
  const [plainT, rulesT, rootT, expertT, aT, bT] = await Promise.all([
    runPlainLLM(test),
    runRulesOnly(test),
    runStrategy(root, test),
    runStrategy(bestExpert, test),
    runStrategy(A.best, test),
    runStrategy(B.best, test),
  ]);
  checkErrorRate("Test set", [plainT, rulesT, rootT, expertT, aT, bT]);

  // 5. Reports
  const all = () => true;
  const hard = (r: ScenarioResult) => r.difficulty === "hard";
  const in10 = (r: ScenarioResult) => TEST10.has(r.id);
  const subsets: { name: string; base: ScenarioResult[]; a: ScenarioResult[]; b: ScenarioResult[]; keep: (r: ScenarioResult) => boolean }[] = [
    { name: "train", base: root.scenarios, a: A.best.scenarios, b: B.best.scenarios, keep: all },
    { name: "train hard", base: root.scenarios, a: A.best.scenarios, b: B.best.scenarios, keep: hard },
    { name: "test 10", base: rootT.results, a: aT.results, b: bT.results, keep: in10 },
    { name: "test 10 hard", base: rootT.results, a: aT.results, b: bT.results, keep: (r) => in10(r) && hard(r) },
    { name: `test ${test.length}`, base: rootT.results, a: aT.results, b: bT.results, keep: all },
    { name: `test ${test.length} hard`, base: rootT.results, a: aT.results, b: bT.results, keep: hard },
  ];
  const improvement = subsets.map((s) => {
    const base = sub(s.base, s.keep);
    const a = sub(s.a, s.keep);
    const b = sub(s.b, s.keep);
    return { subset: s.name, n: base.n, baseline: base, parallel: { ...a, error_reduction: errorReduction(base, a) }, single: { ...b, error_reduction: errorReduction(base, b) } };
  });

  console.log(`\n${"=".repeat(118)}\n1. IMPROVEMENT: baseline r0-generic → evolved (error = points lost; reduction = (base − final) / base)\n${"=".repeat(118)}`);
  console.log(`${"subset".padEnd(15)}${"n".padStart(3)}  ${"baseline".padEnd(18)}${`A best (${A.best.id})`.padEnd(30)}${"err↓".padStart(6)}   ${`B best (${B.best.id})`.padEnd(30)}${"err↓".padStart(6)}`);
  for (const row of improvement) {
    console.log(
      `${row.subset.padEnd(15)}${String(row.n).padStart(3)}  ${fmtSub(row.baseline).padEnd(18)}${fmtSub(row.parallel).padEnd(30)}${fmtPct(row.parallel.error_reduction).padStart(6)}   ` +
        `${fmtSub(row.single).padEnd(30)}${fmtPct(row.single.error_reduction).padStart(6)}`,
    );
  }
  const testRows: [string, ScenarioResult[]][] = [
    ["plain LLM", plainT.results],
    ["rules only", rulesT.results],
    ["r0-generic (baseline)", rootT.results],
    [`expert: ${bestExpert.id}`, expertT.results],
    [`A best: ${A.best.id}`, aT.results],
    [`B best: ${B.best.id}`, bT.results],
  ];
  console.log(`\nAll strategies on test:\n${"strategy".padEnd(40)}${"test 10".padEnd(20)}${`test ${test.length}`.padEnd(20)}hard (${test.length})`);
  for (const [name, rs] of testRows) console.log(`${name.slice(0, 39).padEnd(40)}${fmtSub(sub(rs, in10)).padEnd(20)}${fmtSub(sub(rs, all)).padEnd(20)}${fmtSub(sub(rs, hard))}`);

  console.log(`\n${"=".repeat(118)}\n2. LOOP DESIGN: lineage and feedback hit rate (targeted failures that pass in the child)\n${"=".repeat(118)}`);
  console.log(`${"cand".padEnd(24)}${"parent".padEnd(24)}${"lane".padEnd(16)}${"settings".padEnd(34)}${"score".padStart(9)}${"hits".padStart(7)}${"other".padStart(7)}${"regr".padStart(6)}`);
  for (const c of [...A.candidates, ...B.candidates]) {
    const f = c.feedback;
    console.log(
      `${c.id.padEnd(24)}${String(c.parent_id).slice(0, 23).padEnd(24)}${String(c.lane).padEnd(16)}${settingsStr(c.settings).padEnd(34)}${`${c.score}/${c.metrics.max_score}`.padStart(9)}` +
        `${(f ? `${f.now_pass}/${f.targets}` : "-").padStart(7)}${String(f?.fixed_other ?? "-").padStart(7)}${String(f?.regressions ?? "-").padStart(6)}`,
    );
  }
  const hitA = hitRate(A);
  const hitB = hitRate(B);
  console.log(`Feedback hit rate: A ${hitA.now_pass}/${hitA.targets} (${fmtPct(hitA.hit_rate)}) · B ${hitB.now_pass}/${hitB.targets} (${fmtPct(hitB.hit_rate)})`);

  const threshold = Math.min(A.best.score, B.best.score);
  const reach = (arm: Arm) => arm.trace.find((p) => p.best_score >= threshold) ?? null;
  console.log(`\n${"=".repeat(118)}\n3. PARALLELISM: equal budget (${A.candidates.length} vs ${B.candidates.length} candidates), same train set, evaluator and seed\n${"=".repeat(118)}`);
  console.log(`${"cands".padEnd(7)}${"A best so far".padEnd(26)}B best so far`);
  const maxN = Math.max(A.trace.length, B.trace.length);
  for (let i = 0; i < maxN; i++) {
    const cell = (p: TracePoint | undefined) => (p ? `${p.best_score} @ ${p.seconds.toFixed(0)} s` : "");
    console.log(`${String(i).padEnd(7)}${cell(A.trace[i]).padEnd(26)}${cell(B.trace[i])}`);
  }
  const rA = reach(A);
  const rB = reach(B);
  console.log(
    `\n${"".padEnd(30)}${"A parallel".padEnd(22)}B single\n` +
      `${"final best (train)".padEnd(30)}${`${A.best.score} (${A.best.id})`.padEnd(22)}${B.best.score} (${B.best.id})\n` +
      `${"final best (test)".padEnd(30)}${fmtSub(sub(aT.results, all)).padEnd(22)}${fmtSub(sub(bT.results, all))}\n` +
      `${"wall-clock".padEnd(30)}${`${A.seconds.toFixed(0)} s`.padEnd(22)}${B.seconds.toFixed(0)} s\n` +
      `${"  of which critic calls".padEnd(30)}${`${A.critic_seconds.toFixed(0)} s`.padEnd(22)}${B.critic_seconds.toFixed(0)} s\n` +
      `${`time to reach ${threshold}`.padEnd(30)}${(rA ? `${rA.seconds.toFixed(0)} s (${rA.candidates} cands)` : "never").padEnd(22)}${rB ? `${rB.seconds.toFixed(0)} s (${rB.candidates} cands)` : "never"}`,
  );
  console.log(`Scenario-evaluation concurrency: ×${speed.speedup.toFixed(2)} (${speed.sequential_s.toFixed(1)} s one at a time vs ${speed.concurrent_s.toFixed(1)} s with ${CONCURRENCY} at once, ${speed.scenarios.length} scenarios)`);

  // 6. Save. Every field the UI reads from results.json is kept; A is the main run ("rounds", "best_strategy", "test.best").
  const armSummary = (arm: Arm, testRun: { results: ScenarioResult[]; metrics: Metrics }) => ({
    candidates: arm.candidates.length,
    failed_critic_calls: arm.failed_critic_calls,
    seconds: arm.seconds,
    critic_seconds: arm.critic_seconds,
    best_id: arm.best.id,
    train_score: arm.best.score,
    test_score: testRun.metrics.score,
    test_max: testRun.metrics.max_score,
    trace: arm.trace,
    time_to_threshold: { threshold, reached: arm === A ? rA : rB },
    feedback: hitRate(arm),
  });
  const testEntry = (run: { results: ScenarioResult[]; metrics: Metrics }, extra: object = {}) => ({ ...extra, ...summary(run), scenarios: run.results.map(compactScenario) });
  const results = {
    generated_at: new Date().toISOString(),
    quick: QUICK,
    seed: SEED,
    seed_applied_to_critic: seedSupported,
    config: { train: train.length, test: test.length, concurrency: CONCURRENCY, rounds_a: ROUNDS_A, rounds_b: ROUNDS_B, candidates_per_round_a: LANES.length, budget_min: BUDGET_MIN, reduced_for_budget: reduced },
    train_scenarios: train.map((s) => s.id),
    test_scenarios: test.map((s) => s.id),
    test10_scenarios: [...TEST10],
    baselines: { plain_llm: summary(plainTrain), rules_only: summary(rulesTrain), r0_generic: summary(root) },
    expert_reference: experts.map((e) => ({ id: e.id, score: e.score, metrics: e.metrics, prompt: e.prompt, settings: e.settings })),
    lanes: LANES,
    rounds: A.rounds,
    single_agent_rounds: B.rounds,
    test: {
      plain_llm: testEntry(plainT),
      rules_only: testEntry(rulesT),
      expert_reference: testEntry(expertT, { id: bestExpert.id }),
      best: testEntry(aT, { id: A.best.id }),
      r0_generic: testEntry(rootT, { id: root.id }),
      single_agent_best: testEntry(bT, { id: B.best.id }),
    },
    best_strategy: { id: A.best.id, round: A.best.round, score: A.best.score, metrics: A.best.metrics, qualified: A.best.qualified, prompt: A.best.prompt, settings: A.best.settings, rationale: A.best.rationale },
    rubric: {
      improvement,
      loop_design: { lanes: LANES.map((l) => ({ key: l.key, context_order: l.context_order, reasoning_effort: l.reasoning_effort })), parallel: hitRate(A), single: hitRate(B) },
      parallelism: { parallel: armSummary(A, aT), single: armSummary(B, bT), concurrency_speedup: speed },
    },
    total_seconds: since(runStart),
  };
  writeOut(OUT_FILE, results);
  console.log(`\nSaved ${path.relative(process.cwd(), OUT_FILE)} · ${(results.total_seconds / 60).toFixed(1)} min total`);
  if (COPY_TO_RESULTS) {
    copyFileSync(OUT_FILE, path.join(DATA_DIR, "results.json"));
    console.log("Copied to data/results.json");
  }
}

/**
 * --rescore-test: no rounds. Re-scores the baselines, the best expert prompt and r3-s1
 * (prompts/settings as saved in data/results.json) on ALL test scenarios.
 */
async function rescoreTest() {
  const started = Date.now();
  const saved = JSON.parse(readFileSync(path.join(DATA_DIR, "results.json"), "utf8"));
  const toStrategy = (e: { id: string; prompt?: string; settings?: unknown; rationale?: string } | undefined, what: string): Strategy => {
    const settings = parseSettings(e?.settings);
    if (!e || typeof e.prompt !== "string" || !settings) throw new AbortRun(`results.json has no usable ${what}`);
    return { id: e.id, prompt: e.prompt, settings, rationale: e.rationale };
  };
  const expertId: string | undefined = saved.test?.expert_reference?.id;
  const expert = toStrategy((saved.expert_reference ?? []).find((e: { id: string }) => e.id === expertId), `expert "${expertId}"`);
  const optimized = toStrategy(
    (saved.rounds ?? []).flatMap((r: { strategies: { id: string }[] }) => r.strategies).find((s: { id: string }) => s.id === "r3-s1"),
    "strategy r3-s1",
  );

  console.log(`Re-scoring on all ${allTest.length} test scenarios (${allTest.filter((s) => s.difficulty === "hard").length} hard). No rounds.`);
  const [plainTest, rulesTest, expertTest, bestTest] = await Promise.all([
    runPlainLLM(allTest),
    runRulesOnly(allTest),
    runStrategy(expert, allTest),
    runStrategy(optimized, allTest),
  ]);
  checkErrorRate("Test set", [plainTest, rulesTest, expertTest, bestTest]);
  printHeader();
  printRow("test", "plain LLM", plainTest.metrics);
  printRow("test", "rules only", rulesTest.metrics);
  printRow("test", `expert: ${expert.id}`, expertTest.metrics, settingsStr(expert.settings), "reference");
  printRow("test", `best: ${optimized.id}`, bestTest.metrics, settingsStr(optimized.settings), "optimized");

  const out = path.join(DATA_DIR, "results_test20.json");
  writeFileSync(
    out,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        source: "data/results.json",
        source_generated_at: saved.generated_at ?? null,
        test_scenarios: allTest.map((s) => s.id),
        test: {
          plain_llm: { ...summary(plainTest), scenarios: plainTest.results.map(compactScenario) },
          rules_only: { ...summary(rulesTest), scenarios: rulesTest.results.map(compactScenario) },
          expert_reference: { id: expert.id, settings: expert.settings, ...summary(expertTest), scenarios: expertTest.results.map(compactScenario) },
          best: { id: optimized.id, settings: optimized.settings, ...summary(bestTest), scenarios: bestTest.results.map(compactScenario) },
        },
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`\nSaved ${path.relative(process.cwd(), out)} · ${((Date.now() - started) / 1000).toFixed(0)} s total`);
}

(process.argv.includes("--rescore-test") ? rescoreTest() : main()).catch((err) => {
  if (err instanceof AbortRun) console.error(`\n✗ ${err.message}`);
  else console.error(err);
  process.exitCode = 1;
});
