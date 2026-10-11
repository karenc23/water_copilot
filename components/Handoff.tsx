"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import AgentBadge from "@/components/agents/AgentBadge";
import Markdown from "@/components/Markdown";
import { Card, Spinner, buttonPrimary, buttonSecondary } from "@/components/ui";

export default function Handoff() {
  const [loading, setLoading] = useState(false);
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/handoff", { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok || typeof body?.markdown !== "string") setError(body?.error ?? `Request failed (${res.status}).`);
      else setMarkdown(body.markdown);
    } catch {
      setError("Could not reach the server. Check the connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-center gap-5">
          <AgentBadge id="keeper" state={loading ? "thinking" : markdown ? "done" : "active"} className="size-28" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold tracking-widest text-aurora-violet uppercase">Keeper</p>
            <p className="mt-1 text-lg leading-relaxed text-ink">
              {loading
                ? "I’m reading every logbook entry, 30 days of readings and the manual, and writing it down for the next operator…"
                : "When an operator leaves, what they knew stays with me. I’ll write a handbook from the logbook, the last 30 days of readings and the plant manual: plant quirks, recurring problems and what fixed them, warning signs, and who to call."}
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="button" onClick={generate} disabled={loading} className={`${buttonPrimary} min-h-14 px-8 text-xl`}>
            {loading ? (
              <>
                <Spinner /> Writing handbook…
              </>
            ) : markdown ? (
              "Generate again"
            ) : (
              "Generate handbook for new operator"
            )}
          </button>
          {markdown && !loading && (
            <>
              <button
                type="button"
                className={buttonSecondary}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(markdown);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  } catch {
                    setCopied(false);
                  }
                }}
              >
                {copied ? "Copied" : "Copy text"}
              </button>
              <button type="button" className={buttonSecondary} onClick={() => window.print()}>
                Print
              </button>
            </>
          )}
        </div>
        {loading && <p className="mt-3 text-base text-ink-muted">This can take up to a minute.</p>}
      </Card>

      {error && (
        <div role="alert" className="glass rounded-2xl border-red-400/60 p-5">
          <p className="text-xl font-bold text-ink">Couldn’t write the handbook</p>
          <p className="mt-1 text-lg text-ink-soft">{error}</p>
        </div>
      )}

      {loading && !markdown && (
        <Card>
          <div className="animate-pulse space-y-4" aria-hidden>
            <div className="h-9 w-2/3 rounded bg-glass-strong" />
            <div className="h-5 w-full rounded bg-glass-strong" />
            <div className="h-5 w-5/6 rounded bg-glass-strong" />
            <div className="h-7 w-1/3 rounded bg-glass-strong pt-4" />
            <div className="h-5 w-4/5 rounded bg-glass-strong" />
            <div className="h-5 w-3/4 rounded bg-glass-strong" />
          </div>
        </Card>
      )}

      <AnimatePresence mode="wait">
        {markdown && (
          <motion.article
            key={markdown}
            initial={{ opacity: 0, y: 30, scale: 0.98 }}
            animate={{ opacity: loading ? 0.5 : 1, y: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 110, damping: 20 }}
            className="glass glow-accent rounded-2xl p-6 md:p-10"
          >
            <p className="mb-6 rounded-lg bg-glass-strong px-4 py-3 text-base text-ink-soft">
              Written by the Keeper (AI) from the plant’s own records. Check anything you act on against the manual.
            </p>
            <Markdown source={markdown} />
          </motion.article>
        )}
      </AnimatePresence>
    </div>
  );
}
