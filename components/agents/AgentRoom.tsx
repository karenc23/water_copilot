"use client";

import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AgentOrb, type OrbState } from "@/components/agents/AgentOrb";
import Aurora from "@/components/agents/Aurora";
import { AGENT, AGENTS, RING_POS, TIER_GLOW, type AgentId } from "@/components/agents/meta";
import LiveAnswer from "@/components/agents/LiveAnswer";
import type { Alert, Tier } from "@/lib/rules";
import type { LiveEvent } from "@/components/agents/live-events";

// Troubleshoot: replays the real pipeline trace from /api/troubleshoot/stream in the Agent Room while
// the answer card (LiveAnswer) fills in from the same events.
// Every label, chip and sentence below is built from a TraceEvent field; nothing is made up.
// Events are shown no faster than one stage per ~1.5 s so each hand-off can be seen; the
// Diagnostician's wait is real (it shimmers until the model's event arrives).

const EXAMPLES = [
  "Water looks cloudy and chlorine reading is lower than yesterday",
  "Second backwash today and the filter still won’t clear",
];

// SVG canvas: 1000 × 600 user units, orbs in a loose ring.
const W = 1000;
const H = 600;
const POS = RING_POS;

type Pt = { x: number; y: number };

/** Quadratic curve from a to b, bowed sideways by `bend` units. */
function curve(a: Pt, b: Pt, bend: number) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const c = { x: (a.x + b.x) / 2 + (-dy / len) * bend, y: (a.y + b.y) / 2 + (dx / len) * bend };
  return (t: number): Pt => {
    const u = 1 - t;
    return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
  };
}

function pathD(a: Pt, b: Pt, bend: number) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const c = { x: (a.x + b.x) / 2 + (-dy / len) * bend, y: (a.y + b.y) / 2 + (dx / len) * bend };
  return `M${a.x} ${a.y} Q${c.x} ${c.y} ${b.x} ${b.y}`;
}

// The hand-offs that exist in the pipeline, drawn faintly at rest.
const LINKS: { from: AgentId; to: AgentId; bend: number }[] = [
  { from: "sentinel", to: "diagnostician", bend: -95 },
  { from: "librarian", to: "diagnostician", bend: 55 },
  { from: "keeper", to: "diagnostician", bend: -35 },
  { from: "diagnostician", to: "governor", bend: 35 },
  { from: "sentinel", to: "governor", bend: 70 },
  { from: "governor", to: "courier", bend: 40 },
];

// ---------------------------------------------------------------------------
// Text helpers (all derived from event fields)
// ---------------------------------------------------------------------------

