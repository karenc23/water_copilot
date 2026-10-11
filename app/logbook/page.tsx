"use client";

import { useEffect, useState } from "react";

interface LogEntry {
  date: string;
  operator: string;
  problem: string;
  steps_taken: string;
  outcome: string;
  escalated: boolean;
  tags?: string[];
}

export default function Logbook() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    operator: "",
    problem: "",
    steps_taken: "",
    outcome: "",
    escalated: false,
  });

  async function load(q?: string) {
    const url = q ? `/api/logs?q=${encodeURIComponent(q)}` : "/api/logs";
    const res = await fetch(url);
    const data = await res.json();
    setLogs(data.logs || []);
  }

  useEffect(() => {
    load();
  }, []);

  async function search() {
    await load(query.trim() || undefined);
  }

  async function addEntry() {
    setAdding(true);
    try {
      await fetch("/api/logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      setForm({
        operator: "",
        problem: "",
        steps_taken: "",
        outcome: "",
        escalated: false,
      });
      await load();
    } finally {
      setAdding(false);
    }
  }

  return (
    <>
      <h1>Logbook</h1>
      <p className="subtitle">
        Every problem and fix, stored per plant. This is the memory ChatGPT
        doesn&apos;t have — ask &quot;what fixed this last time?&quot;
      </p>

      <div className="card">
        <div className="row">
          <input
            placeholder="Search the plant's history (e.g. chlorine low, filter clog)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
          />
          <button style={{ flex: "0 0 auto" }} onClick={search}>
            Search
          </button>
          <button
            className="secondary"
            style={{ flex: "0 0 auto" }}
            onClick={() => {
              setQuery("");
              load();
            }}
          >
            Clear
          </button>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Add an entry</h2>
        <div className="row">
          <div>
            <label>Operator</label>
            <input
              value={form.operator}
              onChange={(e) => setForm({ ...form, operator: e.target.value })}
            />
          </div>
          <div>
            <label>Problem</label>
            <input
              value={form.problem}
              onChange={(e) => setForm({ ...form, problem: e.target.value })}
            />
          </div>
        </div>
        <label>Steps taken</label>
        <textarea
          value={form.steps_taken}
          onChange={(e) => setForm({ ...form, steps_taken: e.target.value })}
        />
        <div className="row">
          <div>
            <label>Outcome</label>
            <input
              value={form.outcome}
              onChange={(e) => setForm({ ...form, outcome: e.target.value })}
            />
          </div>
          <div>
            <label>Escalated?</label>
            <select
              value={form.escalated ? "yes" : "no"}
              onChange={(e) =>
                setForm({ ...form, escalated: e.target.value === "yes" })
              }
            >
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </div>
        </div>
        <button onClick={addEntry} disabled={adding || !form.problem}>
          {adding ? "Saving…" : "Save entry"}
        </button>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>{query ? `Results for "${query}"` : "All entries"}</h2>
        {logs.length === 0 ? (
          <p className="muted">No entries.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Operator</th>
                <th>Problem</th>
                <th>Fix</th>
                <th>Outcome</th>
                <th>Esc.</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l, i) => (
                <tr key={i}>
                  <td>{l.date}</td>
                  <td>{l.operator}</td>
                  <td>{l.problem}</td>
                  <td className="muted">{l.steps_taken}</td>
                  <td>{l.outcome}</td>
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
        )}
      </div>
    </>
  );
}
