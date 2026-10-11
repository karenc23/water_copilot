import { readFile } from "node:fs/promises";
import path from "node:path";
import { Suspense } from "react";
import { connection } from "next/server";
import Evolution from "@/components/agents/Evolution";
import { parseEvolution } from "@/components/evolution-data";
import { Card, PageHeader, Spinner } from "@/components/ui";

// RESULTS_FILE (env) points at another optimizer output, e.g. for a demo or a test fixture.
const RESULTS_FILE = process.env.RESULTS_FILE || path.join(process.cwd(), "data", "results.json");

export default function EvolutionPage() {
  return (
    <>
      <PageHeader
        title="Agent Evolution"
        subtitle="The Critic studies failures, Explorers try fixes, the Judge scores them, and the best survives."
      />
      <Suspense
        fallback={
          <Card>
            <div className="flex items-center gap-3 text-lg text-ink-soft">
              <Spinner /> Loading results…
            </div>
          </Card>
        }
      >
        <EvolutionContent />
      </Suspense>
    </>
  );
}

async function EvolutionContent() {
  // Read on every request, like /results: the optimizer rewrites this file while it runs.
  await connection();
  let data;
  try {
    data = parseEvolution(JSON.parse(await readFile(RESULTS_FILE, "utf8")));
  } catch {
    data = null;
  }
  if (!data || !data.rounds.length) {
    return (
      <Card>
        <p className="text-lg text-ink-soft">
          No optimizer results yet. Run <code className="font-mono">npx tsx scripts/optimize.ts</code> to create data/results.json.
        </p>
      </Card>
    );
  }
  return <Evolution data={data} />;
}
