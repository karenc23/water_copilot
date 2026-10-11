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
  /** The strategy it was derived from: its own parent_id if recorded, else the previous round's best. */
  parentId: string | null;
  /** The critic's hypothesis for this child, if the optimizer recorded one. */
  hypothesis: string | null;
  /** "What I changed and why": the optimizer's changes field, else its rationale. */
  changes: string | null;
  score: number;
  max: number | null;
  prompt: string | null;
  rationale: string | null;
  settings: Record<string, string | number | boolean>;
  metrics: Record<string, number>;
  /** Per training scenario: points scored and max. */
  scenarioScores: Record<string, { score: number; max: number }>;
}

export type FixStatus = "fixed" | "improved" | "same" | "worse" | "unknown";

export interface EvoRound {
  round: number;
  strategies: EvoStrategy[];
  /** Best strategy so far after this round (may be from an earlier round). */
  bestId: string | null;
  /** Round ≥ 1: the strategy the critic improved on (previous round's best). */
  parentId: string | null;
  /** Round ≥ 1: the parent's worst-scored training scenarios, as scripts/optimize.ts worstOf() picks them (5, lowest score − max first), failures only. */
  worst: ScenarioCard[];
  /** Round ≥ 1: how each targeted scenario did in this round's survivor, vs. the parent. */
  fixes: { id: string; before: number; after: number | null; max: number; status: FixStatus }[];
  /** Share of targeted scenarios that improved in the survivor: the optimizer's own figure if recorded, else computed. */
  hitRate: number | null;
  hitRateSource: "recorded" | "computed" | null;
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

export interface RunPoint {
  candidates: number;
  seconds: number | null;
  best: number;
}

export interface AgentRun {
  label: string;
  points: RunPoint[];
  test: { score: number; max: number | null } | null;
  wallSeconds: number | null;
}

export interface ParallelComparison {
  a: AgentRun;
  b: AgentRun;
  /** B's wall-clock ÷ A's, the optimizer's figure if recorded. */
  speedup: number | null;
}

export interface Evolution {
  rounds: EvoRound[];
  /** Only present when results.json records a parallel-vs-single run. */
  parallel: ParallelComparison | null;
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

/** A string, or a list of strings joined as sentences. */
function textOf(v: unknown): string | null {
  if (Array.isArray(v)) {
    const parts = v.flatMap((x) => (str(x) ? [str(x)!] : []));
    return parts.length ? parts.join(" ") : null;
  }
  return str(v);
}

function runOf(v: unknown, fallbackLabel: string): AgentRun | null {
  const o = obj(v);
  if (!o) return null;
  const points = arr(o.curve ?? o.history ?? o.progress ?? o.points).flatMap((p) => {
    const po = obj(p);
    const candidates = num(po?.candidates) ?? num(po?.evaluated) ?? num(po?.candidates_evaluated) ?? num(po?.n);
    const best = num(po?.best) ?? num(po?.best_score) ?? num(po?.score);
    if (!po || candidates === null || best === null) return [];
    return [{ candidates, best, seconds: num(po.seconds) ?? num(po.wall_seconds) ?? num(po.elapsed_seconds) ?? num(po.elapsed_s) ?? num(po.t) }];
  });
  if (points.length < 2) return null;
  points.sort((a, b) => a.candidates - b.candidates);
  const t = o.test ?? o.test_score;
  const testScore = num(t) ?? num(obj(t)?.score);
  return {
    label: str(o.label) ?? str(o.name) ?? fallbackLabel,
    points,
    test: testScore !== null ? { score: testScore, max: num(obj(t)?.max) ?? num(obj(t)?.max_score) ?? num(o.test_max) } : null,
    wallSeconds: num(o.wall_seconds) ?? num(o.wall_clock_seconds) ?? num(o.seconds) ?? points.at(-1)?.seconds ?? null,
  };
}

/** results.json may record a parallel (A) vs single-agent (B) run under one of a few names. */
function parallelOf(root: Obj): ParallelComparison | null {
  const c = obj(root.parallel_vs_single) ?? obj(root.parallel_comparison) ?? obj(root.agent_comparison) ?? obj(root.comparison);
  if (!c) return null;
  const runs = arr(c.runs);
  const a = runOf(c.parallel ?? c.A ?? c.a ?? runs[0], "A · parallel agents");
  const b = runOf(c.single ?? c.B ?? c.b ?? runs[1], "B · single agent");
  if (!a || !b) return null;
  const recorded = num(c.speedup) ?? num(c.concurrency_speedup);
  return { a, b, speedup: recorded ?? (a.wallSeconds && b.wallSeconds ? b.wallSeconds / a.wallSeconds : null) };
}

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

