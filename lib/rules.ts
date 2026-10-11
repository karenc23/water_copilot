import failureModesJson from "@/data/failure_modes.json";
import type { LogEntry, Reading } from "@/types";

// Deterministic safety rules — no LLM. Thresholds mirror data/manual.md Section 1.2,
// which follows EPA limits (chlorine 0.2–4.0 mg/L, turbidity ≤1 NTU, pH 6.5–8.5).

export type Tier = "green" | "yellow" | "red";

const TIER_RANK: Record<Tier, number> = { green: 0, yellow: 1, red: 2 };

export function maxTier(...tiers: Tier[]): Tier {
  return tiers.reduce<Tier>((a, b) => (TIER_RANK[b] > TIER_RANK[a] ? b : a), "green");
}

export interface Alert {
  rule_id: string;
  tier: Tier;
  parameter: "chlorine" | "turbidity" | "ph" | "logbook";
  message: string;
  manual_section: string;
}

export interface FailureMode {
  id: string;
  name: string;
  tier: Tier;
  manual_section: string;
  description: string;
}

export const FAILURE_MODES = failureModesJson as FailureMode[];

export function getFailureMode(id: string | null | undefined): FailureMode | undefined {
  return FAILURE_MODES.find((f) => f.id === id);
}

export const LIMITS = {
  chlorine: { red_below: 0.2, yellow_below: 0.5, yellow_above: 2.0, red_above: 4.0 }, // mg/L
  turbidity: { yellow_at: 0.25, red_above: 1.0 }, // NTU
  ph: { red_below: 6.5, yellow_below: 6.8, yellow_above: 8.0, red_above: 8.5 },
};

const byDate = <T extends { date: string }>(rows: T[]) =>
  [...rows].sort((a, b) => a.date.localeCompare(b.date));

/** Out-of-range checks on the latest reading, plus 3-day trends. */
export function checkReadings(readings: Reading[]): Alert[] {
  const sorted = byDate(readings);
  const r = sorted.at(-1);
  if (!r) return [];
  const alerts: Alert[] = [];
  const add = (rule_id: string, tier: Tier, parameter: Alert["parameter"], message: string, manual_section: string) =>
    alerts.push({ rule_id, tier, parameter, message: `${message} (${r.date})`, manual_section });

  const c = LIMITS.chlorine;
  if (r.chlorine < c.red_below) add("CL_CRITICAL_LOW", "red", "chlorine", `Chlorine ${r.chlorine} mg/L is below the ${c.red_below} mg/L minimum`, "3.3");
  else if (r.chlorine < c.yellow_below) add("CL_LOW", "yellow", "chlorine", `Chlorine ${r.chlorine} mg/L is below the ${c.yellow_below} mg/L action level`, "3.2");
  if (r.chlorine > c.red_above) add("CL_CRITICAL_HIGH", "red", "chlorine", `Chlorine ${r.chlorine} mg/L is above the ${c.red_above} mg/L EPA maximum`, "3.4");
  else if (r.chlorine > c.yellow_above) add("CL_HIGH", "yellow", "chlorine", `Chlorine ${r.chlorine} mg/L is above the ${c.yellow_above} mg/L action level`, "3.4");

  const t = LIMITS.turbidity;
  if (r.turbidity > t.red_above) add("TURB_CRITICAL", "red", "turbidity", `Turbidity ${r.turbidity} NTU is above the ${t.red_above} NTU EPA limit`, "4.3");
  else if (r.turbidity >= t.yellow_at) add("TURB_HIGH", "yellow", "turbidity", `Turbidity ${r.turbidity} NTU is at or above the ${t.yellow_at} NTU action level`, "4.2");

  const p = LIMITS.ph;
  if (r.ph < p.red_below || r.ph > p.red_above) add("PH_CRITICAL", "red", "ph", `pH ${r.ph} is outside ${p.red_below}–${p.red_above}`, "5.4");
  else if (r.ph < p.yellow_below) add("PH_LOW", "yellow", "ph", `pH ${r.ph} is below ${p.yellow_below}`, "5.2");
  else if (r.ph > p.yellow_above) add("PH_HIGH", "yellow", "ph", `pH ${r.ph} is above ${p.yellow_above}`, "5.3");

  // "3 days in a row" = three consecutive day-over-day changes, i.e. the last 4 readings.
  const last4 = sorted.slice(-4);
  if (last4.length === 4) {
    const cl = last4.map((x) => x.chlorine);
    if (cl.every((v, i) => i === 0 || v < cl[i - 1])) {
      add("CL_FALLING", "yellow", "chlorine", `Chlorine fell 3 days in a row (${cl.join(" → ")} mg/L)`, "3.5");
    }
    const tu = last4.map((x) => x.turbidity);
    if (tu.every((v, i) => i === 0 || v > tu[i - 1])) {
      add("TURB_RISING", "yellow", "turbidity", `Turbidity rose 3 days in a row (${tu.join(" → ")} NTU)`, "4.2");
    }
  }
  return alerts;
}

