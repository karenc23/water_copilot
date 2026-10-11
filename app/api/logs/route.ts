import { connection } from "next/server";
import { addLog, getLogs } from "@/lib/db";
import { parseLog, readJSON } from "@/lib/validate";

export async function GET(request: Request) {
  await connection();
  const plantId = new URL(request.url).searchParams.get("plant_id");
  if (!plantId) return Response.json({ error: "plant_id is required" }, { status: 400 });
  return Response.json(await getLogs(plantId));
}

export async function POST(request: Request) {
  const parsed = parseLog(await readJSON(request));
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  return Response.json(await addLog(parsed.value), { status: 201 });
}
