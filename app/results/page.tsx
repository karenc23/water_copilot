"use client";

import { useEffect, useState } from "react";

interface RoundScore {
  round: number | string;
  strategy: string;
  training_score: number;
  escalation_accuracy: number;
  missed_health_risks: number;
}
interface ResultsData {
  problem: string;
  baseline: { label: string; score: number; missed_health_risks: number };
  rounds: RoundScore[];
  final_test: {
    strategy: string;
    score: number;
    escalation_accuracy: number;
    missed_health_risks: number;
    n_scenarios: number;
  };
  max_score: number;
  source?: string;
}

export default function Results() {
  const [data, setData] = useState<ResultsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/results")
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setData(d)))
      .catch((e) => setError(String(e)));
  }, []);

  if (error)
    return (
      <>
        <h1>Benchmark</h1>
        <div className="alert warn">
          {error} Run <code>python optimize/optimize.py</code> to generate live
          results.
        </div>
      </>
    );
  if (!data) return <p className="muted">Loading benchmark…</p>;

  const pct = (s: number) => Math.round((s / data.max_score) * 100);

  return (
    <>
      <h1>Self-improving benchmark</h1>
      <p className="subtitle">
        Our copilot vs. a plain-LLM baseline on 12 training + 3 fresh scenarios.
        Missed health risks are penalized heavily.
      </p>

      <div className="card">
        <h2>The problem</h2>
        <p>{data.problem}</p>
      </div>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <div className="card">
          <h2>Baseline — {data.baseline.label}</h2>
          <div className="stat">{pct(data.baseline.score)}%</div>
          <div className="muted">
            {data.baseline.missed_health_risks} missed health risk(s)
          </div>
        </div>
        <div className="card">
          <h2>Final strategy — fresh scenarios</h2>
          <div className="stat" style={{ color: "var(--ok)" }}>
            {pct(data.final_test.score)}%
          </div>
          <div className="muted">
            {data.final_test.missed_health_risks} missed on{" "}
            {data.final_test.n_scenarios} unseen scenarios ·{" "}
            {Math.round(data.final_test.escalation_accuracy * 100)}% escalation
            accuracy
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Rounds — the critic agent rewrites the weak strategies</h2>
        <table>
          <thead>
            <tr>
              <th>Round</th>
              <th>Winning strategy</th>
              <th>Training score</th>
              <th>Escalation acc.</th>
              <th>Missed risks</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>baseline</td>
              <td className="muted">{data.baseline.label}</td>
              <td>{pct(data.baseline.score)}%</td>
              <td>—</td>
              <td>
                <span className="pill danger">
                  {data.baseline.missed_health_risks}
                </span>
              </td>
            </tr>
            {data.rounds.map((r, i) => (
              <tr key={i}>
                <td>round {r.round}</td>
                <td className="muted">{r.strategy}</td>
                <td>{pct(r.training_score)}%</td>
                <td>{Math.round(r.escalation_accuracy * 100)}%</td>
                <td>
                  <span
                    className={`pill ${
                      r.missed_health_risks === 0 ? "ok" : "warn"
                    }`}
                  >
                    {r.missed_health_risks}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ marginTop: 16 }}>
          {data.rounds.map((r, i) => (
            <div key={i} style={{ marginBottom: 8 }}>
              <div className="muted" style={{ fontSize: 12 }}>
                round {r.round}
              </div>
              <div className="bar">
                <span
                  style={{
                    width: `${pct(r.training_score)}%`,
                    background: "var(--accent)",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
        {data.source && (
          <p className="muted" style={{ marginTop: 12 }}>
            source: <code>{data.source}</code>
          </p>
        )}
      </div>
    </>
  );
}
