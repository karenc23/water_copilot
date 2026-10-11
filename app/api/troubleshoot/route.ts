import { NextRequest, NextResponse } from "next/server";
import { troubleshootAgent } from "@/lib/agents";
import type { Reading } from "@/lib/types";

const DEFAULT_PLANT = "chena-village-01";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const plantId: string = body.plant_id || DEFAULT_PLANT;
    const report: string = (body.report || "").toString().trim();

    if (!report) {
      return NextResponse.json(
        { error: "A problem description is required." },
        { status: 400 }
      );
    }

    let readings: Reading | undefined;
    if (
      body.readings &&
      typeof body.readings.chlorine === "number" &&
      typeof body.readings.turbidity === "number" &&
      typeof body.readings.ph === "number"
    ) {
      readings = {
        plant_id: plantId,
        date: new Date().toISOString().slice(0, 10),
        chlorine: body.readings.chlorine,
        turbidity: body.readings.turbidity,
        ph: body.readings.ph,
      };
    }

    const result = await troubleshootAgent(plantId, report, readings);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Troubleshoot failed." },
      { status: 500 }
    );
  }
}
