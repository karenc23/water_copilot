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
          <svg viewBox="0 0 24 24" className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-slate-500" fill="currentColor" aria-hidden>
            <path d="M11 4a7 7 0 1 0 4.2 12.6l4.1 4.1 1.4-1.4-4.1-4.1A7 7 0 0 0 11 4Zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search problems, steps, operators… e.g. “filter 2”"
            aria-label="Search the logbook"
            className="min-h-14 w-full rounded-lg border-2 border-slate-300 bg-white pr-4 pl-12 text-lg text-slate-900 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none"
          />
        </div>
        <label className="flex min-h-12 cursor-pointer items-center gap-3 text-lg text-slate-800">
          <input type="checkbox" checked={escalatedOnly} onChange={(e) => setEscalatedOnly(e.target.checked)} className="size-6 accent-blue-700" />
          Escalated only
        </label>
      </div>

      <p className="mb-3 text-base text-slate-600" aria-live="polite">
        {rows.length} of {logs.length} entries
      </p>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[720px] text-left">
          <thead className="bg-slate-100 text-sm uppercase tracking-wide text-slate-600">
            <tr>
              <th className="px-4 py-3 font-semibold">Date</th>
              <th className="px-4 py-3 font-semibold">Problem</th>
              <th className="px-4 py-3 font-semibold">Steps taken</th>
              <th className="px-4 py-3 font-semibold">Outcome</th>
              <th className="px-4 py-3 font-semibold whitespace-nowrap">Escalated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 align-top">
            {rows.map((l, i) => (
              <tr key={`${l.date}-${i}`}>
                <td className="px-4 py-4 whitespace-nowrap">
                  <div className="text-base font-semibold text-slate-900">{formatDate(l.date)}</div>
                  <div className="text-sm text-slate-600">{l.operator}</div>
                </td>
                <td className="px-4 py-4 text-base font-medium text-slate-900">
                  <Highlight text={l.problem} query={query} />
                </td>
                <td className="px-4 py-4">
                  <ul className="list-disc space-y-1 pl-5 text-base text-slate-800">
                    {l.steps_taken.map((s, j) => (
                      <li key={j}>
                        <Highlight text={s} query={query} />
                      </li>
                    ))}
                  </ul>
                </td>
                <td className="px-4 py-4 text-base text-slate-800">
                  <Highlight text={l.outcome} query={query} />
                </td>
                <td className="px-4 py-4">
                  {l.escalated ? (
                    <span className="rounded bg-slate-800 px-2 py-1 text-sm font-semibold text-white">Yes</span>
                  ) : (
                    <span className="text-base text-slate-500">No</span>
                  )}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-lg text-slate-600">
                  No entries match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
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
          <mark key={i} className="rounded bg-blue-100 px-0.5 text-slate-900">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}
