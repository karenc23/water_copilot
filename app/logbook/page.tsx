import { Suspense } from "react";
import { connection } from "next/server";
import AgentBadge from "@/components/agents/AgentBadge";
import LogbookTable from "@/components/LogbookTable";
import { loadLogs } from "@/components/logbook-data";
import { Card, PageHeader, Spinner } from "@/components/ui";

export default function LogbookPage() {
  return (
    <>
      <PageHeader
        title="Keeper’s Memory"
        subtitle="Every problem an operator logged, the steps they took, and how it turned out."
        agent={<AgentBadge id="keeper" state="active" />}
      />
      <Suspense
        fallback={
          <Card>
            <p className="flex items-center gap-3 text-lg text-ink-muted">
              <Spinner /> The Keeper is remembering…
            </p>
          </Card>
        }
      >
        <Entries />
      </Suspense>
    </>
  );
}

async function Entries() {
  // Read on every request: entries are added from Troubleshoot ("Save to logbook").
  await connection();
  const { logs, source } = await loadLogs();
  return (
    <>
      {source === "seed" && (
        <p role="status" className="glass mb-4 rounded-xl px-4 py-3 text-base text-amber-200">
          The logbook database isn’t reachable, so this shows the sample entries. New entries can’t be saved right now.
        </p>
      )}
      <LogbookTable logs={logs} />
    </>
  );
}
