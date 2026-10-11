// Evaluator shared by the optimizer scripts: data splits, scoring, the key-step Judge,
// the pipeline runner, retries/concurrency and the seeded critic call.
//
// Copied verbatim from scripts/optimize.ts, which can't be imported (it starts a run on load).
// Keep the two in sync until optimize.ts is switched over to import from here.
import "dotenv/config"; // load .env before anything reads process.env
import { readFileSync } from "node:fs";
import path from "node:path";
import { APIConnectionError } from "openai";
import { MAX_STEPS, type ContextOrder, type ReasoningEffort } from "@/lib/agents";
import { chatJSON, extractLastJSONObject, getLLM, LLMParseError, stripReasoning } from "@/lib/llm";
import { runTroubleshoot } from "@/lib/pipeline";
import type { Tier } from "@/lib/rules";
import type { Scenario } from "@/types";

process.env.LLM_LOG = "off"; // thousands of calls; the scripts print their own tables

export const CONCURRENCY = 5;
export const MAX_ERROR_RATE = 0.3; // abort if more than this share of a phase's calls error
export const DATA_DIR = path.join(process.cwd(), "data");

export const manual = readFileSync(path.join(DATA_DIR, "manual.md"), "utf8");
export const allTrain: Scenario[] = JSON.parse(readFileSync(path.join(DATA_DIR, "scenarios_train.json"), "utf8"));
export const allTest: Scenario[] = JSON.parse(readFileSync(path.join(DATA_DIR, "scenarios_test.json"), "utf8"));

/**
 * Deterministic subset of n scenarios that keeps the same share of each
 * (difficulty, escalate) group as the full set (largest-remainder allocation).
 */
