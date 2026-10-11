import type OpenAI from "openai";
import { chatJSON, LLMParseError } from "@/lib/llm";
import type { LogEntry, Reading } from "@/types";

// ---------------------------------------------------------------------------
// Troubleshoot
// ---------------------------------------------------------------------------

export interface TroubleshootStep {
  action: string;
  /** Manual section number the step comes from (e.g. "3.2"); null only if the model gave none. */
  manual_section: string | null;
}

export interface TroubleshootResult {
  diagnosis: string;
  steps: TroubleshootStep[];
  escalate: boolean;
  /** Message for the supervisor; null when escalate is false. */
  escalation_message: string | null;
  /** Notes from the safety checks below (forced escalation, redacted amounts). */
  warnings: string[];
}

/**
 * Health-risk thresholds checked against the latest reading. Any breach forces
 * escalation regardless of what the model says. Defaults follow EPA drinking
 * water limits; confirm against your plant's permit.
 */
export const HEALTH_LIMITS = {
  chlorine_min: 0.2, // mg/L — residual below this may mean inadequate disinfection
  chlorine_max: 4.0, // mg/L — EPA maximum residual disinfectant level
  turbidity_max: 1.0, // NTU — EPA treatment technique limit
  ph_min: 6.5,
  ph_max: 8.5,
};

const SYSTEM_PROMPT = `You are a troubleshooting assistant for water treatment plant operators.

Rules you must follow:
1. Only use guidance from the MANUAL. Every step must come from the manual and cite the section number it comes from in "manual_section" (e.g. "3.2"). Do not add steps the manual doesn't support. If the manual doesn't cover the situation, say so in the diagnosis and escalate.
2. Never invent chemical doses. Only use doses, feed rates, concentrations, or quantities that appear verbatim in the MANUAL. Never estimate an amount. If the manual doesn't give one, say "see manual / ask supervisor for amount".
3. If there is ANY possible risk to public health (inadequate disinfection, high turbidity, disinfectant overdose, contamination, pH out of range, equipment failure affecting treatment), set "health_risk": true and "escalate": true.
4. Also escalate if previous log entries show the same problem was not resolved, or if the fix is beyond operator authority.
5. If you escalate, write "escalation_message": a short message to the shift supervisor stating plant, problem, key readings, and what has been tried. Otherwise null.

Respond with ONLY a JSON object, no prose:
{
  "diagnosis": string,
  "steps": [{ "action": string, "manual_section": string }],
  "health_risk": boolean,
  "escalate": boolean,
  "escalation_message": string | null
}`;

export async function troubleshoot(
  description: string,
  readings: Reading[],
  logs: LogEntry[],
  manualText: string,
): Promise<TroubleshootResult> {
  const warnings: string[] = [];
  const healthFlags = checkHealthLimits(readings);

  const userPrompt = [
    `PROBLEM DESCRIPTION:\n${description}`,
    `RECENT READINGS (chlorine mg/L, turbidity NTU):\n${JSON.stringify(readings, null, 2)}`,
    `RECENT LOG ENTRIES:\n${JSON.stringify(logs, null, 2)}`,
    manualText.trim()
      ? `MANUAL:\n<<<\n${manualText}\n>>>`
      : "MANUAL: (none provided — do not give any amounts, and cite null for every step)",
  ].join("\n\n");

  const parsed = await askWithRetry([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userPrompt },
  ]);
  if (!parsed) {
    warnings.push("Model returned invalid JSON twice; escalating by default.");
    return {
      diagnosis: "Automated diagnosis unavailable.",
      steps: [],
      escalate: true,
      escalation_message: buildEscalationMessage(description, readings, healthFlags),
      warnings: [...warnings, ...healthFlags],
    };
  }

  // Rule: never invent doses. Redact any amount that isn't in the manual
  // (or simply restating a reading).
  const allowed = allowedNumbers(manualText, readings);
  const redact = (text: string) => {
    const { text: out, removed } = redactUnknownAmounts(text, allowed);
    for (const r of removed) warnings.push(`Removed amount "${r}" — not found in the manual.`);
    return out;
  };
  const diagnosis = redact(parsed.diagnosis);
  const sections = manualSections(manualText);
  const steps = parsed.steps.map((s) => {
    const section = manualText.trim() ? s.manual_section : null;
    if (!section) {
      warnings.push(`Step cites no manual section: "${s.action}"`);
    } else if (!sections.has(section)) {
      warnings.push(`Step cites section ${section}, which isn't in the manual: "${s.action}"`);
    }
    return { action: redact(s.action), manual_section: section };
  });

  // Rule: always escalate possible health risks.
  let escalate = parsed.escalate || parsed.health_risk;
  if (healthFlags.length > 0) {
    if (!escalate) warnings.push("Escalation forced by health-limit check.");
    warnings.push(...healthFlags);
    escalate = true;
  }

  let escalation_message: string | null = null;
  if (escalate) {
    escalation_message = parsed.escalation_message
      ? redact(parsed.escalation_message)
      : buildEscalationMessage(description, readings, healthFlags);
  }

  return { diagnosis, steps, escalate, escalation_message, warnings };
}

/**
 * Call the model and validate the reply. If it isn't valid JSON in the expected
 * shape, show the model its reply and ask once more. Returns null if both fail.
 * API/config errors propagate.
 */
