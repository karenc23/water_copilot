import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ContextOrder, ReasoningEffort, TroubleshootOptions } from "@/lib/agents";

// The live Troubleshoot strategy. "fast" = the production prompt (lib/agents.ts defaults).
// "evolved" = the strategy picked by the selection rule (best training score, never test):
// data/results_agents.json → selected, else b3 from data/results.json. Server-only.

export type StrategyChoice = "evolved" | "fast";

export interface LiveStrategy {
  choice: StrategyChoice;
  id: string;
  options: TroubleshootOptions;
}

const DATA = path.join(process.cwd(), "data");
const ORDERS: ContextOrder[] = ["description_first", "readings_first", "logbook_first"];

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);

function optionsOf(prompt: unknown, settings: unknown): TroubleshootOptions | null {
  const s = obj(settings);
  if (typeof prompt !== "string" || prompt.trim().length < 50 || !s) return null;
  const contextOrder = ORDERS.find((o) => o === s.context_order);
  const reasoningEffort: ReasoningEffort | undefined = s.reasoning_effort === "low" ? "low" : s.reasoning_effort === "none" ? "none" : undefined;
  const maxSteps = typeof s.max_steps === "number" ? s.max_steps : undefined;
  if (!contextOrder || !reasoningEffort || !maxSteps) return null;
  return { instructions: prompt, contextOrder, reasoningEffort, maxSteps };
}

async function readJSON(file: string): Promise<Obj | null> {
  try {
    return obj(JSON.parse(await readFile(path.join(DATA, file), "utf8")));
  } catch {
    return null;
  }
}

/** The evolved strategy, or null if no results file has a usable one. */
export async function loadEvolved(): Promise<LiveStrategy | null> {
  const agents = await readJSON("results_agents.json");
  const sel = obj(agents?.selected);
  if (agents && agents.dry_run !== true && sel && typeof sel.id === "string") {
    const options = optionsOf(sel.prompt, sel.settings);
    if (options) return { choice: "evolved", id: sel.id, options };
  }
  const results = await readJSON("results.json");
  for (const r of Array.isArray(results?.single_agent_rounds) ? results!.single_agent_rounds : []) {
    for (const s of Array.isArray(obj(r)?.strategies) ? (obj(r)!.strategies as unknown[]) : []) {
      const so = obj(s);
      if (so?.id === "b3") {
        const options = optionsOf(so.prompt, so.settings);
        if (options) return { choice: "evolved", id: "b3", options };
      }
    }
  }
  return null;
}

export const FAST: LiveStrategy = { choice: "fast", id: "production prompt", options: {} };

/** body.strategy: "fast" → the production prompt; anything else → evolved, falling back to fast if none is available. */
export async function strategyFor(body: unknown): Promise<LiveStrategy> {
  const choice = obj(body)?.strategy;
  if (choice === "fast") return FAST;
  return (await loadEvolved()) ?? FAST;
}
