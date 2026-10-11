"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { EscalationPacket, TroubleshootResponse } from "@/lib/pipeline";
import { AlertList, ManualTag, RuleBadge, TIER_MEANING, TIER_STYLE, TierIcon, readingTier, type Parameter } from "@/components/tier";
import { Card, Spinner, buttonPrimary, buttonSecondary, formatDate } from "@/components/ui";

const EXAMPLES = [
  "Water looks cloudy and chlorine reading is lower than yesterday",
  "Second backwash today and the filter still won’t clear",
];

const LOADING_STAGES = ["Checking readings against safety rules…", "Reading the manual and logbook…", "Running the safety check…"];

/** Steps and packet lines end with "(Manual §3.2)" / "(Manual 3.2)"; we show that as a tag instead. */
const TRAILING_MANUAL_RE = /\s*\(Manual\s*§?\s*([\d.]+)\)\s*$/i;
function splitManualRef(text: string): { text: string; section: string | null } {
  const m = text.match(TRAILING_MANUAL_RE);
  return m ? { text: text.slice(0, m.index).trim(), section: m[1] } : { text, section: null };
}

export default function Troubleshoot() {
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState(0);
  const [result, setResult] = useState<TroubleshootResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!loading) return;
    const id = setInterval(() => setStage((s) => Math.min(s + 1, LOADING_STAGES.length - 1)), 1500);
    return () => clearInterval(id);
  }, [loading]);

  useEffect(() => {
    if (result || error) resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [result, error]);

  async function submit() {
    if (!description.trim() || loading) return;
    setLoading(true);
    setStage(0);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/troubleshoot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body) {
        setError(body?.error ?? `Request failed (${res.status}).`);
      } else {
        setResult(body as TroubleshootResponse);
      }
    } catch {
      setError("Could not reach the server. Check the connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label htmlFor="description" className="block text-2xl font-bold text-slate-900">
            Describe what’s happening
          </label>
          <p className="mt-1 text-base text-slate-600">Say what you see, hear or measured. Plain words are fine.</p>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
            }}
            rows={5}
            placeholder="e.g. Chlorine dropped to 0.4 this morning and the feed pump sounds different"
            className="mt-4 block w-full resize-y rounded-lg border-2 border-slate-300 bg-white p-4 text-xl leading-relaxed text-slate-900 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none"
          />
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-slate-600">Try an example:</span>
            {EXAMPLES.map((ex) => (
              <button key={ex} type="button" className={`${buttonSecondary} text-left`} onClick={() => setDescription(ex)} disabled={loading}>
                {ex}
              </button>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <button type="submit" className={`${buttonPrimary} min-h-14 px-8 text-xl`} disabled={loading || !description.trim()}>
              {loading ? (
                <>
                  <Spinner /> Checking…
                </>
              ) : (
                "Get help"
              )}
            </button>
            {description && !loading && (
              <button
                type="button"
                className="text-base font-medium text-slate-600 underline underline-offset-4 hover:text-slate-900"
                onClick={() => {
                  setDescription("");
                  setResult(null);
                  setError(null);
                }}
              >
                Clear
              </button>
            )}
          </div>
        </form>
      </Card>

      <div ref={resultRef} className="scroll-mt-6 space-y-6" aria-live="polite">
        {loading && <LoadingState stage={stage} />}
        {error && (
          <div role="alert" className="rounded-xl border-2 border-slate-800 bg-white p-5">
            <p className="text-xl font-bold text-slate-900">Couldn’t get a diagnosis</p>
            <p className="mt-1 text-lg text-slate-700">{error}</p>
            <p className="mt-3 text-base text-slate-700">
              Follow the manual. If you think health could be at risk, contact your Remote Maintenance Worker now (Manual §8.1).
            </p>
          </div>
        )}
        {result && <ResultView result={result} />}
      </div>
    </div>
  );
}

function LoadingState({ stage }: { stage: number }) {
  return (
    <Card>
      <div className="flex items-center gap-4 text-blue-800">
        <Spinner className="size-8" />
        <div>
          <p className="text-xl font-semibold text-slate-900">{LOADING_STAGES[stage]}</p>
          <p className="text-base text-slate-600">This usually takes a few seconds.</p>
        </div>
      </div>
      <div className="mt-6 animate-pulse space-y-3" aria-hidden>
        <div className="h-16 w-64 rounded-lg bg-slate-200" />
        <div className="h-6 w-3/4 rounded bg-slate-200" />
        <div className="h-6 w-2/3 rounded bg-slate-200" />
        <div className="h-6 w-1/2 rounded bg-slate-200" />
      </div>
    </Card>
  );
}

function ResultView({ result }: { result: TroubleshootResponse }) {
  const tier = result.tier;
  const s = TIER_STYLE[tier];
  const meaning = TIER_MEANING[tier];
  const [packetOpen, setPacketOpen] = useState(false);

  return (
    <>
      {tier === "red" && (
        <div role="alert" className="flex flex-wrap items-center gap-4 rounded-xl bg-red-700 p-5 text-white shadow-md">
          <TierIcon tier="red" className="size-10 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-2xl font-bold">Escalate now: contact your Remote Maintenance Worker</p>
            <p className="mt-1 text-lg text-red-50">
              Don’t wait to see if it clears. An expert packet with everything they need is ready below.
            </p>
          </div>
          {result.escalation_packet && (
            <button
              type="button"
              onClick={() => setPacketOpen((o) => !o)}
              className="min-h-12 rounded-lg bg-white px-5 text-lg font-bold text-red-800 hover:bg-red-50"
              aria-expanded={packetOpen}
              aria-controls="expert-packet"
            >
              {packetOpen ? "Hide expert packet" : "View expert packet"}
            </button>
          )}
        </div>
      )}

      <Card>
        <div className="flex flex-wrap items-start gap-5">
          <div className={`flex items-center gap-3 rounded-xl px-6 py-4 ${s.solid}`}>
            <TierIcon tier={tier} className="size-12" />
            <div>
              <div className="text-sm font-semibold uppercase tracking-widest opacity-90">Safety tier</div>
              <div className="text-4xl leading-none font-black uppercase">{s.label}</div>
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <p className={`text-2xl font-bold ${s.text}`}>{meaning.title}</p>
            <p className="text-lg text-slate-700">{meaning.detail}</p>
          </div>
        </div>
        <h2 className="mt-6 text-sm font-semibold uppercase tracking-wide text-slate-500">Diagnosis</h2>
        <p className="mt-1 text-2xl leading-snug font-medium text-slate-900">{result.diagnosis}</p>
      </Card>

      <Card title="What to do, in order">
        {result.steps.length ? (
          <ol className="space-y-4">
            {result.steps.map((step, i) => {
              const { text } = splitManualRef(step.action);
              return (
                <li key={i} className="flex gap-4">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xl font-bold text-white">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1 pt-1">
                    <p className="text-xl leading-snug text-slate-900">{text}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <ManualTag section={step.manual_section} />
                      {step.source === "safety" && (
                        <span className="rounded-md bg-slate-200 px-2 py-0.5 text-sm font-semibold text-slate-800">Added by safety rule</span>
                      )}
                      {step.flags.map((f) => (
                        <span key={f} className="rounded-md border border-slate-300 px-2 py-0.5 text-sm text-slate-700">
                          {f.startsWith("dose not in manual") ? `⚠ Amount removed: ${f.split(": ").slice(1).join(": ")} is not in the manual` : `Amount checked against manual: ${f.split(": ").slice(1).join(": ")}`}
                        </span>
                      ))}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="text-lg text-slate-700">No steps could be verified against the manual. Contact your Remote Maintenance Worker (Manual §8.1).</p>
        )}
      </Card>

      <Card title="Alerts that fired" aside={<RuleBadge />}>
        <p className="mb-4 text-base text-slate-600">Fixed safety rules checked your readings and logbook. These don’t come from the AI.</p>
        <AlertList alerts={result.alerts} empty="No rule alerts. Latest readings and logbook are within limits." />
      </Card>

      {result.warnings.length > 0 && (
        <Card title="Safety layer notes">
          <p className="mb-3 text-base text-slate-600">The safety layer checked the AI’s answer and changed or removed these parts:</p>
          <ul className="space-y-2">
            {result.warnings.map((w, i) => (
              <li key={i} className="flex gap-3 rounded-lg bg-slate-100 p-3 text-base text-slate-800">
                <span aria-hidden className="font-bold">!</span>
                {w}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {result.escalation_packet && packetOpen && <ExpertPacket packet={result.escalation_packet} onClose={() => setPacketOpen(false)} />}
    </>
  );
}

function ExpertPacket({ packet, onClose }: { packet: EscalationPacket; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }), []);

  return (
    <section ref={ref} id="expert-packet" className="scroll-mt-6 rounded-xl border-4 border-red-700 bg-white shadow-md">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-red-50 p-5">
        <div>
          <h2 className="text-2xl font-bold text-red-900">Expert packet</h2>
          <p className="text-base text-slate-700">
            For the Remote Maintenance Worker · {packet.plant_id} · built from plant data, not written by AI
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className={buttonSecondary}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(packet.message);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? "Copied" : "Copy as text"}
          </button>
          <button type="button" className={buttonSecondary} onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      <div className="space-y-7 p-5 md:p-6">
        <PacketSection title="Failure mode">
          {packet.failure_mode ? (
            <p className="flex flex-wrap items-center gap-2 text-lg text-slate-900">
              <span className="font-mono font-semibold">{packet.failure_mode.id}</span> {packet.failure_mode.name}
              <ManualTag section={packet.failure_mode.manual_section} />
            </p>
          ) : (
            <p className="text-lg text-slate-700">Not identified</p>
          )}
        </PacketSection>

        <PacketSection title="Operator’s words">
          <blockquote className="border-l-4 border-slate-400 bg-slate-50 p-4 text-xl text-slate-900 italic">“{packet.operator_report}”</blockquote>
        </PacketSection>

        <PacketSection title="Recent readings">
          {packet.recent_readings.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-md text-left text-lg">
                <thead>
                  <tr className="border-b-2 border-slate-300 text-sm uppercase tracking-wide text-slate-600">
                    <th className="py-2 pr-4 font-semibold">Date</th>
                    <th className="py-2 pr-4 font-semibold">Chlorine (mg/L)</th>
                    <th className="py-2 pr-4 font-semibold">Turbidity (NTU)</th>
                    <th className="py-2 font-semibold">pH</th>
                  </tr>
                </thead>
                <tbody>
                  {packet.recent_readings.map((r) => (
                    <tr key={r.date} className="border-b border-slate-200">
                      <td className="py-2 pr-4 text-slate-700">{formatDate(r.date)}</td>
                      <ReadingCell parameter="chlorine" value={r.chlorine} />
                      <ReadingCell parameter="turbidity" value={r.turbidity} />
                      <ReadingCell parameter="ph" value={r.ph} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-lg text-slate-700">None</p>
          )}
        </PacketSection>

        <PacketSection title="Alerts (rule-detected, not AI)">
          {packet.alerts.length ? (
            <ul className="list-disc space-y-1 pl-6 text-lg text-slate-900">
              {packet.alerts.map((a, i) => {
                const { text, section } = splitManualRef(a);
                return (
                  <li key={i}>
                    {text} {section && <ManualTag section={section} />}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-lg text-slate-700">None</p>
          )}
        </PacketSection>

        <PacketSection title="Steps already done (from the logbook, last 30 days)">
          {packet.steps_reported_done.length ? (
            <ul className="space-y-3">
              {packet.steps_reported_done.map((l, i) => (
                <li key={i} className="rounded-lg bg-slate-50 p-4">
                  <p className="text-base font-semibold text-slate-600">{formatDate(l.date)}</p>
                  <ul className="mt-1 list-disc pl-6 text-lg text-slate-900">
                    {l.steps.map((st, j) => (
                      <li key={j}>{st}</li>
                    ))}
                  </ul>
                  <p className="mt-2 text-lg text-slate-800">
                    <span className="font-semibold">Result:</span> {l.outcome}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-lg text-slate-700">Nothing logged in the last 30 days.</p>
          )}
        </PacketSection>

        <PacketSection title="Recommended steps, not yet done">
          {packet.steps_recommended.length ? (
            <ol className="space-y-2">
              {packet.steps_recommended.map((st, i) => {
                const { text, section } = splitManualRef(st);
                return (
                  <li key={i} className="flex flex-wrap items-baseline gap-2 text-lg text-slate-900">
                    <span className="font-bold">{i + 1}.</span>
                    <span>{text}</span>
                    {section && <ManualTag section={section} />}
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="text-lg text-slate-700">None</p>
          )}
        </PacketSection>
      </div>
    </section>
  );
}

function PacketSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">{title}</h3>
      {children}
    </div>
  );
}

function ReadingCell({ parameter, value }: { parameter: Parameter; value: number }) {
  const tier = readingTier(parameter, value);
  const s = TIER_STYLE[tier];
  return (
    <td className="py-2 pr-4">
      <span className={`inline-flex items-center gap-1.5 font-semibold tabular-nums ${tier === "green" ? "text-slate-900" : s.text}`}>
        {tier !== "green" && <TierIcon tier={tier} className="size-4" />}
        {value}
      </span>
    </td>
  );
}
