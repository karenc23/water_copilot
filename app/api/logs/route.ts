import { NextRequest, NextResponse } from "next/server";
import { getLogs, searchLogs } from "@/lib/db";
import { logbookAgent } from "@/lib/agents";
import type { LogEntry } from "@/lib/types";

const DEFAULT_PLANT = "chena-village-01";

export async function GET(req: NextRequest) {
  const plantId = req.nextUrl.searchParams.get("plant_id") || DEFAULT_PLANT;
  const q = req.nextUrl.searchParams.get("q");
  try {
    const logs = q
      ? await searchLogs(plantId, q, 20)
      : await getLogs(plantId, 200);
    return NextResponse.json({ logs });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load logs." },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const entry: LogEntry = {
      plant_id: body.plant_id || DEFAULT_PLANT,
      date: body.date || new Date().toISOString().slice(0, 10),
      operator: body.operator || "Unknown",
      problem: (body.problem || "").toString(),
      steps_taken: (body.steps_taken || "").toString(),
      outcome: (body.outcome || "").toString(),
      escalated: Boolean(body.escalated),
      tags: Array.isArray(body.tags) ? body.tags : undefined,
    };

    if (!entry.problem) {
      return NextResponse.json(
        { error: "problem is required." },
        { status: 400 }
      );
    }

    await logbookAgent(entry);
    return NextResponse.json({ ok: true, entry });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save log." },
      { status: 500 }
    );
  }
}
