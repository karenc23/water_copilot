"use client";

import Link from "next/link";
import { useState } from "react";
import type { TroubleshootResponse } from "@/lib/pipeline";
import { Card, Spinner, buttonPrimary, buttonSecondary } from "@/components/ui";

const TRAILING_MANUAL_RE = /\s*\(Manual\s*§?\s*[\d.]+\)\s*$/i;

/** Local date as YYYY-MM-DD (the operator's day, not UTC). */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const field =
  "mt-1 block w-full rounded-lg border border-line-strong bg-glass px-3 py-2.5 text-lg text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none";

/**
 * Records what the operator actually did as a logbook entry (POST /api/logs → MongoDB). The Logbook page
 * and the handbook read from MongoDB. Nothing is saved until they submit.
 */
export default function SaveToLogbook({ description, result }: { description: string; result: TroubleshootResponse }) {
  const [open, setOpen] = useState(false);
  const [operator, setOperator] = useState("");
  const [problem, setProblem] = useState(description);
  const [steps, setSteps] = useState("");
  const [outcome, setOutcome] = useState("");
  const [escalated, setEscalated] = useState(result.tier === "red");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const stepList = steps.split("\n").map((s) => s.trim()).filter(Boolean);
    if (!operator.trim() || !problem.trim() || !outcome.trim()) {
      setError("Please fill in your name, the problem and how it turned out.");
      return;
    }
    setError(null);
    setState("saving");
    try {
      const res = await fetch("/api/logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plant_id: "plant-a",
          date: today(),
          operator: operator.trim(),
          problem: problem.trim(),
          steps_taken: stepList,
          outcome: outcome.trim(),
          escalated,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? `Couldn’t save (${res.status}). Try again.`);
        setState("idle");
      } else {
        setState("saved");
      }
    } catch {
      setError("Could not reach the server. Your entry was not saved.");
      setState("idle");
    }
  }

  if (state === "saved") {
    return (
      <Card className="glow-accent">
        <p className="text-xl font-bold text-ink">Saved to the Keeper’s memory</p>
        <p className="mt-1 text-lg text-ink-soft">It’s in the logbook now, and the next handbook the Keeper writes will include it.</p>
        <Link href="/logbook" className="mt-3 inline-block text-lg font-semibold text-accent underline underline-offset-4">
          Open the logbook →
        </Link>
      </Card>
    );
  }

  if (!open) {
    return (
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xl font-bold text-ink">Write it in the logbook</p>
            <p className="text-base text-ink-muted">Record what you did and how it turned out (Manual §1.3).</p>
          </div>
          <button type="button" className={buttonPrimary} onClick={() => setOpen(true)}>
            Save to logbook
          </button>
        </div>
      </Card>
    );
  }

  return (
    <Card title="Save to logbook">
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="grid gap-4 md:grid-cols-[1fr_2fr]">
          <label className="text-base font-semibold text-ink-soft">
            Your name
            <input className={field} value={operator} onChange={(e) => setOperator(e.target.value)} placeholder="e.g. Sam" autoComplete="name" />
          </label>
          <label className="text-base font-semibold text-ink-soft">
            Problem
            <input className={field} value={problem} onChange={(e) => setProblem(e.target.value)} />
          </label>
        </div>
        <label className="text-base font-semibold text-ink-soft">
          Steps you actually took <span className="font-normal text-ink-faint">(one per line)</span>
          <textarea className={field} rows={4} value={steps} onChange={(e) => setSteps(e.target.value)} placeholder="e.g. Backwashed filter 2" />
        </label>
        {result.steps.length > 0 && (
          <button
            type="button"
            className="-mt-2 justify-self-start text-base font-semibold text-accent underline underline-offset-4"
            onClick={() => setSteps(result.steps.map((s) => s.action.replace(TRAILING_MANUAL_RE, "")).join("\n"))}
          >
            Start from the recommended steps
          </button>
        )}
        <label className="text-base font-semibold text-ink-soft">
          How it turned out
          <input className={field} value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="e.g. Turbidity back to 0.12 NTU after 1 hour" />
        </label>
        <label className="flex min-h-12 items-center gap-3 text-lg text-ink">
          <input type="checkbox" checked={escalated} onChange={(e) => setEscalated(e.target.checked)} className="size-6 accent-teal-400" />
          I escalated to the Remote Maintenance Worker
        </label>
        {error && (
          <p role="alert" className="rounded-lg border border-red-400/60 bg-red-500/15 px-4 py-3 text-base text-red-100">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <button type="submit" className={buttonPrimary} disabled={state === "saving"}>
            {state === "saving" ? (
              <>
                <Spinner /> Saving…
              </>
            ) : (
              "Save entry"
            )}
          </button>
          <button type="button" className={buttonSecondary} onClick={() => setOpen(false)}>
            Cancel
          </button>
        </div>
      </form>
    </Card>
  );
}
