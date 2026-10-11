// Handoff handbook — the turnover USP.
//
// Generates a "Welcome to this plant" guide for the next operator entirely from
// the logbook: recurring problems, what usually works, who to call, what's
// overdue. This is the thing ChatGPT structurally cannot do — it has no memory
// of THIS plant.

import type { LogEntry } from "./types";

export interface HandoffGuide {
  plant_id: string;
  generated_at: string;
  summary: string;
  recurring_problems: { problem: string; count: number; usual_fix: string }[];
  what_usually_works: string[];
  escalation_history: { date: string; problem: string; outcome: string }[];
  quirks: string[];
  stats: { total_entries: number; escalations: number; span_days: number };
}

function normalize(problem: string): string {
  return problem.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
}

function keyOf(log: LogEntry): string {
  if (log.tags && log.tags.length) return log.tags[0];
  // Group by the first few significant words of the problem.
  return normalize(log.problem).split(" ").slice(0, 3).join(" ");
}

export function generateHandoff(
  plantId: string,
  logs: LogEntry[]
): HandoffGuide {
  const sorted = [...logs].sort((a, b) => a.date.localeCompare(b.date));

  // Group problems to find recurring ones.
  const groups = new Map<string, LogEntry[]>();
  for (const log of sorted) {
    const k = keyOf(log);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(log);
  }

  const recurring = [...groups.entries()]
    .filter(([, entries]) => entries.length >= 2)
    .map(([, entries]) => {
      // Pick the fix with a positive outcome, else the most recent.
      const good =
        entries.find((e) => /resolved|fixed|restored|cleared/i.test(e.outcome)) ||
        entries[entries.length - 1];
      return {
        problem: good.problem,
        count: entries.length,
        usual_fix: good.steps_taken,
      };
    })
    .sort((a, b) => b.count - a.count);

  const whatWorks = sorted
    .filter((l) => /resolved|fixed|restored|cleared/i.test(l.outcome))
    .slice(-6)
    .map((l) => `${l.problem}: ${l.steps_taken}`);

  const escalations = sorted
    .filter((l) => l.escalated)
    .map((l) => ({ date: l.date, problem: l.problem, outcome: l.outcome }));

  const quirks = deriveQuirks(recurring, escalations.length, sorted.length);

  const spanDays =
    sorted.length >= 2
      ? Math.round(
          (new Date(sorted[sorted.length - 1].date).getTime() -
            new Date(sorted[0].date).getTime()) /
            86400000
        )
      : 0;

  const summary =
    `This guide was built from ${sorted.length} logbook entries spanning ${spanDays} days. ` +
    (recurring.length
      ? `The plant has ${recurring.length} recurring issue(s) — read those first. `
      : "No strongly recurring issues so far. ") +
    `${escalations.length} issue(s) were escalated to the Remote Maintenance Worker. ` +
    `For anything in the ESCALATE band on Page 1 of the manual, call the RMW the same day.`;

  return {
    plant_id: plantId,
    generated_at: new Date().toISOString(),
    summary,
    recurring_problems: recurring,
    what_usually_works: whatWorks,
    escalation_history: escalations,
    quirks,
    stats: {
      total_entries: sorted.length,
      escalations: escalations.length,
      span_days: spanDays,
    },
  };
}

function deriveQuirks(
  recurring: { problem: string; count: number }[],
  escalations: number,
  total: number
): string[] {
  const quirks: string[] = [];
  for (const r of recurring) {
    if (r.count >= 3) {
      quirks.push(
        `"${r.problem}" has happened ${r.count} times — likely a root cause, not a one-off. Watch for it and consider flagging to the RMW.`
      );
    }
  }
  if (total > 0 && escalations / total > 0.25) {
    quirks.push(
      "This plant escalates often relative to its history — it may be running near its limits. Keep readings current for the expert."
    );
  }
  if (quirks.length === 0) {
    quirks.push(
      "No standout quirks detected yet. Keep logging every fix so the next operator inherits more than you did."
    );
  }
  return quirks;
}
