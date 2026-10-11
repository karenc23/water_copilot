"use client";

import { useState } from "react";

interface Result {
  diagnosis: string;
  steps: string[];
  citations: { page: string; heading: string }[];
  safety: {
    escalate: boolean;
    health_critical: boolean;
    reason: string;
    rule: string | null;
    source: string;
  };
  past_similar: {
    date: string;
    problem: string;
    steps_taken: string;
    outcome: string;
  }[];
  escalation_packet?: {
    summary: string;
    steps_tried: string;
    recent_readings: { date: string; chlorine: number; turbidity: number; ph: number }[];
  };
}

export default function Troubleshoot() {
  const [report, setReport] = useState("");
  const [chlorine, setChlorine] = useState("");
  const [turbidity, setTurbidity] = useState("");
  const [ph, setPh] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const readings =
        chlorine && turbidity && ph
          ? {
              chlorine: Number(chlorine),
              turbidity: Number(turbidity),
              ph: Number(ph),
            }
          : undefined;
      const res = await fetch("/api/troubleshoot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report, readings }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else setResult(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <h1>Troubleshoot</h1>
      <p className="subtitle">
        Describe the problem in plain words. You get cited steps from this
        plant&apos;s manual and a clear escalate / don&apos;t-escalate call.
      </p>

      <div className="card">
        <label>What&apos;s happening?</label>
        <textarea
          value={report}
          onChange={(e) => setReport(e.target.value)}
          placeholder="e.g. Chlorine came back at 0.18 today, cylinder still shows plenty of gas"
        />
        <label>Current readings (optional, but sharpens the safety call)</label>
        <div className="row">
          <input
            placeholder="chlorine mg/L"
            value={chlorine}
            onChange={(e) => setChlorine(e.target.value)}
          />
          <input
            placeholder="turbidity NTU"
            value={turbidity}
            onChange={(e) => setTurbidity(e.target.value)}
          />
          <input
            placeholder="pH"
            value={ph}
            onChange={(e) => setPh(e.target.value)}
          />
        </div>
        <button onClick={submit} disabled={loading || !report.trim()}>
          {loading ? "Thinking…" : "Get help"}
        </button>
      </div>

      {error && <div className="alert danger">{error}</div>}

      {result && (
        <>
          <div
            className={`alert ${
              result.safety.escalate
                ? result.safety.health_critical
                  ? "danger"
                  : "warn"
                : "ok"
            }`}
            style={{ marginTop: 16 }}
          >
            <strong>
              {result.safety.escalate
                ? result.safety.health_critical
                  ? "ESCALATE — health-critical"
                  : "ESCALATE"
                : "Handle locally"}
            </strong>
            <div>{result.safety.reason}</div>
            <div className="muted" style={{ marginTop: 6 }}>
              decided by: {result.safety.source}
              {result.safety.rule ? ` · rule ${result.safety.rule}` : ""}
            </div>
          </div>

          <div className="card">
            <h2>Diagnosis</h2>
            <p>{result.diagnosis}</p>
            <h2 style={{ marginTop: 16 }}>Steps</h2>
            <ol className="steps">
              {result.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
            <div style={{ marginTop: 12 }}>
              {result.citations.map((c, i) => (
                <span className="citation" key={i} title={c.heading}>
                  {c.page} — {c.heading}
                </span>
              ))}
            </div>
          </div>

          {result.past_similar.length > 0 && (
            <div className="card" style={{ marginTop: 16 }}>
              <h2>What fixed this last time</h2>
              {result.past_similar.map((p, i) => (
                <div key={i} className="alert ok">
                  <strong>{p.date}</strong> — {p.problem}
                  <div className="muted">
                    Fix: {p.steps_taken} → {p.outcome}
                  </div>
                </div>
              ))}
            </div>
          )}

          {result.escalation_packet && (
            <div className="card" style={{ marginTop: 16 }}>
              <h2>Expert handoff packet</h2>
              <p className="muted">
                Send this to the Remote Maintenance Worker so they can diagnose
                remotely — no phone-tag marathon.
              </p>
              <p>
                <strong>Summary:</strong> {result.escalation_packet.summary}
              </p>
              <p>
                <strong>Steps tried:</strong>{" "}
                {result.escalation_packet.steps_tried}
              </p>
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Cl</th>
                    <th>Turb</th>
                    <th>pH</th>
                  </tr>
                </thead>
                <tbody>
                  {result.escalation_packet.recent_readings.map((r, i) => (
                    <tr key={i}>
                      <td>{r.date}</td>
                      <td>{r.chlorine}</td>
                      <td>{r.turbidity}</td>
                      <td>{r.ph}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
