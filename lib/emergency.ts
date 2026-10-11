// Emergency / red-alert system.
//
// DEMO HONESTY: a hackathon app cannot actually dispatch EPA, recall water, or
// fly a crew to a village. What this module does is model the SOFTWARE layer of
// a real emergency protocol: classify severity, pick the right agencies, draft
// the correct public advisory from the manual's hard rules, and fan out
// structured notifications with per-recipient delivery logging. Each send is
// stubbed at `deliver()` — the one function you'd swap for Twilio / SendGrid /
// EPA SDWIS in production. Everything else (who, what, when, the immutable
// incident record) is exactly what a live system would store.

import { THRESHOLDS } from "./types";
import type {
  Reading,
  Emergency,
  EmergencySeverity,
  AgencyContact,
  AgencyNotification,
  AdvisoryType,
  TimelineEvent,
} from "./types";

// Who gets contacted in a real rural-Alaska drinking-water emergency. Targets
// are placeholders — clearly fake so nobody is actually paged in a demo.
export const AGENCIES: AgencyContact[] = [
  {
    id: "state-dw",
    name: "Alaska DEC — Drinking Water Program",
    role: "State primacy agency; authorizes advisories and compliance response",
    channel: "email",
    target: "demo+dec@example.gov",
  },
  {
    id: "rmw",
    name: "Remote Maintenance Worker (ANTHC/VSW)",
    role: "Travels to the plant; hands-on repair and verification",
    channel: "sms",
    target: "+1-555-0100",
  },
  {
    id: "tribal-health",
    name: "Tribal Health / Village Clinic",
    role: "Protects residents; distributes advisory and bottled water",
    channel: "sms",
    target: "+1-555-0101",
  },
  {
    id: "epa-sdwis",
    name: "EPA Region 10 (SDWIS)",
    role: "Federal oversight; notified for critical disinfection failures",
    channel: "api",
    target: "https://sdwis.example.gov/incidents",
  },
  {
    id: "village-council",
    name: "Village Council / Water Utility",
    role: "Local authority; issues the public notice to residents",
    channel: "phone",
    target: "+1-555-0102",
  },
];

/**
 * Classify severity from readings + manual thresholds. This mirrors the Safety
 * agent's hard rules — the AI never sets severity, the manual does.
 */
export function classifySeverity(readings?: Reading): {
  severity: EmergencySeverity;
  reason: string;
  rule: string | null;
  advisoryType: AdvisoryType;
} {
  if (!readings) {
    return {
      severity: "urgent",
      reason: "Operator-declared emergency without readings attached.",
      rule: null,
      advisoryType: "boil_water",
    };
  }

  const { chlorine, turbidity, ph } = readings;
  const t = THRESHOLDS;

  // Rule 1C — simultaneous disinfection failure. Most severe.
  if (chlorine < t.chlorine.min_safe && turbidity >= t.turbidity.escalate) {
    return {
      severity: "critical",
      reason: `Rule 1C: chlorine ${chlorine} mg/L below 0.3 AND turbidity ${turbidity} NTU at/above 1.0 — simultaneous disinfection failure.`,
      rule: "1C",
      advisoryType: "do_not_drink",
    };
  }
  // Rule 1A — no/low disinfection.
  if (chlorine < t.chlorine.min_safe) {
    return {
      severity: "critical",
      reason: `Rule 1A: free chlorine ${chlorine} mg/L is below the 0.3 mg/L limit — water may be undisinfected.`,
      rule: "1A",
      advisoryType: "boil_water",
    };
  }
  // Rule 1A upper — chlorine overdose.
  if (chlorine > t.chlorine.max_safe) {
    return {
      severity: "critical",
      reason: `Rule 1A: free chlorine ${chlorine} mg/L exceeds the 4.0 mg/L limit — possible overdose.`,
      rule: "1A",
      advisoryType: "do_not_drink",
    };
  }
  // Rule 1B — turbidity shielding pathogens.
  if (turbidity >= t.turbidity.escalate) {
    return {
      severity: "critical",
      reason: `Rule 1B: turbidity ${turbidity} NTU at/above 1.0 — can shield pathogens from chlorine.`,
      rule: "1B",
      advisoryType: "boil_water",
    };
  }
  // pH out of safe band.
  if (ph < t.ph.min_safe || ph > t.ph.max_safe) {
    return {
      severity: "urgent",
      reason: `pH ${ph} is outside the safe band 6.5–8.5.`,
      rule: "pH",
      advisoryType: "do_not_drink",
    };
  }

  // Readings look safe but the operator still declared — treat as urgent.
  return {
    severity: "urgent",
    reason:
      "Operator declared an emergency though current readings are within limits. Treated as urgent pending RMW review.",
    rule: null,
    advisoryType: "boil_water",
  };
}

