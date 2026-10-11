"use client";

import { useMemo, useState } from "react";
import type { LogEntry } from "@/types";
import { formatDate } from "@/components/ui";

export default function LogbookTable({ logs }: { logs: LogEntry[] }) {
  const [query, setQuery] = useState("");
  const [escalatedOnly, setEscalatedOnly] = useState(false);

  const rows = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return logs.filter((l) => {
      if (escalatedOnly && !l.escalated) return false;
      const hay = [l.date, formatDate(l.date), l.operator, l.problem, l.outcome, ...l.steps_taken].join(" ").toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }, [logs, query, escalatedOnly]);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-4">
        <div className="relative min-w-64 flex-1">
          <svg viewBox="0 0 24 24" className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-ink-faint" fill="currentColor" aria-hidden>
            <path d="M11 4a7 7 0 1 0 4.2 12.6l4.1 4.1 1.4-1.4-4.1-4.1A7 7 0 0 0 11 4Zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search problems, steps, operators… e.g. “filter 2”"
            aria-label="Search the logbook"
            className="glass min-h-14 w-full rounded-xl pr-4 pl-12 text-lg text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
          />
        </div>
        <label className="flex min-h-12 cursor-pointer items-center gap-3 text-lg text-ink">
          <input type="checkbox" checked={escalatedOnly} onChange={(e) => setEscalatedOnly(e.target.checked)} className="size-6 accent-teal-400" />
          Escalated only
        </label>
      </div>

      <p className="mb-4 text-base text-ink-muted" aria-live="polite">
        {rows.length} of {logs.length} entries
      </p>

      {rows.length ? (
        <ol className="relative ml-3 border-l-2 border-aurora-violet/30 md:ml-4">
          {rows.map((l, i) => (
            <li key={`${l.date}-${l.problem}-${i}`} className="relative pb-6 pl-7 last:pb-0 md:pl-9">
              <span
                aria-hidden
                className={`absolute top-5 -left-[9px] size-4 rounded-full ring-4 ring-night ${
                  l.escalated ? "bg-red-400 shadow-[0_0_16px_3px_rgba(248,113,113,0.7)]" : "bg-aurora-violet shadow-[0_0_14px_2px_rgba(165,180,252,0.6)]"
                }`}
              />
              <article className={`glass rounded-2xl p-4 md:p-5 ${l.escalated ? "border-red-400/50" : ""}`}>
                <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <time dateTime={l.date} className="text-base font-bold text-ink">
                    {formatDate(l.date)}
                  </time>
                  <span className="text-base text-ink-muted">{l.operator}</span>
                  {l.escalated && <span className="rounded-full bg-red-600 px-2.5 py-0.5 text-sm font-semibold text-white">Escalated</span>}
                </header>
                <p className="mt-2 text-lg font-semibold text-ink">
                  <Highlight text={l.problem} query={query} />
                </p>
                {l.steps_taken.length > 0 && (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-base text-ink-soft marker:text-aurora-violet">
                    {l.steps_taken.map((s, j) => (
                      <li key={j}>
                        <Highlight text={s} query={query} />
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-3 border-t border-line pt-3 text-base text-ink-soft">
                  <span className="font-semibold text-ink">Outcome: </span>
                  <Highlight text={l.outcome} query={query} />
                </p>
              </article>
            </li>
          ))}
        </ol>
      ) : (
        <p className="glass rounded-2xl px-4 py-10 text-center text-lg text-ink-muted">No entries match.</p>
      )}
    </div>
  );
}

function Highlight({ text, query }: { text: string; query: string }) {
  const terms = query.split(/\s+/).filter(Boolean).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!terms.length) return <>{text}</>;
  const re = new RegExp(`(${terms.join("|")})`, "gi");
  return (
    <>
      {text.split(re).map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded bg-accent/30 px-0.5 text-white">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}
