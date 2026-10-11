// Luminal Cloud client (DeepSeek chat / GLM critic) with offline fallbacks.
//
// Everything here degrades gracefully: with no LUMINAL_API_KEY or OFFLINE_MODE
// set, we return deterministic local results so the app and the benchmark run
// without a network. That same path powers the AGI on-device track.

const BASE_URL = process.env.LUMINAL_BASE_URL || "https://api.luminal.ai/v1";
const API_KEY = process.env.LUMINAL_API_KEY || "";
const CHAT_MODEL = process.env.LUMINAL_CHAT_MODEL || "deepseek-chat";
const EMBED_MODEL = process.env.LUMINAL_EMBED_MODEL || "text-embedding-3-small";

export function isOffline(): boolean {
  return process.env.OFFLINE_MODE === "true" || !API_KEY;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Chat completion against Luminal. Model override lets the critic use GLM. */
export async function chat(
  messages: ChatMessage[],
  opts: { model?: string; temperature?: number; json?: boolean } = {}
): Promise<string> {
  if (isOffline()) {
    return offlineChat(messages);
  }

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: opts.model || CHAT_MODEL,
      messages,
      temperature: opts.temperature ?? 0.2,
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
    }),
  });

  if (!res.ok) {
    throw new Error(`Luminal chat failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

/** Embedding for vector search. Falls back to a deterministic hash vector. */
export async function embed(text: string): Promise<number[]> {
  if (isOffline()) {
    return hashEmbed(text);
  }

  const res = await fetch(`${BASE_URL}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({ model: EMBED_MODEL, input: text }),
  });

  if (!res.ok) {
    // Fall back rather than crash the whole request.
    return hashEmbed(text);
  }
  const data = await res.json();
  return data.data?.[0]?.embedding ?? hashEmbed(text);
}

// ---- Offline fallbacks ----

const DIM = 256;

/**
 * Deterministic bag-of-words hash embedding. Not semantically strong, but it
 * ranks manual chunks sensibly by shared vocabulary and keeps the demo fully
 * functional without any API key.
 */
export function hashEmbed(text: string): number[] {
  const vec = new Array(DIM).fill(0);
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) || [];
  for (const tok of tokens) {
    let h = 2166136261;
    for (let i = 0; i < tok.length; i++) {
      h ^= tok.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % DIM;
    vec[idx] += 1;
  }
  // L2 normalize.
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

// A tiny rule-ish responder so the troubleshooting agent still produces
// readable output offline. The safety verdict never depends on this — hard
// rules in agents.ts decide escalation.
function offlineChat(messages: ChatMessage[]): string {
  const user = messages.filter((m) => m.role === "user").pop()?.content || "";
  if (user.includes("Respond with JSON")) {
    return JSON.stringify({
      diagnosis:
        "Offline mode: see cited manual sections for the matching procedure.",
      steps: [
        "Review the cited manual pages below.",
        "Confirm the current readings against Page 1 limits.",
        "Follow the matching procedure and log the outcome.",
      ],
    });
  }
  return "Offline mode active. Follow the cited manual sections.";
}
