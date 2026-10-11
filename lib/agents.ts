// The four agents + drift rules.
//
// Design principle: the AI never decides a health threshold. The Safety agent
// runs HARD-CODED rules (from THRESHOLDS, mirroring Page 1) first; the LLM only
// adds judgment on top and can escalate further, never relax a hard rule.

import { chat } from "./llm";
import { searchManual, searchLogs, addLog, getReadings } from "./db";
import {
  THRESHOLDS,
  type Reading,
  type LogEntry,
  type ManualHit,
  type Citation,
  type SafetyVerdict,
  type TroubleshootResult,
  type EscalationPacket,
  type DriftAlert,
} from "./types";

// ---------------------------------------------------------------------------
// 1. Manual agent — vector search over the plant's own manual.
// ---------------------------------------------------------------------------

export async function manualAgent(
  plantId: string,
  query: string,
  k = 4
): Promise<ManualHit[]> {
  return searchManual(plantId, query, k);
}

function toCitations(hits: ManualHit[]): Citation[] {
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const h of hits) {
    if (!seen.has(h.page)) {
      seen.add(h.page);
      out.push({ page: h.page, heading: h.heading });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. Safety agent — hard rules first, LLM second. Never relaxes a hard rule.
// ---------------------------------------------------------------------------

export function hardRuleCheck(readings?: Reading): SafetyVerdict | null {
  if (!readings) return null;
  const { chlorine, turbidity, ph } = readings;
  const t = THRESHOLDS;

  if (chlorine < t.chlorine.min_safe && turbidity >= t.turbidity.escalate) {
    return {
      escalate: true,
      health_critical: true,
      reason:
        "Rule 1C: chlorine below 0.3 mg/L AND turbidity at/above 1.0 NTU at once — disinfection failure. Consider a boil-water notice.",
      rule: "1C",
      source: "hard-rule",
    };
  }
  if (chlorine < t.chlorine.min_safe) {
    return {
      escalate: true,
      health_critical: true,
      reason: `Rule 1A: free chlorine ${chlorine} mg/L is below the 0.3 mg/L limit — water may not be disinfected.`,
      rule: "1A",
      source: "hard-rule",
    };
  }
  if (chlorine > t.chlorine.max_safe) {
    return {
      escalate: true,
      health_critical: true,
      reason: `Rule 1A: free chlorine ${chlorine} mg/L is above the 4.0 mg/L limit — regulator may be stuck open (Page 3E).`,
      rule: "1A",
      source: "hard-rule",
    };
  }
  if (turbidity >= t.turbidity.escalate) {
    return {
      escalate: true,
      health_critical: true,
      reason: `Rule 1B: turbidity ${turbidity} NTU is at/above 1.0 NTU — can shield pathogens from chlorine.`,
      rule: "1B",
      source: "hard-rule",
    };
  }
  if (ph < t.ph.min_safe || ph > t.ph.max_safe) {
    return {
      escalate: true,
      health_critical: true,
      reason: `Page 1/5: pH ${ph} is outside the 6.5-8.5 safe band.`,
      rule: "pH",
      source: "hard-rule",
    };
  }
  return null;
}

export async function safetyAgent(
  report: string,
  readings: Reading | undefined,
  manualContext: string
): Promise<SafetyVerdict> {
  const hard = hardRuleCheck(readings);
  if (hard) return hard; // Hard rule is final when it fires.

  // No hard rule tripped. Ask the LLM whether softer signals (gas leak smell,
  // recurring unresolved problem) warrant escalation per Page 7.
  let llmEscalate = false;
  let llmReason =
    "No ESCALATE-band reading. Handle locally and monitor; log the outcome.";
  try {
    const raw = await chat(
      [
        {
          role: "system",
          content:
            "You are the Safety agent for a water plant. Hard numeric rules already passed (no reading is in an escalate band). Decide ONLY whether a non-numeric safety condition requires escalating to the Remote Maintenance Worker: a chlorine GAS LEAK (smell/hiss/alarm), or a RECURRING problem the operator cannot resolve. Err toward escalation if a gas leak is plausible. Respond with JSON: {\"escalate\": boolean, \"reason\": string}.",
        },
        {
          role: "user",
          content: `Operator report: ${report}\n\nManual context:\n${manualContext}\n\nRespond with JSON.`,
        },
      ],
      { json: true }
    );
    const parsed = JSON.parse(raw);
    if (typeof parsed.escalate === "boolean") {
      llmEscalate = parsed.escalate;
      if (parsed.reason) llmReason = parsed.reason;
    }
  } catch {
    // Keyword backstop so a gas leak is never missed if the LLM is unavailable.
    const r = report.toLowerCase();
    if (
      (r.includes("leak") || r.includes("hiss") || r.includes("smell")) &&
      r.includes("chlor")
    ) {
      llmEscalate = true;
      llmReason =
        "Page 3D: possible chlorine gas leak reported — evacuate and call the RMW. Do not repair alone.";
    } else if (
      r.includes("again") ||
      r.includes("times") ||
      r.includes("keeps") ||
      r.includes("recurring")
    ) {
      llmEscalate = true;
      llmReason =
        "Page 7: recurring problem the operator cannot resolve — flag to the RMW.";
    }
  }

  return {
    escalate: llmEscalate,
    health_critical: false,
    reason: llmReason,
    rule: llmEscalate ? "Page 7" : null,
    source: "llm",
  };
}

// ---------------------------------------------------------------------------
// 3. Troubleshooting agent — writes cited steps using the manual + logbook.
// ---------------------------------------------------------------------------

export async function troubleshootAgent(
  plantId: string,
  report: string,
  readings?: Reading
): Promise<TroubleshootResult> {
  const hits = await manualAgent(plantId, report, 4);
  const citations = toCitations(hits);
  const manualContext = hits
    .map((h) => `[${h.page} — ${h.heading}]\n${h.text}`)
    .join("\n\n");

  const past_similar = await searchLogs(plantId, report, 3);
  const safety = await safetyAgent(report, readings, manualContext);

  const { diagnosis, steps } = await writeSteps(
    report,
    readings,
    manualContext,
    citations,
    past_similar
  );

  const result: TroubleshootResult = {
    diagnosis,
    steps,
    citations,
    safety,
    past_similar,
  };

  if (safety.escalate) {
    result.escalation_packet = await buildEscalationPacket(
      plantId,
      diagnosis,
      steps
    );
  }

  return result;
}

async function writeSteps(
  report: string,
  readings: Reading | undefined,
  manualContext: string,
  citations: Citation[],
  past: LogEntry[]
): Promise<{ diagnosis: string; steps: string[] }> {
  const citeList = citations.map((c) => c.page).join(", ") || "the manual";
  const pastText =
    past.length > 0
      ? past
          .map(
            (p) =>
              `- ${p.date}: ${p.problem} -> ${p.steps_taken} (outcome: ${p.outcome})`
          )
          .join("\n")
      : "No similar past entries.";

  try {
    const raw = await chat(
      [
        {
          role: "system",
          content:
            "You are the Troubleshooting agent for a rural water plant operator. Using ONLY the provided manual context, write a short diagnosis and 3-6 concrete numbered steps. Cite manual pages inline like (Page 3). NEVER invent a chemical dose or a numeric safety limit that is not in the manual context. Respond with JSON: {\"diagnosis\": string, \"steps\": string[]}.",
        },
        {
          role: "user",
          content: `Operator report: ${report}
Current readings: ${
              readings
                ? `chlorine ${readings.chlorine} mg/L, turbidity ${readings.turbidity} NTU, pH ${readings.ph}`
                : "none provided"
            }

Manual context (cite these pages: ${citeList}):
${manualContext}

What worked before at this plant:
${pastText}

Respond with JSON.`,
        },
      ],
      { json: true }
    );
    const parsed = JSON.parse(raw);
    if (parsed.diagnosis && Array.isArray(parsed.steps)) {
      return { diagnosis: parsed.diagnosis, steps: parsed.steps };
    }
  } catch {
    // fall through to deterministic summary
  }

  return {
    diagnosis: `See ${citeList} for the matching procedure.`,
    steps: [
      `Confirm the current readings against the Page 1 limits.`,
      `Follow the procedure in ${citeList}.`,
      `Log the problem, the steps you took, and the outcome.`,
    ],
  };
}

// ---------------------------------------------------------------------------
// 4. Logbook agent — save an issue+fix and recall past entries.
// ---------------------------------------------------------------------------

export async function logbookAgent(entry: LogEntry): Promise<void> {
  await addLog(entry);
}

export async function recallSimilar(
  plantId: string,
  query: string,
  limit = 5
): Promise<LogEntry[]> {
  return searchLogs(plantId, query, limit);
}

// Expert handoff packet: structured summary for the remote expert.
export async function buildEscalationPacket(
  plantId: string,
  diagnosis: string,
  steps: string[]
): Promise<EscalationPacket> {
  const recent = await getReadings(plantId, 14);
  return {
    plant_id: plantId,
    summary: diagnosis,
    recent_readings: recent,
    steps_tried: steps.join(" "),
    generated_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Drift rules — plain code, not AI (Page 2). The plant watches trends.
// ---------------------------------------------------------------------------

export function computeDrift(readings: Reading[]): DriftAlert[] {
  const alerts: DriftAlert[] = [];
  if (readings.length < 2) return alerts;

  const sorted = [...readings].sort((a, b) => a.date.localeCompare(b.date));
  const last3 = sorted.slice(-3);

  // Drift 2A — chlorine declining 3 consecutive days.
  if (last3.length === 3 && strictlyDecreasing(last3.map((r) => r.chlorine))) {
    alerts.push({
      parameter: "chlorine",
      rule: "Drift 2A",
      message:
        "Free chlorine has dropped three days running. Check the injector feed (Page 3A) before it crosses the 0.3 mg/L limit.",
      severity: "warning",
    });
  }

  // Drift 2B — turbidity climbing 3 consecutive days.
  if (last3.length === 3 && strictlyIncreasing(last3.map((r) => r.turbidity))) {
    alerts.push({
      parameter: "turbidity",
      rule: "Drift 2B",
      message:
        "Turbidity has risen three days running. The filter is nearing breakthrough — schedule a backwash (Page 4A).",
      severity: "warning",
    });
  }

  // Drift 2C — pH swing > 0.5 units in one day.
  const [prev, curr] = sorted.slice(-2);
  if (Math.abs(curr.ph - prev.ph) > 0.5) {
    alerts.push({
      parameter: "ph",
      rule: "Drift 2C",
      message: `pH moved ${(curr.ph - prev.ph).toFixed(
        1
      )} units in a day. Check the soda ash feed or a source change (Page 5).`,
      severity: "warning",
    });
  }

  return alerts;
}

function strictlyDecreasing(xs: number[]): boolean {
  return xs.every((x, i) => i === 0 || x < xs[i - 1]);
}
function strictlyIncreasing(xs: number[]): boolean {
  return xs.every((x, i) => i === 0 || x > xs[i - 1]);
}

// Knowledge-risk score for the dashboard: how exposed is this plant if the
// operator leaves? Higher = more undocumented, more recurring unresolved issues.
export function knowledgeRiskScore(logs: LogEntry[]): {
  score: number;
  label: string;
  factors: string[];
} {
  const factors: string[] = [];
  let score = 0;

  if (logs.length < 10) {
    score += 30;
    factors.push("Thin logbook — little history captured for the next operator.");
  }
  const unresolved = logs.filter(
    (l) => l.escalated && /pending|unresolved|waiting/i.test(l.outcome)
  ).length;
  if (unresolved > 0) {
    score += unresolved * 10;
    factors.push(`${unresolved} escalated issue(s) still open.`);
  }

  // Recurring problems that keep coming back indicate undocumented root causes.
  const problemCounts = new Map<string, number>();
  for (const l of logs) {
    const key = (l.tags && l.tags[0]) || l.problem.slice(0, 20).toLowerCase();
    problemCounts.set(key, (problemCounts.get(key) || 0) + 1);
  }
  const recurring = [...problemCounts.values()].filter((n) => n >= 3).length;
  if (recurring > 0) {
    score += recurring * 15;
    factors.push(`${recurring} recurring problem(s) with no permanent fix.`);
  }

  score = Math.min(100, score);
  const label = score >= 60 ? "High" : score >= 30 ? "Medium" : "Low";
  return { score, label, factors };
}
