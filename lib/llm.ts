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
    // The SDK default timeout is 10 minutes; a hung request should fail fast and be retried.
    client = new OpenAI({ baseURL, apiKey, timeout: Number(process.env.LUMINAL_TIMEOUT_MS) || 120_000 });
  }
  return client;
}

function getModel(): string {
  const model = process.env.LUMINAL_MODEL;
  if (!model) throw new Error("LUMINAL_MODEL must be set in .env");
  return model;
}

export interface ChatOptions {
  temperature?: number;
  max_tokens?: number;
  /** Reasoning budget for reasoning models. Reasoning tokens count toward max_tokens. */
  reasoning_effort?: "none" | "low" | "medium" | "high";
  /** Per-request timeout override in ms (default 2 minutes). */
  timeout?: number;
  /** Label for the timing log line. */
  label?: string;
}

export async function chat(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  options: ChatOptions = {},
): Promise<string> {
  const model = getModel();
  const started = Date.now();
  const res = await getLLM().chat.completions.create({
    model,
    messages,
    temperature: options.temperature ?? 0,
    ...(options.max_tokens ? { max_tokens: options.max_tokens } : {}),
    // "none" isn't in the SDK's type yet but OpenAI-compatible servers accept it.
    ...(options.reasoning_effort ? { reasoning_effort: options.reasoning_effort as "low" } : {}),
  }, options.timeout ? { timeout: options.timeout } : undefined);
  const choice = res.choices[0];
  const u = res.usage;
  const reasoning = (u as { completion_tokens_details?: { reasoning_tokens?: number } } | undefined)
    ?.completion_tokens_details?.reasoning_tokens;
  if (process.env.LLM_LOG !== "off") console.info(
    `[llm] ${options.label ?? "chat"} ${model}${options.reasoning_effort ? ` effort=${options.reasoning_effort}` : ""} ${Date.now() - started} ms · ` +
      `${u?.prompt_tokens ?? "?"} in / ${u?.completion_tokens ?? "?"} out` +
      `${reasoning ? ` (${reasoning} reasoning)` : ""} · finish=${choice?.finish_reason}`,
  );
  // Reasoning models may return their thinking in a separate field (ignored here)
  // or inline as <think>…</think>; strip the inline form.
  return stripReasoning(choice?.message?.content ?? "");
}

export function stripReasoning(text: string): string {
  let out = text.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "");
  // An unclosed <think> (reply cut off mid-thought) has no answer after it.
  out = out.replace(/<think(?:ing)?>[\s\S]*$/i, "");
  return out.trim();
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
 * not every OpenAI-compatible server supports. If the reply has prose or
 * reasoning around the JSON, takes the last complete top-level {...} object.
 */
export async function chatJSON(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  options: ChatOptions = {},
): Promise<unknown> {
  const text = await chat(messages, options);
  const obj = extractLastJSONObject(text);
  if (obj === undefined) {
    throw new LLMParseError(`LLM did not return valid JSON: ${text.slice(0, 200)}`, text);
  }
  return obj;
}

export function extractLastJSONObject(text: string): unknown {
  let found: unknown = undefined;
  let i = 0;
  while ((i = text.indexOf("{", i)) !== -1) {
    const end = matchingBrace(text, i);
    if (end === -1) break;
    try {
      found = JSON.parse(text.slice(i, end + 1));
      i = end + 1;
    } catch {
      i += 1;
    }
  }
  return found;
}

/** Index of the `}` closing the `{` at `start`, skipping braces inside strings; -1 if none. */
function matchingBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return i;
  }
  return -1;
}
