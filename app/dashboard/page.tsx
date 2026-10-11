import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import readingsSeed from "@/data/readings_seed.json";
import logsSeed from "@/data/logs_seed.json";
import { checkLogs, checkReadings } from "@/lib/rules";
import type { LogEntry, Reading } from "@/types";
import AgentBadge from "@/components/agents/AgentBadge";
import { loadLogs } from "@/components/logbook-data";
import ReadingsCharts from "@/components/ReadingsCharts";
import { AlertList, PARAMETERS, RuleBadge, TIER_STYLE, TierIcon, readingTier, type Parameter } from "@/components/tier";
import { Card, PageHeader, Spinner, buttonPrimary, formatDate } from "@/components/ui";

const PLANT_ID = "plant-a";

// Readings and alerts use the seed files, the same data the troubleshoot pipeline checks.
// The recent-logbook panel reads the live logbook (MongoDB).
const readings = (readingsSeed as Reading[]).filter((r) => r.plant_id === PLANT_ID).sort((a, b) => a.date.localeCompare(b.date));
const seedLogs = (logsSeed as LogEntry[]).filter((l) => l.plant_id === PLANT_ID).sort((a, b) => b.date.localeCompare(a.date));

export default function DashboardPage() {
  const latest = readings.at(-1);
  // "Today" for the rules is the latest reading, matching lib/pipeline.
  const alerts = [...checkReadings(readings), ...checkLogs(seedLogs, latest?.date ?? seedLogs[0]?.date)];
  const worst = alerts.some((a) => a.tier === "red") ? "red" : alerts.length ? "yellow" : "green";

  return (
    <>
      <PageHeader
        title="Plant Status"
        subtitle={<>Today’s readings and alerts, reported by the Sentinel{latest ? ` · latest reading ${formatDate(latest.date)}` : ""}</>}
        agent={<AgentBadge id="sentinel" state="active" />}
      >
        <Link href="/troubleshoot" className={buttonPrimary}>
          Ask the agents →
        </Link>
      </PageHeader>

      <div className="glass mb-6 rounded-2xl rounded-tl-sm border-l-4 border-l-amber-300/80 p-5">
        <p className="text-sm font-bold tracking-widest text-amber-300 uppercase">Sentinel’s report</p>
        <p className="mt-1 text-lg leading-relaxed text-ink">
          I checked {readings.length} days of readings and the logbook against the fixed safety rules.{" "}
          {alerts.length === 0
            ? "Everything is within limits."
            : `${alerts.length} ${alerts.length === 1 ? "thing needs" : "things need"} your attention${worst === "red" ? ", and one is an emergency" : ""}.`}
        </p>
      </div>

      {latest && (
        <div className="grid gap-4 sm:grid-cols-3">
          {(["chlorine", "turbidity", "ph"] as const).map((p) => (
            <ReadingCard key={p} parameter={p} value={latest[p]} previous={readings.at(-2)?.[p]} />
          ))}
        </div>
      )}

      <Card title="What I flagged" aside={<RuleBadge />} className="mt-6">
        <AlertList alerts={alerts} empty="No active alerts. Everything is within limits." />
        {alerts.length > 0 && (
          <Link href="/troubleshoot" className="mt-4 inline-block text-base font-semibold text-accent underline underline-offset-4">
            Ask the agents what to do →
          </Link>
        )}
      </Card>

      <div className="mt-6 grid gap-6 xl:grid-cols-5">
        <Card
          title="Last 30 days"
          className="xl:col-span-3"
          aside={
            <Link href="/readings" className="text-base font-semibold text-accent underline underline-offset-4">
              All readings
            </Link>
          }
        >
          <ReadingsCharts readings={readings.slice(-30)} />
        </Card>

        <div className="xl:col-span-2">
          <Card
            title={
              <span className="flex items-center gap-2">
                <AgentBadge id="keeper" className="size-9" /> From the Keeper’s memory
              </span>
            }
            aside={
              <Link href="/logbook" className="text-base font-semibold text-accent underline underline-offset-4">
                All entries
              </Link>
            }
          >
            <Suspense
              fallback={
                <p className="flex items-center gap-2 text-base text-ink-muted">
                  <Spinner className="size-5" /> Loading the logbook…
                </p>
              }
            >
              <RecentLogs />
            </Suspense>
          </Card>
        </div>
      </div>
    </>
  );
}

async function RecentLogs() {
  await connection();
  const { logs } = await loadLogs();
  return (
    <ul className="divide-y divide-line">
      {logs.slice(0, 5).map((l, i) => (
        <li key={i} className="py-3 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            <span className="font-semibold text-ink">{formatDate(l.date)}</span>
            <span>· {l.operator}</span>
            {l.escalated && <span className="rounded bg-red-600 px-1.5 py-0.5 text-xs font-semibold text-white">Escalated</span>}
          </div>
          <p className="mt-0.5 text-base font-medium text-ink">{l.problem}</p>
          <p className="mt-0.5 text-sm text-ink-muted">{l.outcome}</p>
        </li>
      ))}
    </ul>
  );
}

function ReadingCard({ parameter, value, previous }: { parameter: Parameter; value: number; previous?: number }) {
  const tier = readingTier(parameter, value);
  const s = TIER_STYLE[tier];
  const meta = PARAMETERS[parameter];
  const delta = previous === undefined ? null : Math.round((value - previous) * 100) / 100;
  return (
    <div className={`glass rounded-2xl border-2 p-5 ${s.border}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-lg font-semibold whitespace-nowrap text-ink">{meta.name}</span>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-sm font-bold ${s.solid}`}>
          <TierIcon tier={tier} className="size-4" />
          {s.label.toUpperCase()}
        </span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className={`text-5xl font-black tabular-nums ${tier === "green" ? "text-ink" : s.text}`}>{value}</span>
        <span className="text-xl text-ink-muted">{meta.unit}</span>
      </div>
      <div className="mt-2 text-sm text-ink-muted">
        {meta.normal}
        {delta !== null && (
          <span className="block">
            {delta === 0 ? "No change" : `${delta > 0 ? "▲ +" : "▼ "}${delta}`} since previous reading
          </span>
        )}
      </div>
    </div>
  );
}
