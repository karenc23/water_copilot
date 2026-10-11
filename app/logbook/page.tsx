import logsSeed from "@/data/logs_seed.json";
import type { LogEntry } from "@/types";
import LogbookTable from "@/components/LogbookTable";
import { PageHeader } from "@/components/ui";

const logs = (logsSeed as LogEntry[]).filter((l) => l.plant_id === "plant-a").sort((a, b) => b.date.localeCompare(a.date));

export default function LogbookPage() {
  return (
    <>
      <PageHeader title="Logbook" subtitle="Every problem, the steps taken, and how it turned out." />
      <LogbookTable logs={logs} />
    </>
  );
}