/** Draft the public advisory text that residents would see. */
export function draftAdvisory(
  plantId: string,
  type: AdvisoryType,
  reason: string
): { type: AdvisoryType; headline: string; body: string } {
  const date = new Date().toLocaleString();
  if (type === "do_not_drink") {
    return {
      type,
      headline: "DO NOT DRINK THE WATER — until further notice",
      body:
        `A water emergency has been declared for ${plantId} as of ${date}. ` +
        `Do NOT drink, cook, or make ice with tap water. Do not try to boil it to make it safe. ` +
        `Use bottled water for drinking, cooking, brushing teeth, and preparing food. ` +
        `Reason: ${reason} Updates will follow from the Village Council and Tribal Health.`,
    };
  }
  if (type === "boil_water") {
    return {
      type,
      headline: "BOIL WATER NOTICE — bring water to a rolling boil for 1 minute",
      body:
        `A boil-water notice is in effect for ${plantId} as of ${date}. ` +
        `Bring all water to a rolling boil for at least 1 minute before drinking, cooking, or brushing teeth, ` +
        `or use bottled water. Reason: ${reason} The notice stays until the water is confirmed safe.`,
    };
  }
  return {
    type: "none",
    headline: "Water system advisory",
    body: `An advisory has been logged for ${plantId} as of ${date}. ${reason}`,
  };
}

/**
 * Pick which agencies to notify for a given severity. Critical pulls in the
 * federal layer; urgent stays state/regional/local.
 */
export function recipientsFor(severity: EmergencySeverity): AgencyContact[] {
  if (severity === "critical") return AGENCIES;
  if (severity === "urgent")
    return AGENCIES.filter((a) => a.id !== "epa-sdwis");
  return AGENCIES.filter((a) => ["state-dw", "rmw", "village-council"].includes(a.id));
}

/**
 * THE STUB. In production this calls Twilio (sms), SendGrid (email), or the
 * SDWIS API. Here it just records a successful delivery so the demo shows the
 * full fan-out without paging anyone. Returns false to simulate a failure path
 * only if the target is obviously invalid.
 */
async function deliver(
  agency: AgencyContact,
  _message: string
): Promise<boolean> {
  // Where a real integration would go:
  //   if (agency.channel === "sms")   await twilio.messages.create({...})
  //   if (agency.channel === "email") await sendgrid.send({...})
  //   if (agency.channel === "api")   await fetch(agency.target, {...})
  return Boolean(agency.target);
}

/** Fan out notifications to the chosen agencies, logging each delivery. */
export async function notifyAgencies(
  plantId: string,
  severity: EmergencySeverity,
  advisoryHeadline: string,
  reason: string
): Promise<AgencyNotification[]> {
  const recipients = recipientsFor(severity);
  const now = new Date().toISOString();

  const results = await Promise.all(
    recipients.map(async (a) => {
      const message =
        `[${severity.toUpperCase()}] ${plantId}: ${advisoryHeadline}. ${reason} ` +
        `Please acknowledge and respond per the drinking-water emergency protocol.`;
      let ok = false;
      try {
        ok = await deliver(a, message);
      } catch {
        ok = false;
      }
      const n: AgencyNotification = {
        agency_id: a.id,
        agency_name: a.name,
        role: a.role,
        channel: a.channel,
        status: ok ? "sent" : "failed",
        sent_at: now,
        message,
      };
      return n;
    })
  );

  return results;
}

/** Build a fresh incident record (not yet persisted). */
export function buildIncident(
  plantId: string,
  declaredBy: string,
  source: "operator" | "auto-safety-agent",
  readings: Reading | undefined,
  notifications: AgencyNotification[]
): Emergency {
  const { severity, reason, rule, advisoryType } = classifySeverity(readings);
  const advisory = draftAdvisory(plantId, advisoryType, reason);
  const now = new Date().toISOString();

  const timeline: TimelineEvent[] = [
    {
      at: now,
      actor: declaredBy,
      event: `Emergency declared (${severity}) — ${reason}`,
    },
    {
      at: now,
      actor: "system",
      event: `Public advisory issued: ${advisory.headline}`,
    },
    {
      at: now,
      actor: "system",
      event: `Notified ${notifications.length} agencies (${notifications
        .filter((n) => n.status === "sent")
        .length} sent, ${notifications
        .filter((n) => n.status === "failed")
        .length} failed).`,
    },
  ];

  return {
    incident_id: `INC-${Date.now()}`,
    plant_id: plantId,
    severity,
    status: "active",
    declared_by: declaredBy,
    declared_at: now,
    trigger: { reason, rule, readings, source },
    advisory,
    notifications,
    timeline,
  };
}
