import { handoffAgent, type HandoffInput } from "@/lib/agents";

export async function POST(request: Request) {
  const body = (await request.json()) as HandoffInput;
  // TODO: validate input, persist generated note to collections.handoffs
  const note = await handoffAgent(body);
  return Response.json({ note });
}
