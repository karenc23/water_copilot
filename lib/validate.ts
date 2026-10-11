import type { LogEntry, Reading } from "@/types";

// Minimal runtime validation for request bodies and seed data.
// Returns the cleaned value, or an error message.

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isDate = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(Date.parse(v));

export function parseReading(v: unknown): Result<Reading> {
  if (!isObj(v)) return { ok: false, error: "reading must be an object" };
  if (!isStr(v.plant_id)) return { ok: false, error: "plant_id is required" };
  if (!isDate(v.date)) return { ok: false, error: "date must be ISO 8601 (YYYY-MM-DD)" };
  for (const k of ["chlorine", "turbidity", "ph"] as const) {
    if (!isNum(v[k])) return { ok: false, error: `${k} must be a number` };
  }
  return {
    ok: true,
    value: {
      plant_id: v.plant_id,
      date: v.date,
      chlorine: v.chlorine as number,
      turbidity: v.turbidity as number,
      ph: v.ph as number,
    },
  };
}

export function parseLog(v: unknown): Result<LogEntry> {
  if (!isObj(v)) return { ok: false, error: "log entry must be an object" };
  if (!isStr(v.plant_id)) return { ok: false, error: "plant_id is required" };
  if (!isDate(v.date)) return { ok: false, error: "date must be ISO 8601 (YYYY-MM-DD)" };
  for (const k of ["operator", "problem", "outcome"] as const) {
    if (typeof v[k] !== "string") return { ok: false, error: `${k} must be a string` };
  }
  if (!Array.isArray(v.steps_taken) || !v.steps_taken.every((s) => typeof s === "string")) {
    return { ok: false, error: "steps_taken must be an array of strings" };
  }
  if (typeof v.escalated !== "boolean") return { ok: false, error: "escalated must be a boolean" };
  return {
    ok: true,
    value: {
      plant_id: v.plant_id,
      date: v.date,
      operator: v.operator as string,
      problem: v.problem as string,
      steps_taken: v.steps_taken as string[],
      outcome: v.outcome as string,
      escalated: v.escalated,
    },
  };
}

export async function readJSON(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}
