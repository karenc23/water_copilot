"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState, type ReactNode } from "react";
import type { LiveEvent } from "@/components/agents/live-events";
import { AGENT, type AgentId } from "@/components/agents/meta";
import DraftMessage from "@/components/DraftMessage";
import SaveToLogbook from "@/components/SaveToLogbook";
import { ManualTag, TIER_MEANING, TIER_STYLE, TierIcon, TierPill } from "@/components/tier";
import { buttonPrimary } from "@/components/ui";

// The answer card on Troubleshoot. It fills in from the same streamed events as the Agent Room,
// in the order the agents finish; every piece is tagged with the agent that produced it.

const TRAILING_MANUAL_RE = /\s*\(Manual\s*§?\s*[\d.]+\)\s*$/i;
const ORDER: AgentId[] = ["sentinel", "librarian", "keeper", "diagnostician", "governor", "courier"];

function AgentTag({ id, note }: { id: AgentId; note?: string }) {
  const a = AGENT[id];
  return (
    <p className="mb-2 flex items-center gap-2 text-xs font-bold tracking-widest uppercase" style={{ color: a.color }}>
      <span className="size-2.5 rounded-full" style={{ background: a.color, boxShadow: `0 0 10px ${a.color}` }} aria-hidden />
      {a.name}
      {note && <span className="font-medium tracking-normal text-ink-faint normal-case">· {note}</span>}
    </p>
  );
}

function Piece({ id, note, children, className = "" }: { id: AgentId; note?: string; children: ReactNode; className?: string }) {
  return (
    <motion.section
      layout
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 26 }}
      className={`border-t border-line pt-4 first:border-t-0 first:pt-0 ${className}`}
      aria-label={`${AGENT[id].name}: ${note ?? AGENT[id].role}`}
    >
      <AgentTag id={id} note={note} />
      {children}
    </motion.section>
  );
}

