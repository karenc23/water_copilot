"use client";

import { useState } from "react";
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
        <p className="text-lg text-slate-700">
          Builds a handbook from the logbook, the last 30 days of readings and the plant manual: plant quirks, recurring problems and what
          fixed them, warning signs, and who to call.
        </p>
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
        {loading && <p className="mt-3 text-base text-slate-600">Reading the logbook, readings and manual. This can take up to a minute.</p>}
      </Card>

      {error && (
        <div role="alert" className="rounded-xl border-2 border-slate-800 bg-white p-5">
          <p className="text-xl font-bold text-slate-900">Couldn’t write the handbook</p>
          <p className="mt-1 text-lg text-slate-700">{error}</p>
        </div>
      )}

      {loading && !markdown && (
        <Card>
          <div className="animate-pulse space-y-4" aria-hidden>
            <div className="h-9 w-2/3 rounded bg-slate-200" />
            <div className="h-5 w-full rounded bg-slate-200" />
            <div className="h-5 w-5/6 rounded bg-slate-200" />
            <div className="h-7 w-1/3 rounded bg-slate-200 pt-4" />
            <div className="h-5 w-4/5 rounded bg-slate-200" />
            <div className="h-5 w-3/4 rounded bg-slate-200" />
          </div>
        </Card>
      )}

      {markdown && (
        <article className={`rounded-xl border border-slate-200 bg-white p-6 shadow-sm md:p-10 ${loading ? "opacity-50" : ""}`}>
          <p className="mb-6 rounded-lg bg-slate-100 px-4 py-3 text-base text-slate-700">
            Written by AI from the plant’s own records. Check anything you act on against the manual.
          </p>
          <Markdown source={markdown} />
        </article>
      )}
    </div>
  );
}
