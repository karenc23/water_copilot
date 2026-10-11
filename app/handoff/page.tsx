"use client";

import { useEffect, useState } from "react";

interface HandoffData {
  guide: {
    summary: string;
    recurring_problems: { problem: string; count: number; usual_fix: string }[];
    what_usually_works: string[];
    escalation_history: { date: string; problem: string; outcome: string }[];
    quirks: string[];
    stats: { total_entries: number; escalations: number; span_days: number };
  };
  risk: { score: number; label: string; factors: string[] };
}

export default function Handoff() {
  const [data, setData] = useState<HandoffData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/handoff")
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setData(d)))
      .catch((e) => setError(String(e)));
  }, []);

  if (error) return <div className="alert danger">{error}</div>;
  if (!data) return <p className="muted">Building the handoff guide…</p>;

  const { guide, risk } = data;

  return (
    <>
      <h1>Welcome to this plant</h1>
      <p className="subtitle">
        Auto-generated for the next operator from {guide.stats.total_entries}{" "}
        logbook entries. When someone leaves, their knowledge stays.
      </p>

      <div className="card">
        <h2>The short version</h2>
        <p>{guide.summary}</p>
        <div className="row" style={{ marginTop: 10 }}>
          <div>
            <div className="stat-label">Entries</div>
            <div className="stat">{guide.stats.total_entries}</div>
          </div>
          <div>
            <div className="stat-label">Escalations</div>
            <div className="stat">{guide.stats.escalations}</div>
          </div>
          <div>
            <div className="stat-label">History span</div>
            <div className="stat">{guide.stats.span_days}d</div>
          </div>
          <div>
            <div className="stat-label">Knowledge risk</div>
            <div className="stat">
              <span
                className={`pill ${
                  risk.label === "High"
                    ? "danger"
                    : risk.label === "Medium"
                    ? "warn"
                    : "ok"
                }`}
              >
                {risk.label}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Plant quirks — read these first</h2>
        {guide.quirks.map((q, i) => (
          <div key={i} className="alert warn">
            {q}
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Recurring problems</h2>
        {guide.recurring_problems.length === 0 ? (
          <p className="muted">No strongly recurring problems recorded.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Problem</th>
                <th>Times</th>
                <th>What usually works</th>
              </tr>
            </thead>
            <tbody>
              {guide.recurring_problems.map((r, i) => (
                <tr key={i}>
                  <td>{r.problem}</td>
                  <td>
                    <span className="pill warn">{r.count}×</span>
                  </td>
                  <td className="muted">{r.usual_fix}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <div className="card">
          <h2>What usually works</h2>
          <ul className="steps">
            {guide.what_usually_works.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
        <div className="card">
          <h2>Escalation history</h2>
          {guide.escalation_history.length === 0 ? (
            <p className="muted">No escalations recorded.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Problem</th>
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {guide.escalation_history.map((e, i) => (
                  <tr key={i}>
                    <td>{e.date}</td>
                    <td>{e.problem}</td>
                    <td className="muted">{e.outcome}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
