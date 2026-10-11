import OpenAI from "openai";

// Placeholder: OpenAI-compatible client pointed at Luminal.
let client: OpenAI | null = null;

export function getLLM(): OpenAI {
  if (!client) {
    const baseURL = process.env.LUMINAL_BASE_URL;
    const apiKey = process.env.LUMINAL_API_KEY;
    if (!baseURL || !apiKey) {
      throw new Error("LUMINAL_BASE_URL and LUMINAL_API_KEY must be set");
    }
    client = new OpenAI({ baseURL, apiKey });
  }
  return client;
}

export const LLM_MODEL = process.env.LUMINAL_MODEL ?? "";

// TODO: implement chat helper(s) used by lib/agents.ts
export async function chat(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
): Promise<string> {
  const res = await getLLM().chat.completions.create({
    model: LLM_MODEL,
    messages,
  });
  return res.choices[0]?.message?.content ?? "";
}
