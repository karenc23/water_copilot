"use client";

import { AgentOrb, type OrbState } from "@/components/agents/AgentOrb";
import { AGENT, type AgentId } from "@/components/agents/meta";

/** One agent orb on its own, for page headers. */
export default function AgentBadge({ id, state = "done", className = "size-20" }: { id: AgentId; state?: OrbState; className?: string }) {
  return (
    <svg viewBox="-80 -80 160 160" className={`shrink-0 overflow-visible ${className}`} role="img" aria-label={`${AGENT[id].name}: ${AGENT[id].role}`}>
      <AgentOrb agent={AGENT[id]} x={0} y={0} r={30} state={state} labels={false} wakeKey={id} />
    </svg>
  );
}
