import { NextRequest, NextResponse } from "next/server";
import {
  createEmergency,
  getActiveEmergency,
  getEmergency,
  listEmergencies,
  acknowledgeAgency,
  appendTimeline,
  standDownEmergency,
  getReadings,
  addLog,
} from "@/lib/db";
import { buildIncident, notifyAgencies, classifySeverity } from "@/lib/emergency";
import type { Reading } from "@/lib/types";

const DEFAULT_PLANT = "chena-village-01";

// GET /api/emergency            -> { active, history }
// GET /api/emergency?id=INC-123 -> { incident }
export async function GET(req: NextRequest) {
  const plantId = req.nextUrl.searchParams.get("plant_id") || DEFAULT_PLANT;
  const id = req.nextUrl.searchParams.get("id");
  try {
    if (id) {
      const incident = await getEmergency(id);
      return NextResponse.json({ incident });
    }
    const [active, history] = await Promise.all([
      getActiveEmergency(plantId),
      listEmergencies(plantId, 20),
    ]);
    return NextResponse.json({ active, history });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load." },
      { status: 500 }
    );
  }
}

// POST /api/emergency  { declared_by, source?, readings? }  -> declares an incident
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const plantId: string = body.plant_id || DEFAULT_PLANT;
    const declaredBy: string = body.declared_by || "Operator";
    const source: "operator" | "auto-safety-agent" =
      body.source === "auto-safety-agent" ? "auto-safety-agent" : "operator";

    // Guard: one active incident per plant.
    const existing = await getActiveEmergency(plantId);
    if (existing) {
      return NextResponse.json(
        { error: "An emergency is already active for this plant.", active: existing },
        { status: 409 }
      );
    }

    // Use the latest stored reading if the caller didn't attach one.
    let readings: Reading | undefined;
    if (
      body.readings &&
      typeof body.readings.chlorine === "number" &&
      typeof body.readings.turbidity === "number" &&
      typeof body.readings.ph === "number"
    ) {
      readings = {
        plant_id: plantId,
        date: new Date().toISOString().slice(0, 10),
        ...body.readings,
      };
    } else {
      const recent = await getReadings(plantId, 1);
      readings = recent[recent.length - 1];
    }

    const { severity, reason, advisoryType } = classifySeverity(readings);
    const headline =
      advisoryType === "do_not_drink"
        ? "DO NOT DRINK THE WATER"
        : advisoryType === "boil_water"
        ? "BOIL WATER NOTICE"
        : "Water system advisory";

    const notifications = await notifyAgencies(
      plantId,
      severity,
      headline,
      reason
    );

    const incident = buildIncident(
      plantId,
      declaredBy,
      source,
      readings,
      notifications
    );

    await createEmergency(incident);

    // Mirror into the logbook so the plant's history records the emergency.
    await addLog({
      plant_id: plantId,
      date: new Date().toISOString().slice(0, 10),
      operator: declaredBy,
      problem: `EMERGENCY DECLARED (${severity}): ${reason}`,
      steps_taken: `Issued ${incident.advisory.headline}. Notified ${notifications.length} agencies.`,
      outcome: "pending — incident " + incident.incident_id,
      escalated: true,
      tags: ["emergency"],
    });

    return NextResponse.json({ ok: true, incident });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to declare." },
      { status: 500 }
    );
  }
}

// PATCH /api/emergency
//   { incident_id, action: "acknowledge", agency_id }
//   { incident_id, action: "stand_down", by, resolution }
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const incidentId: string = body.incident_id;
    if (!incidentId) {
      return NextResponse.json(
        { error: "incident_id is required." },
        { status: 400 }
      );
    }

    if (body.action === "acknowledge") {
      const agencyId: string = body.agency_id;
      await acknowledgeAgency(incidentId, agencyId);
      await appendTimeline(incidentId, {
        at: new Date().toISOString(),
        actor: agencyId,
        event: "Acknowledged the alert and is responding.",
      });
    } else if (body.action === "stand_down") {
      const by: string = body.by || "Operator";
      const resolution: string =
        body.resolution || "Resolved; water confirmed safe.";
      await standDownEmergency(incidentId, by, resolution);
      await appendTimeline(incidentId, {
        at: new Date().toISOString(),
        actor: by,
        event: `Emergency stood down: ${resolution}`,
      });
    } else {
      return NextResponse.json(
        { error: "Unknown action." },
        { status: 400 }
      );
    }

    const incident = await getEmergency(incidentId);
    return NextResponse.json({ ok: true, incident });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update." },
      { status: 500 }
    );
  }
}
