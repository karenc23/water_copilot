// The six agents shown in the Agent Room, the story intro and nowhere else. Each one maps to a
// real stage of lib/pipeline.ts: rules (Sentinel, Keeper), manual (Librarian), LLM
// (Diagnostician), safety layer (Governor), drafted escalation message (Courier).

export type AgentId = "sentinel" | "librarian" | "keeper" | "diagnostician" | "governor" | "courier";

export interface AgentMeta {
  id: AgentId;
  name: string;
  role: string;
  /** What it actually is in the code, for the intro. */
  intro: string;
  color: string;
  /** 24×24 stroke icon paths. */
  icon: string[];
}

export const AGENTS: AgentMeta[] = [
  {
    id: "sentinel",
    name: "Sentinel",
    role: "Checks readings against fixed rules",
    intro: "I check every reading and the logbook against fixed EPA-based rules. No AI, no guessing.",
    color: "#fbbf24",
    icon: ["M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z", "M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6Z"],
  },
  {
    id: "librarian",
    name: "Librarian",
    role: "Knows the plant manual by section",
    intro: "I know the plant manual section by section, so every step can cite where it came from.",
    color: "#7dd3fc",
    icon: ["M4 19.5V5a2 2 0 0 1 2-2h14v15H6.5A2.5 2.5 0 0 0 4 20.5 2.5 2.5 0 0 0 6.5 23H20", "M8 7h8M8 11h6"],
  },
  {
    id: "keeper",
    name: "Keeper",
    role: "Remembers the operator logbook",
    intro: "I remember what every operator logged: what broke, what they tried, what worked.",
    color: "#c4b5fd",
    icon: ["M3 12a9 9 0 1 0 2.6-6.4", "M3 4v4.5h4.5", "M12 7.5V12l3 2"],
  },
  {
    id: "diagnostician",
    name: "Diagnostician",
    role: "The AI model: works out what’s wrong",
    intro: "I’m the AI model. I read it all and propose a diagnosis and steps from the manual.",
    color: "#5eead4",
    icon: ["M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z", "M19 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2Z"],
  },
  {
    id: "governor",
    name: "Governor",
    role: "Safety layer with the final say",
    intro: "I check the AI’s answer. I can raise the tier, never lower it, and I strip any dose not in the manual.",
    color: "#e2e8f0",
    icon: ["M12 2.5l8 3v6.2c0 5-3.4 8.4-8 9.8-4.6-1.4-8-4.8-8-9.8V5.5l8-3Z", "M8.5 12l2.5 2.5 4.6-5"],
  },
  {
    id: "courier",
    name: "Courier",
    role: "Drafts the message to the expert",
    intro: "When it’s red, I draft a message for your expert from plant data, not AI. You check it and send it yourself.",
    color: "#fda4af",
    icon: ["M5 3h9l5 5v13H5Z", "M14 3v5h5", "M8.5 13h7M8.5 17h4.5"],
  },
];

export const AGENT: Record<AgentId, AgentMeta> = Object.fromEntries(AGENTS.map((a) => [a.id, a])) as Record<AgentId, AgentMeta>;

/** Tier colors that read on the dark canvas. Always paired with the tier word. */
export const TIER_GLOW = { green: "#4ade80", yellow: "#facc15", red: "#f87171" } as const;

/** Ring layout in a 1000 × 600 SVG canvas (Agent Room and story intro). */
export const RING_POS: Record<AgentId, { x: number; y: number }> = {
  sentinel: { x: 170, y: 285 },
  librarian: { x: 340, y: 118 },
  keeper: { x: 660, y: 118 },
  diagnostician: { x: 830, y: 285 },
  governor: { x: 640, y: 455 },
  courier: { x: 360, y: 455 },
};
