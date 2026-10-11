import { readFile } from "node:fs/promises";
import path from "node:path";
import { Suspense } from "react";
import { connection } from "next/server";
import ResultsChart from "@/components/ResultsChart";
import { parseResults, type Results, type Score, type Strategy } from "@/components/results-data";
import { Card, PageHeader, Spinner } from "@/components/ui";

const RESULTS_FILE = path.join(process.cwd(), "data", "results.json");

export default function ResultsPage() {
  return (
    <>
      <PageHeader title="Results" subtitle="How the prompt optimizer did against a plain LLM, rules only, and our hand-written expert prompt." />
      <Suspense fallback={<Loading />}>
        <ResultsContent />
      </Suspense>
    </>
  );
}

function Loading() {
  return (
    <Card>
      <div className="flex items-center gap-3 text-lg text-slate-700">
        <Spinner /> Loading results…
      </div>
    </Card>
  );
}

type Loaded = { state: "ok"; results: Results } | { state: "missing" } | { state: "unreadable" };

async function loadResults(): Promise<Loaded> {
  let text: string;
  try {
    text = await readFile(RESULTS_FILE, "utf8");
  } catch {
    return { state: "missing" };
  }
  try {
    return { state: "ok", results: parseResults(JSON.parse(text)) };
  } catch {
    // Most likely the optimizer is mid-write.
    return { state: "unreadable" };
  }
}

async function ResultsContent() {
  // Read on every request: the optimizer rewrites this file while it runs.
  await connection();
  const loaded = await loadResults();
  if (loaded.state !== "ok" || !loaded.results.rounds.length) {
    return <InProgress detail={loaded.state === "unreadable" ? "The results file is being written. Refresh in a minute." : undefined} />;
  }
  const r = loaded.results;
  const points = r.rounds.flatMap((rd) => (rd.best?.pct != null ? [{ round: rd.round, pct: rd.best.pct, id: rd.best.id }] : []));
  const rewrites = Math.max(r.rounds.length - 1, 0);

  return (
    <div className="space-y-6">
      <Summary rewrites={rewrites} ours={r.test.best} expert={r.test.expert} />

      <Card
        title="Unseen test scenarios"
        aside={<span className="text-base text-slate-600">{r.test.count ? `${r.test.count} scenarios` : "Scenarios"} the optimizer never saw</span>}
      >
        {r.test.plain || r.test.rules || r.test.best ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <BigNumber label="Plain LLM" score={r.test.plain} />
            <BigNumber label="Rules only" score={r.test.rules} />
            <BigNumber label="Expert prompt" score={r.test.expert} sub={r.test.expert?.id ?? undefined} />
            <BigNumber label="Ours" score={r.test.best} highlight sub={r.test.best?.id ?? undefined} />
          </div>
        ) : (
          <p className="text-lg text-slate-600">Test results aren’t in yet. They’re written when the run finishes.</p>
        )}
      </Card>

      <Card
        title="Best score so far, per round (training scenarios)"
        aside={
          <span className="text-base text-slate-600">
            {r.generatedAt && `Updated ${new Date(r.generatedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`}
            {r.quick && " · quick run"}
          </span>
        }
      >
        {points.length ? (
          <ResultsChart
            points={points}
            plainPct={r.baselines.plain?.pct ?? null}
            rulesPct={r.baselines.rules?.pct ?? null}
            expertPct={r.baselines.expert?.pct ?? null}
          />
        ) : (
          <p className="text-lg text-slate-600">No scored rounds yet.</p>
        )}
        <p className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-600">
          <span className="inline-flex items-center gap-2">
            <span className="h-[3px] w-6 rounded bg-[#2a78d6]" /> Best strategy so far
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="w-6 border-t-2 border-dashed border-slate-600" /> Reference: plain LLM, rules only, expert prompt
          </span>
          <span>Score as % of the maximum possible points.</span>
        </p>
        {points.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-base font-semibold text-blue-800 underline underline-offset-4">Show as a table</summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-base tabular-nums">
                <thead className="text-slate-600">
                  <tr>
                    <th className="py-1 pr-4 font-semibold">Round</th>
                    <th className="py-1 pr-4 font-semibold">Best so far</th>
                    <th className="py-1 pr-4 font-semibold">Strategy</th>
                  </tr>
                </thead>
                <tbody className="text-slate-900">
                  {points.map((p) => (
                    <tr key={p.round} className="border-t border-slate-200">
                      <td className="py-1 pr-4">{p.round}</td>
                      <td className="py-1 pr-4">{Math.round(p.pct)}%</td>
                      <td className="py-1 pr-4 font-mono text-sm">{p.id}</td>
                    </tr>
                  ))}
                  {[
                    ["Expert prompt (reference)", r.baselines.expert],
                    ["Rules only (reference)", r.baselines.rules],
                    ["Plain LLM (reference)", r.baselines.plain],
                  ].map(([label, s]) =>
                    s && typeof s === "object" ? (
                      <tr key={label as string} className="border-t border-slate-200 text-slate-600">
                        <td className="py-1 pr-4">{label as string}</td>
                        <td className="py-1 pr-4">{pct(s)}</td>
                        <td className="py-1 pr-4" />
                      </tr>
                    ) : null,
                  )}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </Card>

      <Card title="Strategies tried">
        <div className="space-y-3">
          {r.rounds.map((rd) => (
            <details key={rd.round} className="group rounded-lg border border-slate-200" open={rd.round === r.rounds.at(-1)?.round}>
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50">
                <span className="flex items-center gap-3">
                  <svg viewBox="0 0 24 24" className="size-5 text-slate-500 transition-transform group-open:rotate-90" fill="currentColor" aria-hidden>
                    <path d="m9 6 6 6-6 6V6Z" />
                  </svg>
                  <span className="text-xl font-semibold text-slate-900">Round {rd.round}</span>
                  <span className="text-base text-slate-600">
                    {rd.strategies.length} {rd.strategies.length === 1 ? "strategy" : "strategies"}
                  </span>
                </span>
                {rd.best && <span className="text-lg font-semibold tabular-nums text-slate-900">best {pct(rd.best)}</span>}
              </summary>
              <ul className="space-y-3 border-t border-slate-200 p-4">
                {rd.strategies.map((s) => (
                  <StrategyItem key={s.id} s={s} isRoundBest={s.id === rd.best?.id} isOverallBest={s.id === r.bestStrategyId} />
                ))}
              </ul>
            </details>
          ))}
        </div>
      </Card>
    </div>
  );
}

