import type { LogEntry, Reading } from "@/types";

// Placeholder agent interfaces. Implementations will use lib/llm.ts and lib/db.ts.

export interface TroubleshootInput {
  plant_id: string;
  problem: string;
  readings?: Reading[];
  log_history?: LogEntry[];
}

export interface TroubleshootResult {
  diagnosis: string;
  escalate: boolean;
  key_steps: string[];
}

export async function troubleshootAgent(
  input: TroubleshootInput,
): Promise<TroubleshootResult> {
  // TODO: implement
  void input;
  return { diagnosis: "", escalate: false, key_steps: [] };
}

export interface HandoffInput {
  plant_id: string;
  operator: string;
}

export async function handoffAgent(input: HandoffInput): Promise<string> {
  // TODO: implement — summarize recent readings + logs into a shift handoff note
  void input;
  return "";
}
