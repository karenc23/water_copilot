// The Proof headline: generic prompt → the evolved strategy picked by the selection rule
// ("best training score across all runs, never test"), on the unseen test scenarios.
// Reads data/results_agents.json (scripts/optimize_agents.ts) when present, else data/results.json.
// Defensive: anything missing returns null and the headline is not shown.

export interface ProofScore {
  score: number;
  max: number;
  hard: { score: number; max: number } | null;
  missed: number | null;
  falseAlarms: number | null;
  missedRate: number | null;
  falseAlarmRate: number | null;
}

export interface Contender {
  id: string;
  label: string;
  trainScore: number;
  trainMax: number | null;
  test: ProofScore | null;
  selected: boolean;
}

export interface Proof {
  source: "results_agents.json" | "results.json";
  n: number;
  baseline: ProofScore;
  selected: Contender & { test: ProofScore };
  contenders: Contender[];
  rule: string;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function hardOf(v: unknown): ProofScore["hard"] {
  const m = typeof v === "string" ? v.match(/^\s*(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/) : null;
  return m && Number(m[2]) ? { score: Number(m[1]), max: Number(m[2]) } : null;
}

/** A test entry { score, metrics: { max_score, hard_score, ... } }. */
function scoreOf(v: unknown): ProofScore | null {
  const o = obj(v);
  const m = obj(o?.metrics) ?? {};
  const score = num(o?.score) ?? num(m.score);
  const max = num(m.max_score);
  if (score === null || max === null) return null;
  const recall = num(m.escalation_recall);
  return {
    score,
    max,
    hard: hardOf(m.hard_score),
    missed: num(m.missed_escalations),
    falseAlarms: num(m.false_alarms),
    missedRate: recall === null ? null : 1 - recall,
    falseAlarmRate: num(m.false_alarm_rate),
  };
}

/** Training score of a strategy id anywhere in a results.json round list. */
function trainScoreIn(root: Obj, id: string): { score: number; max: number | null } | null {
  for (const key of ["rounds", "single_agent_rounds"]) {
    for (const r of arr(root[key])) {
      for (const s of arr(obj(r)?.strategies)) {
        const so = obj(s);
        if (str(so?.id) === id && num(so?.score) !== null) return { score: num(so!.score)!, max: num(obj(so!.metrics)?.max_score) };
      }
    }
  }
  return null;
}

const RULE = "Selection rule: the evolved strategy is the one with the best training score across all runs. It was never chosen by test score.";

export function proofFromAgents(raw: unknown): Proof | null {
  const r = obj(raw);
  if (!r || r.dry_run === true) return null;
  const test = obj(r.test) ?? {};
  const baselineId = str(obj(r.round0)?.id) ?? "r0-generic";
  const baseline = scoreOf(test[baselineId]);
  if (!baseline) return null;
  const sel = obj(r.selected);
  const selId = str(sel?.id);
  const contenders: Contender[] = arr(r.report).flatMap((row) => {
    const o = obj(row);
    const id = str(o?.id);
    if (!o || !id || o.key === "generic" || o.key === "expert") return [];
    const tr = obj(obj(o.subsets)?.train);
    return [{ id, label: str(o.label) ?? id, trainScore: num(tr?.score) ?? 0, trainMax: num(tr?.max), test: scoreOf(test[id]), selected: id === selId }];
  });
  const selected = contenders.find((c) => c.selected);
  if (!selected?.test) return null;
  return { source: "results_agents.json", n: arr(r.test_scenarios).length, baseline, selected: selected as Proof["selected"], contenders, rule: RULE };
}

export function proofFromResults(raw: unknown): Proof | null {
  const r = obj(raw);
  if (!r) return null;
  const test = obj(r.test) ?? {};
  const baseline = scoreOf(test.r0_generic);
  if (!baseline) return null;
  const contenders: Contender[] = [
    ["best", "Parallel run (A)"],
    ["single_agent_best", "Single-agent run (B)"],
  ].flatMap(([key, label]) => {
    const t = obj(test[key]);
    const id = str(t?.id);
    const tr = id ? trainScoreIn(r, id) : null;
    return id && tr ? [{ id, label: `${label} · ${id}`, trainScore: tr.score, trainMax: tr.max, test: scoreOf(t), selected: false }] : [];
  });
  if (!contenders.length) return null;
  const top = contenders.reduce((a, c) => (c.trainScore > a.trainScore ? c : a));
  top.selected = true;
  if (!top.test) return null;
  return { source: "results.json", n: arr(r.test_scenarios).length, baseline, selected: top as Proof["selected"], contenders, rule: RULE };
}
