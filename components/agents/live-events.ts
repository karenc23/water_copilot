import type { TraceEvent } from "@/lib/trace";

// Events on /api/troubleshoot/stream: the pipeline's TraceEvents plus one app-level event,
// sent first, naming the strategy the Diagnostician runs with.
export type StrategyEvent = { type: "strategy"; choice: "evolved" | "fast"; id: string };
export type LiveEvent = TraceEvent | StrategyEvent;
