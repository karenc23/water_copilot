import { troubleshoot, type TroubleshootOptions, type TroubleshootResult } from "@/lib/agents";
import { checkLogs, checkReadings, getFailureMode, type Alert, type Tier } from "@/lib/rules";
import { finalTier, type SafeStep, type SafetyResult } from "@/lib/safety";
import type { LogEntry, Reading } from "@/types";

// rules → LLM → safety. Used by /api/troubleshoot and scripts/try-scenarios.ts.

export interface EscalationPacket {
  plant_id: string;
  tier: Tier;
  failure_mode: { id: string; name: string; manual_section: string } | null;
  /** The operator's own words, verbatim. */
  operator_report: string;
  recent_readings: Reading[];
  alerts: string[];
  /** From the logbook — things the operator actually recorded doing. */
  steps_reported_done: { date: string; steps: string[]; outcome: string }[];
  /** Suggested by Water Copilot. NOT yet done. */
  steps_recommended: string[];
  /** Plain-text rendering of the above, ready to send. */
  message: string;
}

export interface TroubleshootResponse {
  diagnosis: string;
  failure_mode: string | null;
  steps: SafeStep[];
  tier: Tier;
  alerts: Alert[];
  escalate: boolean;
  escalation_packet: EscalationPacket | null;
  warnings: string[];
  /** Counts of what the safety layer removed (used for scoring in scripts/optimize.ts). */
  safety_drops: { invalid_citation: number; dose: number };
}

/**
 * Optional observers for each stage, called with the stage's real output as it finishes.
 * Used by /api/troubleshoot/stream; they never change the result.
 */
export interface PipelineTrace {
  onRules?(alerts: Alert[], asOf: string | undefined): void;
  onModelStart?(): void;
  onModel?(llm: TroubleshootResult, ms: number): void;
  onSafety?(safe: SafetyResult, llm: TroubleshootResult): void;
}

export async function runTroubleshoot(
  input: {
    plant_id: string;
    description: string;
    readings: Reading[];
    logs: LogEntry[];
    manualText: string;
  },
  options: TroubleshootOptions = {},
  trace: PipelineTrace = {},
): Promise<TroubleshootResponse> {
  const { plant_id, description, readings, logs, manualText } = input;
  const asOf = latestDate(readings, logs);

  const alerts = [...checkReadings(readings), ...checkLogs(logs, asOf)];
  trace.onRules?.(alerts, asOf);
  trace.onModelStart?.();
  const started = Date.now();
  const llm = await troubleshoot(description, readings, logs, manualText, alerts, options);
  trace.onModel?.(llm, Date.now() - started);
  const safe = finalTier(llm, alerts, manualText, readings);
  trace.onSafety?.(safe, llm);

  return {
    diagnosis: safe.diagnosis,
    failure_mode: llm.failure_mode,
    steps: safe.steps,
    tier: safe.tier,
    alerts,
    escalate: safe.escalate,
    escalation_packet: safe.escalate
      ? buildEscalationPacket({ plant_id, description, readings, logs, alerts, asOf, tier: safe.tier, failure_mode: llm.failure_mode, steps: safe.steps })
      : null,
    warnings: safe.warnings,
    safety_drops: safe.dropped,
  };
}

/** "Today" for the rules: the latest reading, or the latest log entry if there are no readings. */
export function latestDate(readings: Reading[], logs: LogEntry[]): string | undefined {
  const rows: { date: string }[] = readings.length ? readings : logs;
  return rows.map((r) => r.date).sort().at(-1);
}

const RECENT_READINGS = 5;
const RECENT_LOG_DAYS = 30;

/** Built entirely from data the app has — nothing here is written by the LLM. */
export function buildEscalationPacket(args: {
  plant_id: string;
  description: string;
  readings: Reading[];
  logs: LogEntry[];
  alerts: Alert[];
  asOf: string | undefined;
  tier: Tier;
  failure_mode: string | null;
  steps: SafeStep[];
}): EscalationPacket {
  const mode = getFailureMode(args.failure_mode);
  const recent_readings = [...args.readings].sort((a, b) => a.date.localeCompare(b.date)).slice(-RECENT_READINGS);
  const end = args.asOf ? Date.parse(args.asOf) : Infinity;
  const steps_reported_done = [...args.logs]
    .filter((l) => Date.parse(l.date) <= end && (end - Date.parse(l.date)) / 86_400_000 <= RECENT_LOG_DAYS)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((l) => ({ date: l.date, steps: l.steps_taken, outcome: l.outcome }));
  const alerts = args.alerts.map((a) => `[${a.tier.toUpperCase()}] ${a.message} (Manual ${a.manual_section})`);
  const steps_recommended = args.steps
    .filter((s) => s.source === "llm")
    .map((s) => `${s.action} (Manual ${s.manual_section})`);

  const lines = [
    `ESCALATION — ${args.plant_id} — tier ${args.tier.toUpperCase()}`,
    mode ? `Failure mode: ${mode.id} ${mode.name} (Manual ${mode.manual_section})` : "Failure mode: not identified",
    "",
    "Operator's report:",
    `  "${args.description}"`,
    "",
    "Recent readings:",
    ...(recent_readings.length
      ? recent_readings.map((r) => `  ${r.date}  chlorine ${r.chlorine} mg/L  turbidity ${r.turbidity} NTU  pH ${r.ph}`)
      : ["  (none)"]),
    "",
    "Alerts:",
    ...(alerts.length ? alerts.map((a) => `  - ${a}`) : ["  (none)"]),
    "",
    `Steps the operator logged in the last ${RECENT_LOG_DAYS} days:`,
    ...(steps_reported_done.length
      ? steps_reported_done.map((l) => `  - ${l.date}: ${l.steps.join("; ")} → ${l.outcome}`)
      : ["  (none logged)"]),
    "",
    "Recommended by Water Copilot (NOT yet done):",
    ...(steps_recommended.length ? steps_recommended.map((s, i) => `  ${i + 1}. ${s}`) : ["  (none)"]),
  ];

  return {
    plant_id: args.plant_id,
    tier: args.tier,
    failure_mode: mode ? { id: mode.id, name: mode.name, manual_section: mode.manual_section } : null,
    operator_report: args.description,
    recent_readings,
    alerts,
    steps_reported_done,
    steps_recommended,
    message: lines.join("\n"),
  };
}
