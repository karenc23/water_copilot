"use client";

import { motion } from "framer-motion";
import { useId } from "react";
import type { AgentMeta } from "@/components/agents/meta";

export type OrbState = "idle" | "active" | "thinking" | "done";

/**
 * One glowing agent orb, drawn in SVG user units around (x, y). Glows use radial gradients,
 * not blur filters, and only opacity/scale/rotate animate, so many can run at 60 fps.
 */
export function AgentOrb({
  agent,
  x,
  y,
  r = 44,
  state,
  wakeKey,
  labels = true,
  caption,
  compact = false,
}: {
  agent: AgentMeta;
  x: number;
  y: number;
  r?: number;
  state: OrbState;
  /** Changing this replays the wake-up ripple. */
  wakeKey?: string | number;
  labels?: boolean;
  /** Extra small line under the role, e.g. "Not needed: tier isn't red". */
  caption?: string | null;
  /** Name only, larger: for a canvas drawn at about half the page width. */
  compact?: boolean;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const lit = state !== "idle";
  const c = agent.color;

  return (
    <g transform={`translate(${x} ${y})`}>
      <defs>
        <radialGradient id={`glow${uid}`}>
          <stop offset="0" stopColor={c} stopOpacity="0.55" />
          <stop offset="0.45" stopColor={c} stopOpacity="0.16" />
          <stop offset="1" stopColor={c} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`core${uid}`} cx="0.36" cy="0.3" r="0.75">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="0.38" stopColor={c} />
          <stop offset="1" stopColor={c} stopOpacity="0.4" />
        </radialGradient>
      </defs>

      <motion.circle
        r={r * 2.5}
        fill={`url(#glow${uid})`}
        initial={false}
        animate={
          state === "thinking"
            ? { opacity: [0.55, 1, 0.55], scale: [0.92, 1.12, 0.92] }
            : { opacity: state === "idle" ? 0.16 : state === "active" ? 1 : 0.7, scale: 1 }
        }
        transition={state === "thinking" ? { duration: 1.6, repeat: Infinity, ease: "easeInOut" } : { duration: 0.6 }}
      />

      {state === "active" && (
        <motion.circle
          key={`wake-${wakeKey}`}
          r={r}
          fill="none"
          stroke={c}
          strokeWidth={3}
          initial={{ scale: 1, opacity: 0.9 }}
          animate={{ scale: 2.3, opacity: 0 }}
          transition={{ duration: 1.1, ease: "easeOut" }}
        />
      )}

      {state === "thinking" && (
        <>
          <motion.circle
            r={r + 9}
            fill="none"
            stroke={c}
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray={`${r * 0.9} ${r * 2.4}`}
            animate={{ rotate: 360 }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "linear" }}
          />
          <motion.circle
            r={r + 17}
            fill="none"
            stroke="#ffffff"
            strokeOpacity={0.5}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeDasharray={`${r * 0.5} ${r * 1.6}`}
            animate={{ rotate: -360 }}
            transition={{ duration: 2.2, repeat: Infinity, ease: "linear" }}
          />
        </>
      )}

      <motion.circle r={r} fill={`url(#core${uid})`} initial={false} animate={{ opacity: lit ? 1 : 0.32 }} transition={{ duration: 0.5 }} />
      <circle r={r} fill="none" stroke={c} strokeOpacity={lit ? 0.9 : 0.35} strokeWidth={1.5} />
      <g
        transform={`translate(${-r * 0.36} ${-r * 0.36}) scale(${(r * 0.72) / 24})`}
        fill="none"
        stroke={lit ? "#04121f" : "#cbd5e1"}
        strokeOpacity={lit ? 0.9 : 0.55}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {agent.icon.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>

      {labels && (
        <g textAnchor="middle" style={{ fontFamily: "var(--font-geist-sans), system-ui, sans-serif" }}>
          <text y={r + (compact ? 38 : 30)} fontSize={compact ? 28 : 21} fontWeight={700} fill="#ffffff" fillOpacity={lit ? 1 : 0.6}>
            {agent.name}
          </text>
          {!compact && (
            <text y={r + 53} fontSize={16} fill="#cbd5e1" fillOpacity={lit ? 0.95 : 0.55}>
              {agent.role}
            </text>
          )}
          {caption && (
            <text y={r + (compact ? 68 : 73)} fontSize={compact ? 21 : 14} fill={c} fillOpacity={0.95} fontStyle="italic">
              {caption}
            </text>
          )}
        </g>
      )}
    </g>
  );
}
