"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

// Single series (best strategy so far, per round) plus three reference lines, each direct-labeled.
// Plain SVG rather than a chart library so it renders on the server and needs no measuring to appear.
// Neutral colors only: green/yellow/red are reserved for safety tiers.

const OURS = "#5eead4";
const BASELINE = "#aab7c9";
const LABEL = "#d6deea";
const GRID = "rgba(186, 206, 235, 0.12)";
const AXIS = "rgba(186, 206, 235, 0.3)";

export interface RoundPoint {
  round: number;
  pct: number;
  id: string;
}

interface Ref {
  key: string;
  label: string;
  pct: number;
  dash: string;
  /** Which end of the line carries its label. */
  side: "left" | "right";
}

const HEIGHT = 320;
const M = { top: 20, right: 24, bottom: 40, left: 52 };
const fmt = (v: number) => `${Math.round(v)}%`;

export default function ResultsChart({
  points,
  plainPct,
  rulesPct,
  expertPct,
}: {
  points: RoundPoint[];
  plainPct: number | null;
  rulesPct: number | null;
  expertPct: number | null;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(320, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const refs: Ref[] = [
    // The expert line is labeled on the right: on the left it would sit on round 0, which starts near the expert score.
    ...(expertPct !== null ? [{ key: "expert", label: "Expert prompt", pct: expertPct, dash: "12 4", side: "right" as const }] : []),
    ...(rulesPct !== null ? [{ key: "rules", label: "Rules only", pct: rulesPct, dash: "6 4", side: "left" as const }] : []),
    ...(plainPct !== null ? [{ key: "plain", label: "Plain LLM", pct: plainPct, dash: "2 4", side: "left" as const }] : []),
  ];

  // Round ticks every 25%, with room below the lowest value for its label.
  const values = [...points.map((p) => p.pct), ...refs.map((r) => r.pct)];
  const lo = Math.min(0, Math.floor((Math.min(...values) - 10) / 25) * 25);
  const ticks = Array.from({ length: (100 - lo) / 25 + 1 }, (_, i) => lo + i * 25);

  const plotW = width - M.left - M.right;
  const plotH = HEIGHT - M.top - M.bottom;
  const padX = Math.min(48, plotW / 8);
  const x = (i: number) => M.left + padX + (points.length > 1 ? (i * (plotW - 2 * padX)) / (points.length - 1) : (plotW - 2 * padX) / 2);
  const y = (v: number) => M.top + ((100 - v) / (100 - lo)) * plotH;

  const nearest = (clientX: number) => {
    const box = wrap.current?.getBoundingClientRect();
    if (!box || !points.length) return null;
    const px = clientX - box.left;
    let best = 0;
    points.forEach((_, i) => {
      if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    });
    return best;
  };
  const onMove = (e: PointerEvent) => setActive(nearest(e.clientX));
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight") setActive((a) => Math.min((a ?? -1) + 1, points.length - 1));
    else if (e.key === "ArrowLeft") setActive((a) => Math.max((a ?? points.length) - 1, 0));
    else if (e.key === "Escape") setActive(null);
    else return;
    e.preventDefault();
  };

  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.pct)}`).join(" ");
  const first = points[0];
  const last = points.at(-1);
  const a = active !== null ? points[active] : null;
  const tipLeft = active !== null ? x(active) : 0;
  const tipOnLeft = tipLeft > width * 0.6;

  return (
    <div ref={wrap} className="relative" style={{ height: HEIGHT }}>
      <svg
        // Scales to the container until the ResizeObserver reports a width, so it never forces the page wider than the screen.
        viewBox={`0 0 ${width} ${HEIGHT}`}
        width="100%"
        height={HEIGHT}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Best score so far per round, from ${first ? fmt(first.pct) : "—"} to ${last ? fmt(last.pct) : "—"}. Use arrow keys to read each round.`}
        tabIndex={0}
        onPointerMove={onMove}
        onPointerLeave={() => setActive(null)}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
        className="block touch-none outline-none focus-visible:ring-4 focus-visible:ring-accent/50"
      >
        {/* Grid + y axis */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} stroke={GRID} />
            <text x={M.left - 10} y={y(t)} dy="0.32em" textAnchor="end" fontSize={14} fill={BASELINE} style={{ fontVariantNumeric: "tabular-nums" }}>
              {fmt(t)}
            </text>
          </g>
        ))}
        <line x1={M.left} x2={width - M.right} y1={y(lo)} y2={y(lo)} stroke={AXIS} />
        {points.map((p, i) => (
          <text key={p.round} x={x(i)} y={HEIGHT - M.bottom + 24} textAnchor="middle" fontSize={14} fill={BASELINE}>
            Round {p.round}
          </text>
        ))}

        {/* Reference lines, direct-labeled */}
        {refs.map((r) => (
          <g key={r.key}>
            <line x1={M.left} x2={width - M.right} y1={y(r.pct)} y2={y(r.pct)} stroke={BASELINE} strokeWidth={2} strokeDasharray={r.dash} />
            <text
              x={r.side === "left" ? M.left + 6 : width - M.right - 6}
              y={y(r.pct) + (r.side === "left" ? -8 : 18)}
              textAnchor={r.side === "left" ? "start" : "end"}
              fontSize={14}
              fill={LABEL}
            >
              {r.label} {fmt(r.pct)}
            </text>
          </g>
        ))}

        {/* Crosshair */}
        {a && <line x1={tipLeft} x2={tipLeft} y1={M.top} y2={y(lo)} stroke="rgba(241, 245, 249, 0.5)" strokeWidth={1} />}

        {/* Our line: 2px stroke, 10px markers with a surface ring, start and end labeled */}
        <path d={path} fill="none" stroke={OURS} style={{ filter: "drop-shadow(0 0 6px rgba(94,234,212,0.8))" }} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <circle key={p.round} cx={x(i)} cy={y(p.pct)} r={active === i ? 7 : 5} fill={OURS} stroke="#040a17" strokeWidth={2} />
        ))}
        {first && points.length > 1 && (
          <text x={x(0)} y={y(first.pct) - 14} textAnchor="middle" fontSize={15} fontWeight={600} fill="#f1f5f9">
            {fmt(first.pct)}
          </text>
        )}
        {last && (
          <text x={x(points.length - 1)} y={y(last.pct) - 14} textAnchor="middle" fontSize={15} fontWeight={600} fill="#f1f5f9">
            {fmt(last.pct)}
          </text>
        )}
      </svg>

      {a && (
        <div
          className="pointer-events-none absolute top-2 rounded-lg border border-line-strong bg-night-raised/95 px-3 py-2 shadow-xl shadow-black/50"
          style={tipOnLeft ? { right: width - tipLeft + 12 } : { left: tipLeft + 12 }}
        >
          <div className="text-lg font-bold tabular-nums text-ink">{a.pct.toFixed(1)}%</div>
          <div className="text-sm text-ink-muted">Round {a.round} · best so far</div>
          <div className="font-mono text-xs text-ink-faint">{a.id}</div>
          {refs.length > 0 && (
            <dl className="mt-2 grid grid-cols-[auto_auto] gap-x-3 border-t border-line pt-2 text-sm text-ink-muted">
              {refs.map((r) => (
                <div key={r.key} className="contents">
                  <dt>{r.label}</dt>
                  <dd className="text-right tabular-nums">{fmt(r.pct)}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </div>
  );
}
