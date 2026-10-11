import type OpenAI from "openai";
import { chatJSON, LLMParseError, type ChatOptions } from "@/lib/llm";
import { FAILURE_MODES, getFailureMode, type Alert } from "@/lib/rules";
import type { LogEntry, Reading } from "@/types";

// ---------------------------------------------------------------------------
// Troubleshoot (LLM step only — lib/safety.ts has the final say)
// ---------------------------------------------------------------------------

export const MAX_STEPS = 5;
export const MAX_STEP_WORDS = 25;
const MAX_TOKENS = 700;
// Reasoning tokens count toward max_tokens. With this ~4k-token prompt even "low"
// reasoning fills a 700-token cap before any JSON is written, so it gets a larger cap.
const REASONING_MAX_TOKENS = 1500;
const DEFAULT_REASONING_EFFORT = (process.env.LUMINAL_REASONING_EFFORT || "none") as ReasoningEffort;

export type ReasoningEffort = "none" | "low";
export type ContextOrder = "description_first" | "readings_first" | "logbook_first";

/** Tunable parts of the LLM step. scripts/optimize.ts searches over these. */
export interface TroubleshootOptions {
  /** Rules/instructions part of the system prompt. The failure-mode list and JSON format are always appended by code. */
  instructions?: string;
  contextOrder?: ContextOrder;
  maxSteps?: number;
  /** "none" uses a 700-token cap; "low" uses 1,500. */
  reasoningEffort?: ReasoningEffort;
}

export interface TroubleshootStep {
  action: string;
  /** Manual section number the step comes from (e.g. "3.2"); null if the model gave none. */
  manual_section: string | null;
}

export interface TroubleshootResult {
  diagnosis: string;
  /** Failure mode id from data/failure_modes.json, or null if missing/unknown. */
  failure_mode: string | null;
  steps: TroubleshootStep[];
  /** The model's own escalation call. It can raise the final tier, never lower it. */
  escalate: boolean;
  health_risk: boolean;
  warnings: string[];
}

export const FAILURE_MODE_LIST = FAILURE_MODES.map(
  (f) => `${f.id} [${f.tier}] ${f.name} (Manual ${f.manual_section}): ${f.description}`,
).join("\n");

export const DEFAULT_INSTRUCTIONS = `You are a troubleshooting assistant for water treatment plant operators.

Rules you must follow:
1. Only use guidance from the MANUAL. Every step must come from the manual and cite its section number in "manual_section" (e.g. "3.2"). If the manual doesn't cover the situation, say so and escalate.
2. Never invent chemical doses. Only use amounts that appear verbatim in the MANUAL.
3. If there is ANY possible risk to public health, set "health_risk": true and "escalate": true. Also escalate if the logbook shows the same problem 3+ times in 30 days or two failed backwashes.
4. "diagnosis" is ONE sentence. List the most important step first; each step under ${MAX_STEP_WORDS} words.`;

/** Instructions + the parts code always controls: step limit, failure modes, output format. */
export function buildSystemPrompt(instructions: string, maxSteps: number): string {
  return `${instructions.trim()}

Give at most ${maxSteps} steps.

Choose the single best "failure_mode" id from this list:
${FAILURE_MODE_LIST}

Respond with ONLY a JSON object, no prose:
{"diagnosis": string, "failure_mode": string, "steps": [{"action": string, "manual_section": string}], "health_risk": boolean, "escalate": boolean}`;
}

const CONTEXT_ORDERS: Record<ContextOrder, ("description" | "readings" | "logs" | "alerts")[]> = {
  description_first: ["description", "readings", "logs", "alerts"],
  readings_first: ["readings", "alerts", "logs", "description"],
  logbook_first: ["logs", "readings", "alerts", "description"],
};

