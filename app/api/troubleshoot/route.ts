import { readFile } from "node:fs/promises";
import path from "node:path";
import { troubleshoot } from "@/lib/agents";
import { getLogs, getReadings } from "@/lib/db";
import { parseLog, parseReading, readJSON } from "@/lib/validate";
import type { LogEntry, Reading } from "@/types";

const DEFAULT_MANUAL_PATH = path.join(process.cwd(), "data", "manual.md");

/**
 * POST { plant_id, description, readings?, logs?, manual_text? }
 * readings/logs default to the plant's recent history in MongoDB;
 * manual_text defaults to data/manual.md if present.
 */
export async function POST(request: Request) {
  const body = await readJSON(request);
  if (!body || typeof body !== "object") {
    return Response.json({ error: "JSON body required" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  if (typeof b.plant_id !== "string" || !b.plant_id.trim()) {
    return Response.json({ error: "plant_id is required" }, { status: 400 });
  }
  if (typeof b.description !== "string" || !b.description.trim()) {
    return Response.json({ error: "description is required" }, { status: 400 });
  }

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
    readings = await getReadings(b.plant_id);
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
    logs = await getLogs(b.plant_id);
  }

  const manualText =
    typeof b.manual_text === "string"
      ? b.manual_text
      : await readFile(DEFAULT_MANUAL_PATH, "utf8").catch(() => "");

  try {
    return Response.json(await troubleshoot(b.description, readings, logs, manualText));
  } catch (err) {
    console.error("troubleshoot failed", err);
    return Response.json({ error: "Troubleshooting model request failed" }, { status: 502 });
  }
}
