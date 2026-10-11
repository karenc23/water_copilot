import readingsSeed from "@/data/readings_seed.json";
import type { Reading } from "@/types";
import AgentBadge from "@/components/agents/AgentBadge";
import ReadingsCharts from "@/components/ReadingsCharts";
import { PARAMETERS, TIER_STYLE, TierIcon, readingTier, type Parameter } from "@/components/tier";
import { Card, PageHeader, formatDate } from "@/components/ui";

// Same data the Sentinel checks on the Dashboard and in Troubleshoot.
const readings = (readingsSeed as Reading[]).filter((r) => r.plant_id === "plant-a").sort((a, b) => b.date.localeCompare(a.date));

export default function ReadingsPage() {
  return (
    <>
      <PageHeader title="Readings" subtitle="Daily chlorine, turbidity and pH, as the Sentinel sees them." agent={<AgentBadge id="sentinel" />} />
      <Card title="Last 30 days">
        <ReadingsCharts readings={readings.slice(0, 30)} />
      </Card>
      <Card title="Every reading" className="mt-6">
        <div className="overflow-x-auto">
          <table className="w-full min-w-md text-left text-lg tabular-nums">
            <thead>
              <tr className="border-b border-line-strong text-sm tracking-wide text-ink-muted uppercase">
                <th className="py-2 pr-4 font-semibold">Date</th>
                {(["chlorine", "turbidity", "ph"] as const).map((p) => (
                  <th key={p} className="py-2 pr-4 font-semibold">
                    {PARAMETERS[p].name}
                    {PARAMETERS[p].unit && ` (${PARAMETERS[p].unit})`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {readings.map((r) => (
                <tr key={r.date} className="border-b border-line">
                  <td className="py-2 pr-4 text-ink-soft">{formatDate(r.date)}</td>
                  <Cell parameter="chlorine" value={r.chlorine} />
                  <Cell parameter="turbidity" value={r.turbidity} />
                  <Cell parameter="ph" value={r.ph} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

function Cell({ parameter, value }: { parameter: Parameter; value: number }) {
  const tier = readingTier(parameter, value);
  const s = TIER_STYLE[tier];
  return (
    <td className="py-2 pr-4">
      <span className={`inline-flex items-center gap-1.5 font-semibold ${tier === "green" ? "text-ink" : s.text}`}>
        {tier !== "green" && <TierIcon tier={tier} className="size-4" />}
        {value}
        {tier !== "green" && <span className="sr-only">({s.label})</span>}
      </span>
    </td>
  );
}
