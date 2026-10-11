import { connection } from "next/server";
import type { Reading } from "@/types";

export async function GET(request: Request) {
  await connection();
  const plantId = new URL(request.url).searchParams.get("plant_id");
  // TODO: query collections.readings from lib/db.ts, filtered by plantId
  void plantId;
  const items: Reading[] = [];
  return Response.json(items);
}

export async function POST(request: Request) {
  const body = (await request.json()) as Reading;
  // TODO: validate and insert into collections.readings
  return Response.json(body, { status: 201 });
}
