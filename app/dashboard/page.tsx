import Link from "next/link";
import readingsSeed from "@/data/readings_seed.json";
import logsSeed from "@/data/logs_seed.json";
import { checkLogs, checkReadings } from "@/lib/rules";
import type { LogEntry, Reading } from "@/types";
import ReadingsCharts from "@/components/ReadingsCharts";
import { AlertList, PARAMETERS, RuleBadge, TIER_STYLE, TierIcon, readingTier, type Parameter } from "@/components/tier";
import { Card, PageHeader, formatDate } from "@/components/ui";

const PLANT_ID = "plant-a";

// Seed files are the data source until MongoDB is live (same as /api/troubleshoot).
const readings = (readingsSeed as Reading[]).filter((r) => r.plant_id === PLANT_ID).sort((a, b) => a.date.localeCompare(b.date));
const logs = (logsSeed as LogEntry[]).filter((l) => l.plant_id === PLANT_ID).sort((a, b) => b.date.localeCompare(a.date));

export default function DashboardPage() {
  const latest = readings.at(-1);
  // "Today" for the rules is the latest reading, matching lib/pipeline.
  const alerts = [...checkReadings(readings), ...checkLogs(logs, latest?.date ?? logs[0]?.date)];

  return (
    <>
      <PageHeader title="Dashboard" subtitle={latest ? `Latest reading: ${formatDate(latest.date)}` : "No readings yet"} />

      {latest && (
        <div className="grid gap-4 sm:grid-cols-3">
          {(["chlorine", "turbidity", "ph"] as const).map((p) => (
            <ReadingCard key={p} parameter={p} value={latest[p]} previous={readings.at(-2)?.[p]} />
          ))}
        </div>
      )}

      <Card title="Active alerts" aside={<RuleBadge />} className="mt-6">
        <AlertList alerts={alerts} empty="No active alerts. Everything is within limits." />
        {alerts.length > 0 && (
          <Link href="/troubleshoot" className="mt-4 inline-block text-base font-semibold text-blue-800 underline underline-offset-4">
            Troubleshoot this →
          </Link>
        )}
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <Card title="Last 30 days" className="lg:col-span-3">
          <ReadingsCharts readings={readings.slice(-30)} />
        </Card>

        <div className="lg:col-span-2">
          <Card title="Recent logbook" aside={<Link href="/logbook" className="text-base font-semibold text-blue-800 underline underline-offset-4">All entries</Link>}>
            <ul className="divide-y divide-slate-200">
              {logs.slice(0, 5).map((l, i) => (
                <li key={i} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                    <span className="font-semibold text-slate-800">{formatDate(l.date)}</span>
                    <span>· {l.operator}</span>
                    {l.escalated && <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs font-semibold text-white">Escalated</span>}
                  </div>
                  <p className="mt-0.5 text-base font-medium text-slate-900">{l.problem}</p>
                  <p className="mt-0.5 text-sm text-slate-600">{l.outcome}</p>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}

function ReadingCard({ parameter, value, previous }: { parameter: Parameter; value: number; previous?: number }) {
  const tier = readingTier(parameter, value);
  const s = TIER_STYLE[tier];
  const meta = PARAMETERS[parameter];
  const delta = previous === undefined ? null : Math.round((value - previous) * 100) / 100;
  return (
    <div className={`rounded-xl border-2 bg-white p-5 shadow-sm ${s.border}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-lg font-semibold text-slate-800">{meta.name}</span>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-sm font-bold ${s.solid}`}>
          <TierIcon tier={tier} className="size-4" />
          {s.label.toUpperCase()}
        </span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className={`text-5xl font-black tabular-nums ${tier === "green" ? "text-slate-900" : s.text}`}>{value}</span>
        <span className="text-xl text-slate-600">{meta.unit}</span>
      </div>
      <div className="mt-2 text-sm text-slate-600">
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
