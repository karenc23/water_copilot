// Run a few training scenarios through troubleshoot() and print each result
// next to the expected answer.
//
// Usage: npm run try-scenarios                     (train-01, train-04, train-13)
//        npm run try-scenarios -- train-05 train-18
import { readFileSync } from "node:fs";
import path from "node:path";
import { troubleshoot } from "@/lib/agents";
import type { Scenario } from "@/types";

const DATA_DIR = path.join(process.cwd(), "data");
// Defaults: a routine case, a slow drift (tricky), and a recurring problem that must escalate.
const DEFAULT_IDS = ["train-01", "train-04", "train-13"];

const scenarios: Scenario[] = JSON.parse(
  readFileSync(path.join(DATA_DIR, "scenarios_train.json"), "utf8"),
);
const manual = readFileSync(path.join(DATA_DIR, "manual.md"), "utf8");

const ids = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_IDS;

const sectionsOf = (steps: string[]) =>
  [
    ...new Set(
      steps.flatMap((s) =>
        [...s.matchAll(/\(Manual ([\d., ]+)\)/g)].flatMap((m) => m[1].match(/\d+\.\d+/g) ?? []),
      ),
    ),
  ]
    .sort()
    .join(", ");

async function main() {
  let escalateMatches = 0;
  for (const id of ids) {
    const s = scenarios.find((x) => x.id === id);
    if (!s) {
      console.error(`No scenario ${id}`);
      process.exitCode = 1;
      continue;
    }
    const got = await troubleshoot(s.description, s.readings, s.log_history, manual);
    const match = got.escalate === s.expected.escalate;
    if (match) escalateMatches++;

    console.log(`\n${"=".repeat(80)}\n${s.id}: ${s.description}\n${"=".repeat(80)}`);
    console.log(`\nESCALATE   expected ${s.expected.escalate}  got ${got.escalate}  ${match ? "✓" : "✗"}`);
    console.log(`\nDIAGNOSIS\n  expected: ${s.expected.diagnosis}\n  got:      ${got.diagnosis}`);
    console.log(`\nSTEPS (expected)`);
    for (const k of s.expected.key_steps) console.log(`  - ${k}`);
    console.log(`STEPS (got)`);
    for (const st of got.steps) console.log(`  - ${st.action} (Manual ${st.manual_section ?? "—"})`);
    console.log(
      `\nSECTIONS   expected ${sectionsOf(s.expected.key_steps)}  got ${
        [...new Set(got.steps.map((x) => x.manual_section ?? "—"))].sort().join(", ")
      }`,
    );
    if (got.escalation_message) console.log(`\nESCALATION MESSAGE\n  ${got.escalation_message}`);
    if (got.warnings.length) console.log(`\nWARNINGS\n${got.warnings.map((w) => `  - ${w}`).join("\n")}`);
  }
  console.log(`\nEscalation matched ${escalateMatches}/${ids.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
