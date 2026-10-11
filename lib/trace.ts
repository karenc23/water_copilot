import type { TroubleshootResult, TroubleshootStep } from "@/lib/agents";
import type { EscalationPacket, TroubleshootResponse } from "@/lib/pipeline";
import { getFailureMode, LOG_CATEGORIES, maxTier, type Alert, type Tier } from "@/lib/rules";
import type { SafeStep, SafetyResult } from "@/lib/safety";
import type { LogEntry, Reading } from "@/types";

// Events streamed by /api/troubleshoot/stream, one per pipeline stage. Every field is
// taken from that stage's real output; the Agent Room only renders what is here.

export interface ManualRef {
  section: string;
  title: string | null;
}

export type TraceEvent =
  | {
      type: "sentinel";
      alerts: Alert[];
      readings_checked: number;
      latest: Reading | null;
      as_of: string | null;
    }
  | {
      type: "librarian";
      /** Number of numbered sections in the manual. The model is given the whole manual. */
      sections_total: number;
      /** Sections the rule alerts point to. */
      sections: ManualRef[];
    }
  | {
      type: "keeper";
      entries_total: number;
      window_days: number;
      /** Entries inside the window, newest first, with the rule category they fall into. */
      recent: { date: string; problem: string; outcome: string; escalated: boolean; category: string | null }[];
      /** e.g. { filter: 3 } */
      counts: Record<string, number>;
      log_alerts: Alert[];
    }
  | { type: "diagnostician_start" }
  | {
      type: "diagnostician";
      /** The model's own words, before the safety check. */
      diagnosis: string;
      failure_mode: { id: string; name: string; tier: Tier; manual_section: string } | null;
      escalate: boolean;
      health_risk: boolean;
      /** Highest of its failure mode's tier and its own escalate/health-risk call. */
      proposed_tier: Tier;
      steps: TroubleshootStep[];
      cited: ManualRef[];
      warnings: string[];
      ms: number;
    }
  | {
      type: "governor";
      proposed_tier: Tier;
      final_tier: Tier;
      raised: boolean;
      /** The alert(s) that set the final tier, when the Governor raised it. */
      reason: string | null;
      dropped_steps: { action: string; why: string }[];
      /** Model steps folded into the code-inserted RMW call. */
      merged_rmw_steps: number;
      inserted_steps: SafeStep[];
      doses_removed: string[];
      steps_kept: number;
    }
  | { type: "courier"; packet: EscalationPacket }
  | { type: "done"; result: TroubleshootResponse }
  | { type: "error"; error: string };

const RECENT_LOG_DAYS = 30;

/** Section titles from "**3.2 Low residual (0.2–0.5 mg/L).**". */
export function manualTitles(manualText: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of manualText.matchAll(/\*\*(\d+(?:\.\d+)+)\s+([^*]+?)\*\*/g)) {
    out.set(m[1], m[2].replace(/[.:]\s*$/, "").trim());
  }
  return out;
}

const refs = (sections: (string | null)[], titles: Map<string, string>): ManualRef[] =>
  [...new Set(sections.filter((s): s is string => !!s))].map((section) => ({ section, title: titles.get(section) ?? null }));

export function sentinelEvent(alerts: Alert[], readings: Reading[], asOf: string | undefined): TraceEvent {
  const latest = [...readings].sort((a, b) => a.date.localeCompare(b.date)).at(-1) ?? null;
  return { type: "sentinel", alerts, readings_checked: readings.length, latest, as_of: asOf ?? null };
}

export function librarianEvent(alerts: Alert[], manualText: string): TraceEvent {
  const titles = manualTitles(manualText);
  return { type: "librarian", sections_total: titles.size, sections: refs(alerts.map((a) => a.manual_section), titles) };
}

export function keeperEvent(logs: LogEntry[], alerts: Alert[], asOf: string | undefined): TraceEvent {
  const end = asOf ? Date.parse(asOf) : Infinity;
  const recent = [...logs]
    .filter((l) => Date.parse(l.date) <= end && (end - Date.parse(l.date)) / 86_400_000 <= RECENT_LOG_DAYS)
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((l) => ({
      date: l.date,
      problem: l.problem,
      outcome: l.outcome,
      escalated: l.escalated,
      category: LOG_CATEGORIES.find((c) => c.re.test(l.problem))?.name ?? null,
    }));
  const counts: Record<string, number> = {};
  for (const r of recent) if (r.category) counts[r.category] = (counts[r.category] ?? 0) + 1;
  return {
    type: "keeper",
    entries_total: logs.length,
    window_days: RECENT_LOG_DAYS,
    recent,
    counts,
    log_alerts: alerts.filter((a) => a.parameter === "logbook"),
  };
}

export function proposedTier(llm: TroubleshootResult): Tier {
  return maxTier(getFailureMode(llm.failure_mode)?.tier ?? "green", llm.escalate || llm.health_risk ? "red" : "green");
}

export function diagnosticianEvent(llm: TroubleshootResult, ms: number, manualText: string): TraceEvent {
  const mode = getFailureMode(llm.failure_mode);
  return {
    type: "diagnostician",
    diagnosis: llm.diagnosis,
    failure_mode: mode ? { id: mode.id, name: mode.name, tier: mode.tier, manual_section: mode.manual_section } : null,
    escalate: llm.escalate,
    health_risk: llm.health_risk,
    proposed_tier: proposedTier(llm),
    steps: llm.steps,
    cited: refs(llm.steps.map((s) => s.manual_section), manualTitles(manualText)),
    warnings: llm.warnings,
    ms,
  };
}

const DROPPED_RE = /^Dropped step citing (.+?): "([\s\S]*)"$/;
const DOSE_RE = /^Removed dose "(.+?)"/;

export function governorEvent(safe: SafetyResult, llm: TroubleshootResult, alerts: Alert[]): TraceEvent {
  const proposed = proposedTier(llm);
  const raised = safe.tier !== proposed && maxTier(proposed, safe.tier) === safe.tier;
  const setters = alerts.filter((a) => a.tier === safe.tier);
  const dropped_steps = safe.warnings.flatMap((w) => {
    const m = w.match(DROPPED_RE);
    return m ? [{ action: m[2], why: `cited ${m[1]}` }] : [];
  });
  const kept = safe.steps.filter((s) => s.source === "llm").length;
  return {
    type: "governor",
    proposed_tier: proposed,
    final_tier: safe.tier,
    raised,
    reason: raised && setters.length ? setters.map((a) => a.message).join("; ") : null,
    dropped_steps,
    merged_rmw_steps: Math.max(0, llm.steps.length - dropped_steps.length - kept),
    inserted_steps: safe.steps.filter((s) => s.source === "safety"),
    doses_removed: safe.warnings.flatMap((w) => w.match(DOSE_RE)?.[1] ?? []),
    steps_kept: kept,
  };
}
