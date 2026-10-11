// Defensive reader for data/results.json (written by scripts/optimize.ts). The format may
// change, so every field is optional and anything unexpected is skipped instead of throwing.

export interface Score {
  score: number;
  max: number | null;
  /** score / max × 100, or null if max is unknown. */
  pct: number | null;
  metrics: Record<string, number>;
  /** Score on the hard-scenario subset ("7/22" in results.json), if recorded. */
  hard: { score: number; max: number } | null;
}

export interface Strategy extends Score {
  id: string;
  qualified: boolean | null;
  rationale: string | null;
  prompt: string | null;
  settings: Record<string, string | number | boolean>;
}

export interface Round {
  round: number;
  strategies: Strategy[];
  /** Best strategy so far after this round (the optimizer's best_id), which may come from an earlier round. */
  best: Strategy | null;
}

export interface Results {
  generatedAt: string | null;
  quick: boolean;
  baselines: { plain: Score | null; rules: Score | null; expert: (Score & { id: string | null }) | null };
  rounds: Round[];
  test: {
    /** What "Baseline" means in the headline: test.baseline if the optimizer records one, else the plain LLM. */
    baseline: (Score & { label: string }) | null;
    plain: Score | null;
    rules: Score | null;
    expert: (Score & { id: string | null }) | null;
    best: (Score & { id: string | null }) | null;
    /** Number of held-out scenarios, if recorded. */
    count: number | null;
  };
  bestStrategyId: string | null;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function metricsOf(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, x] of Object.entries(obj(v) ?? {})) if (num(x) !== null) out[k] = x as number;
  return out;
}

/** "7/22", "-1/22" or { score, max }. */
function hardOf(v: unknown): Score["hard"] {
  const o = obj(v);
  if (o) {
    const score = num(o.score);
    const max = num(o.max) ?? num(o.max_score);
    return score !== null && max ? { score, max } : null;
  }
  const m = typeof v === "string" ? v.match(/^\s*(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/) : null;
  return m && Number(m[2]) ? { score: Number(m[1]), max: Number(m[2]) } : null;
}

function scoreOf(v: unknown, fallbackMax: number | null = null): Score | null {
  const o = obj(v);
  if (!o) return null;
  const metrics = metricsOf(o.metrics);
  const score = num(o.score) ?? metrics.score ?? null;
  if (score === null) return null;
  const max = num(o.max_score) ?? metrics.max_score ?? fallbackMax;
  return { score, max, pct: max ? (score / max) * 100 : null, metrics, hard: hardOf(obj(o.metrics)?.hard_score ?? o.hard_score) };
}

function strategyOf(v: unknown, i: number, fallbackMax: number | null): Strategy | null {
  const o = obj(v);
  const s = scoreOf(v, fallbackMax);
  if (!o || !s) return null;
  const settings: Strategy["settings"] = {};
  for (const [k, x] of Object.entries(obj(o.settings) ?? {})) {
    if (typeof x === "string" || typeof x === "number" || typeof x === "boolean") settings[k] = x;
  }
  return {
    ...s,
    id: str(o.id) ?? `strategy-${i + 1}`,
    qualified: typeof o.qualified === "boolean" ? o.qualified : null,
    rationale: str(o.rationale),
    prompt: str(o.prompt) ?? str(o.instructions),
    settings,
  };
}

export function parseResults(raw: unknown): Results {
  const r = obj(raw) ?? {};
  const baselines = obj(r.baselines) ?? {};
  const plain = scoreOf(baselines.plain_llm);
  const rules = scoreOf(baselines.rules_only);
  const trainMax = plain?.max ?? rules?.max ?? null;
  // Expert reference: the best-scoring hand-written strategy on train.
  const experts = arr(r.expert_reference)
    .map((e, i) => strategyOf(e, i, trainMax))
    .filter((s): s is Strategy => s !== null);
  const expert = experts.reduce<Strategy | null>((b, s) => (!b || s.score > b.score ? s : b), null);

  const seen: Strategy[] = [];
  const rounds: Round[] = arr(r.rounds)
    .map((rv, i): Round | null => {
      const ro = obj(rv);
      if (!ro) return null;
      const strategies = arr(ro.strategies)
        .map((s, j) => strategyOf(s, j, trainMax))
        .filter((s): s is Strategy => s !== null);
      seen.push(...strategies);
      // Prefer the optimizer's own pick (best so far, across rounds); otherwise the
      // highest-scoring strategy so far that wasn't disqualified.
      const bestId = str(ro.best_id);
      const eligible = seen.filter((s) => s.qualified !== false);
      const pool = eligible.length ? eligible : seen;
      const best =
        (bestId && seen.find((s) => s.id === bestId)) || pool.reduce<Strategy | null>((b, s) => (!b || s.score > b.score ? s : b), null);
      return { round: num(ro.round) ?? i, strategies, best };
    })
    .filter((x): x is Round => x !== null);

  const test = obj(r.test) ?? {};
  const testPlain = scoreOf(test.plain_llm);
  const testRules = scoreOf(test.rules_only);
  const testMax = testPlain?.max ?? testRules?.max ?? null;
  const testExpertScore = scoreOf(test.expert_reference, testMax);
  const testBestScore = scoreOf(test.best, testMax);

  const explicitBaseline = scoreOf(test.baseline, testMax);
  const baseline = explicitBaseline
    ? { ...explicitBaseline, label: str(obj(test.baseline)?.label) ?? str(obj(test.baseline)?.id) ?? "Baseline" }
    : testPlain
      ? { ...testPlain, label: "Plain LLM" }
      : null;

  return {
    generatedAt: str(r.generated_at),
    quick: r.quick === true,
    baselines: { plain, rules, expert: expert ? { ...expert, id: expert.id } : null },
    rounds,
    test: {
      baseline,
      plain: testPlain,
      rules: testRules,
      expert: testExpertScore ? { ...testExpertScore, id: str(obj(test.expert_reference)?.id) } : null,
      best: testBestScore ? { ...testBestScore, id: str(obj(test.best)?.id) } : null,
      count: arr(r.test_scenarios).length || null,
    },
    bestStrategyId: str(obj(r.best_strategy)?.id),
  };
}
