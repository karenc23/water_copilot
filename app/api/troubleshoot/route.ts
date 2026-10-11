import { runTroubleshoot } from "@/lib/pipeline";
import { parseTroubleshootBody } from "@/lib/troubleshoot-input";
import { readJSON } from "@/lib/validate";

/**
 * POST { description, plant_id?, readings?, logs? }
 * plant_id defaults to "plant-a". readings/logs default to that plant's rows in
 * data/readings_seed.json and data/logs_seed.json. The manual is data/manual.md.
 *
 * Runs rules → LLM → safety and returns
 * { diagnosis, failure_mode, steps, tier, alerts, escalate, escalation_packet, warnings }.
 */
export async function POST(request: Request) {
  const parsed = await parseTroubleshootBody(await readJSON(request));
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  try {
    return Response.json(await runTroubleshoot(parsed.input));
  } catch (err) {
    console.error("troubleshoot failed", err);
    return Response.json({ error: "Troubleshooting model request failed" }, { status: 502 });
  }
}
