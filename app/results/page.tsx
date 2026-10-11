import { readFile } from "node:fs/promises";
import path from "node:path";
import { Suspense } from "react";
import { connection } from "next/server";
import ResultsChart from "@/components/ResultsChart";
import { proofFromAgents, proofFromResults, type Proof } from "@/components/proof-data";
import { parseResults, type Results, type Score, type Strategy } from "@/components/results-data";
import Link from "next/link";
import { Card, PageHeader, Spinner, buttonPrimary } from "@/components/ui";

// RESULTS_FILE (env) points at another optimizer output, e.g. for a demo or a test fixture.
const RESULTS_FILE = process.env.RESULTS_FILE || path.join(process.cwd(), "data", "results.json");
// Written by scripts/optimize_agents.ts; when present (and not a dry run) it drives the headline.
const AGENTS_FILE = path.join(process.cwd(), "data", "results_agents.json");

export default function ResultsPage() {
  return (
    <>
      <PageHeader title="Proof" subtitle="How much the agents improved on scenarios they never saw.">
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

type Loaded = { state: "ok"; results: Results; proof: Proof | null } | { state: "missing" } | { state: "unreadable" };

/** The headline: results_agents.json if it has a (non-dry) selection, else the same rule applied to results.json. */
async function loadProof(resultsRaw: unknown): Promise<Proof | null> {
  try {
    const agents = proofFromAgents(JSON.parse(await readFile(AGENTS_FILE, "utf8")));
    if (agents) return agents;
  } catch {
    // Not written yet, or mid-write: fall back to results.json.
  }
  return proofFromResults(resultsRaw);
}

async function loadResults(): Promise<Loaded> {
  let text: string;
  try {
    text = await readFile(RESULTS_FILE, "utf8");
  } catch {
    return { state: "missing" };
  }
  try {
    const raw = JSON.parse(text);
    return { state: "ok", results: parseResults(raw), proof: await loadProof(raw) };
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
  // The strategy picked by training score (proof-data.ts); only this one is highlighted.
  const selectedId = loaded.proof?.source === "results.json" ? loaded.proof.selected.id : null;

  return (
    <div className="space-y-6">
      <Headline proof={loaded.proof} />
      <Summary rewrites={rewrites} ours={r.test.best} expert={r.test.expert} />

      <Card
        title="Unseen test scenarios"
        aside={<span className="text-base text-ink-muted">{r.test.count ? `${r.test.count} scenarios` : "Scenarios"} the optimizer never saw</span>}
      >
        {r.test.plain || r.test.rules || r.test.best ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {r.test.baseline && r.test.baseline.label !== "Plain LLM" && <BigNumber label={r.test.baseline.label} score={r.test.baseline} />}
            <BigNumber label="Plain LLM" score={r.test.plain} />
            <BigNumber label="Rules only" score={r.test.rules} />
            <BigNumber label="Expert prompt" score={r.test.expert} sub={r.test.expert?.id ?? undefined} />
            <BigNumber
              label={r.test.single ? "Parallel run (A)" : "Ours"}
              score={r.test.best}
              highlight={!r.test.single || selectedId === r.test.best?.id}
              sub={`${r.test.best?.id ?? ""}${selectedId === r.test.best?.id ? " · selected" : ""}`}
            />
            {r.test.single && (
              <BigNumber
                label="Single-agent run (B)"
                score={r.test.single}
                highlight={selectedId === r.test.single.id}
                sub={`${r.test.single.id ?? ""}${selectedId === r.test.single.id ? " · selected" : ""}`}
              />
            )}
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

const fewer = (base: { score: number; max: number }, fin: { score: number; max: number }) => {
  const b = base.max - base.score;
  const f = fin.max - fin.score;
  return b > 0 ? ((b - f) / b) * 100 : null;
};

/** Generic → the evolved strategy picked by training score, on the unseen tests. */
function Headline({ proof }: { proof: Proof | null }) {
  if (!proof) return null;
  const { baseline: b, selected: sel } = proof;
  const red = fewer(b, sel.test);
  const errWord = red === null ? "" : red >= 0 ? `${Math.round(red)}% fewer errors` : `${Math.round(-red)}% more errors`;
  const rows: { label: string; b: string; e: string }[] = [];
  if (b.hard && sel.test.hard) rows.push({ label: "Hard cases", b: `${b.hard.score}/${b.hard.max}`, e: `${sel.test.hard.score}/${sel.test.hard.max}` });
  const rate = (r: number | null, n: number | null) => (r === null ? "—" : `${Math.round(r * 100)}%${n !== null ? ` (${n})` : ""}`);
  rows.push({ label: "Missed danger", b: rate(b.missedRate, b.missed), e: rate(sel.test.missedRate, sel.test.missed) });
  rows.push({ label: "False alarms", b: rate(b.falseAlarmRate, b.falseAlarms), e: rate(sel.test.falseAlarmRate, sel.test.falseAlarms) });
  return (
    <section className="glass glow-accent rounded-2xl p-5 md:p-7">
      <h2 className="text-sm font-bold tracking-widest text-accent uppercase">Generic → evolved on {proof.n || "the"} unseen scenarios</h2>
      <p className="mt-3 text-3xl leading-tight font-black text-white md:text-4xl">
        {b.score} → <span className="text-accent drop-shadow-[0_0_14px_rgba(94,234,212,0.6)]">{sel.test.score}</span>
        {errWord && <span className="text-2xl font-bold text-ink md:text-3xl">, {errWord}</span>}
        {b.hard && sel.test.hard && (
          <span className="text-2xl font-bold text-ink md:text-3xl">
            ; hard cases {b.hard.score} → {sel.test.hard.score}
          </span>
        )}
      </p>
      <p className="mt-2 text-base text-ink-soft">
        Points out of {sel.test.max} · evolved strategy: <span className="font-semibold text-ink">{sel.label}</span>
        {sel.trainMax ? ` · train ${sel.trainScore}/${sel.trainMax}` : ""}
      </p>
      <p className="mt-1 text-sm text-ink-faint">
        {proof.rule}{" "}
        {proof.contenders.length > 1 &&
          `Training scores: ${proof.contenders.map((c) => `${c.label} ${c.trainScore}${c.trainMax ? `/${c.trainMax}` : ""}`).join(", ")}.`}
      </p>
      <table className="mt-5 w-full max-w-xl text-left text-base tabular-nums">
        <thead className="text-sm text-ink-muted">
          <tr>
            <th className="py-1 pr-4 font-semibold">
              <span className="sr-only">Measure</span>
            </th>
            <th className="py-1 pr-4 font-semibold">Generic</th>
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
      <p className="mt-3 text-sm text-ink-faint">
        Scores are points on the unseen test scenarios (errors = points lost). Every run is compared below, including the ones that weren’t selected.{" "}
        <Link href="/evolution" className="font-semibold text-accent underline underline-offset-4">
          Compare the runs →
        </Link>
      </p>
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
      Starting from a generic prompt, the Critic rewrote the strategy {times}
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
