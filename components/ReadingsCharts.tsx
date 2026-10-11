"use client";

import { CartesianGrid, ComposedChart, Line, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { LIMITS } from "@/lib/rules";
import type { Reading } from "@/types";
import { PARAMETERS, TIER_STYLE, TierIcon, readingTier, type Parameter } from "@/components/tier";
import { formatDate } from "@/components/ui";

// One chart per parameter: different units never share an axis.
// Bands use the rule LIMITS; tier colors are pale so the blue reading line stays the focus.

const LINE = "#2a78d6";
const BAND = { green: "#16a34a", yellow: "#f59e0b", red: "#dc2626" } as const;
const BAND_OPACITY = { green: 0.1, yellow: 0.16, red: 0.14 } as const;

type Band = { y1: number; y2: number; tier: keyof typeof BAND };

/** Round tick values from lo to hi. */
function ticksFor([lo, hi]: [number, number], step: number): number[] {
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

const TICK_STEP: Record<Parameter, number> = { chlorine: 0.5, turbidity: 0.1, ph: 0.5 };

function config(parameter: Parameter, values: number[]): { domain: [number, number]; bands: Band[] } {
  const max = Math.max(...values);
  const min = Math.min(...values);
  if (parameter === "chlorine") {
    const c = LIMITS.chlorine;
    const top = Math.max(2.5, Math.ceil(max * 1.15 * 2) / 2);
    return {
      domain: [0, top],
      bands: [
        { y1: 0, y2: c.red_below, tier: "red" },
        { y1: c.red_below, y2: c.yellow_below, tier: "yellow" },
        { y1: c.yellow_below, y2: c.yellow_above, tier: "green" },
        { y1: c.yellow_above, y2: c.red_above, tier: "yellow" },
        { y1: c.red_above, y2: top, tier: "red" },
      ],
    };
  }
  if (parameter === "turbidity") {
    const t = LIMITS.turbidity;
    const top = Math.max(0.4, Math.ceil(max * 1.2 * 10) / 10);
    return {
      domain: [0, top],
      bands: [
        { y1: 0, y2: t.yellow_at, tier: "green" },
        { y1: t.yellow_at, y2: t.red_above, tier: "yellow" },
        { y1: t.red_above, y2: top, tier: "red" },
      ],
    };
  }
  const p = LIMITS.ph;
  const lo = Math.min(6.2, Math.floor(min * 2) / 2);
  const hi = Math.max(8.8, Math.ceil(max * 2) / 2);
  return {
    domain: [lo, hi],
    bands: [
      { y1: lo, y2: p.red_below, tier: "red" },
      { y1: p.red_below, y2: p.yellow_below, tier: "yellow" },
      { y1: p.yellow_below, y2: p.yellow_above, tier: "green" },
      { y1: p.yellow_above, y2: p.red_above, tier: "yellow" },
      { y1: p.red_above, y2: hi, tier: "red" },
    ],
  };
}

export default function ReadingsCharts({ readings }: { readings: Reading[] }) {
  const data = [...readings].sort((a, b) => a.date.localeCompare(b.date));
  if (!data.length) return <p className="text-lg text-slate-600">No readings yet.</p>;
  return (
    <div className="space-y-6">
      {(["chlorine", "turbidity", "ph"] as const).map((p) => (
        <ParameterChart key={p} parameter={p} data={data} />
      ))}
      <p className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-slate-600">
        <span>Shaded bands:</span>
        {(["green", "yellow", "red"] as const).map((t) => (
          <span key={t} className="inline-flex items-center gap-1.5">
            <span className="size-3.5 rounded-sm border border-slate-300" style={{ background: BAND[t], opacity: BAND_OPACITY[t] * 4 }} />
            {t === "green" ? "OK" : t === "yellow" ? "Take action" : "Emergency"}
          </span>
        ))}
      </p>
    </div>
  );
}

function ParameterChart({ parameter, data }: { parameter: Parameter; data: Reading[] }) {
  const meta = PARAMETERS[parameter];
  const { domain, bands } = config(parameter, data.map((r) => r[parameter]));
  return (
    <figure>
      <figcaption className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-lg font-semibold text-slate-900">
          {meta.name} {meta.unit && <span className="font-normal text-slate-500">({meta.unit})</span>}
        </span>
        <span className="text-sm text-slate-500">{meta.normal}</span>
      </figcaption>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 700, height: 192 }}>
          <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            {bands.map((b, i) => (
              <ReferenceArea key={i} y1={b.y1} y2={b.y2} fill={BAND[b.tier]} fillOpacity={BAND_OPACITY[b.tier]} stroke="none" ifOverflow="hidden" />
            ))}
            <CartesianGrid vertical={false} stroke="#e2e8f0" />
            <XAxis
              dataKey="date"
              tickFormatter={(d: string) => formatDate(d, { year: false })}
              tick={{ fill: "#475569", fontSize: 13 }}
              tickLine={false}
              axisLine={{ stroke: "#cbd5e1" }}
              minTickGap={24}
            />
            <YAxis
              domain={domain}
              ticks={ticksFor(domain, TICK_STEP[parameter])}
              allowDataOverflow
              tick={{ fill: "#475569", fontSize: 13 }}
              tickLine={false}
              axisLine={false}
              width={44}
            />
            <Tooltip
              content={({ active, payload }) => {
                const r = active ? (payload?.[0]?.payload as Reading | undefined) : undefined;
                if (!r) return null;
                const v = r[parameter];
                const tier = readingTier(parameter, v);
                return (
                  <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-lg">
                    <div className="text-sm text-slate-600">{formatDate(r.date)}</div>
                    <div className="flex items-center gap-2 text-lg font-bold text-slate-900">
                      {v} {meta.unit}
                      <span className={`inline-flex items-center gap-1 text-sm ${TIER_STYLE[tier].text}`}>
                        <TierIcon tier={tier} className="size-4" />
                        {TIER_STYLE[tier].label}
                      </span>
                    </div>
                  </div>
                );
              }}
              cursor={{ stroke: "#64748b", strokeDasharray: "4 4" }}
            />
            <Line
              dataKey={parameter}
              stroke={LINE}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2, fill: LINE }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
