import { readFile } from "node:fs/promises";
import path from "node:path";
import { chat, type ChatOptions } from "@/lib/llm";
import { checkLogs, checkReadings } from "@/lib/rules";
import type { LogEntry, Reading } from "@/types";

const DATA_DIR = path.join(process.cwd(), "data");
const PLANT_ID = "plant-a";
const MAX_TOKENS = 2500;
const REASONING_EFFORT = (process.env.LUMINAL_REASONING_EFFORT || "none") as ChatOptions["reasoning_effort"];

const SYSTEM_PROMPT = `You write a handbook for a NEW operator taking over Plant A, a small fictional village water treatment plant.

Use ONLY facts from the LOGBOOK, READINGS, CURRENT ALERTS and MANUAL below. CURRENT ALERTS come from fixed safety rules and are correct; never contradict them. Do not invent names, phone numbers, chemical doses or events.
Cite manual sections like "(Manual 3.2)" and logbook entries by date like "(log 2026-09-18)".
Write for someone on their first week: short sentences, plain words, concrete actions.

Respond with ONLY Markdown, using exactly these sections:
# New operator handbook: Plant A
A 2–3 sentence summary of the plant and what matters most right now.
## Plant quirks
## Recurring problems and what fixed them
(For each: what happens, how often, what worked, what didn't. Call out anything that has recurred 3+ times in 30 days.)
## Warning signs to watch
(Include current trends in the readings, with numbers.)
## Who to call
(Who, when, and where to find contact details. If the data gives no phone number, say where the manual says to find it.)`;

/**
 * POST → { markdown }
 * Sends plant-a's logbook, readings and the manual to the LLM and returns a new-operator handbook.
 * Data comes from the seed files, like /api/troubleshoot.
 */
export async function POST() {
  let readings: Reading[];
  let logs: LogEntry[];
  let manual: string;
  try {
    const [r, l, m] = await Promise.all([
      readFile(path.join(DATA_DIR, "readings_seed.json"), "utf8"),
      readFile(path.join(DATA_DIR, "logs_seed.json"), "utf8"),
      readFile(path.join(DATA_DIR, "manual.md"), "utf8"),
    ]);
    readings = (JSON.parse(r) as Reading[]).filter((x) => x.plant_id === PLANT_ID).sort((a, b) => a.date.localeCompare(b.date));
    logs = (JSON.parse(l) as LogEntry[]).filter((x) => x.plant_id === PLANT_ID).sort((a, b) => a.date.localeCompare(b.date));
    manual = m;
  } catch (err) {
    console.error("handoff: failed to load plant data", err);
    return Response.json({ error: "Could not load plant data" }, { status: 500 });
  }

  const alerts = [...checkReadings(readings), ...checkLogs(logs, readings.at(-1)?.date)];
  const userPrompt = [
    `CURRENT ALERTS (fixed rules, latest reading ${readings.at(-1)?.date ?? "none"}):\n${
      alerts.length ? alerts.map((a) => `- [${a.tier}] ${a.message} (Manual ${a.manual_section})`).join("\n") : "none"
    }`,
    `LOGBOOK (oldest first):\n${JSON.stringify(logs)}`,
    `READINGS (daily, oldest first; chlorine mg/L, turbidity NTU, pH):\n${readings
      .map((r) => `${r.date} chlorine=${r.chlorine} turbidity=${r.turbidity} ph=${r.ph}`)
      .join("\n")}`,
    `MANUAL:\n<<<\n${manual}\n>>>`,
  ].join("\n\n");

  try {
    const text = await chat(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      { max_tokens: MAX_TOKENS, reasoning_effort: REASONING_EFFORT, temperature: 0.2, label: "handoff" },
    );
    // Some models wrap the whole answer in a ```markdown fence.
    const markdown = text.replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n?```\s*$/i, "$1").trim();
    if (!markdown) return Response.json({ error: "The model returned an empty handbook" }, { status: 502 });
    return Response.json({ markdown, generated_at: new Date().toISOString() });
  } catch (err) {
    console.error("handoff failed", err);
    return Response.json({ error: "Handbook model request failed" }, { status: 502 });
  }
}
