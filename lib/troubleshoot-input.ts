import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseLog, parseReading } from "@/lib/validate";
import type { LogEntry, Reading } from "@/types";

// Request parsing shared by /api/troubleshoot and /api/troubleshoot/stream.

const DATA_DIR = path.join(process.cwd(), "data");

// For now readings and logs come from the seed files rather than MongoDB.
// TODO: switch to getReadings/getLogs from lib/db.ts once the database is live.
async function loadSeed<T>(file: string): Promise<T[]> {
  return JSON.parse(await readFile(path.join(DATA_DIR, file), "utf8")) as T[];
}

export interface TroubleshootInput {
  plant_id: string;
  description: string;
  readings: Reading[];
  logs: LogEntry[];
  manualText: string;
}

/**
 * Body { description, plant_id?, readings?, logs? }. plant_id defaults to "plant-a".
 * readings/logs default to that plant's rows in the seed files. The manual is data/manual.md.
 */
export async function parseTroubleshootBody(
  body: unknown,
): Promise<{ ok: true; input: TroubleshootInput } | { ok: false; error: string }> {
  if (!body || typeof body !== "object") return { ok: false, error: "JSON body required" };
  const b = body as Record<string, unknown>;
  if (typeof b.description !== "string" || !b.description.trim()) {
    return { ok: false, error: "description is required" };
  }
  const plantId = typeof b.plant_id === "string" && b.plant_id.trim() ? b.plant_id : "plant-a";

  let readings: Reading[];
  if (b.readings !== undefined) {
    if (!Array.isArray(b.readings)) return { ok: false, error: "readings must be an array" };
    readings = [];
    for (const r of b.readings) {
      const p = parseReading(r);
      if (!p.ok) return { ok: false, error: `readings: ${p.error}` };
      readings.push(p.value);
    }
  } else {
    readings = (await loadSeed<Reading>("readings_seed.json")).filter((r) => r.plant_id === plantId);
  }

  let logs: LogEntry[];
  if (b.logs !== undefined) {
    if (!Array.isArray(b.logs)) return { ok: false, error: "logs must be an array" };
    logs = [];
    for (const l of b.logs) {
      const p = parseLog(l);
      if (!p.ok) return { ok: false, error: `logs: ${p.error}` };
      logs.push(p.value);
    }
  } else {
    logs = (await loadSeed<LogEntry>("logs_seed.json")).filter((l) => l.plant_id === plantId);
  }

  const manualText = await readFile(path.join(DATA_DIR, "manual.md"), "utf8");
  return { ok: true, input: { plant_id: plantId, description: b.description, readings, logs, manualText } };
}
