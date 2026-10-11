// Defensive reader for data/results.json (written by scripts/optimize.ts). The format may
// change, so every field is optional and anything unexpected is skipped instead of throwing.

export interface Score {
  score: number;
  max: number | null;
  /** score / max × 100, or null if max is unknown. */
  pct: number | null;
  metrics: Record<string, number>;
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
  best: Strategy | null;
}

export interface Results {
  generatedAt: string | null;
  quick: boolean;
  baselines: { plain: Score | null; rules: Score | null };
  rounds: Round[];
  test: { plain: Score | null; rules: Score | null; best: (Score & { id: string | null }) | null };
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

function scoreOf(v: unknown, fallbackMax: number | null = null): Score | null {
  const o = obj(v);
  if (!o) return null;
  const metrics = metricsOf(o.metrics);
  const score = num(o.score) ?? metrics.score ?? null;
  if (score === null) return null;
  const max = num(o.max_score) ?? metrics.max_score ?? fallbackMax;
  return { score, max, pct: max ? (score / max) * 100 : null, metrics };
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

  const rounds: Round[] = arr(r.rounds)
    .map((rv, i): Round | null => {
      const ro = obj(rv);
      if (!ro) return null;
      const strategies = arr(ro.strategies)
        .map((s, j) => strategyOf(s, j, trainMax))
        .filter((s): s is Strategy => s !== null);
      // Best = highest-scoring strategy that wasn't disqualified.
      const eligible = strategies.filter((s) => s.qualified !== false);
      const pool = eligible.length ? eligible : strategies;
      const best = pool.reduce<Strategy | null>((b, s) => (!b || s.score > b.score ? s : b), null);
      return { round: num(ro.round) ?? i, strategies, best };
    })
    .filter((x): x is Round => x !== null);

  const test = obj(r.test) ?? {};
  const testPlain = scoreOf(test.plain_llm);
  const testRules = scoreOf(test.rules_only);
  const testBestScore = scoreOf(test.best, testPlain?.max ?? testRules?.max ?? null);

  return {
    generatedAt: str(r.generated_at),
    quick: r.quick === true,
    baselines: { plain, rules },
    rounds,
    test: {
      plain: testPlain,
      rules: testRules,
      best: testBestScore ? { ...testBestScore, id: str(obj(test.best)?.id) } : null,
    },
    bestStrategyId: str(obj(r.best_strategy)?.id),
  };
}
