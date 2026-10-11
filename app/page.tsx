"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface DashboardData {
  latest?: { date: string; chlorine: number; turbidity: number; ph: number };
  drift: { parameter: string; rule: string; message: string; severity: string }[];
  safety: { escalate: boolean; reason: string } | null;
  risk: { score: number; label: string; factors: string[] };
  counts: { readings: number; logs: number };
  recent_logs: {
    date: string;
    problem: string;
    escalated: boolean;
  }[];
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/dashboard")
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setData(d)))
      .catch((e) => setError(String(e)));
  }, []);

  if (error)
    return (
      <>
        <h1>Dashboard</h1>
        <div className="alert danger">
          Could not load plant data: {error}. Have you run <code>npm run seed</code>?
        </div>
      </>
    );
  if (!data) return <p className="muted">Loading plant status…</p>;

  const riskClass =
    data.risk.label === "High" ? "danger" : data.risk.label === "Medium" ? "warn" : "ok";

  return (
    <>
      <h1>Plant Status</h1>
      <p className="subtitle">
        chena-village-01 — what the plant remembers, at a glance.
      </p>

      {data.safety?.escalate && (
        <div className="alert danger">
          <strong>Escalate now.</strong> {data.safety.reason}
        </div>
      )}

      <div className="grid grid-3">
        <div className="card">
          <div className="stat-label">Latest chlorine</div>
          <div className="stat">{data.latest?.chlorine ?? "—"}</div>
          <div className="muted">mg/L — safe band 0.5–2.0</div>
        </div>
        <div className="card">
          <div className="stat-label">Latest turbidity</div>
          <div className="stat">{data.latest?.turbidity ?? "—"}</div>
          <div className="muted">NTU — escalate at 1.0</div>
        </div>
        <div className="card">
          <div className="stat-label">Latest pH</div>
          <div className="stat">{data.latest?.ph ?? "—"}</div>
          <div className="muted">safe band 6.5–8.5</div>
        </div>
      </div>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <div className="card">
          <h2>Drift alerts (code, not AI)</h2>
          {data.drift.length === 0 ? (
            <div className="alert ok">No drift. Readings are steady.</div>
          ) : (
            data.drift.map((d, i) => (
              <div key={i} className="alert warn">
                <strong>{d.rule}:</strong> {d.message}
              </div>
            ))
          )}
          <p className="muted">
            The AI never guesses at health thresholds — these are plain rules
            from Page 2 of the manual.
          </p>
        </div>

        <div className="card">
          <h2>
            Knowledge-risk score
            <span className={`pill ${riskClass}`}>{data.risk.label}</span>
          </h2>
          <div className="stat">{data.risk.score}/100</div>
          <div className="bar" style={{ margin: "10px 0 14px" }}>
            <span
              style={{
                width: `${data.risk.score}%`,
                background:
                  riskClass === "danger"
                    ? "var(--danger)"
                    : riskClass === "warn"
                    ? "var(--warn)"
                    : "var(--ok)",
              }}
            />
          </div>
          <div className="muted">
            How exposed is this plant if the operator leaves tomorrow?
          </div>
          <ul className="muted" style={{ marginTop: 10 }}>
            {data.risk.factors.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>
          Recent logbook
          <Link href="/logbook" className="pill ok">
            open logbook →
          </Link>
        </h2>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Problem</th>
              <th>Escalated</th>
            </tr>
          </thead>
          <tbody>
            {data.recent_logs.map((l, i) => (
              <tr key={i}>
                <td>{l.date}</td>
                <td>{l.problem}</td>
                <td>
                  {l.escalated ? (
                    <span className="pill danger">yes</span>
                  ) : (
                    <span className="pill ok">no</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted" style={{ marginTop: 12 }}>
          {data.counts.readings} readings and {data.counts.logs} logbook entries
          stored for this plant.
        </p>
      </div>
    </>
  );
}
