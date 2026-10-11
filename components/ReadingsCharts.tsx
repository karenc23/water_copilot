"use client";

import { CartesianGrid, ComposedChart, Line, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { LIMITS } from "@/lib/rules";
import type { Reading } from "@/types";
import { PARAMETERS, TIER_STYLE, TierIcon, readingTier, type Parameter } from "@/components/tier";
import { formatDate } from "@/components/ui";

// One chart per parameter: different units never share an axis.
// Bands use the rule LIMITS; tier colors stay faint so the glowing reading line is the focus.

const LINE = "#5eead4";
const BAND = { green: "#22c55e", yellow: "#facc15", red: "#ef4444" } as const;
const BAND_OPACITY = { green: 0.1, yellow: 0.13, red: 0.17 } as const;
const GRID = "rgba(186, 206, 235, 0.12)";
const TICK = "#aab7c9";

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
  if (!data.length) return <p className="text-lg text-ink-muted">No readings yet.</p>;
  return (
    <div className="space-y-6">
      {(["chlorine", "turbidity", "ph"] as const).map((p) => (
        <ParameterChart key={p} parameter={p} data={data} />
      ))}
      <p className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-ink-muted">
        <span>Shaded bands:</span>
        {(["green", "yellow", "red"] as const).map((t) => (
          <span key={t} className="inline-flex items-center gap-1.5">
            <span className="size-3.5 rounded-sm border border-line-strong" style={{ background: BAND[t], opacity: Math.min(1, BAND_OPACITY[t] * 5) }} />
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
        <span className="text-lg font-semibold text-ink">
          {meta.name} {meta.unit && <span className="font-normal text-ink-faint">({meta.unit})</span>}
        </span>
        <span className="text-sm text-ink-faint">{meta.normal}</span>
      </figcaption>
      <div className="h-48 [&_.recharts-line-curve]:drop-shadow-[0_0_6px_rgba(94,234,212,0.85)]">
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 700, height: 192 }}>
          <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            {bands.map((b, i) => (
              <ReferenceArea key={i} y1={b.y1} y2={b.y2} fill={BAND[b.tier]} fillOpacity={BAND_OPACITY[b.tier]} stroke="none" ifOverflow="hidden" />
            ))}
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis
              dataKey="date"
              tickFormatter={(d: string) => formatDate(d, { year: false })}
              tick={{ fill: TICK, fontSize: 13 }}
              tickLine={false}
              axisLine={{ stroke: GRID }}
              minTickGap={24}
            />
            <YAxis
              domain={domain}
              ticks={ticksFor(domain, TICK_STEP[parameter])}
              allowDataOverflow
              tick={{ fill: TICK, fontSize: 13 }}
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
                  <div className="rounded-lg border border-line-strong bg-night-raised/95 px-3 py-2 shadow-xl shadow-black/50">
                    <div className="text-sm text-ink-muted">{formatDate(r.date)}</div>
                    <div className="flex items-center gap-2 text-lg font-bold text-ink">
                      {v} {meta.unit}
                      <span className={`inline-flex items-center gap-1 text-sm ${TIER_STYLE[tier].text}`}>
                        <TierIcon tier={tier} className="size-4" />
                        {TIER_STYLE[tier].label}
                      </span>
                    </div>
                  </div>
                );
              }}
              cursor={{ stroke: "rgba(241, 245, 249, 0.5)", strokeDasharray: "4 4" }}
            />
            <Line
              dataKey={parameter}
              stroke={LINE}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 5, stroke: "#040a17", strokeWidth: 2, fill: LINE }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
