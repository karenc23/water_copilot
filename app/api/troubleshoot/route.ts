import { readFile } from "node:fs/promises";
import path from "node:path";
import { troubleshoot } from "@/lib/agents";
import { parseLog, parseReading, readJSON } from "@/lib/validate";
import type { LogEntry, Reading } from "@/types";

const DATA_DIR = path.join(process.cwd(), "data");

// For now readings and logs come from the seed files rather than MongoDB.
// TODO: switch to getReadings/getLogs from lib/db.ts once the database is live.
async function loadSeed<T>(file: string): Promise<T[]> {
  return JSON.parse(await readFile(path.join(DATA_DIR, file), "utf8")) as T[];
}

/**
 * POST { description, plant_id?, readings?, logs? }
 * plant_id defaults to "plant-a". readings/logs default to that plant's rows in
 * data/readings_seed.json and data/logs_seed.json. The manual is data/manual.md.
 */
export async function POST(request: Request) {
  const body = await readJSON(request);
  if (!body || typeof body !== "object") {
    return Response.json({ error: "JSON body required" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  if (typeof b.description !== "string" || !b.description.trim()) {
    return Response.json({ error: "description is required" }, { status: 400 });
  }
  const plantId = typeof b.plant_id === "string" && b.plant_id.trim() ? b.plant_id : "plant-a";

  let readings: Reading[];
  if (b.readings !== undefined) {
    if (!Array.isArray(b.readings)) {
      return Response.json({ error: "readings must be an array" }, { status: 400 });
    }
    readings = [];
    for (const r of b.readings) {
      const p = parseReading(r);
      if (!p.ok) return Response.json({ error: `readings: ${p.error}` }, { status: 400 });
      readings.push(p.value);
    }
  } else {
    readings = (await loadSeed<Reading>("readings_seed.json")).filter((r) => r.plant_id === plantId);
  }

  let logs: LogEntry[];
  if (b.logs !== undefined) {
    if (!Array.isArray(b.logs)) {
      return Response.json({ error: "logs must be an array" }, { status: 400 });
    }
    logs = [];
    for (const l of b.logs) {
      const p = parseLog(l);
      if (!p.ok) return Response.json({ error: `logs: ${p.error}` }, { status: 400 });
      logs.push(p.value);
    }
  } else {
    logs = (await loadSeed<LogEntry>("logs_seed.json")).filter((l) => l.plant_id === plantId);
  }

  const manualText = await readFile(path.join(DATA_DIR, "manual.md"), "utf8");

  try {
    return Response.json(await troubleshoot(b.description, readings, logs, manualText));
  } catch (err) {
    console.error("troubleshoot failed", err);
    return Response.json({ error: "Troubleshooting model request failed" }, { status: 502 });
  }
}
