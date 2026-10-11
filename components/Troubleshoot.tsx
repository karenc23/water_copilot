"use client";

import { useEffect, useRef, useState } from "react";
import type { TroubleshootResponse } from "@/lib/pipeline";
import DraftMessage from "@/components/DraftMessage";
import { AlertList, ManualTag, RuleBadge, TIER_MEANING, TIER_STYLE, TierIcon } from "@/components/tier";
import SaveToLogbook from "@/components/SaveToLogbook";
import { Card, Spinner, buttonPrimary, buttonSecondary } from "@/components/ui";

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
  const [hint, setHint] = useState<string | null>(null);
  const [asked, setAsked] = useState("");
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
    if (loading) return;
    if (!description.trim()) {
      setHint("Describe what’s happening first: what you see, hear or measured.");
      return;
    }
    setHint(null);
    setAsked(description);
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
          <label htmlFor="description" className="block text-2xl font-bold text-ink">
            Describe what’s happening
          </label>
          <p className="mt-1 text-base text-ink-muted">Say what you see, hear or measured. Plain words are fine.</p>
          <textarea
            id="description"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setHint(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
            }}
            aria-describedby={hint ? "description-hint" : undefined}
            rows={5}
            placeholder="e.g. Chlorine dropped to 0.4 this morning and the feed pump sounds different"
            className="mt-4 block w-full resize-y rounded-lg border-2 border-line-strong bg-glass p-4 text-xl leading-relaxed text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
          />
          {hint && (
            <p id="description-hint" role="alert" className="mt-2 text-base font-semibold text-amber-200">
              {hint}
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-ink-muted">Try an example:</span>
            {EXAMPLES.map((ex) => (
              <button key={ex} type="button" className={`${buttonSecondary} text-left`} onClick={() => {
                  setDescription(ex);
                  setHint(null);
                }} disabled={loading}>
                {ex}
              </button>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <button type="submit" className={`${buttonPrimary} min-h-14 px-8 text-xl`} disabled={loading}>
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
                className="text-base font-medium text-ink-muted underline underline-offset-4 hover:text-ink"
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
          <div role="alert" className="rounded-xl border-2 border-line-strong bg-glass p-5">
            <p className="text-xl font-bold text-ink">Couldn’t get a diagnosis</p>
            <p className="mt-1 text-lg text-ink-soft">{error}</p>
            <p className="mt-3 text-base text-ink-soft">
              Follow the manual. If you think health could be at risk, contact your Remote Maintenance Worker now (Manual §8.1).
            </p>
          </div>
        )}
        {result && <ResultView result={result} description={asked} />}
      </div>
    </div>
  );
}

function LoadingState({ stage }: { stage: number }) {
  return (
    <Card>
      <div className="flex items-center gap-4 text-accent">
        <Spinner className="size-8" />
        <div>
          <p className="text-xl font-semibold text-ink">{LOADING_STAGES[stage]}</p>
          <p className="text-base text-ink-muted">This usually takes a few seconds.</p>
        </div>
      </div>
      <div className="mt-6 animate-pulse space-y-3" aria-hidden>
        <div className="h-16 w-64 rounded-lg bg-glass-strong" />
        <div className="h-6 w-3/4 rounded bg-glass-strong" />
        <div className="h-6 w-2/3 rounded bg-glass-strong" />
        <div className="h-6 w-1/2 rounded bg-glass-strong" />
      </div>
    </Card>
  );
}

export function ResultView({ result, description }: { result: TroubleshootResponse; description: string }) {
  const tier = result.tier;
  const s = TIER_STYLE[tier];
  const meaning = TIER_MEANING[tier];
  const [draftOpen, setDraftOpen] = useState(false);

  return (
    <>
      {tier === "red" && (
        <div role="alert" className="flex flex-wrap items-center gap-4 rounded-2xl border border-red-400/60 bg-red-700/90 p-5 text-white shadow-[0_0_40px_-8px_rgba(248,113,113,0.7)]">
          <TierIcon tier="red" className="size-10 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-2xl font-bold">Escalate now: contact your Remote Maintenance Worker</p>
            <p className="mt-1 text-lg text-red-50">
              Don’t wait to see if it clears. A message with everything they need has been drafted for you to send.
            </p>
          </div>
          {result.escalation_packet && (
            <button
              type="button"
              onClick={() => setDraftOpen((o) => !o)}
              className="min-h-12 rounded-lg bg-white px-5 text-lg font-bold text-red-800 hover:bg-red-50"
              aria-expanded={draftOpen}
              aria-controls="draft-message"
            >
              Draft message to expert
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
            <p className="text-lg text-ink-soft">{meaning.detail}</p>
          </div>
        </div>
        <h2 className="mt-6 text-sm font-semibold uppercase tracking-wide text-ink-faint">Diagnosis</h2>
        <p className="mt-1 text-2xl leading-snug font-medium text-ink">{result.diagnosis}</p>
      </Card>

      <Card title="What to do, in order">
        {result.steps.length ? (
          <ol className="space-y-4">
            {result.steps.map((step, i) => {
              const { text } = splitManualRef(step.action);
              return (
                <li key={i} className="flex gap-4">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent text-xl font-bold text-accent-ink shadow-[0_0_18px_-4px_rgba(94,234,212,0.7)]">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1 pt-1">
                    <p className="text-xl leading-snug text-ink">{text}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <ManualTag section={step.manual_section} />
                      {step.source === "safety" && (
                        <span className="rounded-md bg-glass-strong px-2 py-0.5 text-sm font-semibold text-ink">Added by safety rule</span>
                      )}
                      {step.flags.map((f) => (
                        <span key={f} className="rounded-md border border-line-strong px-2 py-0.5 text-sm text-ink-soft">
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
          <p className="text-lg text-ink-soft">No steps could be verified against the manual. Contact your Remote Maintenance Worker (Manual §8.1).</p>
        )}
      </Card>

      <Card title="Alerts that fired" aside={<RuleBadge />}>
        <p className="mb-4 text-base text-ink-muted">Fixed safety rules checked your readings and logbook. These don’t come from the AI.</p>
        <AlertList alerts={result.alerts} empty="No rule alerts. Latest readings and logbook are within limits." />
      </Card>

      {result.warnings.length > 0 && (
        <Card title="Safety layer notes">
          <p className="mb-3 text-base text-ink-muted">The safety layer checked the AI’s answer and changed or removed these parts:</p>
          <ul className="space-y-2">
            {result.warnings.map((w, i) => (
              <li key={i} className="flex gap-3 rounded-lg bg-glass-strong p-3 text-base text-ink">
                <span aria-hidden className="font-bold">!</span>
                {w}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {result.escalation_packet && draftOpen && <DraftMessage packet={result.escalation_packet} onClose={() => setDraftOpen(false)} />}

      <SaveToLogbook key={description} description={description} result={result} />
    </>
  );
}