// Logbook categories for spotting repeat problems; first match wins.
const LOG_CATEGORIES: { name: string; re: RegExp; manual_section: string }[] = [
  { name: "circulation", re: /circ|loop|return temp|boiler/i, manual_section: "8.1" },
  { name: "filter", re: /filter|turbidity|backwash/i, manual_section: "2.5" },
  { name: "chlorine", re: /chlorine|hypochlorite/i, manual_section: "8.1" },
  { name: "pH", re: /\bph\b|soda ash/i, manual_section: "8.1" },
  { name: "pressure", re: /pressure|main break/i, manual_section: "8.1" },
  { name: "pump", re: /pump|breaker/i, manual_section: "8.1" },
];

const daysBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;

/**
 * Manual escalation conditions found in the logbook (Sections 2.5 and 8.1):
 * the same problem 3+ times in 30 days, or 2+ failed backwashes in the last 7 days.
 * `asOf` defaults to the latest log date.
 */
export function checkLogs(logs: LogEntry[], asOf?: string): Alert[] {
  const sorted = byDate(logs);
  const end = asOf ?? sorted.at(-1)?.date;
  if (!end) return [];
  const within = (days: number) => sorted.filter((l) => l.date <= end && daysBetween(l.date, end) <= days);
  const alerts: Alert[] = [];

  const recent30 = within(30);
  for (const cat of LOG_CATEGORIES) {
    const hits = recent30.filter((l) => LOG_CATEGORIES.find((c) => c.re.test(l.problem)) === cat);
    if (hits.length >= 3) {
      alerts.push({
        rule_id: "LOG_RECURRING",
        tier: "red",
        parameter: "logbook",
        message: `Same ${cat.name} problem logged ${hits.length} times in 30 days (${hits.map((h) => h.date).join(", ")})`,
        manual_section: cat.manual_section,
      });
    }
  }

  // A backwash "failed" if the logged outcome says it didn't fix the problem.
  let failed = 0;
  for (const l of within(7)) {
    const backwashes = l.steps_taken.filter((s) => /backwash/i.test(s));
    if (!backwashes.length) continue;
    const ntu = [...l.outcome.matchAll(/(\d+(?:\.\d+)?)\s*NTU/gi)].map((m) => parseFloat(m[1]));
    const didntWork = /\bstill\b|no improvement|did not|didn't|not improve/i.test(l.outcome) || ntu.some((v) => v > 0.3);
    if (didntWork) failed += backwashes.reduce((n, s) => n + (/twice/i.test(s) ? 2 : 1), 0);
  }
  if (failed >= 2) {
    alerts.push({
      rule_id: "LOG_BACKWASH_FAILED",
      tier: "red",
      parameter: "logbook",
      message: `${failed} backwashes in the last 7 days did not fix turbidity`,
      manual_section: "2.5",
    });
  }
  return alerts;
}