function pct(s: Score): string {
  return s.pct != null ? `${Math.round(s.pct)}%` : `${s.score} pts`;
}

/** The headline sentence. Only claims a win over the expert prompt if the test numbers show one. */
function Summary({ rewrites, ours, expert }: { rewrites: number; ours: Score | null; expert: Score | null }) {
  if (!ours || !rewrites) return null;
  const times = rewrites === 1 ? "once" : `${rewrites} times`;
  const outcome =
    !expert ? "" : ours.score > expert.score
      ? "; the final version beat our hand-written expert prompt on unseen scenarios"
      : ours.score === expert.score
        ? "; the final version tied our hand-written expert prompt on unseen scenarios"
        : "; the final version did not beat our hand-written expert prompt on unseen scenarios";
  return (
    <p className="text-xl leading-relaxed text-slate-800">
      Starting from a generic prompt, a critic agent rewrote the strategy {times}
      {outcome}.
    </p>
  );
}

const rate = (x: number | undefined) => (x == null ? "—" : `${Math.round(x * 100)}%`);

function BigNumber({ label, score, highlight, sub }: { label: string; score: Score | null; highlight?: boolean; sub?: string }) {
  const recall = score?.metrics.escalation_recall;
  const falseAlarm = score?.metrics.false_alarm_rate;
  return (
    <div className={`rounded-xl p-5 ${highlight ? "bg-blue-700 text-white" : "bg-slate-100 text-slate-900"}`}>
      <div className={`text-lg font-semibold ${highlight ? "text-blue-50" : "text-slate-700"}`}>{label}</div>
      <div className="mt-1 text-6xl font-black tabular-nums">{score ? pct(score) : "—"}</div>
      {score && (
        <div className={`mt-2 space-y-0.5 text-base ${highlight ? "text-blue-50" : "text-slate-600"}`}>
          <div>
            {score.score}
            {score.max != null && ` / ${score.max}`} points
          </div>
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 whitespace-nowrap">
            <dt>Missed danger</dt>
            <dd className="text-right font-semibold tabular-nums">{rate(recall == null ? undefined : 1 - recall)}</dd>
            <dt>False alarms</dt>
            <dd className="text-right font-semibold tabular-nums">{rate(falseAlarm)}</dd>
          </dl>
          {sub && <div className="font-mono text-sm opacity-80">{sub}</div>}
        </div>
      )}
    </div>
  );
}

function StrategyItem({ s, isRoundBest, isOverallBest }: { s: Strategy; isRoundBest: boolean; isOverallBest: boolean }) {
  return (
    <li className={`rounded-lg p-4 ${isRoundBest ? "bg-blue-50 ring-2 ring-blue-700" : "bg-slate-50"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-base font-semibold text-slate-900">{s.id}</span>
          {isOverallBest && <span className="rounded bg-blue-700 px-2 py-0.5 text-sm font-semibold text-white">Overall best</span>}
          {isRoundBest && !isOverallBest && <span className="rounded bg-slate-800 px-2 py-0.5 text-sm font-semibold text-white">Round best</span>}
          {s.qualified === false && <span className="rounded border border-slate-400 px-2 py-0.5 text-sm text-slate-700">Disqualified</span>}
        </div>
        <span className="text-lg font-semibold tabular-nums text-slate-900">
          {pct(s)}
          <span className="ml-2 text-base font-normal text-slate-600">
            {s.score}
            {s.max != null && ` / ${s.max}`}
          </span>
        </span>
      </div>
      {s.rationale && <p className="mt-2 text-base text-slate-700">{s.rationale}</p>}
      {Object.keys(s.settings).length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {Object.entries(s.settings).map(([k, v]) => (
            <span key={k} className="rounded border border-slate-300 bg-white px-2 py-0.5 font-mono text-sm text-slate-700">
              {k}: {String(v)}
            </span>
          ))}
        </div>
      )}
      {s.prompt && (
        <details className="mt-3">
          <summary className="cursor-pointer text-base font-semibold text-blue-800 underline underline-offset-4">Show prompt</summary>
          <pre className="mt-2 max-h-96 overflow-auto rounded-lg border border-slate-200 bg-white p-4 font-mono text-sm leading-relaxed whitespace-pre-wrap text-slate-800">
            {s.prompt}
          </pre>
        </details>
      )}
    </li>
  );
}

function InProgress({ detail }: { detail?: string }) {
  return (
    <Card>
      <div className="flex items-center gap-4">
        <Spinner className="size-8 text-blue-700" />
        <div>
          <p className="text-2xl font-bold text-slate-900">Run in progress</p>
          <p className="mt-1 text-lg text-slate-600">
            {detail ?? (
              <>
                No results yet. They appear here once <code className="font-mono">npm run optimize</code> writes data/results.json.
              </>
            )}
          </p>
        </div>
      </div>
    </Card>
  );
}