const TIER_WORD: Record<Tier, string> = { green: "GREEN", yellow: "YELLOW", red: "RED" };
const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Chlorine 0.45 mg/L is below … (2026-09-30)" → "Chlorine 0.45 mg/L". */
function shortAlert(a: Alert) {
  const m = a.message.replace(/\s*\(\d{4}-\d{2}-\d{2}\)$/, "");
  const head = m.split(/ is | \(/)[0];
  return trunc(head, 30);
}

// ---------------------------------------------------------------------------
// Particles
// ---------------------------------------------------------------------------

interface ParticleSpec {
  key: string;
  from: Pt;
  to: Pt;
  bend: number;
  label?: string;
  color: string;
  delay?: number;
  duration?: number;
  glyph?: "dot" | "packet" | "drop";
}

function Particle({ spec }: { spec: ParticleSpec }) {
  const { from, to, bend, label, color, delay = 0, duration = 1.5, glyph = "dot" } = spec;
  const t = useMotionValue(0);
  const [done, setDone] = useState(false);
  const at = useMemo(() => curve(from, to, bend), [from, to, bend]);
  const x = useTransform(t, (v) => at(v).x);
  const y = useTransform(t, (v) => at(v).y);
  const tx1 = useTransform(t, (v) => at(Math.max(0, v - 0.035)).x);
  const ty1 = useTransform(t, (v) => at(Math.max(0, v - 0.035)).y);
  const tx2 = useTransform(t, (v) => at(Math.max(0, v - 0.07)).x);
  const ty2 = useTransform(t, (v) => at(Math.max(0, v - 0.07)).y);
  const opacity = useTransform(t, [0, 0.06, glyph === "dot" ? 0.86 : 0.75, 1], [0, 1, 1, 0]);

  useEffect(() => {
    const c = animate(t, 1, { duration, delay, ease: [0.45, 0, 0.2, 1], onComplete: () => setDone(true) });
    return () => c.stop();
  }, [t, duration, delay]);

  if (done) return null;
  // Sized for the compact canvas (~55% of the page width), so labels stay readable.
  const w = label ? label.length * 10.4 + 34 : 0;
  return (
    <motion.g style={{ opacity }}>
      <motion.circle cx={tx2} cy={ty2} r={3} fill={color} opacity={0.3} />
      <motion.circle cx={tx1} cy={ty1} r={4.5} fill={color} opacity={0.55} />
      <motion.g style={{ x, y }}>
        <circle r={16} fill={color} opacity={0.22} />
        {glyph === "packet" ? (
          <g transform="translate(-10 -13)">
            <rect width={20} height={26} rx={3} fill="#fff1f2" stroke={color} strokeWidth={2} />
            <path d="M5 8h10M5 13h10M5 18h6" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />
          </g>
        ) : (
          <circle r={glyph === "drop" ? 6 : 7} fill={color} />
        )}
        {label && (
          <g transform={`translate(${-w / 2} -56)`}>
            <rect width={w} height={36} rx={18} fill="#06101f" fillOpacity={0.9} stroke={color} strokeWidth={2} />
            <text x={w / 2} y={25} textAnchor="middle" fontSize={19} fontWeight={600} fill="#fff" style={{ fontFamily: "var(--font-geist-sans), system-ui" }}>
              {label}
            </text>
          </g>
        )}
      </motion.g>
    </motion.g>
  );
}

const P = POS;

function particlesFor(e: LiveEvent, key: string): ParticleSpec[] {
  const out: ParticleSpec[] = [];
  const add = (s: Omit<ParticleSpec, "key">) => out.push({ ...s, key: `${key}-${out.length}` });
  switch (e.type) {
    case "sentinel":
      if (!e.alerts.length) add({ from: P.sentinel, to: P.diagnostician, bend: -95, label: "No alerts · within limits", color: TIER_GLOW.green });
      e.alerts.slice(0, 3).forEach((a, i) =>
        add({ from: P.sentinel, to: P.diagnostician, bend: -70 - i * 35, label: `${TIER_WORD[a.tier]} · ${shortAlert(a)}`, color: TIER_GLOW[a.tier], delay: i * 0.3 }),
      );
      break;
    case "librarian":
      if (!e.sections.length) add({ from: P.librarian, to: P.diagnostician, bend: 55, label: `Whole manual · ${e.sections_total} §`, color: AGENT.librarian.color });
      e.sections.slice(0, 3).forEach((s, i) =>
        add({ from: P.librarian, to: P.diagnostician, bend: 40 + i * 30, label: `§${s.section}`, color: AGENT.librarian.color, delay: i * 0.28 }),
      );
      break;
    case "keeper": {
      const cats = Object.entries(e.counts).sort((a, b) => b[1] - a[1]);
      if (!cats.length) add({ from: P.keeper, to: P.diagnostician, bend: -35, label: "No entries in 30 days", color: AGENT.keeper.color });
      cats.slice(0, 3).forEach(([cat, n], i) =>
        add({ from: P.keeper, to: P.diagnostician, bend: -25 - i * 30, label: `${plural(n, `past ${cat} problem`)}`, color: AGENT.keeper.color, delay: i * 0.3 }),
      );
      break;
    }
    case "diagnostician":
      add({
        from: P.diagnostician,
        to: P.governor,
        bend: 30,
        label: e.failure_mode ? trunc(`${e.failure_mode.id} · ${e.failure_mode.name}`, 34) : "No failure mode",
        color: AGENT.diagnostician.color,
      });
      add({ from: P.diagnostician, to: P.governor, bend: 70, label: `Proposes ${TIER_WORD[e.proposed_tier]}`, color: TIER_GLOW[e.proposed_tier], delay: 0.35 });
      break;
    case "governor": {
      if (e.raised) {
        // The rule alerts that set the final tier travel to the Governor.
        const first = (e.reason ?? "rule alert").split("; ")[0].replace(/\s*\(\d{4}-\d{2}-\d{2}\)$/, "");
        add({ from: P.sentinel, to: P.governor, bend: 70, label: `${TIER_WORD[e.final_tier]} · ${trunc(first.split(" is ")[0], 28)}`, color: TIER_GLOW[e.final_tier] });
      }
      const drops = [...e.dropped_steps.map((d) => `✕ step (${d.why})`), ...e.doses_removed.map((d) => `✕ dose ${d}`)];
      drops.slice(0, 3).forEach((label, i) =>
        add({ from: P.governor, to: { x: P.governor.x + 70 + i * 40, y: H + 60 }, bend: -40, label: trunc(label, 30), color: TIER_GLOW.red, glyph: "drop", delay: 0.4 + i * 0.3, duration: 1.8 }),
      );
      break;
    }
    case "courier":
      // The Courier only drafts: the facts travel to it, and the draft stays with the operator.
      add({ from: P.governor, to: P.courier, bend: 40, label: "Facts for the draft", color: AGENT.courier.color, glyph: "packet", duration: 1.3 });
      break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Narration (speech bubbles)
// ---------------------------------------------------------------------------

interface Bubble {
  agent: AgentId;
  body: ReactNode;
}

function Chip({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold text-white" style={{ borderColor: color, background: `${color}22` }}>
      {children}
    </span>
  );
}

function narrate(e: LiveEvent): Bubble | null {
  switch (e.type) {
    case "sentinel":
      return {
        agent: "sentinel",
        body: (
          <>
            <p>
              I checked {plural(e.readings_checked, "day")} of readings
              {e.latest ? ` (latest ${e.latest.date}: chlorine ${e.latest.chlorine} mg/L, turbidity ${e.latest.turbidity} NTU, pH ${e.latest.ph})` : ""} and
              the logbook against the fixed rules.{" "}
              {e.alerts.length ? `${plural(e.alerts.length, "alert")} fired:` : "Everything is within limits."}
            </p>
            {e.alerts.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {e.alerts.map((a, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <Chip color={TIER_GLOW[a.tier]}>{TIER_WORD[a.tier]}</Chip>
                    <span className="text-slate-300">
                      {a.message} <span className="text-ink-faint">· §{a.manual_section}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ),
      };
    case "librarian":
      return {
        agent: "librarian",
        body: e.sections.length ? (
          <p>
            The alerts point to{" "}
            {e.sections.map((s, i) => (
              <span key={s.section}>
                {i > 0 && (i === e.sections.length - 1 ? " and " : ", ")}
                <strong className="text-white">§{s.section}</strong>
                {s.title ? ` “${s.title}”` : ""}
              </span>
            ))}
            . I’m handing the Diagnostician the whole manual ({e.sections_total} sections) with those marked.
          </p>
        ) : (
          <p>No alert points to a specific section, so I’m handing over the whole manual ({e.sections_total} sections).</p>
        ),
      };
    case "keeper": {
      const cats = Object.entries(e.counts).sort((a, b) => b[1] - a[1]);
      return {
        agent: "keeper",
        body: (
          <>
            <p>
              {e.recent.length
                ? `${plural(e.recent.length, "entry", "entries")} in the last ${e.window_days} days${cats.length ? `: ${cats.map(([c, n]) => `${n} ${c}`).join(", ")}` : ""}. Most recent, ${e.recent[0].date}: “${trunc(e.recent[0].problem, 90)}”.`
                : `Nothing logged in the last ${e.window_days} days.`}{" "}
              I’m passing along all {e.entries_total} entries.
            </p>
            {e.log_alerts.length > 0 && (
              <p className="mt-2 text-slate-300">
                <Chip color={TIER_GLOW.red}>RED</Chip> The rules flagged the pattern: {e.log_alerts.map((a) => a.message).join("; ")}.
              </p>
            )}
          </>
        ),
      };
    }
    case "diagnostician_start":
      return { agent: "diagnostician", body: <p className="text-slate-300 italic">Reading the operator’s words, the alerts, the manual and the logbook… waiting on the model.</p> };
    case "diagnostician":
      return {
        agent: "diagnostician",
        body: (
          <>
            <p>“{e.diagnosis}”</p>
            <p className="mt-2 text-slate-300">
              {e.failure_mode ? (
                <>
                  I think it’s <strong className="text-white">{e.failure_mode.id} {e.failure_mode.name}</strong> (§{e.failure_mode.manual_section}).{" "}
                </>
              ) : (
                "I couldn’t match a known failure mode. "
              )}
              {e.escalate || e.health_risk ? "I’d escalate. " : ""}My tier: <Chip color={TIER_GLOW[e.proposed_tier]}>{TIER_WORD[e.proposed_tier]}</Chip>{" "}
              · {plural(e.steps.length, "step")} proposed
              {e.cited.length ? `, citing ${e.cited.map((c) => `§${c.section}`).join(", ")}` : ""} · {(e.ms / 1000).toFixed(1)} s
            </p>
          </>
        ),
      };
    case "governor":
      return {
        agent: "governor",
        body: (
          <>
            {e.raised ? (
              <p>
                <strong className="text-red-300">Overruled.</strong> The Diagnostician said {TIER_WORD[e.proposed_tier]}, but {e.reason ?? "the rules require more"}. Final tier{" "}
                <Chip color={TIER_GLOW[e.final_tier]}>{TIER_WORD[e.final_tier]}</Chip>.
              </p>
            ) : (
              <p>
                Checked against the rules and the manual. I agree: <Chip color={TIER_GLOW[e.final_tier]}>{TIER_WORD[e.final_tier]}</Chip>.
              </p>
            )}
            <ul className="mt-2 space-y-1 text-slate-300">
              <li>Kept {plural(e.steps_kept, "step")} with valid manual citations.</li>
              {e.dropped_steps.map((d, i) => (
                <li key={`d${i}`}>✕ Dropped “{trunc(d.action, 70)}” ({d.why}).</li>
              ))}
              {e.doses_removed.map((d, i) => (
                <li key={`x${i}`}>✕ Removed dose “{d}”: not in the manual.</li>
              ))}
              {e.merged_rmw_steps > 0 && <li>Folded {plural(e.merged_rmw_steps, "RMW step")} into my own call step.</li>}
              {e.inserted_steps.map((s, i) => (
                <li key={`i${i}`}>＋ Inserted first: “{s.action}”.</li>
              ))}
              {!e.dropped_steps.length && !e.doses_removed.length && <li>No bad citations or unlisted doses found.</li>}
            </ul>
          </>
        ),
      };
    case "courier":
      return {
        agent: "courier",
        body: (
          <p>
            I drafted a message to your expert with {plural(e.packet.alerts.length, "alert")},{" "}
            {plural(e.packet.recent_readings.length, "reading")}, {plural(e.packet.steps_reported_done.length, "logbook entry", "logbook entries")} and{" "}
            {plural(e.packet.steps_recommended.length, "recommended step")}, built from plant data, not written by AI. Nothing has been sent: open
            “Draft message to expert” below to edit it and send it yourself.
          </p>
        ),
      };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Pacing
// ---------------------------------------------------------------------------

function gapAfter(e: LiveEvent, all: LiveEvent[], replay: boolean, reduced: boolean): number {
  if (reduced) return e.type === "diagnostician_start" && replay ? 600 : 400;
  switch (e.type) {
    case "sentinel":
      return 1700;
    case "librarian":
      return 1500;
    case "keeper":
      return 1600;
    case "diagnostician_start": {
      // Live: the real wait happens naturally. Replay: shimmer for the model's real time (capped).
      const d = all.find((x) => x.type === "diagnostician");
      return replay && d?.type === "diagnostician" ? Math.min(Math.max(d.ms, 1200), 4000) : 400;
    }
    case "diagnostician":
      return 2000;
    case "governor":
      return e.raised ? 3400 : 2100;
    case "courier":
      return 2700;
    default:
      return 0;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export type StrategyChoice = "evolved" | "fast";

const EVOLVED_TIMEOUT_MS = 30_000;

type Attempt = { ok: true } | { ok: false; reason: string; httpError?: string };

/**
 * The combined Troubleshoot view: problem input on top; the Agent Room and its narration on the
 * left; the answer card filling in live on the right (stacked on narrower screens).
 */
export default function AgentRoom({ evolvedId }: { evolvedId: string | null }) {
  const [description, setDescription] = useState("");
  const [asked, setAsked] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<StrategyChoice>(evolvedId ? "evolved" : "fast");
  const [fallback, setFallback] = useState<string | null>(null);
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [shown, setShown] = useState(0);
  const [runId, setRunId] = useState(0);
  const [replaying, setReplaying] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const lastShownAt = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion() ?? false;

  // Reveal received events one at a time.
  useEffect(() => {
    if (shown >= events.length) return;
    const wait = shown === 0 ? 250 : Math.max(0, lastShownAt.current + gapAfter(events[shown - 1], events, replaying, reduced) - performance.now());
    const id = setTimeout(() => {
      lastShownAt.current = performance.now();
      setShown((s) => s + 1);
    }, wait);
    return () => clearTimeout(id);
  }, [shown, events, replaying, reduced]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const visible = events.slice(0, shown);
  const last = visible.at(-1);
  const find = <T extends LiveEvent["type"]>(type: T) => visible.find((e) => e.type === type) as Extract<LiveEvent, { type: T }> | undefined;
  const done = find("done");
  const error = find("error");
  const governor = find("governor");
  const running = events.find((e) => e.type === "strategy") as Extract<LiveEvent, { type: "strategy" }> | undefined;
  const finished = !!(done || error);
  const busy = streaming || (events.length > 0 && !finished);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: reduced ? "auto" : "smooth" });
  }, [shown, reduced]);

  /** One streamed attempt with the given strategy. Events go straight into the room as they arrive. */
  const attempt = useCallback(async (text: string, choice: StrategyChoice, ac: AbortController): Promise<Attempt> => {
    let timedOut = false;
    const timer = choice === "evolved" ? setTimeout(() => ((timedOut = true), ac.abort()), EVOLVED_TIMEOUT_MS) : null;
    const push = (e: LiveEvent) => setEvents((prev) => [...prev, e]);
    try {
      const res = await fetch("/api/troubleshoot/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: text, strategy: choice }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        return { ok: false, reason: "the server returned an error", httpError: body?.error ?? `Request failed (${res.status}).` };
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done: eof } = await reader.read();
        if (eof) break;
        buf += value;
        let i: number;
        while ((i = buf.indexOf("\n\n")) !== -1) {
          const data = buf
            .slice(0, i)
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trimStart())
            .join("\n");
          buf = buf.slice(i + 2);
          if (!data) continue;
          const e = JSON.parse(data) as LiveEvent;
          if (e.type === "error") return { ok: false, reason: "the model request failed", httpError: e.error };
          push(e);
          if (e.type === "done") return { ok: true };
        }
      }
      return { ok: false, reason: "the connection closed early", httpError: "The connection closed before the agents finished." };
    } catch {
      if (timedOut) return { ok: false, reason: `it took longer than ${EVOLVED_TIMEOUT_MS / 1000} s` };
      return { ok: false, reason: "the server couldn’t be reached", httpError: "Could not reach the server. Check the connection and try again." };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }, []);

  const reset = () => {
    setEvents([]);
    setShown(0);
    setReplaying(false);
    setRunId((r) => r + 1);
  };

  const run = useCallback(
    async (text: string) => {
      if (!text.trim()) {
        setHint("Describe what’s happening first: what you see, hear or measured.");
        return;
      }
      setHint(null);
      setAsked(text);
      setFallback(null);
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      reset();
      setStreaming(true);
      try {
        let result = await attempt(text, strategy, ac);
        if (ac !== abortRef.current) return; // a newer question replaced this one
        if (!result.ok && strategy === "evolved") {
          // Automatic fallback: re-run the same question with the fast production prompt.
          setFallback(`The evolved strategy didn’t finish (${result.reason}), so the agents re-ran it with the Fast strategy.`);
          const ac2 = new AbortController();
          abortRef.current = ac2;
          reset();
          result = await attempt(text, "fast", ac2);
          if (ac2 !== abortRef.current) return;
        }
        if (!result.ok) setEvents((prev) => [...prev, { type: "error", error: result.httpError ?? `The request failed: ${result.reason}.` }]);
      } finally {
        setStreaming(false);
      }
    },
    [attempt, strategy],
  );

  function replay() {
    setReplaying(true);
    setShown(0);
    setRunId((r) => r + 1);
  }

  function orbState(id: AgentId): OrbState {
    const own: Record<AgentId, LiveEvent["type"]> = {
      sentinel: "sentinel",
      librarian: "librarian",
      keeper: "keeper",
      diagnostician: "diagnostician",
      governor: "governor",
      courier: "courier",
    };
    if (id === "diagnostician" && find("diagnostician_start") && !find("diagnostician") && !error) return "thinking";
    if (!find(own[id])) return "idle";
    return last?.type === own[id] ? "active" : "done";
  }

  // The overrule banner is a moment: it fades after a few seconds, leaving a note under the tier.
  const [bannerDoneRun, setBannerDoneRun] = useState(-1);
  const raised = !!governor?.raised;
  useEffect(() => {
    if (!raised) return;
    const id = setTimeout(() => setBannerDoneRun(runId), 4500);
    return () => clearTimeout(id);
  }, [raised, runId]);
  const showBanner = raised && bannerDoneRun !== runId;

  const courierCaption = find("courier") ? "Message drafted" : done ? "Not needed" : null;
  const bubbles = visible.map((e, i) => ({ i, b: narrate(e) })).filter((x): x is { i: number; b: Bubble } => !!x.b);

  const status =
    error || governor
      ? null
      : find("diagnostician")
        ? "Governor is checking the answer…"
        : find("diagnostician_start")
          ? "Diagnostician is thinking…"
          : busy
            ? "Gathering the facts…"
            : "Describe a problem to wake the team";

  return (
    <div className="space-y-5">
      {/* Problem input */}
      <form
        className="glass relative rounded-2xl p-4 md:p-5"
        onSubmit={(e) => {
          e.preventDefault();
          run(description);
        }}
      >
        <label htmlFor="agent-description" className="text-sm font-semibold tracking-widest text-teal-200/90 uppercase">
          What’s happening at the plant?
        </label>
        <div className="mt-2 flex flex-col gap-3 md:flex-row">
          <textarea
            id="agent-description"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setHint(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run(description);
            }}
            aria-describedby={hint ? "agent-description-hint" : undefined}
            rows={2}
            placeholder="e.g. Chlorine dropped to 0.4 this morning and the feed pump sounds different"
            className="min-h-20 flex-1 resize-y rounded-xl border border-white/20 bg-white/5 p-3 text-lg text-white placeholder:text-ink-faint focus:border-teal-300 focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy}
            className="min-h-14 shrink-0 rounded-xl bg-teal-300 px-6 text-lg font-bold text-[#04121f] transition hover:bg-teal-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Agents working…" : "Wake the agents"}
          </button>
        </div>
        {hint && (
          <p id="agent-description-hint" role="alert" className="mt-2 text-base font-semibold text-amber-200">
            {hint}
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              disabled={busy}
              onClick={() => {
                setDescription(ex);
                setHint(null);
              }}
              className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-left text-sm text-slate-200 hover:bg-white/10 disabled:opacity-50"
            >
              {ex}
            </button>
          ))}
          <div role="radiogroup" aria-label="Strategy" className="ml-auto inline-flex rounded-full border border-white/15 bg-white/5 p-0.5 text-sm">
            {(
              [
                ["evolved", evolvedId ? `Evolved (${evolvedId})` : "Evolved", "The strategy picked by training score; ~5–10 s"],
                ["fast", "Fast", "The production prompt; ~2–3 s"],
              ] as const
            ).map(([key, label, title]) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={strategy === key}
                title={title}
                disabled={busy || (key === "evolved" && !evolvedId)}
                onClick={() => setStrategy(key)}
                className={`min-h-9 rounded-full px-3 font-semibold transition disabled:opacity-50 ${
                  strategy === key ? "bg-teal-300 text-[#04121f]" : "text-slate-200 hover:bg-white/10"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </form>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        {/* Left: Agent Room + narration */}
        <div className="relative overflow-hidden rounded-2xl bg-night text-white ring-1 ring-accent/25 shadow-[0_0_60px_-20px_rgba(94,234,212,0.45)]">
          <Aurora />
          <div className="relative z-10 flex min-h-9 items-center justify-between gap-3 border-b border-white/10 px-4 py-2 text-sm">
            <span className="font-semibold tracking-widest text-teal-200/90 uppercase">Agent Room</span>
            {running && (busy || finished) && (
              <span role="status" className="inline-flex items-center gap-2 text-slate-200">
                <span className={`size-2 rounded-full ${busy ? "animate-pulse" : ""}`} style={{ background: running.choice === "evolved" ? TIER_GLOW.green : "#cbd5e1" }} />
                {busy ? "Running" : "Ran"} {running.choice === "evolved" ? `evolved strategy: ${running.id}` : "Fast strategy (production prompt)"}
              </span>
            )}
          </div>

          <div className="relative z-10">
            <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Six agents in a ring passing information to each other">
              {LINKS.map((l) => {
                const lit = orbState(l.from) !== "idle" && orbState(l.to) !== "idle";
                return (
                  <path
                    key={`${l.from}-${l.to}`}
                    d={pathD(POS[l.from], POS[l.to], l.bend)}
                    fill="none"
                    stroke="#ffffff"
                    strokeOpacity={lit ? 0.22 : 0.07}
                    strokeWidth={1.5}
                    strokeDasharray="4 8"
                    style={{ transition: "stroke-opacity 600ms" }}
                  />
                );
              })}

              {governor?.raised && (
                <g key={`overrule-${runId}`} transform={`translate(${POS.governor.x} ${POS.governor.y})`}>
                  {[0, 0.35, 0.7].map((d) => (
                    <motion.circle
                      key={d}
                      r={50}
                      fill="none"
                      stroke={TIER_GLOW.red}
                      strokeWidth={4}
                      initial={{ scale: 1, opacity: 0.9 }}
                      animate={{ scale: 4.2, opacity: 0 }}
                      transition={{ duration: 1.6, delay: d, ease: "easeOut" }}
                    />
                  ))}
                </g>
              )}

              {AGENTS.map((a) => (
                <AgentOrb
                  key={a.id}
                  agent={a}
                  x={POS[a.id].x}
                  y={POS[a.id].y}
                  state={orbState(a.id)}
                  wakeKey={runId}
                  compact
                  caption={a.id === "courier" ? courierCaption : null}
                />
              ))}

              {visible.map((e, i) => particlesFor(e, `${runId}-${i}`).map((p) => <Particle key={p.key} spec={p} />))}
            </svg>

            {/* Center status / final tier */}
            <div className="pointer-events-none absolute inset-x-0 top-[44%] flex -translate-y-1/2 justify-center">
              <AnimatePresence mode="wait">
                {governor ? (
                  <motion.div
                    key={`tier-${runId}`}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="rounded-2xl border-2 bg-[#06101f]/85 px-4 py-1.5 text-center"
                    style={{ borderColor: TIER_GLOW[governor.final_tier] }}
                  >
                    <div className="text-xs font-semibold tracking-widest text-slate-300 uppercase">Final tier</div>
                    <div className="text-2xl font-black" style={{ color: TIER_GLOW[governor.final_tier] }}>
                      {TIER_WORD[governor.final_tier]}
                    </div>
                  </motion.div>
                ) : status ? (
                  <motion.p
                    key={status}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className="max-w-[14rem] text-center text-sm text-slate-300"
                  >
                    {status}
                  </motion.p>
                ) : null}
              </AnimatePresence>
            </div>

            {/* Governor overrule moment */}
            <AnimatePresence>
              {governor?.raised && showBanner && (
                <>
                  <motion.div
                    key={`flash-${runId}`}
                    aria-hidden
                    className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_60%_at_64%_76%,rgba(248,113,113,0.55),transparent_70%)]"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: [0, 1, 0.25, 0.8, 0] }}
                    transition={{ duration: 1.8, ease: "easeInOut" }}
                  />
                  <motion.div
                    key={`banner-${runId}`}
                    role="status"
                    initial={{ opacity: 0, y: -16, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ type: "spring", stiffness: 260, damping: 22 }}
                    className="absolute inset-x-3 top-3 rounded-xl border border-red-300/60 bg-red-700/90 px-4 py-2 text-center shadow-lg shadow-red-900/50"
                  >
                    <p className="text-base font-bold">
                      Governor overruled: {TIER_WORD[governor.proposed_tier]} → {TIER_WORD[governor.final_tier]}
                    </p>
                    {governor.reason && <p className="line-clamp-2 text-sm text-red-50">{governor.reason}</p>}
                  </motion.div>
                </>
              )}
            </AnimatePresence>

            {finished && (
              <button
                type="button"
                onClick={replay}
                className="absolute right-3 bottom-3 inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-2 text-sm font-semibold text-white backdrop-blur hover:bg-white/20"
              >
                <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M3 12a9 9 0 1 0 2.6-6.4" />
                  <path d="M3 4v4.5h4.5" />
                </svg>
                Replay
              </button>
            )}
          </div>

          {/* Narration feed */}
          <div ref={feedRef} className="relative z-10 max-h-80 space-y-3 overflow-y-auto border-t border-white/10 p-4" aria-live="polite" aria-label="What each agent did">
            {!bubbles.length && <p className="text-sm text-ink-faint">Each agent will explain what it did here, in plain words.</p>}
            <AnimatePresence initial={false}>
              {bubbles.map(({ i, b }) => {
                const a = AGENT[b.agent];
                return (
                  <motion.div
                    key={`${runId}-${i}`}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ type: "spring", stiffness: 300, damping: 28 }}
                    className="flex gap-2.5"
                  >
                    <span className="mt-1 size-3 shrink-0 rounded-full" style={{ background: a.color, boxShadow: `0 0 12px ${a.color}` }} />
                    <div className="min-w-0 flex-1 rounded-2xl rounded-tl-sm bg-white/[0.07] px-3 py-2 text-sm leading-relaxed text-slate-100 ring-1 ring-white/10">
                      <div className="mb-0.5 text-xs font-bold tracking-wider uppercase" style={{ color: a.color }}>
                        {a.name}
                      </div>
                      {b.body}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </div>

        {/* Right: the answer, filling in as each agent finishes */}
        <LiveAnswer visible={visible} runId={runId} description={asked} busy={busy} fallback={fallback} />
      </div>
    </div>
  );
}
