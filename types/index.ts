// Shared data formats — see README "Data formats". Keep in sync with optimize/ and data/.

export interface Reading {
  plant_id: string;
  date: string; // ISO 8601 (YYYY-MM-DD)
  chlorine: number; // mg/L
  turbidity: number; // NTU
  ph: number;
}

export interface LogEntry {
  plant_id: string;
  date: string; // ISO 8601 (YYYY-MM-DD)
  operator: string;
  problem: string;
  steps_taken: string[];
  outcome: string;
  escalated: boolean;
}

export interface Scenario {
  id: string;
  description: string;
  readings: Reading[];
  log_history: LogEntry[];
  expected: {
    diagnosis: string;
    escalate: boolean;
    key_steps: string[];
  };
}
