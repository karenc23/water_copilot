// Shapes data/results.json (written by scripts/optimize.ts) for the /evolution animation.
// Defensive like components/results-data.ts: anything missing is skipped, never invented.

import type { Tier } from "@/lib/rules";

export interface Outcome {
  tier: Tier | null;
  escalate: boolean | null;
  failure_mode: string | null;
}

export interface ScenarioCard {
  id: string;
  score: number;
  max: number;
  hard: boolean;
  expected: Outcome;
  got: Outcome;
}

export interface EvoStrategy {
  id: string;
  round: number;
  score: number;
  max: number | null;
  prompt: string | null;
  rationale: string | null;
  settings: Record<string, string | number | boolean>;
  metrics: Record<string, number>;
}

export interface EvoRound {
  round: number;
  strategies: EvoStrategy[];
  /** Best strategy so far after this round (may be from an earlier round). */
  bestId: string | null;
  /** Round ≥ 1: the strategy the critic improved on (previous round's best). */
  parentId: string | null;
  /** Round ≥ 1: the parent's worst-scored training scenarios, as scripts/optimize.ts worstOf() picks them (5, lowest score − max first), failures only. */
  worst: ScenarioCard[];
}

export interface TestRow {
  key: "plain" | "rules" | "expert" | "evolved";
  label: string;
  sub: string | null;
  score: number;
  max: number | null;
  missed: number;
  dangerous: number;
  falseAlarms: number;
  safe: number;
}

export interface Evolution {
  rounds: EvoRound[];
  trainMax: number | null;
  expertTrain: { id: string; score: number } | null;
  test: TestRow[];
  testCount: number | null;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const tier = (v: unknown): Tier | null => (v === "green" || v === "yellow" || v === "red" ? v : null);

const CRITIC_WORST = 5; // scripts/optimize.ts

function outcome(v: unknown): Outcome {
  const o = obj(v) ?? {};
  return { tier: tier(o.tier), escalate: typeof o.escalate === "boolean" ? o.escalate : null, failure_mode: str(o.failure_mode) };
}

function scenarios(v: unknown): ScenarioCard[] {
  return arr(v).flatMap((s) => {
    const o = obj(s);
    const id = str(o?.id);
    const score = num(o?.score);
    const max = num(o?.max);
    if (!o || !id || score === null || max === null) return [];
    return [{ id, score, max, hard: o.difficulty === "hard", expected: outcome(o.expected), got: outcome(o.got) }];
  });
}

function metrics(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, x] of Object.entries(obj(v) ?? {})) if (num(x) !== null) out[k] = x as number;
  return out;
}

export function parseEvolution(raw: unknown): Evolution {
  const root = obj(raw) ?? {};
  const scenarioMap = new Map<string, ScenarioCard[]>();
  let trainMax: number | null = null;

  const rounds: EvoRound[] = arr(root.rounds).flatMap((r) => {
    const ro = obj(r);
    const round = num(ro?.round);
    if (!ro || round === null) return [];
    const strategies = arr(ro.strategies).flatMap((s) => {
      const so = obj(s);
      const m = metrics(so?.metrics);
      const score = num(so?.score) ?? m.score ?? null;
      const id = str(so?.id);
      if (!so || score === null || !id) return [];
      const max = m.max_score ?? null;
      trainMax ??= max;
      scenarioMap.set(id, scenarios(so.scenarios));
      const settings: EvoStrategy["settings"] = {};
      for (const [k, x] of Object.entries(obj(so.settings) ?? {})) {
        if (typeof x === "string" || typeof x === "number" || typeof x === "boolean") settings[k] = x;
      }
      return [{ id, round, score, max, prompt: str(so.prompt), rationale: str(so.rationale), settings, metrics: m }];
    });
    return [{ round, strategies, bestId: str(ro.best_id), parentId: null, worst: [] }];
  });
  rounds.sort((a, b) => a.round - b.round);

  for (let i = 1; i < rounds.length; i++) {
    const parentId = rounds[i - 1].bestId;
    rounds[i].parentId = parentId;
    rounds[i].worst = [...(parentId ? (scenarioMap.get(parentId) ?? []) : [])]
      .sort((a, b) => a.score - a.max - (b.score - b.max))
      .slice(0, CRITIC_WORST)
      .filter((s) => s.score < s.max);
  }

  const test = obj(root.test) ?? {};
  const testExpertId = str(obj(test.expert_reference)?.id);
  const expertEntry = arr(root.expert_reference)
    .map(obj)
    .find((e) => e && str(e.id) === testExpertId);
  const expertScore = num(expertEntry?.score);

  const rowDefs: [TestRow["key"], string, string][] = [
    ["plain", "Plain LLM", "plain_llm"],
    ["rules", "Rules only", "rules_only"],
    ["expert", "Expert prompt", "expert_reference"],
    ["evolved", "Evolved", "best"],
  ];
  let testCount: number | null = null;
  const rows: TestRow[] = rowDefs.flatMap(([key, label, field]) => {
    const t = obj(test[field]);
    const m = metrics(t?.metrics);
    const sc = scenarios(t?.scenarios);
    const score = num(t?.score) ?? m.score ?? null;
    if (!t || score === null || !sc.length || m.missed_escalations === undefined || m.false_alarms === undefined) return [];
    testCount ??= sc.length;
    const dangerous = sc.filter((s) => s.expected.escalate).length;
    return [
      {
        key,
        label,
        sub: str(t.id),
        score,
        max: m.max_score ?? null,
        missed: m.missed_escalations,
        dangerous,
        falseAlarms: m.false_alarms,
        safe: sc.length - dangerous,
      },
    ];
  });

  return {
    rounds,
    trainMax,
    expertTrain: testExpertId && expertScore !== null ? { id: testExpertId, score: expertScore } : null,
    test: rows,
    testCount,
  };
}
