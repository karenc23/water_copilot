import { connection } from "next/server";
import { addLog, getLogs } from "@/lib/db";
import { parseLog, readJSON } from "@/lib/validate";

export async function GET(request: Request) {
  await connection();
  const plantId = new URL(request.url).searchParams.get("plant_id");
  if (!plantId) return Response.json({ error: "plant_id is required" }, { status: 400 });
  try {
    return Response.json(await getLogs(plantId));
  } catch (err) {
    console.error("logs: read failed", err);
    return Response.json({ error: "The logbook database is not reachable right now." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const parsed = parseLog(await readJSON(request));
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  try {
    return Response.json(await addLog(parsed.value), { status: 201 });
  } catch (err) {
    console.error("logs: write failed", err);
    return Response.json({ error: "The logbook database is not reachable right now. Your entry was not saved." }, { status: 503 });
  }
}
