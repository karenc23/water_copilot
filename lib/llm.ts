import OpenAI from "openai";

// OpenAI-compatible client pointed at Luminal. Next.js loads .env automatically;
// standalone scripts run with `tsx --env-file=.env`.
let client: OpenAI | null = null;

export function getLLM(): OpenAI {
  if (!client) {
    const baseURL = process.env.LUMINAL_BASE_URL;
    const apiKey = process.env.LUMINAL_API_KEY;
    if (!baseURL || !apiKey) {
      throw new Error("LUMINAL_BASE_URL and LUMINAL_API_KEY must be set in .env");
    }
    client = new OpenAI({ baseURL, apiKey });
  }
  return client;
}

function getModel(): string {
  const model = process.env.LUMINAL_MODEL;
  if (!model) throw new Error("LUMINAL_MODEL must be set in .env");
  return model;
}

export async function chat(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  options: { temperature?: number } = {},
): Promise<string> {
  const res = await getLLM().chat.completions.create({
    model: getModel(),
    messages,
    temperature: options.temperature ?? 0,
  });
  return res.choices[0]?.message?.content ?? "";
}

/** The model replied, but not with parseable JSON. `raw` is the full reply. */
export class LLMParseError extends Error {
  constructor(
    message: string,
    readonly raw: string,
  ) {
    super(message);
  }
}

/**
 * Ask for a JSON object and parse it. Doesn't rely on `response_format`, which
 * not every OpenAI-compatible server supports; instead extracts the first
 * {...} block from the reply (tolerating ```json fences).
 */
export async function chatJSON(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
): Promise<unknown> {
  const text = await chat(messages);
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new LLMParseError(`LLM did not return JSON: ${text.slice(0, 200)}`, text);
  }
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new LLMParseError(`LLM returned invalid JSON: ${text.slice(0, 200)}`, text);
  }
}
