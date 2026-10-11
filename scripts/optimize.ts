// Prompt/settings optimizer for the troubleshoot pipeline (rules → LLM → safety).
//
// Usage: npx tsx scripts/optimize.ts          (40 train scenarios, 4 rounds, 20 test)
//        npx tsx scripts/optimize.ts --quick  (5 hard train scenarios, 1 round)
//        npx tsx scripts/optimize.ts --train 20 --rounds 3 --test 10
//          (subsets are stratified by difficulty and escalation, so the mix stays the same)
//
// Round 0 scores one deliberately generic strategy on data/scenarios_train.json.
// Each later round asks a critic LLM call for 3 new strategies, based on the current
// best strategy's 5 worst-scored scenarios. Three hand-written strategies are scored
// alongside as an "expert reference" but are never candidates for best.
// data/scenarios_test.json is only used at the end, for the final comparison.
// Results go to data/results.json (data/results_quick.json with --quick).
import "dotenv/config"; // load .env before anything reads process.env
import { readFileSync, writeFileSync } from "node:fs";
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
import { chatJSON, LLMParseError } from "@/lib/llm";
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
const ROUNDS = intFlag("--rounds") ?? (QUICK ? 1 : 4);
const CONCURRENCY = 5;
const MAX_ERROR_RATE = 0.3; // abort if more than this share of a phase's calls error
const CRITIC_WORST = 5; // scenarios shown to the critic each round
const QUICK_IDS = ["train-21", "train-24", "train-27", "train-28", "train-30"]; // hard mix, 3 escalate
const DATA_DIR = path.join(process.cwd(), "data");
const OUT_FILE = path.join(DATA_DIR, QUICK ? "results_quick.json" : "results.json");

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

const train = QUICK ? allTrain.filter((s) => QUICK_IDS.includes(s.id)) : stratified(allTrain, intFlag("--train"));
const test = stratified(allTest, intFlag("--test"));

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
// Critic
// ---------------------------------------------------------------------------

const CRITIC_SYSTEM = `You improve the system prompt and settings of a water-treatment troubleshooting assistant for operators at a small rural Alaska plant.

The assistant runs inside a pipeline: deterministic rules flag readings → the LLM (your prompt) → a safety layer. The safety layer takes the highest of the rule tier, the chosen failure mode's tier, and the LLM's escalate/health_risk flags, so the LLM can raise the tier but never lower it. It drops steps whose manual section doesn't exist and removes doses not in the manual. The user message the LLM sees contains the operator's description, recent readings, logbook entries, automated alerts, and the full plant MANUAL.

Code ALWAYS appends to your prompt: the step limit, the list of failure modes (ids, tiers, descriptions), and the exact JSON output format (diagnosis, failure_mode, steps with manual_section, health_risk, escalate). Do NOT include a JSON schema or the failure-mode list in your prompt.

Final tier: red if escalated, otherwise yellow if any alert or the failure mode is yellow, otherwise green.

Scoring per scenario: +3 escalate correct, −6 missed escalation, −2 false alarm; +2 exact tier; +2 correct failure_mode; +1 if any cited section matches the expected ones; +1 per expected key step the answer covers (judged by an LLM); −1 per step dropped by the safety layer. Missing an escalation is the worst outcome, but false alarms also cost points.

Every prompt you write must keep these rules: use only the manual; cite a manual section number for every step; never invent chemical doses; escalate any possible health risk.

Settings:
- context_order: "description_first" | "readings_first" | "logbook_first"
- max_steps: integer 2–${MAX_STEPS}
- reasoning_effort: "none" (700-token cap) or "low" (brief reasoning, 1,500-token cap)

You'll see the current best strategy and its ${CRITIC_WORST} worst-scored training scenarios, expected vs. actual. Write 3 DIFFERENT new strategies that fix those failures without breaking what works. Generalize from the failures — don't hard-code scenario details.

Reply with ONLY JSON: {"strategies": [{"rationale": string, "prompt": string, "settings": {"context_order": string, "max_steps": number, "reasoning_effort": string}}]}`;