export function stratified(scenarios: Scenario[], n: number | undefined): Scenario[] {
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

// ---------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------

export interface Settings {
  context_order: ContextOrder;
  max_steps: number;
  reasoning_effort: ReasoningEffort;
}

export interface Strategy {
  id: string;
  prompt: string;
  settings: Settings;
  rationale?: string;
}

/** Round 0: deliberately weak. The agents have to discover everything else. */
export const GENERIC_STRATEGY: Strategy = {
  id: "r0-generic",
  rationale: "Weak starting point: no domain rules.",
  prompt: "You are a helpful assistant for water plant operators. Answer the question.",
  settings: { context_order: "description_first", max_steps: 5, reasoning_effort: "none" },
};

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export interface Output {
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

export interface ScenarioResult {
  id: string;
  difficulty: string;
  score: number;
  max: number;
  expected: { escalate: boolean; tier: Tier; failure_mode: string; key_steps: string[] };
  got: Output;
  covered: boolean[];
  judge_error?: string;
}

export interface Metrics {
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
export function metricsOf(results: ScenarioResult[], seconds: number[]): Metrics {
  const ok = results.filter((r) => !r.got.error);
  const pos = results.filter((r) => r.expected.escalate);
  const neg = results.filter((r) => !r.expected.escalate);
  const tp = pos.filter((r) => !r.got.error && r.got.escalate).length;
  const fp = neg.filter((r) => r.got.error || r.got.escalate).length;
  const hard = results.filter((r) => r.difficulty === "hard");
  const keySteps = results.reduce((n, r) => n + r.expected.key_steps.length, 0);
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

/** Escalation, tier and failure mode all right. */
export const passed = (r: ScenarioResult) =>
  !r.got.error && r.got.escalate === r.expected.escalate && r.got.tier === r.expected.tier && r.got.failure_mode === r.expected.failure_mode;

export const r3 = (x: number) => Math.round(x * 1000) / 1000;

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
export async function withRetry<T>(fn: () => Promise<T>, attempts = 6): Promise<T> {
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
// Key-step Judge (DeepSeek)
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
// Runner: a strategy through the full pipeline (rules → LLM → safety)
// ---------------------------------------------------------------------------

const inputOf = (s: Scenario) => ({
  plant_id: s.readings[0]?.plant_id ?? "plant-a",
  description: s.description,
  readings: s.readings,
  logs: s.log_history,
  manualText: manual,
});

export function runStrategy(st: Strategy, scenarios: Scenario[]) {
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

// ---------------------------------------------------------------------------
// Agent calls, settings, ranking
// ---------------------------------------------------------------------------

const CONTEXT_ORDERS: ContextOrder[] = ["description_first", "readings_first", "logbook_first"];

export function parseSettings(v: unknown): Settings | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const context_order = CONTEXT_ORDERS.find((c) => c === o.context_order);
  const max_steps = Math.round(Number(o.max_steps));
  const reasoning_effort = o.reasoning_effort === "low" ? "low" : o.reasoning_effort === "none" ? "none" : null;
  if (!context_order || !reasoning_effort || !(max_steps >= 2 && max_steps <= MAX_STEPS)) return null;
  return { context_order, max_steps, reasoning_effort };
}

export const asObj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** Set to false if the server rejects `seed`. */
export let seedSupported = true;

/** Agent call with a fixed seed (lib/llm's chat() has no seed option, so this calls the client directly). */
export async function agentJSON(system: string, user: string, seed: number, maxTokens = 3000): Promise<unknown> {
  const model = process.env.LUMINAL_MODEL;
  if (!model) throw new Error("LUMINAL_MODEL must be set in .env");
  const messages = [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];
  const create = (withSeed: boolean) =>
    getLLM().chat.completions.create(
      // "none" isn't in the SDK's type yet (see lib/llm.ts).
      { model, messages, temperature: 0.7, max_tokens: maxTokens, reasoning_effort: "none" as "low", ...(withSeed ? { seed } : {}) },
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
    if (parsed === undefined) throw new LLMParseError(`agent did not return JSON: ${text.slice(0, 200)}`, text);
    return parsed;
  });
}

/** Score first, then escalation recall, then fewer false alarms, then tier accuracy. */
export const better = (a: { score: number; metrics: Metrics }, b: { score: number; metrics: Metrics }) =>
  a.score !== b.score ? a.score > b.score
  : a.metrics.escalation_recall !== b.metrics.escalation_recall ? a.metrics.escalation_recall > b.metrics.escalation_recall
  : a.metrics.false_alarm_rate !== b.metrics.false_alarm_rate ? a.metrics.false_alarm_rate < b.metrics.false_alarm_rate
  : a.metrics.tier_accuracy > b.metrics.tier_accuracy;

export const compactScenario = (s: ScenarioResult) => ({
  id: s.id, difficulty: s.difficulty, score: s.score, max: s.max, expected: { escalate: s.expected.escalate, tier: s.expected.tier, failure_mode: s.expected.failure_mode },
  got: { escalate: s.got.escalate, tier: s.got.tier, failure_mode: s.got.failure_mode, drops: s.got.drops, error: s.got.error }, covered: s.covered, judge_error: s.judge_error,
});

export class AbortRun extends Error {}

/** Stop the whole run if too many calls in a phase failed — the scores would be meaningless. */
export function checkErrorRate(phase: string, runs: { results: ScenarioResult[] }[]) {
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
// Tables
// ---------------------------------------------------------------------------

const pct = (x: number) => `${Math.round(x * 100)}%`;
const WIDTHS = [9, 9, 7, 8, 6, 6, 7, 6, 5, 7];
export function printHeader(first = "round", second = "strategy") {
  const cols = ["score", "hard", "recall", "f.alarm", "tier", "fm", "steps", "drops", "err", "s/call"];
  console.log(`\n${first.padEnd(7)}${second.padEnd(28)}${cols.map((c, i) => c.padStart(WIDTHS[i])).join("")}  notes`);
  console.log("-".repeat(140));
}
export function printRow(round: string, id: string, m: Metrics, notes = "") {
  const vals = [
    `${m.score}/${m.max_score}`, m.hard_score, pct(m.escalation_recall), pct(m.false_alarm_rate), pct(m.tier_accuracy),
    pct(m.failure_mode_accuracy), pct(m.key_step_coverage), String(m.dropped_steps),
    String(m.errors + m.judge_errors), m.avg_seconds.toFixed(1),
  ];
  console.log(`${round.padEnd(7)}${id.slice(0, 27).padEnd(28)}${vals.map((v, i) => v.padStart(WIDTHS[i])).join("")}  ${notes}`);
}
export const settingsStr = (s: Settings) => `${s.context_order} · ${s.max_steps} steps · ${s.reasoning_effort}`;
