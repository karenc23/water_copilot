import { NextRequest, NextResponse } from "next/server";
import { getReadings, getLogs } from "@/lib/db";
import { computeDrift, hardRuleCheck, knowledgeRiskScore } from "@/lib/agents";

const DEFAULT_PLANT = "chena-village-01";

export async function GET(req: NextRequest) {
  const plantId = req.nextUrl.searchParams.get("plant_id") || DEFAULT_PLANT;
  try {
    const [readings, logs] = await Promise.all([
      getReadings(plantId, 90),
      getLogs(plantId, 500),
    ]);

    const latest = readings[readings.length - 1];
    const drift = computeDrift(readings);
    const safety = latest ? hardRuleCheck(latest) : null;
    const risk = knowledgeRiskScore(logs);

    return NextResponse.json({
      plant_id: plantId,
      latest,
      drift,
      safety,
      risk,
      counts: { readings: readings.length, logs: logs.length },
      recent_logs: logs.slice(0, 5),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load dashboard." },
      { status: 500 }
    );
  }
}