interface Evaluated extends Strategy {
  round: number;
  score: number;
  metrics: Metrics;
  qualified: boolean;
  scenarios: ScenarioResult[];
}

function worstOf(e: Evaluated) {
  return [...e.scenarios]
    .sort((a, b) => a.score - a.max - (b.score - b.max))
    .slice(0, CRITIC_WORST)
    .map((r) => {
      const s = train.find((x) => x.id === r.id)!;
      return {
        id: r.id,
        score: `${r.score}/${r.max}`,
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
    });
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

async function critic(best: Evaluated, round: number): Promise<Strategy[]> {
  const user = JSON.stringify(
    {
      current_best: { prompt: best.prompt, settings: best.settings, score: `${best.score}/${best.metrics.max_score}`, metrics: best.metrics },
      worst_scenarios: worstOf(best),
      failure_modes: FAILURE_MODE_LIST,
    },
    null,
    1,
  );
  const raw = (await withRetry(() =>
    chatJSON(
      [
        { role: "system", content: CRITIC_SYSTEM },
        { role: "user", content: user },
      ],
      // Luminal reproducibly returns 503 for max_tokens 6000 + reasoning "low"; reasoning isn't needed to write prompts.
      { max_tokens: 4000, reasoning_effort: "none", temperature: 0.7, timeout: 300_000 },
    ),
  )) as { strategies?: unknown[] };
  const out: Strategy[] = [];
  for (const s of raw?.strategies ?? []) {
    const o = s as Record<string, unknown>;
    const settings = parseSettings(o.settings);
    if (typeof o.prompt !== "string" || o.prompt.trim().length < 50 || !settings) continue;
    out.push({ id: `r${round}-s${out.length + 1}`, prompt: o.prompt.trim(), settings, rationale: String(o.rationale ?? "") });
    if (out.length === 3) break;
  }
  return out;
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

async function main() {
  const started = Date.now();
  console.log(
    `Optimizing on ${train.length} train scenarios (${train.filter((s) => s.difficulty === "hard").length} hard), ` +
      `${ROUNDS} round(s), up to ${CONCURRENCY} calls at once${QUICK ? " (--quick)" : ""}.`,
  );

  // Baselines and expert reference on train
  const [plainTrain, rulesTrain, ...expertRuns] = await Promise.all([
    runPlainLLM(train),
    runRulesOnly(train),
    ...EXPERT_STRATEGIES.map((st) => runStrategy(st, train)),
  ]);
  checkErrorRate("Baselines", [plainTrain, rulesTrain, ...expertRuns]);
  const recallFloor = rulesTrain.metrics.escalation_recall;
  const experts = EXPERT_STRATEGIES.map((st, i) => ({ ...st, score: expertRuns[i].metrics.score, metrics: expertRuns[i].metrics }));
  const bestExpert = experts.reduce((a, b) => (better(b, a) ? b : a));
  printHeader();
  printRow("base", "plain LLM", plainTrain.metrics, "description only, no rules/safety");
  printRow("base", "rules only", rulesTrain.metrics, `no LLM · recall floor ${pct(recallFloor)}`);
  for (const e of experts) printRow("expert", e.id, e.metrics, settingsStr(e.settings), "reference only");

  const all: Evaluated[] = [];
  const rounds: { round: number; strategies: object[]; best_id: string }[] = [];

  const evaluate = async (round: number, strategies: Strategy[]) => {
    const runs = await Promise.all(strategies.map((st) => runStrategy(st, train)));
    checkErrorRate(`Round ${round}`, runs);
    const evaluated: Evaluated[] = strategies.map((st, i) => ({
      ...st,
      round,
      score: runs[i].metrics.score,
      metrics: runs[i].metrics,
      qualified: runs[i].metrics.escalation_recall >= recallFloor,
      scenarios: runs[i].results,
    }));
    all.push(...evaluated);
    const best = pickBest(all);
    for (const e of evaluated) {
      printRow(String(round), e.id, e.metrics, settingsStr(e.settings), [e.qualified ? "" : "DQ (recall)", e.id === best.id ? "★ best" : ""].filter(Boolean).join(" "));
    }
    rounds.push({
      round,
      strategies: evaluated.map((e) => ({
        id: e.id, score: e.score, metrics: e.metrics, qualified: e.qualified, prompt: e.prompt, settings: e.settings, rationale: e.rationale,
        scenarios: e.scenarios.map(compactScenario),
      })),
      best_id: best.id,
    });
    return best;
  };

  let best = await evaluate(0, [GENERIC_STRATEGY]);
  for (let round = 1; round <= ROUNDS; round++) {
    let next: Strategy[] = [];
    try {
      next = await critic(best, round);
    } catch (err) {
      console.log(`round ${round}: critic failed (${String(err).slice(0, 120)})`);
    }
    if (!next.length) {
      console.log(`round ${round}: critic returned no usable strategies; skipping.`);
      continue;
    }
    best = await evaluate(round, next);
  }

  // Final comparison on the held-out test set
  console.log(`\nHeld-out test set (${test.length} scenarios, ${test.filter((s) => s.difficulty === "hard").length} hard):`);
  const [plainTest, rulesTest, expertTest, bestTest] = await Promise.all([
    runPlainLLM(test),
    runRulesOnly(test),
    runStrategy(bestExpert, test),
    runStrategy(best, test),
  ]);
  checkErrorRate("Test set", [plainTest, rulesTest, expertTest, bestTest]);
  printHeader();
  printRow("test", "plain LLM", plainTest.metrics);
  printRow("test", "rules only", rulesTest.metrics);
  printRow("test", `expert: ${bestExpert.id}`, expertTest.metrics, settingsStr(bestExpert.settings), "reference");
  printRow("test", `best: ${best.id}`, bestTest.metrics, settingsStr(best.settings), "optimized");

  console.log("\nOptimized strategy per test scenario:");
  for (const r of bestTest.results) {
    const ok = (a: unknown, b: unknown) => (a === b ? " " : "✗");
    console.log(
      `  ${r.id.padEnd(9)}${r.difficulty === "hard" ? "H" : " "} ${`${r.score}/${r.max}`.padStart(6)}  ` +
        `escalate ${String(r.got.escalate).padEnd(5)}${ok(r.got.escalate, r.expected.escalate)} tier ${String(r.got.tier).padEnd(6)}${ok(r.got.tier, r.expected.tier)} ` +
        `fm ${String(r.got.failure_mode).padEnd(4)}${ok(r.got.failure_mode, r.expected.failure_mode)} steps ${r.covered.filter(Boolean).length}/${r.covered.length}` +
        `${r.got.error ? `  ERROR ${r.got.error}` : ""}`,
    );
  }

  const results = {
    generated_at: new Date().toISOString(),
    quick: QUICK,
    train_scenarios: train.map((s) => s.id),
    test_scenarios: test.map((s) => s.id),
    baselines: { plain_llm: summary(plainTrain), rules_only: summary(rulesTrain) },
    expert_reference: experts.map((e) => ({ id: e.id, score: e.score, metrics: e.metrics, prompt: e.prompt, settings: e.settings })),
    rounds,
    test: {
      plain_llm: { ...summary(plainTest), scenarios: plainTest.results.map(compactScenario) },
      rules_only: { ...summary(rulesTest), scenarios: rulesTest.results.map(compactScenario) },
      expert_reference: { id: bestExpert.id, ...summary(expertTest), scenarios: expertTest.results.map(compactScenario) },
      best: { id: best.id, ...summary(bestTest), scenarios: bestTest.results.map(compactScenario) },
    },
    best_strategy: { id: best.id, round: best.round, score: best.score, metrics: best.metrics, qualified: best.qualified, prompt: best.prompt, settings: best.settings, rationale: best.rationale },
  };
  writeFileSync(OUT_FILE, JSON.stringify(results, null, 2) + "\n");
  console.log(`\nSaved ${path.relative(process.cwd(), OUT_FILE)} · ${((Date.now() - started) / 1000).toFixed(0)} s total`);
}

main().catch((err) => {
  if (err instanceof AbortRun) console.error(`\n✗ ${err.message}`);
  else console.error(err);
  process.exitCode = 1;
});
