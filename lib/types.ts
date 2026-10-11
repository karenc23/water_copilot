// Shared domain types for the Chena copilot.

export interface Reading {
  plant_id: string;
  date: string; // ISO date (YYYY-MM-DD)
  chlorine: number; // mg/L free chlorine residual
  turbidity: number; // NTU
  ph: number;
}

export interface LogEntry {
  plant_id: string;
  date: string; // ISO date
  operator: string;
  problem: string;
  steps_taken: string;
  outcome: string;
  escalated: boolean;
  tags?: string[];
}

export interface ManualChunk {
  plant_id: string;
  page: string; // e.g. "Page 3"
  heading: string;
  text: string;
  embedding?: number[];
}

export interface ManualHit extends ManualChunk {
  score: number;
}

export interface Citation {
  page: string;
  heading: string;
}

// Thresholds mirror Page 1 of the manual. These live in code so the AI never
// invents a safety limit — the drift and escalation rules read from here.
export const THRESHOLDS = {
  chlorine: { min_safe: 0.3, warn_low: 0.5, warn_high: 2.0, max_safe: 4.0 },
  turbidity: { escalate: 1.0, warn: 0.3 },
  ph: { min_safe: 6.5, warn_low: 6.8, warn_high: 7.8, max_safe: 8.5 },
} as const;

export interface SafetyVerdict {
  escalate: boolean;
  health_critical: boolean;
  reason: string;
  // Which rule fired, for transparency in the UI.
  rule: string | null;
  source: "hard-rule" | "llm" | "both";
}

export interface TroubleshootResult {
  diagnosis: string;
  steps: string[];
  citations: Citation[];
  safety: SafetyVerdict;
  past_similar: LogEntry[];
  escalation_packet?: EscalationPacket;
}

export interface EscalationPacket {
  plant_id: string;
  summary: string;
  recent_readings: Reading[];
  steps_tried: string;
  generated_at: string;
}

export interface DriftAlert {
  parameter: "chlorine" | "turbidity" | "ph";
  rule: string;
  message: string;
  severity: "info" | "warning";
}

// ---------------------------------------------------------------------------
// Emergency / red-alert system
// ---------------------------------------------------------------------------

export type EmergencySeverity = "advisory" | "urgent" | "critical";
export type EmergencyStatus = "active" | "stood_down";
export type AdvisoryType = "boil_water" | "do_not_drink" | "none";

export interface AgencyContact {
  id: string;
  name: string;
  role: string; // what they do in a response
  channel: "sms" | "email" | "phone" | "api";
  target: string; // phone/email/endpoint — stubbed in demo
}

export type NotificationStatus = "sent" | "acknowledged" | "failed";

export interface AgencyNotification {
  agency_id: string;
  agency_name: string;
  role: string;
  channel: string;
  status: NotificationStatus;
  sent_at: string;
  acknowledged_at?: string;
  message: string;
}

export interface TimelineEvent {
  at: string;
  actor: string; // operator, system, or an agency name
  event: string;
}

export interface Emergency {
  incident_id: string;
  plant_id: string;
  severity: EmergencySeverity;
  status: EmergencyStatus;
  declared_by: string;
  declared_at: string;
  trigger: {
    reason: string;
    rule: string | null;
    readings?: Reading;
    source: "operator" | "auto-safety-agent";
  };
  advisory: {
    type: AdvisoryType;
    headline: string;
    body: string;
  };
  notifications: AgencyNotification[];
  timeline: TimelineEvent[];
  stood_down_at?: string;
  stood_down_by?: string;
  resolution?: string;
}
