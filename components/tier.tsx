import { LIMITS, type Alert, type Tier } from "@/lib/rules";

// The only place green / yellow / red are defined. Every tier color ships with an icon + word,
// so the color never carries meaning on its own.

export const TIER_STYLE: Record<Tier, { label: string; soft: string; solid: string; text: string; border: string; bar: string }> = {
  green: {
    label: "Green",
    soft: "bg-green-500/12",
    solid: "bg-green-600 text-white shadow-[0_0_24px_-6px_rgba(74,222,128,0.7)]",
    text: "text-green-300",
    border: "border-green-500",
    bar: "bg-green-600",
  },
  yellow: {
    label: "Yellow",
    soft: "bg-amber-400/12",
    solid: "bg-amber-400 text-amber-950 shadow-[0_0_24px_-6px_rgba(250,204,21,0.7)]",
    text: "text-amber-200",
    border: "border-amber-400",
    bar: "bg-amber-400",
  },
  red: {
    label: "Red",
    soft: "bg-red-500/15",
    solid: "bg-red-600 text-white shadow-[0_0_24px_-6px_rgba(248,113,113,0.8)]",
    text: "text-red-300",
    border: "border-red-500",
    bar: "bg-red-600",
  },
};

export const TIER_MEANING: Record<Tier, { title: string; detail: string }> = {
  green: { title: "Routine", detail: "Handle it with the steps below." },
  yellow: { title: "Caution", detail: "Act now and keep a close watch." },
  red: { title: "Escalate", detail: "Contact your Remote Maintenance Worker now." },
};

export function TierIcon({ tier, className = "size-6" }: { tier: Tier; className?: string }) {
  // Check (green), triangle (yellow), octagon (red): different shapes, not just colors.
  const path =
    tier === "green"
      ? "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1.2 14.2-4-4 1.4-1.4 2.6 2.6 5.4-5.4 1.4 1.4-6.8 6.8Z"
      : tier === "yellow"
        ? "M12 2 1 21h22L12 2Zm1 15h-2v-2h2v2Zm0-4h-2V9h2v4Z"
        : "M8.3 2h7.4L22 8.3v7.4L15.7 22H8.3L2 15.7V8.3L8.3 2ZM11 7v6h2V7h-2Zm0 8v2h2v-2h-2Z";
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d={path} />
    </svg>
  );
}

/** Small inline pill: icon + tier word. */
export function TierPill({ tier }: { tier: Tier }) {
  const s = TIER_STYLE[tier];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-sm font-bold ${s.solid}`}>
      <TierIcon tier={tier} className="size-4" />
      {s.label.toUpperCase()}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Per-reading tiers, from the same LIMITS the rules use (lib/rules.ts).
// ---------------------------------------------------------------------------

export type Parameter = "chlorine" | "turbidity" | "ph";

export function readingTier(parameter: Parameter, value: number): Tier {
  if (parameter === "chlorine") {
    const c = LIMITS.chlorine;
    if (value < c.red_below || value > c.red_above) return "red";
    if (value < c.yellow_below || value > c.yellow_above) return "yellow";
    return "green";
  }
  if (parameter === "turbidity") {
    const t = LIMITS.turbidity;
    if (value > t.red_above) return "red";
    if (value >= t.yellow_at) return "yellow";
    return "green";
  }
  const p = LIMITS.ph;
  if (value < p.red_below || value > p.red_above) return "red";
  if (value < p.yellow_below || value > p.yellow_above) return "yellow";
  return "green";
}

export const PARAMETERS: Record<Parameter, { name: string; unit: string; normal: string }> = {
  chlorine: {
    name: "Free chlorine",
    unit: "mg/L",
    normal: `OK ${LIMITS.chlorine.yellow_below}–${LIMITS.chlorine.yellow_above} mg/L`,
  },
  turbidity: { name: "Turbidity", unit: "NTU", normal: `OK below ${LIMITS.turbidity.yellow_at} NTU` },
  ph: { name: "pH", unit: "", normal: `OK ${LIMITS.ph.yellow_below}–${LIMITS.ph.yellow_above}` },
};

// ---------------------------------------------------------------------------
// Rule alerts
// ---------------------------------------------------------------------------

export function AlertList({ alerts, empty = "No alerts." }: { alerts: Alert[]; empty?: string }) {
  if (!alerts.length) return <p className="text-lg text-ink-muted">{empty}</p>;
  return (
    <ul className="space-y-3">
      {alerts.map((a, i) => {
        const s = TIER_STYLE[a.tier];
        return (
          <li key={`${a.rule_id}-${i}`} className={`flex gap-3 rounded-lg border-l-8 p-4 ${s.border} ${s.soft}`}>
            <span className={s.text}>
              <TierIcon tier={a.tier} />
            </span>
            <div className="min-w-0 flex-1">
              <p className={`text-lg font-semibold ${s.text}`}>{a.message}</p>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
                <TierPill tier={a.tier} />
                <ManualTag section={a.manual_section} />
                <span className="font-mono text-xs text-ink-faint">{a.rule_id}</span>
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function ManualTag({ section }: { section: string }) {
  return (
    <span className="inline-flex items-center rounded-md border border-line-strong bg-glass px-2 py-0.5 font-mono text-sm font-semibold text-ink">
      Manual §{section}
    </span>
  );
}

/** "Rule-detected, not AI" label for deterministic alerts. */
export function RuleBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-white/15 px-2.5 py-1 text-sm font-semibold text-white">
      <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden>
        <path d="M3 5h18v2H3V5Zm0 6h18v2H3v-2Zm0 6h12v2H3v-2Z" />
      </svg>
      Rule-detected, not AI
    </span>
  );
}
