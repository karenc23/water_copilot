import { Suspense } from "react";
import { connection } from "next/server";
import AgentRoom from "@/components/agents/AgentRoom";
import { loadEvolved } from "@/components/evolved-strategy";
import { PageHeader } from "@/components/ui";

export default function TroubleshootPage() {
  return (
    <>
      <PageHeader title="Troubleshoot" subtitle="Describe the problem, and watch the agents work it out." />
      <Suspense fallback={<AgentRoom evolvedId={null} />}>
        <Room />
      </Suspense>
    </>
  );
}

async function Room() {
  // Read per request: the optimizer can update the selected strategy. Only the id is sent to the
  // browser (for the toggle's label); the route loads the full strategy itself.
  await connection();
  const evolved = await loadEvolved();
  return <AgentRoom evolvedId={evolved?.id ?? null} />;
}
