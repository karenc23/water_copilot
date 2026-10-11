"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// Single series (best per round) plus two baseline reference lines, each direct-labeled.
// Neutral colors only: green/yellow/red are reserved for safety tiers.

const OURS = "#2a78d6";
const BASELINE = "#475569";

export interface RoundPoint {
  round: number;
  pct: number;
  id: string;
}

export default function ResultsChart({ points, plainPct, rulesPct }: { points: RoundPoint[]; plainPct: number | null; rulesPct: number | null }) {
  const values = [...points.map((p) => p.pct), plainPct ?? 0, rulesPct ?? 0];
  // Round ticks every 25%, with room below the lowest baseline for its label.
  const lo = Math.min(0, Math.floor((Math.min(...values) - 10) / 25) * 25);
  const ticks = Array.from({ length: (100 - lo) / 25 + 1 }, (_, i) => lo + i * 25);
  const fmt = (v: number) => `${Math.round(v)}%`;

  return (
    <div className="h-80">
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 800, height: 320 }}>
        <LineChart data={points} margin={{ top: 16, right: 24, bottom: 8, left: 0 }}>
          <CartesianGrid vertical={false} stroke="#e2e8f0" />
          <XAxis
            dataKey="round"
            tickFormatter={(r: number) => `Round ${r}`}
            tick={{ fill: "#475569", fontSize: 14 }}
            tickLine={false}
            axisLine={{ stroke: "#cbd5e1" }}
            padding={{ left: 24, right: 24 }}
          />
          <YAxis domain={[lo, 100]} ticks={ticks} tickFormatter={fmt} tick={{ fill: "#475569", fontSize: 14 }} tickLine={false} axisLine={false} width={52} />
          {rulesPct !== null && (
            <ReferenceLine
              y={rulesPct}
              stroke={BASELINE}
              strokeDasharray="6 4"
              strokeWidth={2}
              label={{ value: `Rules only ${fmt(rulesPct)}`, position: "insideBottomLeft", fill: "#334155", fontSize: 14 }}
            />
          )}
          {plainPct !== null && (
            <ReferenceLine
              y={plainPct}
              stroke={BASELINE}
              strokeDasharray="2 4"
              strokeWidth={2}
              label={{ value: `Plain LLM ${fmt(plainPct)}`, position: "insideTopLeft", fill: "#334155", fontSize: 14 }}
            />
          )}
          <Tooltip
            cursor={{ stroke: "#64748b", strokeDasharray: "4 4" }}
            content={({ active, payload }) => {
              const p = active ? (payload?.[0]?.payload as RoundPoint | undefined) : undefined;
              if (!p) return null;
              return (
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-lg">
                  <div className="text-sm text-slate-600">Round {p.round}</div>
                  <div className="text-lg font-bold text-slate-900">{p.pct.toFixed(1)}%</div>
                  <div className="font-mono text-xs text-slate-500">{p.id}</div>
                </div>
              );
            }}
          />
          <Line
            dataKey="pct"
            stroke={OURS}
            strokeWidth={3}
            dot={{ r: 5, fill: OURS, stroke: "#fff", strokeWidth: 2 }}
            activeDot={{ r: 7, fill: OURS, stroke: "#fff", strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
