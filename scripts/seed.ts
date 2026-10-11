// Seed script: loads the fake manual (chunked + embedded), 6 months of daily
// readings, and Joe's logbook history into MongoDB.
//
//   npm run seed
//
// Idempotent: clears the three collections for the plant first, then reloads.

import "dotenv/config";
import { readFile } from "fs/promises";
import path from "path";
import { MongoClient } from "mongodb";
import { embed } from "../lib/llm";
import type { Reading, LogEntry, ManualChunk } from "../lib/types";

const PLANT = "chena-village-01";
const uri = process.env.MONGODB_URI || "mongodb://localhost:27017";
const dbName = process.env.MONGODB_DB || "chena_copilot";

// ---- Manual chunking ----------------------------------------------------

async function loadManualChunks(): Promise<ManualChunk[]> {
  const file = path.join(process.cwd(), "data", "manual", "plant_manual.md");
  const md = await readFile(file, "utf8");

  // Split on "## Page N — Heading" markers.
  const chunks: ManualChunk[] = [];
  const parts = md.split(/\n(?=## )/g);
  for (const part of parts) {
    const m = part.match(/^## (Page \d+)\s*[—-]\s*(.+)/);
    if (!m) continue;
    const page = m[1];
    const heading = m[2].trim();
    const text = part.replace(/^## .+\n/, "").trim();
    chunks.push({ plant_id: PLANT, page, heading, text });
  }
  return chunks;
}

// ---- Synthetic 6-month readings -----------------------------------------

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function round(n: number, p = 2): number {
  const f = 10 ** p;
  return Math.round(n * f) / f;
}

/**
 * Generate ~180 days of readings that look like a real plant: mostly healthy,
 * with a few deliberate events the drift rules and dashboard can surface:
 *  - a chlorine decline near the end (Drift 2A)
 *  - a turbidity climb mid-history that triggered a backwash
 *  - small daily noise otherwise
 */
function generateReadings(): Reading[] {
  const out: Reading[] = [];
  const N = 180;
  for (let i = N; i >= 0; i--) {
    const date = daysAgo(i);
    let chlorine = 1.1 + Math.sin(i / 9) * 0.2 + (Math.random() - 0.5) * 0.1;
    let turbidity = 0.15 + (Math.random() - 0.5) * 0.06;
    let ph = 7.2 + (Math.random() - 0.5) * 0.2;

    // Turbidity climb event around day 90, resolved by a backwash.
    if (i <= 92 && i >= 88) turbidity = 0.2 + (92 - i) * 0.06;
    if (i === 87) turbidity = 0.14; // post-backwash

    // Recent chlorine decline (last 3 days) -> Drift 2A on the dashboard.
    if (i === 2) chlorine = 1.0;
    if (i === 1) chlorine = 0.8;
    if (i === 0) chlorine = 0.6;

    out.push({
      plant_id: PLANT,
      date,
      chlorine: round(Math.max(0.1, chlorine)),
      turbidity: round(Math.max(0.05, turbidity)),
      ph: round(ph, 1),
    });
  }
  return out;
}

// ---- Joe's logbook history ----------------------------------------------

function generateLogs(): LogEntry[] {
  const joe = "Joe N.";
  const entries: Omit<LogEntry, "plant_id">[] = [
    {
      date: daysAgo(172),
      operator: joe,
      problem: "Chlorine residual dropped to 0.4, cylinder had gas.",
      steps_taken:
        "Checked injector vacuum line, found a loose fitting, re-seated it. Residual back to 1.1 next morning.",
      outcome: "resolved",
      escalated: false,
      tags: ["chlorine-low"],
    },
    {
      date: daysAgo(150),
      operator: joe,
      problem: "Filter clogged, turbidity climbing toward 0.3.",
      steps_taken: "Ran a full backwash per Page 4A, 10 min to clear.",
      outcome: "resolved",
      escalated: false,
      tags: ["filter-clog"],
    },
    {
      date: daysAgo(120),
      operator: joe,
      problem: "Filter clogged again, backwash needed earlier than expected.",
      steps_taken: "Backwashed. Noted it's clogging faster than last month.",
      outcome: "resolved",
      escalated: false,
      tags: ["filter-clog"],
    },
    {
      date: daysAgo(92),
      operator: joe,
      problem: "Turbidity climbed 3 days running, filter nearing breakthrough.",
      steps_taken: "Backwashed early. Turbidity dropped to 0.14.",
      outcome: "resolved",
      escalated: false,
      tags: ["filter-clog"],
    },
    {
      date: daysAgo(78),
      operator: joe,
      problem: "pH drifted low to 6.6, soda ash day tank was low.",
      steps_taken: "Refilled soda ash, bumped feed rate per Page 5A.",
      outcome: "resolved",
      escalated: false,
      tags: ["ph-low"],
    },
    {
      date: daysAgo(61),
      operator: joe,
      problem: "Chlorine gas smell near the cylinder during changeover.",
      steps_taken:
        "Evacuated the building, called the RMW. Turned out to be a bad lead gasket on the new cylinder.",
      outcome: "resolved after RMW guidance",
      escalated: true,
      tags: ["gas-leak"],
    },
    {
      date: daysAgo(45),
      operator: joe,
      problem: "Filter clogged a 4th time in two months.",
      steps_taken:
        "Backwashed again. Suspect source water change — flagged to RMW for media inspection.",
      outcome: "pending RMW visit",
      escalated: true,
      tags: ["filter-clog"],
    },
    {
      date: daysAgo(30),
      operator: joe,
      problem: "Pump cycling rapidly on and off.",
      steps_taken: "Diagnosed waterlogged pressure tank per Page 6A, scheduled service.",
      outcome: "resolved",
      escalated: false,
      tags: ["pressure-tank"],
    },
    {
      date: daysAgo(14),
      operator: joe,
      problem: "Power outage overnight, restarted the plant in the morning.",
      steps_taken:
        "Ran to waste until residual recovered to 0.9 before sending to town per Page 6C.",
      outcome: "resolved",
      escalated: false,
      tags: ["restart"],
    },
    {
      date: daysAgo(6),
      operator: joe,
      problem: "Chlorine reading 0.45, a touch low but water clear.",
      steps_taken: "Checked injector feed, bumped rotameter slightly, monitored.",
      outcome: "resolved",
      escalated: false,
      tags: ["chlorine-low"],
    },
  ];

  return entries.map((e) => ({ plant_id: PLANT, ...e }));
}

// ---- Main ----------------------------------------------------------------

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  console.log(`Seeding ${dbName} for plant ${PLANT}…`);

  // Clear this plant's data (idempotent reseed).
  await Promise.all([
    db.collection("readings").deleteMany({ plant_id: PLANT }),
    db.collection("logs").deleteMany({ plant_id: PLANT }),
    db.collection("manual_chunks").deleteMany({ plant_id: PLANT }),
  ]);

  // Manual chunks + embeddings.
  const chunks = await loadManualChunks();
  for (const c of chunks) {
    c.embedding = await embed(`${c.heading}\n${c.text}`);
  }
  await db.collection("manual_chunks").insertMany(chunks);
  console.log(`  manual_chunks: ${chunks.length} pages embedded`);

  // Readings.
  const readings = generateReadings();
  await db.collection("readings").insertMany(readings);
  console.log(`  readings: ${readings.length} days`);

  // Logs.
  const logs = generateLogs();
  await db.collection("logs").insertMany(logs);
  console.log(`  logs: ${logs.length} entries`);

  console.log("\nDone. If you're on Atlas, create a vector index named");
  console.log("'manual_vector_index' on manual_chunks.embedding (see README).");

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
