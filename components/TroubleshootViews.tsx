"use client";

import { useState } from "react";
import AgentRoom from "@/components/agents/AgentRoom";
import Troubleshoot from "@/components/Troubleshoot";

type View = "agents" | "operator";

const VIEWS: { id: View; label: string }[] = [
  { id: "operator", label: "Operator view" },
  { id: "agents", label: "See the agents think" },
];

/** Toggle between the plain operator form and the Agent Room. Both stay mounted so switching keeps each one's state. */
export default function TroubleshootViews({ initial = "agents" }: { initial?: View }) {
  const [view, setView] = useState<View>(initial);
  return (
    <>
      <div role="tablist" aria-label="Troubleshoot view" className="mb-6 inline-flex rounded-xl bg-slate-200 p-1">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            role="tab"
            type="button"
            aria-selected={view === v.id}
            onClick={() => setView(v.id)}
            className={`min-h-11 rounded-lg px-4 text-base font-semibold transition-colors ${
              view === v.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>
      <div hidden={view !== "agents"}>
        <AgentRoom />
      </div>
      <div hidden={view !== "operator"}>
        <Troubleshoot />
      </div>
    </>
  );
}
