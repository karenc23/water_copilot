import { troubleshootAgent, type TroubleshootInput } from "@/lib/agents";

export async function POST(request: Request) {
  const body = (await request.json()) as TroubleshootInput;
  // TODO: validate input, load readings/log history from DB
  const result = await troubleshootAgent(body);
  return Response.json(result);
}