export async function troubleshoot(
  description: string,
  readings: Reading[],
  logs: LogEntry[],
  manualText: string,
  alerts: Alert[] = [],
  options: TroubleshootOptions = {},
): Promise<TroubleshootResult> {
  const maxSteps = Math.max(1, Math.min(options.maxSteps ?? MAX_STEPS, MAX_STEPS));
  const effort = options.reasoningEffort ?? DEFAULT_REASONING_EFFORT;
  const warnings: string[] = [];

  const blocks = {
    description: `PROBLEM DESCRIPTION:\n${description}`,
    readings: `RECENT READINGS (chlorine mg/L, turbidity NTU):\n${JSON.stringify(readings)}`,
    logs: `RECENT LOG ENTRIES:\n${JSON.stringify(logs)}`,
    alerts: alerts.length
      ? `AUTOMATED ALERTS:\n${alerts.map((a) => `- [${a.tier}] ${a.message} (Manual ${a.manual_section})`).join("\n")}`
      : "AUTOMATED ALERTS: none",
  };
  const userPrompt = [
    ...CONTEXT_ORDERS[options.contextOrder ?? "description_first"].map((k) => blocks[k]),
    manualText.trim() ? `MANUAL:\n<<<\n${manualText}\n>>>` : "MANUAL: (none provided)",
  ].join("\n\n");

  const parsed = await askWithRetry(
    [
      { role: "system", content: buildSystemPrompt(options.instructions ?? DEFAULT_INSTRUCTIONS, maxSteps) },
      { role: "user", content: userPrompt },
    ],
    effort,
    maxSteps,
  );
  if (!parsed) {
    return {
      diagnosis: "Automated diagnosis unavailable.",
      failure_mode: null,
      steps: [],
      escalate: true,
      health_risk: true,
      warnings: ["Model returned invalid JSON twice; escalating by default."],
    };
  }

  let failure_mode = parsed.failure_mode;
  if (failure_mode && !getFailureMode(failure_mode)) {
    warnings.push(`Model chose unknown failure mode "${failure_mode}".`);
    failure_mode = null;
  }
  if (parsed.steps.length > maxSteps) {
    warnings.push(`Model gave ${parsed.steps.length} steps; kept the first ${maxSteps}.`);
  }
  const steps = parsed.steps.slice(0, maxSteps);
  for (const s of steps) {
    const words = s.action.split(/\s+/).filter(Boolean).length;
    if (words > MAX_STEP_WORDS) warnings.push(`Step is ${words} words: "${s.action}"`);
  }

  return {
    diagnosis: parsed.diagnosis,
    failure_mode,
    steps,
    escalate: parsed.escalate,
    health_risk: parsed.health_risk,
    warnings,
  };
}

/**
 * Call the model and validate the reply. If it isn't valid JSON in the expected
 * shape (including a reply cut off by max_tokens), show the model its reply and
 * ask once more with reasoning off. Returns null if both fail. API/config errors propagate.
 */
async function askWithRetry(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  effort: ReasoningEffort,
  maxSteps: number,
): Promise<RawResult | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const attemptEffort: ChatOptions["reasoning_effort"] = attempt === 0 ? effort : "none";
    let reply: string;
    try {
      const raw = await chatJSON(messages, {
        max_tokens: attemptEffort === "none" ? MAX_TOKENS : REASONING_MAX_TOKENS,
        reasoning_effort: attemptEffort,
        label: attempt === 0 ? "troubleshoot" : "troubleshoot-retry",
      });
      const parsed = coerceResult(raw);
      if (parsed) return parsed;
      reply = JSON.stringify(raw);
    } catch (err) {
      if (!(err instanceof LLMParseError)) throw err;
      reply = err.raw;
    }
    messages = [
      ...messages,
      { role: "assistant", content: reply || "(empty reply)" },
      {
        role: "user",
        content: `That was not valid JSON in the required format. Reply again with ONLY the JSON object: diagnosis (one sentence), failure_mode (id), steps (at most ${maxSteps} of {action, manual_section}), health_risk (boolean), escalate (boolean). Keep it short.`,
      },
    ];
  }
  return null;
}

/** Normalize "Section 3.2 Low residual" / "§3.2" to "3.2". */
function sectionNumber(v: unknown): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  return String(v).match(/\d+(?:\.\d+)+/)?.[0] ?? null;
}

interface RawResult {
  diagnosis: string;
  failure_mode: string | null;
  steps: TroubleshootStep[];
  health_risk: boolean;
  escalate: boolean;
}

function coerceResult(raw: unknown): RawResult | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.diagnosis !== "string" || !Array.isArray(o.steps)) return null;
  const steps: TroubleshootStep[] = [];
  for (const s of o.steps) {
    if (typeof s === "string") {
      steps.push({ action: s, manual_section: sectionNumber(s) });
    } else if (s && typeof s === "object" && typeof (s as { action?: unknown }).action === "string") {
      steps.push({
        action: (s as { action: string }).action,
        manual_section: sectionNumber((s as { manual_section?: unknown }).manual_section),
      });
    }
  }
  const fm = typeof o.failure_mode === "string" ? o.failure_mode.trim().toUpperCase() : "";
  return {
    diagnosis: o.diagnosis,
    failure_mode: fm.match(/F\d+/)?.[0] ?? null,
    steps,
    // Anything other than an explicit false counts as true — fail safe.
    health_risk: o.health_risk !== false,
    escalate: o.escalate === true,
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