  const rounds: (EvoRound & { _targeted: string[] })[] = arr(root.rounds).flatMap((r) => {
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
      const scenarioScores: EvoStrategy["scenarioScores"] = {};
      for (const sc of scenarios(so.scenarios)) scenarioScores[sc.id] = { score: sc.score, max: sc.max };
      const changes = textOf(so.changes ?? so.what_changed ?? so.change_summary ?? so.changes_and_why);
      return [
        {
          id,
          round,
          parentId: str(so.parent_id) ?? str(so.parent),
          hypothesis: textOf(so.hypothesis),
          changes: changes ?? str(so.rationale),
          score,
          max,
          prompt: str(so.prompt),
          rationale: str(so.rationale),
          settings,
          metrics: m,
          scenarioScores,
        },
      ];
    });
    const recordedHit = num(ro.feedback_hit_rate) ?? num(obj(ro.feedback)?.hit_rate);
    const targetedIds = arr(ro.targeted ?? ro.targeted_scenarios ?? obj(ro.feedback)?.targeted).flatMap((t) => {
      const id = str(t) ?? str(obj(t)?.id);
      return id ? [id] : [];
    });
    return [
      {
        round,
        strategies,
        bestId: str(ro.best_id),
        parentId: null,
        worst: [],
        fixes: [],
        hitRate: recordedHit,
        hitRateSource: recordedHit !== null ? ("recorded" as const) : null,
        _targeted: targetedIds,
      },
    ];
  });
  rounds.sort((a, b) => a.round - b.round);

  const byId = new Map(rounds.flatMap((r) => r.strategies).map((s) => [s.id, s]));
  for (let i = 1; i < rounds.length; i++) {
    const rd = rounds[i];
    const parentId = rounds[i - 1].bestId;
    rd.parentId = parentId;
    for (const s of rd.strategies) s.parentId ??= parentId;
    const parentScenarios = parentId ? (scenarioMap.get(parentId) ?? []) : [];
    const targeted = rd._targeted.length
      ? rd._targeted.flatMap((id) => parentScenarios.filter((x) => x.id === id))
      : [...parentScenarios]
          .sort((a, b) => a.score - a.max - (b.score - b.max))
          .slice(0, CRITIC_WORST)
          .filter((s) => s.score < s.max);
    rd.worst = targeted;
    const survivor = rd.bestId ? byId.get(rd.bestId) : undefined;
    rd.fixes = targeted.map((t) => {
      const after = survivor?.scenarioScores[t.id]?.score ?? null;
      const status: FixStatus =
        after === null ? "unknown" : after >= t.max ? "fixed" : after > t.score ? "improved" : after === t.score ? "same" : "worse";
      return { id: t.id, before: t.score, after, max: t.max, status };
    });
    if (rd.hitRate === null) {
      const known = rd.fixes.filter((f) => f.status !== "unknown");
      if (known.length) {
        rd.hitRate = known.filter((f) => f.status === "fixed" || f.status === "improved").length / known.length;
        rd.hitRateSource = "computed";
      }
    }
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
    rounds: rounds.map(({ _targeted, ...r }) => (void _targeted, r)),
    parallel: parallelOf(root),
    trainMax,
    expertTrain: testExpertId && expertScore !== null ? { id: testExpertId, score: expertScore } : null,
    test: rows,
    testCount,
  };
}
