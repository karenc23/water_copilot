import { connection } from "next/server";
import type { LogEntry } from "@/types";

export async function GET(request: Request) {
  await connection();
  const plantId = new URL(request.url).searchParams.get("plant_id");
  // TODO: query collections.logs from lib/db.ts, filtered by plantId
  void plantId;
  const items: LogEntry[] = [];
  return Response.json(items);
}

export async function POST(request: Request) {
  const body = (await request.json()) as LogEntry;
  // TODO: validate and insert into collections.logs
  return Response.json(body, { status: 201 });
}
