"use client";

import { useEffect, useState, useCallback } from "react";
import EmergencyButton from "../components/EmergencyButton";

interface Notification {
  agency_id: string;
  agency_name: string;
  role: string;
  channel: string;
  status: string;
  sent_at: string;
  acknowledged_at?: string;
  message: string;
}
interface TimelineEvent {
  at: string;
  actor: string;
  event: string;
}
interface Incident {
  incident_id: string;
  plant_id: string;
  severity: string;
  status: string;
  declared_by: string;
  declared_at: string;
  trigger: { reason: string; rule: string | null; source: string };
  advisory: { type: string; headline: string; body: string };
  notifications: Notification[];
  timeline: TimelineEvent[];
  stood_down_at?: string;
  resolution?: string;
}

export default function EmergencyConsole() {
  const [active, setActive] = useState<Incident | null>(null);
  const [history, setHistory] = useState<Incident[]>([]);
  const [busy, setBusy] = useState(false);
  const [resolution, setResolution] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/emergency");
    const data = await res.json();
    setActive(data.active || null);
    setHistory(data.history || []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function acknowledge(agencyId: string) {
    if (!active) return;
    setBusy(true);
    try {
      await fetch("/api/emergency", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          incident_id: active.incident_id,
          action: "acknowledge",
          agency_id: agencyId,
        }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function standDown() {
    if (!active) return;
    setBusy(true);
    try {
      await fetch("/api/emergency", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          incident_id: active.incident_id,
          action: "stand_down",
          by: "Operator",
          resolution: resolution || "Resolved; water confirmed safe.",
        }),
      });
      setResolution("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>Emergency Console</h1>
      <p className="subtitle">
        A declared water emergency activates agency notification, a public
        advisory, and a tracked response — before the situation turns dire.
      </p>

      {!active && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <strong>No active emergency.</strong>
              <div className="muted">
                The water system is operating normally. Declare an emergency
                only if the supply is unsafe.
              </div>
            </div>
            <EmergencyButton />
          </div>
        </div>
      )}

      {active && (
        <>
          <div className="incident-banner">
            <span className={`sev ${active.severity}`}>{active.severity}</span>
            <h2 style={{ margin: "8px 0 4px" }}>{active.advisory.headline}</h2>
            <div className="muted">
              Incident {active.incident_id} · declared by {active.declared_by} ·{" "}
              {new Date(active.declared_at).toLocaleString()} · trigger:{" "}
              {active.trigger.source}
              {active.trigger.rule ? ` (rule ${active.trigger.rule})` : ""}
            </div>
          </div>

          <div className="grid grid-2">
            <div className="card">
              <h2>Public advisory</h2>
              <div
                className={`alert ${
                  active.advisory.type === "do_not_drink" ? "danger" : "warn"
                }`}
              >
                <strong>{active.advisory.headline}</strong>
              </div>
              <p>{active.advisory.body}</p>
              <p className="muted">
                Trigger: {active.trigger.reason}
              </p>
            </div>

            <div className="card">
              <h2>Response timeline</h2>
              <ul className="timeline">
                {active.timeline.map((t, i) => (
                  <li key={i}>
                    <div className="ts">
                      {new Date(t.at).toLocaleTimeString()} · {t.actor}
                    </div>
                    <div>{t.event}</div>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <h2>Agencies notified</h2>
            <table>
              <thead>
                <tr>
                  <th>Agency</th>
                  <th>Role</th>
                  <th>Channel</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {active.notifications.map((n) => (
                  <tr key={n.agency_id}>
                    <td>{n.agency_name}</td>
                    <td className="muted">{n.role}</td>
                    <td>
                      <code>{n.channel}</code>
                    </td>
                    <td>
                      <span
                        className={`pill ${
                          n.status === "acknowledged"
                            ? "ok"
                            : n.status === "failed"
                            ? "danger"
                            : "warn"
                        }`}
                      >
                        {n.status}
                      </span>
                    </td>
                    <td>
                      {n.status === "sent" && (
                        <button
                          className="secondary"
                          style={{ padding: "4px 10px", fontSize: 12 }}
                          disabled={busy}
                          onClick={() => acknowledge(n.agency_id)}
                        >
                          mark acknowledged
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted" style={{ marginTop: 10 }}>
              Delivery is stubbed for the demo — in production these become real
              SMS / email / SDWIS API calls. The incident record and
              acknowledgements are live in MongoDB.
            </p>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <h2>Stand down</h2>
            <p className="muted">
              Close the incident once the water is confirmed safe. This lifts
              the advisory and records the resolution.
            </p>
            <input
              placeholder="Resolution (e.g. chlorine restored to 1.1 mg/L, confirmed by RMW)"
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
            />
            <button className="secondary" disabled={busy} onClick={standDown}>
              {busy ? "Working…" : "Stand down emergency"}
            </button>
          </div>
        </>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Incident history</h2>
        {history.length === 0 ? (
          <p className="muted">No incidents on record.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Incident</th>
                <th>Severity</th>
                <th>Declared</th>
                <th>Status</th>
                <th>Resolution</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.incident_id}>
                  <td>
                    <code>{h.incident_id}</code>
                  </td>
                  <td>
                    <span className={`sev ${h.severity}`}>{h.severity}</span>
                  </td>
                  <td>{new Date(h.declared_at).toLocaleDateString()}</td>
                  <td>
                    <span
                      className={`pill ${
                        h.status === "active" ? "danger" : "ok"
                      }`}
                    >
                      {h.status}
                    </span>
                  </td>
                  <td className="muted">{h.resolution || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
