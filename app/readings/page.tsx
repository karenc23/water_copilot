"use client";

import { useEffect, useState } from "react";

interface Reading {
  date: string;
  chlorine: number;
  turbidity: number;
  ph: number;
}
interface Drift {
  parameter: string;
  rule: string;
  message: string;
  severity: string;
}

export default function Readings() {
  const [readings, setReadings] = useState<Reading[]>([]);
  const [drift, setDrift] = useState<Drift[]>([]);
  const [chlorine, setChlorine] = useState("");
  const [turbidity, setTurbidity] = useState("");
  const [ph, setPh] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/readings");
    const data = await res.json();
    if (data.error) setError(data.error);
    else {
      setReadings(data.readings);
      setDrift(data.drift);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/readings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chlorine: Number(chlorine),
          turbidity: Number(turbidity),
          ph: Number(ph),
        }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else {
        setChlorine("");
        setTurbidity("");
        setPh("");
        await load();
      }
    } finally {
      setSaving(false);
    }
  }

  const recent = readings.slice(-21);
  const maxCl = Math.max(1, ...recent.map((r) => r.chlorine));

  return (
    <>
      <h1>Readings Tracker</h1>
      <p className="subtitle">
        Log chlorine, turbidity and pH daily. The plant watches the trend and
        warns you before a failure.
      </p>

      {drift.map((d, i) => (
        <div key={i} className="alert warn">
          <strong>{d.rule}:</strong> {d.message}
        </div>
      ))}
      {drift.length === 0 && readings.length > 0 && (
        <div className="alert ok">No drift detected. Readings are steady.</div>
      )}

      <div className="card">
        <h2>Log today&apos;s reading</h2>
        <div className="row">
          <div>
            <label>Free chlorine (mg/L)</label>
            <input value={chlorine} onChange={(e) => setChlorine(e.target.value)} />
          </div>
          <div>
            <label>Turbidity (NTU)</label>
            <input
              value={turbidity}
              onChange={(e) => setTurbidity(e.target.value)}
            />
          </div>
          <div>
            <label>pH</label>
            <input value={ph} onChange={(e) => setPh(e.target.value)} />
          </div>
        </div>
        <button
          onClick={save}
          disabled={saving || !chlorine || !turbidity || !ph}
        >
          {saving ? "Saving…" : "Save reading"}
        </button>
        {error && (
          <div className="alert danger" style={{ marginTop: 12 }}>
            {error}
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Chlorine, last {recent.length} readings</h2>
        <div className="sparkline">
          {recent.map((r, i) => (
            <span
              key={i}
              title={`${r.date}: ${r.chlorine} mg/L`}
              style={{
                height: `${(r.chlorine / maxCl) * 100}%`,
                background:
                  r.chlorine < 0.3 ? "var(--danger)" : "var(--accent)",
              }}
            />
          ))}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>History</h2>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Chlorine</th>
              <th>Turbidity</th>
              <th>pH</th>
            </tr>
          </thead>
          <tbody>
            {[...readings].reverse().slice(0, 30).map((r, i) => (
              <tr key={i}>
                <td>{r.date}</td>
                <td style={{ color: r.chlorine < 0.3 ? "var(--danger)" : undefined }}>
                  {r.chlorine}
                </td>
                <td style={{ color: r.turbidity >= 1 ? "var(--danger)" : undefined }}>
                  {r.turbidity}
                </td>
                <td style={{ color: r.ph < 6.5 || r.ph > 8.5 ? "var(--danger)" : undefined }}>
                  {r.ph}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
