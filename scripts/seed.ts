// Load data/readings_seed.json and data/logs_seed.json into MongoDB. Usage: npm run seed
// Re-running is safe: readings are upserted on (plant_id, date), logs on (plant_id, date, problem).
import "dotenv/config"; // load .env before anything reads process.env
import { readFile } from "node:fs/promises";
import path from "node:path";
import { closeDb, collections, ensureIndexes, getDb } from "@/lib/db";
import { parseLog, parseReading } from "@/lib/validate";
import type { LogEntry, Reading } from "@/types";

const DATA_DIR = path.join(process.cwd(), "data");

async function loadRows<T>(
  file: string,
  parse: (v: unknown) => { ok: true; value: T } | { ok: false; error: string },
): Promise<T[]> {
  const raw: unknown = JSON.parse(await readFile(path.join(DATA_DIR, file), "utf8"));
  if (!Array.isArray(raw)) throw new Error(`${file} must contain a JSON array`);
  return raw.map((r, i) => {
    const p = parse(r);
    if (!p.ok) throw new Error(`${file} row ${i}: ${p.error}`);
    return p.value;
  });
}

async function main() {
  const readings = await loadRows("readings_seed.json", parseReading);
  const logs = await loadRows("logs_seed.json", parseLog);

  await ensureIndexes();
  const db = await getDb();
  const r = await db.collection<Reading>(collections.readings).bulkWrite(
    readings.map((x) => ({
      replaceOne: { filter: { plant_id: x.plant_id, date: x.date }, replacement: x, upsert: true },
    })),
  );
  console.log(`Seeded ${readings.length} readings (${r.upsertedCount} inserted, ${r.modifiedCount} updated).`);

  const l = await db.collection<LogEntry>(collections.logs).bulkWrite(
    logs.map((x) => ({
      replaceOne: {
        filter: { plant_id: x.plant_id, date: x.date, problem: x.problem },
        replacement: x,
        upsert: true,
      },
    })),
  );
  console.log(`Seeded ${logs.length} log entries (${l.upsertedCount} inserted, ${l.modifiedCount} updated).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(closeDb);
