import { readFile } from "node:fs/promises";
import path from "node:path";
import { Suspense } from "react";
import { connection } from "next/server";
import ResultsChart from "@/components/ResultsChart";
import { parseResults, type Results, type Score, type Strategy } from "@/components/results-data";
import Link from "next/link";
import { Card, PageHeader, Spinner, buttonPrimary } from "@/components/ui";

const RESULTS_FILE = path.join(process.cwd(), "data", "results.json");

export default function ResultsPage() {
  return (
    <>
      <PageHeader title="Results" subtitle="How the prompt optimizer did against a plain LLM, rules only, and our hand-written expert prompt.">
        <Link href="/evolution" className={buttonPrimary}>
          Watch the agents evolve →
        </Link>
      </PageHeader>
      <Suspense fallback={<Loading />}>
        <ResultsContent />
      </Suspense>
    </>
  );
}

function Loading() {
  return (
    <Card>
      <div className="flex items-center gap-3 text-lg text-ink-soft">
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
      <Headline baseline={r.test.baseline} evolved={r.test.best} count={r.test.count} />
      <Summary rewrites={rewrites} ours={r.test.best} expert={r.test.expert} />

      <Card
        title="Unseen test scenarios"
        aside={<span className="text-base text-ink-muted">{r.test.count ? `${r.test.count} scenarios` : "Scenarios"} the optimizer never saw</span>}
      >
        {r.test.plain || r.test.rules || r.test.best ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <BigNumber label="Plain LLM" score={r.test.plain} />
            <BigNumber label="Rules only" score={r.test.rules} />
            <BigNumber label="Expert prompt" score={r.test.expert} sub={r.test.expert?.id ?? undefined} />
            <BigNumber label="Ours" score={r.test.best} highlight sub={r.test.best?.id ?? undefined} />
          </div>
        ) : (
          <p className="text-lg text-ink-muted">Test results aren’t in yet. They’re written when the run finishes.</p>
        )}
      </Card>

      <Card
        title="Best score so far, per round (training scenarios)"
        aside={
          <span className="text-base text-ink-muted">
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
          <p className="text-lg text-ink-muted">No scored rounds yet.</p>
        )}
        <p className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-muted">
          <span className="inline-flex items-center gap-2">
            <span className="h-[3px] w-6 rounded bg-accent shadow-[0_0_8px_rgba(94,234,212,0.9)]" /> Best strategy so far
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="w-6 border-t-2 border-dashed border-ink-muted" /> Reference: plain LLM, rules only, expert prompt
          </span>
          <span>Score as % of the maximum possible points.</span>
        </p>
        {points.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-base font-semibold text-accent underline underline-offset-4">Show as a table</summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-base tabular-nums">
                <thead className="text-ink-muted">
                  <tr>
                    <th className="py-1 pr-4 font-semibold">Round</th>
                    <th className="py-1 pr-4 font-semibold">Best so far</th>
                    <th className="py-1 pr-4 font-semibold">Strategy</th>
                  </tr>
                </thead>
                <tbody className="text-ink">
                  {points.map((p) => (
                    <tr key={p.round} className="border-t border-line">
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
                      <tr key={label as string} className="border-t border-line text-ink-muted">
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
            <details key={rd.round} className="group rounded-lg border border-line" open={rd.round === r.rounds.at(-1)?.round}>
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 hover:bg-glass-strong">
                <span className="flex items-center gap-3">
                  <svg viewBox="0 0 24 24" className="size-5 text-ink-faint transition-transform group-open:rotate-90" fill="currentColor" aria-hidden>
                    <path d="m9 6 6 6-6 6V6Z" />
                  </svg>
                  <span className="text-xl font-semibold text-ink">Round {rd.round}</span>
                  <span className="text-base text-ink-muted">
                    {rd.strategies.length} {rd.strategies.length === 1 ? "strategy" : "strategies"}
                  </span>
                </span>
                {rd.best && <span className="text-lg font-semibold tabular-nums text-ink">best {pct(rd.best)}</span>}
              </summary>
              <ul className="space-y-3 border-t border-line p-4">
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

/**
 * Baseline → Evolved on the unseen test set, the relative reduction in lost points
 * ((max − score) is the "error"), then the hard subset and the two safety rates.
 */
function Headline({
  baseline,
  evolved,
  count,
}: {
  baseline: (Score & { label: string }) | null;
  evolved: (Score & { id: string | null }) | null;
  count: number | null;
}) {
  if (!baseline || !evolved) return null;
  const bErr = baseline.max != null ? baseline.max - baseline.score : null;
  const eErr = evolved.max != null ? evolved.max - evolved.score : null;
  const reduction = bErr && eErr != null ? ((bErr - eErr) / bErr) * 100 : null;
  const missed = (s: Score) => (s.metrics.escalation_recall != null ? 1 - s.metrics.escalation_recall : undefined);
  const withCount = (r: string, n: number | undefined) => `${r}${n != null ? ` (${n})` : ""}`;
  const rows: { label: string; b: string; e: string }[] = [];
  if (baseline.hard || evolved.hard) {
    rows.push({
      label: "Hard scenarios",
      b: baseline.hard ? `${baseline.hard.score}/${baseline.hard.max}` : "—",
      e: evolved.hard ? `${evolved.hard.score}/${evolved.hard.max}` : "—",
    });
  }
  if (missed(baseline) != null || missed(evolved) != null) {
    rows.push({
      label: "Missed danger",
      b: withCount(rate(missed(baseline)), baseline.metrics.missed_escalations),
      e: withCount(rate(missed(evolved)), evolved.metrics.missed_escalations),
    });
  }
  if (baseline.metrics.false_alarm_rate != null || evolved.metrics.false_alarm_rate != null) {
    rows.push({
      label: "False alarms",
      b: withCount(rate(baseline.metrics.false_alarm_rate), baseline.metrics.false_alarms),
      e: withCount(rate(evolved.metrics.false_alarm_rate), evolved.metrics.false_alarms),
    });
  }
  return (
    <section className="glass glow-accent rounded-2xl p-5 md:p-7">
      <h2 className="text-sm font-bold tracking-widest text-accent uppercase">Baseline → Evolved on unseen tests</h2>
      <div className="mt-3 flex flex-wrap items-end gap-x-6 gap-y-3">
        <div>
          <div className="text-base font-semibold text-ink-muted">{baseline.label}</div>
          <div className="text-6xl font-black tabular-nums text-ink-soft">{pct(baseline)}</div>
          <div className="text-sm text-ink-muted tabular-nums">
            {baseline.score}
            {baseline.max != null && ` / ${baseline.max}`} points
          </div>
        </div>
        <div aria-hidden className="pb-8 text-4xl text-accent">
          →
        </div>
        <div>
          <div className="text-base font-semibold text-accent">Evolved{evolved.id ? ` (${evolved.id})` : ""}</div>
          <div className="text-6xl font-black tabular-nums text-white drop-shadow-[0_0_18px_rgba(94,234,212,0.6)]">{pct(evolved)}</div>
          <div className="text-sm text-ink-muted tabular-nums">
            {evolved.score}
            {evolved.max != null && ` / ${evolved.max}`} points
          </div>
        </div>
        {reduction != null && (
          <div className="rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 sm:ml-auto sm:text-right">
            <div className="text-4xl font-black text-accent tabular-nums">−{Math.round(reduction)}%</div>
            <div className="text-sm text-ink-soft">relative error reduction</div>
            <div className="text-xs text-ink-faint tabular-nums">
              points lost: {bErr} → {eErr}
            </div>
          </div>
        )}
      </div>
      {rows.length > 0 && (
        <table className="mt-5 w-full max-w-xl text-left text-base tabular-nums">
          <thead className="text-sm text-ink-muted">
            <tr>
              <th className="py-1 pr-4 font-semibold">
                <span className="sr-only">Measure</span>
              </th>
              <th className="py-1 pr-4 font-semibold">{baseline.label}</th>
              <th className="py-1 font-semibold text-accent">Evolved</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-t border-line">
                <th scope="row" className="py-2 pr-4 font-semibold text-ink-soft">
                  {row.label}
                </th>
                <td className="py-2 pr-4 text-ink-soft">{row.b}</td>
                <td className="py-2 font-semibold text-ink">{row.e}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {count != null && (
        <p className="mt-3 text-sm text-ink-faint">
          {count} test scenarios the optimizer never saw. Lower is better for missed danger and false alarms.
        </p>
      )}
    </section>
  );
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
    <p className="text-xl leading-relaxed text-ink">
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
    <div className={`rounded-xl border p-5 text-ink ${highlight ? "glow-accent bg-accent/15" : "border-line bg-glass-strong"}`}>
      <div className={`text-lg font-semibold ${highlight ? "text-accent" : "text-ink-soft"}`}>{label}</div>
      <div className="mt-1 text-6xl font-black tabular-nums">{score ? pct(score) : "—"}</div>
      {score && (
        <div className={`mt-2 space-y-0.5 text-base ${highlight ? "text-ink-soft" : "text-ink-muted"}`}>
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
    <li className={`rounded-lg p-4 ${isRoundBest ? "glow-accent border bg-accent/10" : "border border-line bg-glass"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-base font-semibold text-ink">{s.id}</span>
          {isOverallBest && <span className="rounded bg-accent px-2 py-0.5 text-sm font-bold text-accent-ink">Overall best</span>}
          {isRoundBest && !isOverallBest && <span className="rounded bg-white/15 px-2 py-0.5 text-sm font-semibold text-white">Round best</span>}
          {s.qualified === false && <span className="rounded border border-line-strong px-2 py-0.5 text-sm text-ink-soft">Disqualified</span>}
        </div>
        <span className="text-lg font-semibold tabular-nums text-ink">
          {pct(s)}
          <span className="ml-2 text-base font-normal text-ink-muted">
            {s.score}
            {s.max != null && ` / ${s.max}`}
          </span>
        </span>
      </div>
      {s.rationale && <p className="mt-2 text-base text-ink-soft">{s.rationale}</p>}
      {Object.keys(s.settings).length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {Object.entries(s.settings).map(([k, v]) => (
            <span key={k} className="rounded border border-line-strong bg-glass px-2 py-0.5 font-mono text-sm text-ink-soft">
              {k}: {String(v)}
            </span>
          ))}
        </div>
      )}
      {s.prompt && (
        <details className="mt-3">
          <summary className="cursor-pointer text-base font-semibold text-accent underline underline-offset-4">Show prompt</summary>
          <pre className="mt-2 max-h-96 overflow-auto rounded-lg border border-line bg-glass p-4 font-mono text-sm leading-relaxed whitespace-pre-wrap text-ink">
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
        <Spinner className="size-8 text-accent" />
        <div>
          <p className="text-2xl font-bold text-ink">Run in progress</p>
          <p className="mt-1 text-lg text-ink-muted">
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
