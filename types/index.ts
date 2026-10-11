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
  /** "hard": danger only in words, misleading descriptions, instrument errors, near-threshold counts, two problems, or logbook-dependent answers. */
  difficulty?: "hard" | "standard";
  description: string;
  readings: Reading[];
  log_history: LogEntry[];
  expected: {
    diagnosis: string;
    /** Failure mode id from data/failure_modes.json */
    failure_mode: string;
    /** red = escalate; otherwise the failure mode's tier. */
    tier: "green" | "yellow" | "red";
    escalate: boolean;
    key_steps: string[];
  };
}
