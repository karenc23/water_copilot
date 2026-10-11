import { NextRequest, NextResponse } from "next/server";
import { getLogs, getReadings } from "@/lib/db";
import { generateHandoff } from "@/lib/handoff";
import { knowledgeRiskScore, computeDrift } from "@/lib/agents";

const DEFAULT_PLANT = "chena-village-01";

export async function GET(req: NextRequest) {
  const plantId = req.nextUrl.searchParams.get("plant_id") || DEFAULT_PLANT;
  try {
    const [logs, readings] = await Promise.all([
      getLogs(plantId, 500),
      getReadings(plantId, 30),
    ]);

    const guide = generateHandoff(plantId, logs);
    const risk = knowledgeRiskScore(logs);
    const drift = computeDrift(readings);

    return NextResponse.json({ guide, risk, drift, recent_readings: readings });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to build handoff guide.",
      },
      { status: 500 }
    );
  }
}
