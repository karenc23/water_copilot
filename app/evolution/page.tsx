import { readFile } from "node:fs/promises";
import path from "node:path";
import { Suspense } from "react";
import { connection } from "next/server";
import Evolution from "@/components/agents/Evolution";
import { parseEvolution } from "@/components/evolution-data";
import { Card, PageHeader, Spinner } from "@/components/ui";

const RESULTS_FILE = path.join(process.cwd(), "data", "results.json");

export default function EvolutionPage() {
  return (
    <>
      <PageHeader
        title="Evolution"
        subtitle="How the prompt optimizer improved the Diagnostician: a Critic studies the worst failures, writes new strategies, and the best one survives."
      />
      <Suspense
        fallback={
          <Card>
            <div className="flex items-center gap-3 text-lg text-slate-700">
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
        <p className="text-lg text-slate-700">
          No optimizer results yet. Run <code className="font-mono">npx tsx scripts/optimize.ts</code> to create data/results.json.
        </p>
      </Card>
    );
  }
  return <Evolution data={data} />;
}
