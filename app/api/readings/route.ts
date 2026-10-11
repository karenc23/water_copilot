import { NextRequest, NextResponse } from "next/server";
import { getReadings, addReading } from "@/lib/db";
import { computeDrift, hardRuleCheck } from "@/lib/agents";
import type { Reading } from "@/lib/types";

const DEFAULT_PLANT = "chena-village-01";

export async function GET(req: NextRequest) {
  const plantId =
    req.nextUrl.searchParams.get("plant_id") || DEFAULT_PLANT;
  try {
    const readings = await getReadings(plantId, 90);
    const drift = computeDrift(readings);
    const latest = readings[readings.length - 1];
    const safety = latest ? hardRuleCheck(latest) : null;
    return NextResponse.json({ readings, drift, latest, safety });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load readings." },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const plantId: string = body.plant_id || DEFAULT_PLANT;

    const reading: Reading = {
      plant_id: plantId,
      date: body.date || new Date().toISOString().slice(0, 10),
      chlorine: Number(body.chlorine),
      turbidity: Number(body.turbidity),
      ph: Number(body.ph),
    };

    if (
      Number.isNaN(reading.chlorine) ||
      Number.isNaN(reading.turbidity) ||
      Number.isNaN(reading.ph)
    ) {
      return NextResponse.json(
        { error: "chlorine, turbidity and ph must be numbers." },
        { status: 400 }
      );
    }

    await addReading(reading);
    const readings = await getReadings(plantId, 90);
    const drift = computeDrift(readings);
    const safety = hardRuleCheck(reading);
    return NextResponse.json({ ok: true, reading, drift, safety });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save reading." },
      { status: 500 }
    );
  }
}
