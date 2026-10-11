import type { TroubleshootResult } from "@/lib/agents";
import { getFailureMode, maxTier, type Alert, type Tier } from "@/lib/rules";
import type { Reading } from "@/types";

// Safety layer — no LLM. Runs after the model and has the final say:
// the model can raise the tier but never lower it.

export interface SafeStep {
  action: string;
  manual_section: string;
  /** "safety" = inserted by code; "llm" = suggested by the model. */
  source: "safety" | "llm";
  /** e.g. "dose: 5%", "dose not in manual: 2.5 mg/L" */
  flags: string[];
}

export interface SafetyResult {
  tier: Tier;
  escalate: boolean;
  diagnosis: string;
  steps: SafeStep[];
  warnings: string[];
}

const RMW_STEP_RE = /\b(contact|call|notify|phone)\b.*\b(rmw|remote maintenance worker)\b/i;

// Number followed by a dose/volume/mass/rate unit, e.g. "2.5 mg/L", "10 lb/day", "15%".
const DOSE_RE =
  /(\d+(?:\.\d+)?)\s*(mg\/l|ppm|ppb|ml|l|liters?|litres?|gal(?:lons?)?|lbs?|pounds?|kg|g|grams?|oz|%|percent)(?:\s*\/\s*(?:day|hr|hour|min|d|h))?(?![a-z])/gi;

export function finalTier(
  llm: TroubleshootResult,
  alerts: Alert[],
  manualText: string,
  readings: Reading[] = [],
): SafetyResult {
  const warnings = [...llm.warnings];
  const mode = getFailureMode(llm.failure_mode);

  // Tier: highest of the alerts, the chosen failure mode, and the model's own escalation call.
  const tier = maxTier(
    ...alerts.map((a) => a.tier),
    mode?.tier ?? "green",
    llm.escalate || llm.health_risk ? "red" : "green",
  );
  const escalate = tier === "red";

  const sections = manualSections(manualText);
  // Amounts the model may repeat: an amount the manual states with a unit (not just any
  // number — "2.5" is also a section number), or a reading it's restating.
  const manualNumbers = new Set([...manualText.matchAll(DOSE_RE)].map((m) => parseFloat(m[1])));
  const readingNumbers = new Set(readings.flatMap((r) => [r.chlorine, r.turbidity, r.ph]));

  // Flag every dose; redact any that isn't in the manual or the readings.
  const checkDoses = (text: string, flags: string[]) =>
    text.replace(DOSE_RE, (match, num: string) => {
      const n = parseFloat(num);
      if (readingNumbers.has(n)) return match;
      if (manualNumbers.has(n)) {
        flags.push(`dose: ${match}`);
        return match;
      }
      flags.push(`dose not in manual: ${match}`);
      warnings.push(`Removed dose "${match}" — not found in the manual.`);
      return "[amount not in manual — confirm with RMW]";
    });

  const diagnosisFlags: string[] = [];
  const diagnosis = checkDoses(llm.diagnosis, diagnosisFlags);

  const steps: SafeStep[] = [];
  for (const s of llm.steps) {
    if (!s.manual_section || !sections.has(s.manual_section)) {
      warnings.push(
        `Dropped step citing ${s.manual_section ? `nonexistent section ${s.manual_section}` : "no section"}: "${s.action}"`,
      );
      continue;
    }
    // The urgent RMW step is added by code below; drop the model's version to avoid duplicates.
    if (escalate && RMW_STEP_RE.test(s.action)) continue;
    const flags: string[] = [];
    const action = checkDoses(s.action, flags);
    steps.push({ action, manual_section: s.manual_section, source: "llm", flags });
  }

  if (escalate) {
    const section = urgentSection(alerts, mode?.tier === "red" ? mode.manual_section : undefined);
    steps.unshift({
      action: `Contact your Remote Maintenance Worker now (Manual §${section})`,
      manual_section: section,
      source: "safety",
      flags: [],
    });
  }

  return { tier, escalate, diagnosis, steps, warnings };
}

/** Section to cite for the RMW call: the first red alert, else a red failure mode, else 8.1. */
function urgentSection(alerts: Alert[], redModeSection?: string): string {
  return alerts.find((a) => a.tier === "red")?.manual_section ?? redModeSection ?? "8.1";
}

/** Section numbers defined in the manual, e.g. "3.2" from "**3.2 Low residual". */
export function manualSections(manualText: string): Set<string> {
  const out = new Set<string>();
  for (const m of manualText.matchAll(/(?:^|\*\*|#\s*)(\d+(?:\.\d+)+)\b/gm)) out.add(m[1]);
  return out;
}