async function askWithRetry(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
): Promise<RawResult | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let reply: string;
    try {
      const raw = await chatJSON(messages);
      const parsed = coerceResult(raw);
      if (parsed) return parsed;
      reply = JSON.stringify(raw);
    } catch (err) {
      if (!(err instanceof LLMParseError)) throw err;
      reply = err.raw;
    }
    messages = [
      ...messages,
      { role: "assistant", content: reply },
      {
        role: "user",
        content:
          "That was not valid JSON in the required format. Reply again with ONLY the JSON object: diagnosis (string), steps (array of {action, manual_section}), health_risk (boolean), escalate (boolean), escalation_message (string or null).",
      },
    ];
  }
  return null;
}

/** Section numbers defined in the manual, e.g. "3.2" from "**3.2 Low residual". */
function manualSections(manualText: string): Set<string> {
  const out = new Set<string>();
  for (const m of manualText.matchAll(/(?:^|\*\*|#\s*)(\d+(?:\.\d+)+)\b/gm)) out.add(m[1]);
  return out;
}

/** Normalize "Section 3.2 Low residual" / "§3.2" to "3.2". */
function sectionNumber(v: unknown): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  return String(v).match(/\d+(?:\.\d+)+/)?.[0] ?? null;
}

function latestReading(readings: Reading[]): Reading | undefined {
  return readings.reduce<Reading | undefined>(
    (latest, r) => (!latest || r.date > latest.date ? r : latest),
    undefined,
  );
}

function checkHealthLimits(readings: Reading[]): string[] {
  const r = latestReading(readings);
  if (!r) return [];
  const L = HEALTH_LIMITS;
  const flags: string[] = [];
  if (r.chlorine < L.chlorine_min)
    flags.push(`Chlorine ${r.chlorine} mg/L is below ${L.chlorine_min} mg/L (${r.date}).`);
  if (r.chlorine > L.chlorine_max)
    flags.push(`Chlorine ${r.chlorine} mg/L is above ${L.chlorine_max} mg/L (${r.date}).`);
  if (r.turbidity > L.turbidity_max)
    flags.push(`Turbidity ${r.turbidity} NTU is above ${L.turbidity_max} NTU (${r.date}).`);
  if (r.ph < L.ph_min || r.ph > L.ph_max)
    flags.push(`pH ${r.ph} is outside ${L.ph_min}–${L.ph_max} (${r.date}).`);
  return flags;
}

function buildEscalationMessage(
  description: string,
  readings: Reading[],
  healthFlags: string[],
): string {
  const r = latestReading(readings);
  const parts = [`Escalation needed${r ? ` at ${r.plant_id}` : ""}: ${description}`];
  if (r) {
    parts.push(
      `Latest reading (${r.date}): chlorine ${r.chlorine} mg/L, turbidity ${r.turbidity} NTU, pH ${r.ph}.`,
    );
  }
  parts.push(...healthFlags);
  return parts.join(" ");
}

// Number followed by a dose/volume/mass/rate unit, e.g. "2.5 mg/L", "10 lb/day", "15%".
const AMOUNT_RE =
  /(\d+(?:\.\d+)?)\s*(mg\/l|ppm|ppb|ml|l|liters?|litres?|gal(?:lons?)?|lbs?|pounds?|kg|g|grams?|oz|%|percent)(?:\s*\/\s*(?:day|hr|hour|min|d|h))?(?![a-z])/gi;

function allowedNumbers(manualText: string, readings: Reading[]): Set<number> {
  const nums = new Set<number>();
  for (const m of manualText.matchAll(/\d+(?:\.\d+)?/g)) nums.add(parseFloat(m[0]));
  for (const r of readings) {
    nums.add(r.chlorine);
    nums.add(r.turbidity);
    nums.add(r.ph);
  }
  return nums;
}

function redactUnknownAmounts(
  text: string,
  allowed: Set<number>,
): { text: string; removed: string[] } {
  const removed: string[] = [];
  const out = text.replace(AMOUNT_RE, (match, num: string) => {
    if (allowed.has(parseFloat(num))) return match;
    removed.push(match);
    return "[amount not in manual — confirm with supervisor]";
  });
  return { text: out, removed };
}

interface RawResult {
  diagnosis: string;
  steps: TroubleshootStep[];
  health_risk: boolean;
  escalate: boolean;
  escalation_message: string | null;
}

function coerceResult(raw: unknown): RawResult | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.diagnosis !== "string" || !Array.isArray(o.steps)) return null;
  const steps: TroubleshootStep[] = [];
  for (const s of o.steps) {
    if (typeof s === "string") {
      steps.push({ action: s, manual_section: null });
    } else if (s && typeof s === "object" && typeof (s as { action?: unknown }).action === "string") {
      steps.push({
        action: (s as { action: string }).action,
        manual_section: sectionNumber((s as { manual_section?: unknown }).manual_section),
      });
    }
  }
  return {
    diagnosis: o.diagnosis,
    steps,
    // Anything other than an explicit false counts as true — fail safe.
    health_risk: o.health_risk !== false,
    escalate: o.escalate === true,
    escalation_message:
      typeof o.escalation_message === "string" && o.escalation_message.trim()
        ? o.escalation_message
        : null,
  };
}

// ---------------------------------------------------------------------------
// Handoff (not yet implemented)
// ---------------------------------------------------------------------------

export interface HandoffInput {
  plant_id: string;
  operator: string;
}

export async function handoffAgent(input: HandoffInput): Promise<string> {
  // TODO: implement — summarize recent readings + logs into a shift handoff note
  void input;
  return "";
}