export default function LiveAnswer({
  visible,
  runId,
  description,
  busy,
  fallback,
}: {
  visible: LiveEvent[];
  runId: number;
  description: string;
  busy: boolean;
  fallback: string | null;
}) {
  const find = <T extends LiveEvent["type"]>(type: T) => visible.find((e) => e.type === type) as Extract<LiveEvent, { type: T }> | undefined;
  const sentinel = find("sentinel");
  const librarian = find("librarian");
  const keeper = find("keeper");
  const thinking = find("diagnostician_start");
  const diag = find("diagnostician");
  const governor = find("governor");
  const courier = find("courier");
  const done = find("done");
  const error = find("error");
  const [draftOpen, setDraftOpen] = useState<number | null>(null);

  const arrived: Record<AgentId, boolean> = {
    sentinel: !!sentinel,
    librarian: !!librarian,
    keeper: !!keeper,
    diagnostician: !!diag,
    governor: !!governor,
    courier: !!courier || (!!done && !courier),
  };
  const started = visible.length > 0;
  const pending = busy ? ORDER.filter((id) => !arrived[id]) : [];
  const steps = done?.result.steps;

  return (
    <div className="space-y-4" aria-live="polite">
      <AnimatePresence>
        {fallback && (
          <motion.p
            key={`fb-${runId}`}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            role="status"
            className="rounded-xl border border-amber-300/50 bg-amber-400/10 px-4 py-3 text-base text-amber-100"
          >
            {fallback}
          </motion.p>
        )}
      </AnimatePresence>

      <div className="glass rounded-2xl p-5 md:p-6">
        <h2 className="text-xl font-bold text-ink">The answer</h2>
        {!started && !error && <p className="mt-2 text-base text-ink-muted">It fills in here as each agent finishes: alerts, manual sections, past incidents, the diagnosis, the final tier and, if it’s red, a drafted message to your expert.</p>}

        <div key={runId} className="mt-4 space-y-4">
          {sentinel && (
            <Piece id="sentinel" note="fixed safety rules, not AI">
              {sentinel.alerts.length ? (
                <ul className="flex flex-wrap gap-2">
                  {sentinel.alerts.map((a, i) => (
                    <li key={i} className={`inline-flex max-w-full items-start gap-2 rounded-lg border-l-4 px-3 py-2 text-sm ${TIER_STYLE[a.tier].border} ${TIER_STYLE[a.tier].soft}`}>
                      <TierPill tier={a.tier} />
                      <span className={`${TIER_STYLE[a.tier].text} min-w-0`}>
                        {a.message} <span className="text-ink-faint">§{a.manual_section}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-base text-ink-soft">No rule alerts: the latest readings and logbook are within limits.</p>
              )}
            </Piece>
          )}

          {librarian && (
            <Piece id="librarian" note={`whole manual, ${librarian.sections_total} sections`}>
              {librarian.sections.length ? (
                <ul className="flex flex-wrap gap-2">
                  {librarian.sections.map((s) => (
                    <li key={s.section} className="inline-flex items-center gap-2 rounded-md border border-line-strong bg-glass px-2 py-1 text-sm text-ink">
                      <span className="font-mono font-semibold">§{s.section}</span>
                      {s.title && <span className="text-ink-soft">{s.title}</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-base text-ink-soft">No alert points to a specific section.</p>
              )}
            </Piece>
          )}

          {keeper && (
            <Piece id="keeper" note={`last ${keeper.window_days} days of the logbook`}>
              {keeper.recent.length ? (
                <ul className="space-y-1.5">
                  {keeper.recent.slice(0, 4).map((r, i) => (
                    <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-sm text-ink-soft">
                      <span className="font-semibold text-ink tabular-nums">{r.date}</span>
                      <span className="min-w-0">{r.problem}</span>
                      {r.escalated && <span className="rounded bg-red-600 px-1.5 py-0.5 text-xs font-semibold text-white">Escalated</span>}
                    </li>
                  ))}
                  {keeper.recent.length > 4 && <li className="text-xs text-ink-faint">+ {keeper.recent.length - 4} more</li>}
                </ul>
              ) : (
                <p className="text-base text-ink-soft">No incidents logged in the last {keeper.window_days} days.</p>
              )}
              {keeper.log_alerts.length > 0 && <p className="mt-2 text-sm font-semibold text-red-300">Pattern flagged: {keeper.log_alerts.map((a) => a.message).join("; ")}</p>}
            </Piece>
          )}

          {thinking && !diag && !error && (
            <Piece id="diagnostician" note="thinking…">
              <div className="animate-pulse space-y-2" aria-hidden>
                <div className="h-5 w-11/12 rounded bg-glass-strong" />
                <div className="h-5 w-2/3 rounded bg-glass-strong" />
              </div>
            </Piece>
          )}

          {diag && (
            <Piece id="diagnostician" note="AI model">
              <p className="text-lg leading-snug font-medium text-ink">{done?.result.diagnosis ?? diag.diagnosis}</p>
              {diag.failure_mode && (
                <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
                  <span className="font-mono font-semibold text-ink">{diag.failure_mode.id}</span> {diag.failure_mode.name}
                  <ManualTag section={diag.failure_mode.manual_section} />
                </p>
              )}
              <h3 className="mt-3 text-sm font-semibold tracking-wide text-ink-faint uppercase">
                {steps ? "What to do, in order (checked by the Governor)" : "Proposed steps (waiting for the Governor’s check)"}
              </h3>
              {steps ? (
                steps.length ? (
                  <ol className="mt-2 space-y-3">
                    {steps.map((step, i) => (
                      <li key={i} className="flex gap-3">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-base font-bold text-accent-ink">{i + 1}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-base leading-snug text-ink">{step.action.replace(TRAILING_MANUAL_RE, "")}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <ManualTag section={step.manual_section} />
                            {step.source === "safety" && (
                              <span className="inline-flex items-center gap-1 rounded-md bg-glass-strong px-2 py-0.5 text-xs font-semibold" style={{ color: AGENT.governor.color }}>
                                <span className="size-1.5 rounded-full" style={{ background: AGENT.governor.color }} aria-hidden />
                                Added by the Governor
                              </span>
                            )}
                            {step.flags.map((f) => (
                              <span key={f} className="rounded-md border border-line-strong px-2 py-0.5 text-xs text-ink-soft">
                                {f.startsWith("dose not in manual") ? `⚠ Amount removed: ${f.split(": ").slice(1).join(": ")} is not in the manual` : `Amount checked: ${f.split(": ").slice(1).join(": ")}`}
                              </span>
                            ))}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="mt-2 text-base text-ink-soft">No steps could be verified against the manual. Contact your Remote Maintenance Worker (Manual §8.1).</p>
                )
              ) : (
                <ol className="mt-2 list-decimal space-y-1 pl-6 text-base text-ink-muted">
                  {diag.steps.map((s, i) => (
                    <li key={i}>
                      {s.action.replace(TRAILING_MANUAL_RE, "")} {s.manual_section && <span className="font-mono text-xs">§{s.manual_section}</span>}
                    </li>
                  ))}
                </ol>
              )}
            </Piece>
          )}

          {governor && (
            <Piece id="governor" note="safety layer, final say">
              <div className="flex flex-wrap items-center gap-4">
                <div className={`flex items-center gap-3 rounded-xl px-5 py-3 ${TIER_STYLE[governor.final_tier].solid}`}>
                  <TierIcon tier={governor.final_tier} className="size-9" />
                  <div>
                    <div className="text-xs font-semibold tracking-widest uppercase opacity-90">Safety tier</div>
                    <div className="text-3xl leading-none font-black uppercase">{TIER_STYLE[governor.final_tier].label}</div>
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`text-xl font-bold ${TIER_STYLE[governor.final_tier].text}`}>{TIER_MEANING[governor.final_tier].title}</p>
                  <p className="text-base text-ink-soft">{TIER_MEANING[governor.final_tier].detail}</p>
                </div>
              </div>
              {governor.raised && (
                <p className="mt-3 rounded-lg border border-red-400/60 bg-red-500/15 px-3 py-2 text-base font-semibold text-red-100">
                  Raised to {TIER_STYLE[governor.final_tier].label.toUpperCase()} by Governor
                  <span className="block text-sm font-normal text-red-100/90">
                    The Diagnostician proposed {governor.proposed_tier.toUpperCase()}{governor.reason ? `, but ${governor.reason}` : ""}.
                  </span>
                </p>
              )}
              {(governor.dropped_steps.length > 0 || governor.doses_removed.length > 0) && (
                <ul className="mt-3 space-y-1 text-sm text-ink-soft">
                  {governor.dropped_steps.map((d, i) => (
                    <li key={`d${i}`}>✕ Dropped “{d.action}” ({d.why}).</li>
                  ))}
                  {governor.doses_removed.map((d, i) => (
                    <li key={`x${i}`}>✕ Removed dose “{d}”: not in the manual.</li>
                  ))}
                </ul>
              )}
            </Piece>
          )}

          {courier && (
            <Piece id="courier" note="drafts, never sends">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-base text-ink-soft">A message for your Remote Maintenance Worker, built from plant data. You check it and send it yourself.</p>
                <button
                  type="button"
                  className={buttonPrimary}
                  onClick={() => setDraftOpen((o) => (o === runId ? null : runId))}
                  aria-expanded={draftOpen === runId}
                  aria-controls="draft-message"
                >
                  Draft message to expert
                </button>
              </div>
            </Piece>
          )}
          {done && !courier && (
            <Piece id="courier" note="not needed">
              <p className="text-base text-ink-soft">The tier isn’t red, so there’s no message to your expert.</p>
            </Piece>
          )}

          {pending.length > 0 && (
            <ul className="space-y-1.5 border-t border-line pt-4" aria-label="Still working">
              {pending.map((id) => (
                <li key={id} className="flex items-center gap-2 text-sm text-ink-faint">
                  <span className="size-2 animate-pulse rounded-full" style={{ background: AGENT[id].color }} aria-hidden />
                  {AGENT[id].name}: waiting…
                </li>
              ))}
            </ul>
          )}

          {error && (
            <div role="alert" className="rounded-xl border border-red-400/60 bg-red-500/10 p-4">
              <p className="text-lg font-bold text-ink">Couldn’t get a diagnosis</p>
              <p className="mt-1 text-base text-ink-soft">{error.error}</p>
              <p className="mt-2 text-sm text-ink-soft">Follow the manual. If you think health could be at risk, contact your Remote Maintenance Worker now (Manual §8.1).</p>
            </div>
          )}
        </div>
      </div>

      {courier && draftOpen === runId && <DraftMessage packet={courier.packet} onClose={() => setDraftOpen(null)} />}
      {done && <SaveToLogbook key={`${runId}-${description}`} description={description} result={done.result} />}
    </div>
  );
}
