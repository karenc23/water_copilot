// Run a few training scenarios through the full troubleshoot pipeline
// (rules → LLM → safety) and print each result next to the expected answer.
//
// Usage: npm run try-scenarios                     (train-01, train-04, train-13)
//        npm run try-scenarios -- train-05 train-18
import { readFileSync } from "node:fs";
import path from "node:path";
import { runTroubleshoot } from "@/lib/pipeline";
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
  const results: { id: string; ms: number; match: boolean }[] = [];
  for (const id of ids) {
    const s = scenarios.find((x) => x.id === id);
    if (!s) {
      console.error(`No scenario ${id}`);
      process.exitCode = 1;
      continue;
    }
    console.log(`\n${"=".repeat(80)}\n${s.id}: ${s.description}\n${"=".repeat(80)}`);
    const started = Date.now();
    const got = await runTroubleshoot({
      plant_id: s.readings[0]?.plant_id ?? "plant-a",
      description: s.description,
      readings: s.readings,
      logs: s.log_history,
      manualText: manual,
    });
    const ms = Date.now() - started;
    const match = got.escalate === s.expected.escalate;
    results.push({ id, ms, match });

    console.log(`\nTIME       ${(ms / 1000).toFixed(1)} s`);
    console.log(`ESCALATE   expected ${s.expected.escalate}  got ${got.escalate} (tier ${got.tier})  ${match ? "✓" : "✗"}`);
    console.log(`FAILURE    ${got.failure_mode ?? "—"}`);
    if (got.alerts.length) {
      console.log(`ALERTS`);
      for (const a of got.alerts) console.log(`  - [${a.tier}] ${a.rule_id}: ${a.message} (Manual ${a.manual_section})`);
    }
    console.log(`\nDIAGNOSIS\n  expected: ${s.expected.diagnosis}\n  got:      ${got.diagnosis}`);
    console.log(`\nSTEPS (expected)`);
    for (const k of s.expected.key_steps) console.log(`  - ${k}`);
    console.log(`STEPS (got)`);
    for (const st of got.steps) {
      const tag = st.source === "safety" ? " [safety]" : "";
      const flags = st.flags.length ? `  {${st.flags.join("; ")}}` : "";
      console.log(`  - ${st.action} (Manual ${st.manual_section})${tag}${flags}`);
    }
    console.log(
      `\nSECTIONS   expected ${sectionsOf(s.expected.key_steps)}  got ${[...new Set(got.steps.map((x) => x.manual_section))].sort().join(", ")}`,
    );
    if (got.warnings.length) console.log(`\nWARNINGS\n${got.warnings.map((w) => `  - ${w}`).join("\n")}`);
    if (got.escalation_packet) {
      console.log(`\nESCALATION PACKET\n${got.escalation_packet.message.replace(/^/gm, "  | ")}`);
    }
  }
  console.log(`\n${"-".repeat(40)}`);
  for (const r of results) console.log(`${r.id.padEnd(10)} ${(r.ms / 1000).toFixed(1).padStart(6)} s  escalate ${r.match ? "✓" : "✗"}`);
  const total = results.reduce((n, r) => n + r.ms, 0);
  console.log(
    `Escalation matched ${results.filter((r) => r.match).length}/${results.length} · ` +
      `avg ${(total / Math.max(results.length, 1) / 1000).toFixed(1)} s per scenario`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
