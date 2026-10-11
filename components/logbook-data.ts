import logsSeed from "@/data/logs_seed.json";
import { getLogs } from "@/lib/db";
import type { LogEntry } from "@/types";

// The logbook lives in MongoDB (seeded by `npm run seed`, added to by "Save to logbook").
// If the database isn't reachable, fall back to the seed file so pages still render.

export const PLANT_ID = "plant-a";
const MAX_ENTRIES = 500;

export type LogSource = "database" | "seed";

export async function loadLogs(): Promise<{ logs: LogEntry[]; source: LogSource }> {
  try {
    const logs = await getLogs(PLANT_ID, MAX_ENTRIES);
    if (logs.length) return { logs, source: "database" };
  } catch (err) {
    console.error("logbook: database unavailable, using seed file", err);
  }
  const logs = (logsSeed as LogEntry[]).filter((l) => l.plant_id === PLANT_ID).sort((a, b) => b.date.localeCompare(a.date));
  return { logs, source: "seed" };
}
