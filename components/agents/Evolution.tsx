"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import Aurora from "@/components/agents/Aurora";
import type {
  AgentRun,
  EvoRound,
  EvoStrategy,
  Evolution as EvolutionData,
  FixStatus,
  Outcome,
  ParallelComparison,
  ScenarioCard,
  TestRow,
} from "@/components/evolution-data";

// Generations left to right, driven entirely by data/results.json:
// round 0's single generic strategy → for each later round, the Critic pulls in the parent's
// worst-scored training scenarios and writes 3 children; the round's best survives.

const W = 1000;
const H = 480;
const ORB = 28;
const TEAL = "#5eead4";
const GENERIC = "#94a3b8";
const CRITIC = "#f0abfc";

type Step =
  | { kind: "gen0" }
  | { kind: "critic" | "cards" | "spawn" | "scores" | "select"; r: number }
  | { kind: "test" };

const PHASES = ["critic", "cards", "spawn", "scores", "select"] as const;

const fmt = (o: Outcome) => [o.tier?.toUpperCase(), o.failure_mode].filter(Boolean).join(" ") || "?";

function duration(s: Step, data: EvolutionData): number {
  switch (s.kind) {
    case "gen0":
      return 2400;
    case "critic":
      return 1300;
    case "cards":
      return 900 + 380 * data.rounds[s.r].worst.length + 1200;
    case "spawn":
      return 1700;
    case "scores":
      return 1700;
    case "select":
      return 2300;
    default:
      return 0;
  }
}

export default function Evolution({ data }: { data: EvolutionData }) {
  const { rounds } = data;
  const steps = useMemo<Step[]>(
    () => [{ kind: "gen0" }, ...rounds.slice(1).flatMap((rd) => PHASES.map((kind) => ({ kind, r: rd.round }) as Step)), { kind: "test" }],
    [rounds],
  );
  const [step, setStep] = useState(0);
  const [wantPlaying, setPlaying] = useState(true);
  const [selected, setSelected] = useState<EvoStrategy | null>(null);
  const [hoverPoint, setHoverPoint] = useState<number | null>(null);

  const atEnd = step >= steps.length - 1;
  const playing = wantPlaying && !atEnd;

  useEffect(() => {
    if (!playing || selected) return;
    const id = setTimeout(() => setStep((s) => s + 1), duration(steps[step], data));
    return () => clearTimeout(id);
  }, [playing, selected, step, steps, data]);

  const idx = (kind: Step["kind"], r?: number) => steps.findIndex((s) => s.kind === kind && (r === undefined || ("r" in s && s.r === r)));
  const reached = (kind: Step["kind"], r?: number) => {
    const i = idx(kind, r);
    return i !== -1 && step >= i;
  };
  const cur = steps[step];

  // Layout: one column per generation.
  const gens = rounds.length;
  const colX = (g: number) => 80 + (g * (W - 160)) / Math.max(1, gens - 1);
  const ys = (n: number) => (n === 1 ? [255] : Array.from({ length: n }, (_, i) => 120 + (i * 270) / (n - 1)));
  const pos = new Map<string, { x: number; y: number }>();
  rounds.forEach((rd, g) => rd.strategies.forEach((s, i) => pos.set(s.id, { x: colX(g), y: ys(rd.strategies.length)[i] })));
  const all = rounds.flatMap((rd) => rd.strategies);
  const byId = new Map(all.map((s) => [s.id, s]));

  const trainMax = data.trainMax;

  // Best-so-far line, one point per generation.
  const points = rounds.flatMap((rd, g) => {
    const best = rd.bestId ? byId.get(rd.bestId) : undefined;
    return best ? [{ g, x: colX(g), score: best.score, id: best.id, hit: rd.hitRate, shown: g === 0 ? reached("gen0") : reached("select", rd.round) }] : [];
  });

  const caption = captionFor(cur, data, byId);
  // The round the details panel describes: the one being animated (the last one at the end).
  const detailRound = "r" in cur ? rounds.find((x) => x.round === cur.r) ?? null : cur.kind === "test" ? rounds.at(-1) ?? null : null;
  const detailReveal = !detailRound ? 0 : cur.kind === "test" || reached("select", detailRound.round) ? 3 : reached("scores", detailRound.round) ? 2 : reached("spawn", detailRound.round) ? 1 : 0;
  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl bg-[#040a17] text-white shadow-xl ring-1 ring-white/10">
        <Aurora />

        <div className="relative z-10 flex flex-wrap items-center gap-3 border-b border-white/10 p-4">
          <button
            type="button"
            onClick={() => {
              if (atEnd) setStep(0);
              setPlaying(atEnd ? true : !playing);
            }}
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-teal-300 px-5 text-base font-bold text-[#04121f] hover:bg-teal-200"
          >
            {playing ? (
              <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden>
                <path d="M7 5h4v14H7zM13 5h4v14h-4z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden>
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
            {playing ? "Pause" : atEnd ? "Play again" : "Play"}
          </button>
          <button
            type="button"
            onClick={() => {
              setStep(0);
              setPlaying(true);
            }}
            className="min-h-11 rounded-full border border-white/25 px-4 text-sm font-semibold hover:bg-white/10"
          >
            Restart
          </button>
          {!atEnd && (
            <button
              type="button"
              onClick={() => {
                setStep(steps.length - 1);
                setPlaying(false);
              }}
              className="min-h-11 rounded-full border border-white/25 px-4 text-sm font-semibold hover:bg-white/10"
            >
              Jump to the end
            </button>
          )}
          <div className="min-w-0 flex-1 basis-64" aria-live="polite">
            <AnimatePresence mode="wait">
              <motion.p
                key={step}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="text-base text-slate-200"
              >
                {caption}
              </motion.p>
            </AnimatePresence>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
            <motion.div className="h-full bg-teal-300" animate={{ width: `${(step / Math.max(1, steps.length - 1)) * 100}%` }} transition={{ duration: 0.5 }} />
          </div>
        </div>

        {/* Generations */}
        <div className="relative z-10">
          <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Prompt strategies evolving over rounds">
            {rounds.map((rd, g) => (
              <text key={rd.round} x={colX(g)} y={34} textAnchor="middle" fontSize={15} fontWeight={600} fill="#cbd5e1" letterSpacing={1.5}>
                ROUND {rd.round}
              </text>
            ))}

            {rounds.slice(1).map((rd, i) => {
              const g = i + 1;
              const cx = (colX(g - 1) + colX(g)) / 2;
              const cy = 120;
              const parent = rd.parentId ? pos.get(rd.parentId) : undefined;
              const showCritic = reached("critic", rd.round);
              // Cards come in for the critic, leave while children spawn, and return with their
              // outcome once the survivor is picked (until the next round starts).
              const reviewing = reached("select", rd.round) && !reached("critic", rd.round + 1) && !reached("test");
              const showCards = (reached("cards", rd.round) && !reached("spawn", rd.round)) || reviewing;
              const fixes = new Map(rd.fixes.map((f) => [f.id, f]));
              const spawned = reached("spawn", rd.round);
              const scored = reached("scores", rd.round);
              const selectedNow = reached("select", rd.round);
              return (
                <g key={rd.round}>
                  {showCritic && parent && (
                    <motion.path
                      d={`M${parent.x} ${parent.y} Q${(parent.x + cx) / 2} ${Math.min(parent.y, cy) - 30} ${cx} ${cy}`}
                      fill="none"
                      stroke={CRITIC}
                      strokeOpacity={selectedNow ? 0.18 : 0.45}
                      strokeWidth={1.5}
                      strokeDasharray="4 6"
                      initial={{ pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ duration: 0.8 }}
                    />
                  )}
                  {/* Lineage: parent → child, bending through the Critic that wrote it. */}
                  {spawned &&
                    rd.strategies.map((s) => {
                      const p = pos.get(s.id)!;
                      const from = (s.parentId && pos.get(s.parentId)) || { x: cx, y: cy };
                      const win = selectedNow && rd.bestId === s.id;
                      return (
                        <motion.path
                          key={s.id}
                          d={`M${from.x} ${from.y} Q${cx} ${cy} ${p.x} ${p.y}`}
                          fill="none"
                          stroke={TEAL}
                          strokeWidth={win ? 2.5 : 1.5}
                          initial={{ pathLength: 0, opacity: 0.6 }}
                          animate={{ pathLength: 1, opacity: selectedNow ? (win ? 0.8 : 0.08) : 0.45 }}
                          transition={{ duration: 0.9 }}
                        />
                      );
                    })}

                  <AnimatePresence>
                    {showCritic && (
                      <motion.g
                        key="critic"
                        initial={{ opacity: 0, scale: 0.4 }}
                        animate={{ opacity: selectedNow ? 0.4 : 1, scale: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ type: "spring", stiffness: 200, damping: 18 }}
                        style={{ transformOrigin: `${cx}px ${cy}px` }}
                      >
                        <circle cx={cx} cy={cy} r={50} fill={CRITIC} opacity={0.12} />
                        <circle cx={cx} cy={cy} r={22} fill={CRITIC} opacity={0.9} />
                        <circle cx={cx - 6} cy={cy - 7} r={7} fill="#fff" opacity={0.7} />
                        <text x={cx} y={cy - 32} textAnchor="middle" fontSize={14} fontWeight={700} fill={CRITIC}>
                          Critic
                        </text>
                      </motion.g>
                    )}
                  </AnimatePresence>

                  <AnimatePresence>
                    {showCards &&
                      rd.worst.map((c, k) => (
                        <ScenarioChip
                          key={`${rd.round}-${c.id}-${reviewing ? "after" : "before"}`}
                          card={c}
                          fix={reviewing ? fixes.get(c.id) : undefined}
                          from={reviewing ? { x: cx, y: 190 + k * 50 } : (parent ?? { x: cx, y: cy })}
                          to={{ x: cx, y: 190 + k * 50 }}
                          delay={reviewing ? 0.5 + k * 0.15 : 0.15 + k * 0.38}
                        />
                      ))}
                  </AnimatePresence>

                  {spawned &&
                    rd.strategies.map((s, k) => (
                      <StrategyOrb
                        key={s.id}
                        s={s}
                        from={{ x: cx, y: cy }}
                        at={pos.get(s.id)!}
                        delay={k * 0.18}
                        showScore={scored}
                        state={!selectedNow ? "live" : rd.bestId === s.id ? "winner" : "loser"}
                        max={trainMax}
                        onOpen={() => setSelected(s)}
                      />
                    ))}
                </g>
              );
            })}

            {rounds[0]?.strategies.map((s) => (
              <StrategyOrb
                key={s.id}
                s={s}
                from={pos.get(s.id)!}
                at={pos.get(s.id)!}
                delay={0.2}
                showScore
                state={rounds[1] && reached("select", rounds[1].round) && rounds[1].bestId !== s.id ? "retired" : "winner"}
                color={GENERIC}
                max={trainMax}
                onOpen={() => setSelected(s)}
              />
            ))}
          </svg>
          <p className="px-4 pb-2 text-center text-sm text-ink-faint">Click any strategy orb to read its full prompt.</p>
        </div>

        <RoundDetails round={detailRound} reveal={detailReveal} onOpen={setSelected} />

        {/* Score line */}
        <ScoreLine
          points={points}
          trainMax={trainMax}
          expert={data.expertTrain}
          hover={hoverPoint}
          setHover={setHoverPoint}
        />
      </div>

      <AnimatePresence>
        {reached("test") && data.test.length > 0 && (
          <motion.section
            key="test"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ type: "spring", stiffness: 110, damping: 20 }}
          >
            <TestComparison rows={data.test} count={data.testCount} />
          </motion.section>
        )}
      </AnimatePresence>

      {data.parallel && <ParallelPanel c={data.parallel} />}

      <PromptPanel s={selected} max={trainMax} onClose={() => setSelected(null)} />
    </div>
  );
}

function captionFor(s: Step, data: EvolutionData, byId: Map<string, EvoStrategy>): string {
  const r0 = data.rounds[0]?.strategies[0];
  const of = data.trainMax ? ` / ${data.trainMax}` : "";
  switch (s.kind) {
    case "gen0":
      return r0 ? `Round 0: one deliberately generic prompt, “${r0.prompt ?? r0.id}”, scores ${r0.score}${of} on the training scenarios.` : "Round 0";
    case "test":
      return `Final exam: ${data.testCount ?? "the"} test scenarios no strategy ever saw.`;
  }
  const rd = data.rounds.find((x) => x.round === s.r)!;
  const parent = rd.parentId ? byId.get(rd.parentId) : undefined;
  switch (s.kind) {
    case "critic":
      return `Round ${rd.round}: the Critic studies ${parent?.id ?? "the current best"}, the best strategy so far.`;
    case "cards":
      return rd.worst.length
        ? `It pulls in ${parent?.id ?? "its"}’s ${rd.worst.length} worst-scored scenarios: what was expected vs. what it got.`
        : "No failed scenarios to learn from.";
    case "spawn":
      return `It writes ${rd.strategies.length} new strategies, each a different fix.`;
    case "scores":
      return `Each child is scored on the same training scenarios.`;
    case "select": {
      const best = rd.bestId ? byId.get(rd.bestId) : undefined;
      if (!best) return "No strategy qualified this round.";
      if (best.round !== rd.round) return `No child beat ${best.id} (${best.score}${of}); it survives.`;
      const delta = parent ? best.score - parent.score : null;
      const fixed = rd.fixes.filter((f) => f.status === "fixed" || f.status === "improved").length;
      const hit = rd.fixes.length ? ` It fixed or improved ${fixed} of ${rd.fixes.length} targeted scenarios.` : "";
      return `${best.id} survives with ${best.score}${of}${delta !== null ? ` (${delta >= 0 ? "+" : ""}${delta})` : ""}.${hit}`;
    }
  }
}

const FIX_LABEL: Record<FixStatus, string> = { fixed: "✓ fixed", improved: "↑ improved", same: "= no change", worse: "↓ worse", unknown: "not scored" };
const FIX_COLOR: Record<FixStatus, string> = { fixed: TEAL, improved: "#7dd3fc", same: "#aab7c9", worse: "#fcd34d", unknown: "#aab7c9" };

function ScenarioChip({
  card,
  fix,
  from,
  to,
  delay,
}: {
  card: ScenarioCard;
  /** Set once the survivor is picked: how this targeted scenario did next. */
  fix?: EvoRound["fixes"][number];
  from: { x: number; y: number };
  to: { x: number; y: number };
  delay: number;
}) {
  const w = 200;
  const h = 42;
  const color = fix ? FIX_COLOR[fix.status] : CRITIC;
  const good = fix && (fix.status === "fixed" || fix.status === "improved");
  return (
    <motion.g
      initial={{ x: from.x - w / 2, y: from.y - h / 2, opacity: 0, scale: fix ? 0.95 : 0.5 }}
      animate={{ x: to.x - w / 2, y: to.y - h / 2, opacity: fix && !good ? 0.7 : 1, scale: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.4 } }}
      transition={{ duration: fix ? 0.5 : 0.9, delay, ease: [0.3, 0, 0.2, 1] }}
    >
      {good && <rect x={-4} y={-4} width={w + 8} height={h + 8} rx={11} fill={color} opacity={0.18} />}
      <rect width={w} height={h} rx={8} fill="#0b1426" fillOpacity={0.94} stroke={color} strokeOpacity={good ? 1 : 0.6} strokeWidth={good ? 2 : 1} />
      <text x={10} y={17} fontSize={13} fontWeight={700} fill="#fff">
        {card.id}
        {card.hard ? " · hard" : ""}
      </text>
      <text x={w - 10} y={17} fontSize={13} textAnchor="end" fill={fix ? color : "#cbd5e1"} fontWeight={fix ? 700 : 400}>
        {fix && fix.after !== null ? `${fix.before}→${fix.after}/${fix.max}` : `${card.score}/${card.max}`}
      </text>
      <text x={10} y={34} fontSize={12} fill={fix ? color : "#cbd5e1"}>
        {fix ? `${FIX_LABEL[fix.status]} in the survivor` : `exp ${fmt(card.expected)} → got ${fmt(card.got)}`}
      </text>
    </motion.g>
  );
}

function StrategyOrb({
  s,
  from,
  at,
  delay,
  showScore,
  state,
  color = TEAL,
  max,
  onOpen,
}: {
  s: EvoStrategy;
  from: { x: number; y: number };
  at: { x: number; y: number };
  delay: number;
  showScore: boolean;
  state: "live" | "winner" | "loser" | "retired";
  color?: string;
  max: number | null;
  onOpen: () => void;
}) {
  const scale = state === "winner" ? 1.35 : 1;
  const opacity = state === "loser" ? 0.2 : state === "retired" ? 0.55 : 1;
  return (
    <motion.g
      role="button"
      tabIndex={0}
      aria-label={`${s.id}: score ${s.score}${max ? ` of ${max}` : ""}. Show prompt.`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="cursor-pointer outline-none"
      initial={{ x: from.x, y: from.y, opacity: 0 }}
      animate={{ x: at.x, y: at.y, opacity }}
      transition={{ duration: 0.9, delay, ease: [0.3, 0, 0.2, 1] }}
    >
      <motion.g initial={{ scale: 0.2 }} animate={{ scale }} transition={{ type: "spring", stiffness: 160, damping: 14, delay }}>
        <circle r={ORB * 2.2} fill={color} opacity={state === "winner" ? 0.16 : 0.07} />
        <circle r={ORB} fill={color} opacity={0.9} />
        <circle cx={-8} cy={-9} r={8} fill="#fff" opacity={0.65} />
        {state === "winner" && <circle r={ORB + 7} fill="none" stroke={color} strokeWidth={2} strokeDasharray="3 5" />}
      </motion.g>
      <text y={ORB * scale + 22} textAnchor="middle" fontSize={13} fill="#cbd5e1">
        {s.id}
      </text>
      <AnimatePresence>
        {showScore && (
          <motion.text
            initial={{ opacity: 0, y: ORB * scale + 30 }}
            animate={{ opacity: 1, y: ORB * scale + 42 }}
            textAnchor="middle"
            fontSize={19}
            fontWeight={800}
            fill="#fff"
          >
            {s.score}
          </motion.text>
        )}
      </AnimatePresence>
    </motion.g>
  );
}

function ScoreLine({
  points,
  trainMax,
  expert,
  hover,
  setHover,
}: {
  points: { g: number; x: number; score: number; id: string; shown: boolean; hit: number | null }[];
  trainMax: number | null;
  expert: { id: string; score: number } | null;
  hover: number | null;
  setHover: (g: number | null) => void;
}) {
  const h = 190;
  const top = 26;
  const bottom = h - 34;
  const values = [...points.map((p) => p.score), ...(expert ? [expert.score] : [])];
  if (!values.length) return null;
  const hi = trainMax ?? Math.max(...values) + 10;
  const lo = Math.max(0, Math.floor((Math.min(...values) - 15) / 10) * 10);
  const y = (v: number) => bottom - ((v - lo) / (hi - lo || 1)) * (bottom - top);
  const shown = points.filter((p) => p.shown);
  const d = shown.map((p, i) => `${i ? "L" : "M"}${p.x} ${y(p.score)}`).join(" ");
  const hp = points.find((p) => p.g === hover && p.shown);

  return (
    <div className="relative z-10 border-t border-white/10 px-1 pt-2 pb-3">
      <p className="px-3 text-sm font-semibold text-slate-300">
        Best training score so far <span className="font-normal text-ink-faint">(axis starts at {lo}{trainMax ? `, max ${trainMax}` : ""})</span>
      </p>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${h}`} className="block h-auto w-full" role="img" aria-label="Best training score per round">
          {[lo, Math.round((lo + hi) / 2), hi].map((t) => (
            <g key={t}>
              <line x1={40} x2={W - 20} y1={y(t)} y2={y(t)} stroke="#fff" strokeOpacity={0.08} />
              <text x={34} y={y(t) + 4} textAnchor="end" fontSize={12} fill="#94a3b8">
                {t}
              </text>
            </g>
          ))}
          {expert && (
            <g>
              <line x1={40} x2={W - 20} y1={y(expert.score)} y2={y(expert.score)} stroke="#cbd5e1" strokeOpacity={0.6} strokeDasharray="6 6" strokeWidth={1.5} />
              <text x={W - 22} y={y(expert.score) + 16} textAnchor="end" fontSize={12} fill="#cbd5e1">
                Best expert prompt: {expert.score}
              </text>
            </g>
          )}
          {shown.length > 1 && <motion.path key={shown.length} d={d} fill="none" stroke={TEAL} strokeWidth={2} initial={{ pathLength: 0.6 }} animate={{ pathLength: 1 }} transition={{ duration: 0.8 }} />}
          {shown.map((p) => (
            <g key={p.g}>
              <motion.circle cx={p.x} cy={y(p.score)} r={5} fill={TEAL} stroke="#040a17" strokeWidth={2} initial={{ r: 0 }} animate={{ r: hover === p.g ? 7 : 5 }} />
              <text x={p.x} y={y(p.score) - 12} textAnchor="middle" fontSize={13} fontWeight={700} fill="#fff">
                {p.score}
              </text>
              <circle
                cx={p.x}
                cy={y(p.score)}
                r={20}
                fill="transparent"
                onMouseEnter={() => setHover(p.g)}
                onMouseLeave={() => setHover(null)}
              />
            </g>
          ))}
          {points.map((p) => (
            <text key={`x${p.g}`} x={p.x} y={h - 10} textAnchor="middle" fontSize={12} fill="#aab7c9">
              Round {p.g}
              {p.hit != null && p.shown ? ` · feedback hit ${Math.round(p.hit * 100)}%` : ""}
            </text>
          ))}
        </svg>
        {hp && (
          <div
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-lg bg-glass px-3 py-1.5 text-sm text-ink shadow-lg"
            style={{ left: `${(hp.x / W) * 100}%`, top: `${(y(hp.score) / h) * 100 - 6}%` }}
          >
            <div className="font-semibold">Round {hp.g}</div>
            <div>
              {hp.id}: {hp.score}
              {trainMax ? ` / ${trainMax}` : ""}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TestComparison({ rows, count }: { rows: TestRow[]; count: number | null }) {
  const dangerous = rows[0]?.dangerous ?? 0;
  const safe = rows[0]?.safe ?? 0;
  return (
    <div className="rounded-2xl border border-line bg-glass p-5 md:p-6">
      <h2 className="text-2xl font-bold text-ink">On scenarios it never saw</h2>
      <p className="mt-1 text-base text-ink-muted">
        {count ?? "The"} held-out test scenarios: {dangerous} truly dangerous (should escalate), {safe} not. Lower is better on both.
      </p>
      <div className="mt-6 grid gap-8 md:grid-cols-2">
        <RateChart
          title="Missed danger"
          detail="Dangerous scenarios it failed to escalate"
          rows={rows}
          value={(r) => (r.dangerous ? r.missed / r.dangerous : 0)}
          label={(r) => `${r.missed} of ${r.dangerous}`}
        />
        <RateChart
          title="False alarms"
          detail="Safe scenarios it escalated anyway"
          rows={rows}
          value={(r) => (r.safe ? r.falseAlarms / r.safe : 0)}
          label={(r) => `${r.falseAlarms} of ${r.safe}`}
        />
      </div>
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {rows.map((r) => (
          <div key={r.key} className={`rounded-xl p-3 ${r.key === "evolved" ? "bg-teal-50 ring-2 ring-teal-600" : "bg-glass"}`}>
            <div className="text-sm font-semibold text-ink-muted">{r.label}</div>
            <div className="text-2xl font-black text-ink tabular-nums">
              {r.score}
              {r.max ? <span className="text-base font-semibold text-ink-faint"> / {r.max}</span> : null}
            </div>
            <div className="text-xs text-ink-faint">test score</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RateChart({
  title,
  detail,
  rows,
  value,
  label,
}: {
  title: string;
  detail: string;
  rows: TestRow[];
  value: (r: TestRow) => number;
  label: (r: TestRow) => string;
}) {
  return (
    <div>
      <h3 className="text-lg font-bold text-ink">{title}</h3>
      <p className="text-sm text-ink-muted">{detail}</p>
      <ul className="mt-3 space-y-2.5">
        {rows.map((r, i) => {
          const v = value(r);
          const ours = r.key === "evolved";
          return (
            <li key={r.key} className="grid grid-cols-[7.5rem_1fr_4.5rem] items-center gap-3" title={`${r.label}: ${label(r)} (${Math.round(v * 100)}%)`}>
              <span className={`text-sm ${ours ? "font-bold text-ink" : "text-ink-soft"}`}>{r.label}</span>
              <span className="h-5 rounded bg-glass-strong">
                <motion.span
                  className={`block h-full rounded ${ours ? "bg-teal-600" : "bg-slate-400"}`}
                  initial={{ width: 0 }}
                  animate={{ width: v ? `${v * 100}%` : "3px" }}
                  transition={{ duration: 0.8, delay: 0.2 + i * 0.12 }}
                />
              </span>
              <span className="text-right text-sm text-ink tabular-nums">
                <span className="font-semibold">{Math.round(v * 100)}%</span> <span className="text-ink-faint">{label(r)}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PromptPanel({ s, max, onClose }: { s: EvoStrategy | null; max: number | null; onClose: () => void }) {
  useEffect(() => {
    if (!s) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [s, onClose]);

  return (
    <AnimatePresence>
      {s && (
        <motion.div
          key="panel"
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 p-4 md:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="prompt-title"
            className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-glass p-6 shadow-2xl"
            initial={{ y: 40, scale: 0.97 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 40, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="prompt-title" className="text-2xl font-bold text-ink">
                  {s.id}
                </h2>
                <p className="text-base text-ink-muted">
                  Round {s.round} · training score {s.score}
                  {max ? ` / ${max}` : ""}
                  {s.metrics.escalation_recall !== undefined && ` · caught ${Math.round(s.metrics.escalation_recall * 100)}% of dangers`}
                  {s.metrics.false_alarms !== undefined && ` · ${s.metrics.false_alarms} false alarms`}
                </p>
              </div>
              <button type="button" onClick={onClose} autoFocus className="min-h-11 rounded-lg border border-line-strong px-4 text-base font-semibold text-ink hover:bg-glass-strong">
                Close
              </button>
            </div>
            {s.hypothesis && (
              <>
                <h3 className="mt-5 text-sm font-semibold uppercase tracking-wide text-ink-faint">Hypothesis</h3>
                <p className="mt-1 text-base leading-relaxed text-ink">{s.hypothesis}</p>
              </>
            )}
            {s.changes && (
              <>
                <h3 className="mt-5 text-sm font-semibold uppercase tracking-wide text-ink-faint">What I changed and why</h3>
                <p className="mt-1 text-base leading-relaxed text-ink">{s.changes}</p>
              </>
            )}
            {Object.keys(s.settings).length > 0 && (
              <p className="mt-4 flex flex-wrap gap-2">
                {Object.entries(s.settings).map(([k, v]) => (
                  <span key={k} className="rounded-md bg-glass-strong px-2 py-0.5 font-mono text-sm text-ink-soft">
                    {k}: {String(v)}
                  </span>
                ))}
              </p>
            )}
            <h3 className="mt-5 text-sm font-semibold uppercase tracking-wide text-ink-faint">Full prompt</h3>
            <pre className="mt-1 rounded-lg bg-glass p-4 font-mono text-sm leading-relaxed whitespace-pre-wrap text-ink">{s.prompt ?? "(not recorded)"}</pre>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** The children of the round being animated: hypothesis, what changed and why, score, and the round's feedback hit rate. */
function RoundDetails({ round, reveal, onOpen }: { round: EvoRound | null; reveal: number; onOpen: (s: EvoStrategy) => void }) {
  if (!round || round.round === 0 || reveal === 0) return null;
  const fixed = round.fixes.filter((f) => f.status === "fixed" || f.status === "improved").length;
  return (
    <div className="relative z-10 border-t border-white/10 px-4 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-bold text-white">Round {round.round}: the Critic’s children</h3>
        {reveal >= 3 && round.hitRate !== null && (
          <p className="text-sm text-ink-soft">
            Feedback hit rate{" "}
            <span className="font-bold text-accent tabular-nums">{Math.round(round.hitRate * 100)}%</span>
            {round.hitRateSource === "computed" && round.fixes.length > 0 && (
              <span className="text-ink-faint">
                {" "}
                · {fixed} of {round.fixes.length} targeted scenarios fixed or improved in the survivor
              </span>
            )}
          </p>
        )}
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        {round.strategies.map((s, i) => {
          const winner = reveal >= 3 && round.bestId === s.id;
          const loser = reveal >= 3 && round.bestId !== s.id;
          return (
            <motion.button
              type="button"
              key={s.id}
              onClick={() => onOpen(s)}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: loser ? 0.55 : 1, y: 0 }}
              transition={{ delay: i * 0.12 }}
              className={`rounded-xl border p-3 text-left transition hover:bg-white/10 ${winner ? "glow-accent bg-accent/10" : "border-white/15 bg-white/[0.04]"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-sm font-bold text-white">{s.id}</span>
                {reveal >= 2 && (
                  <span className="text-sm font-bold text-white tabular-nums">
                    {s.score}
                    {winner && <span className="ml-1.5 rounded bg-accent px-1.5 py-0.5 text-xs text-accent-ink">survives</span>}
                  </span>
                )}
              </div>
              {s.hypothesis && (
                <p className="mt-2 text-sm text-ink-soft">
                  <span className="font-semibold text-aurora-violet">Hypothesis: </span>
                  {s.hypothesis}
                </p>
              )}
              {s.changes && (
                <p className="mt-2 line-clamp-4 text-sm text-ink-soft">
                  <span className="font-semibold text-accent">What I changed and why: </span>
                  {s.changes}
                </p>
              )}
              <span className="mt-2 block text-xs font-semibold text-ink-faint">Read the full prompt →</span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

const RUN_COLORS = { a: "#5eead4", b: "#a5b4fc" } as const;

/** A (parallel agents) vs B (single agent): best score vs. candidates evaluated and vs. wall-clock time. */
function ParallelPanel({ c }: { c: ParallelComparison }) {
  const hasTime = c.a.points.some((p) => p.seconds !== null) && c.b.points.some((p) => p.seconds !== null);
  return (
    <section className="glass rounded-2xl p-5 md:p-6">
      <h2 className="text-2xl font-bold text-ink">Parallel vs single agent</h2>
      <p className="mt-1 text-base text-ink-muted">Best training score as the search goes on, for the same optimizer run two ways.</p>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-soft">
        {(["a", "b"] as const).map((k) => (
          <span key={k} className="inline-flex items-center gap-2">
            <span className="h-[3px] w-6 rounded" style={{ background: RUN_COLORS[k], boxShadow: `0 0 8px ${RUN_COLORS[k]}` }} />
            {c[k].label}
          </span>
        ))}
      </div>
      <div className={`mt-4 grid gap-6 ${hasTime ? "lg:grid-cols-2" : ""}`}>
        <RunChart title="Best score vs. candidates evaluated" a={c.a} b={c.b} x={(p) => p.candidates} xLabel={(v) => `${Math.round(v)}`} />
        {hasTime && (
          <RunChart title="Best score vs. wall-clock time" a={c.a} b={c.b} x={(p) => p.seconds ?? 0} xLabel={(v) => (v >= 120 ? `${Math.round(v / 60)} min` : `${Math.round(v)} s`)} />
        )}
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {(["a", "b"] as const).map((k) => (
          <div key={k} className="rounded-xl border border-line bg-glass-strong p-3">
            <div className="text-sm font-semibold text-ink-muted">{c[k].label} · test score</div>
            <div className="text-2xl font-black text-ink tabular-nums">
              {c[k].test ? (
                <>
                  {c[k].test!.score}
                  {c[k].test!.max != null && <span className="text-base font-semibold text-ink-faint"> / {c[k].test!.max}</span>}
                </>
              ) : (
                "—"
              )}
            </div>
          </div>
        ))}
        <div className="glow-accent rounded-xl border bg-accent/10 p-3">
          <div className="text-sm font-semibold text-accent">Concurrency speedup</div>
          <div className="text-2xl font-black text-ink tabular-nums">{c.speedup != null ? `${c.speedup.toFixed(1)}×` : "—"}</div>
        </div>
      </div>
    </section>
  );
}

function RunChart({
  title,
  a,
  b,
  x,
  xLabel,
}: {
  title: string;
  a: AgentRun;
  b: AgentRun;
  x: (p: AgentRun["points"][number]) => number;
  xLabel: (v: number) => string;
}) {
  const [hover, setHover] = useState<{ k: "a" | "b"; i: number } | null>(null);
  const w = 480;
  const h = 220;
  const m = { l: 40, r: 14, t: 14, b: 30 };
  const all = [...a.points, ...b.points];
  const xs = all.map(x);
  const ys = all.map((p) => p.best);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs) || 1;
  const y0 = Math.floor(Math.min(...ys) / 10) * 10;
  const y1 = Math.ceil(Math.max(...ys) / 10) * 10 || 1;
  const sx = (v: number) => m.l + ((v - x0) / (x1 - x0 || 1)) * (w - m.l - m.r);
  const sy = (v: number) => h - m.b - ((v - y0) / (y1 - y0 || 1)) * (h - m.t - m.b);
  const runs = { a, b };
  const hp = hover ? runs[hover.k].points[hover.i] : null;
  return (
    <figure>
      <figcaption className="mb-1 text-base font-semibold text-ink">{title}</figcaption>
      <div className="relative">
        <svg viewBox={`0 0 ${w} ${h}`} className="block h-auto w-full" role="img" aria-label={title}>
          {[y0, (y0 + y1) / 2, y1].map((t) => (
            <g key={t}>
              <line x1={m.l} x2={w - m.r} y1={sy(t)} y2={sy(t)} stroke="rgba(186,206,235,0.12)" />
              <text x={m.l - 6} y={sy(t) + 4} textAnchor="end" fontSize={11} fill="#aab7c9">
                {Math.round(t)}
              </text>
            </g>
          ))}
          {[x0, (x0 + x1) / 2, x1].map((t, i) => (
            <text key={i} x={sx(t)} y={h - 8} textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"} fontSize={11} fill="#aab7c9">
              {xLabel(t)}
            </text>
          ))}
          {(["b", "a"] as const).map((k) => {
            const pts = runs[k].points;
            // Best-so-far is a step function: it only changes when a better candidate is found.
            const d = pts.map((p, i) => `${i ? `H${sx(x(p))}V` : `M${sx(x(p))} `}${sy(p.best)}`).join(" ");
            return (
              <g key={k}>
                <motion.path
                  d={d}
                  fill="none"
                  stroke={RUN_COLORS[k]}
                  strokeWidth={2}
                  style={{ filter: `drop-shadow(0 0 5px ${RUN_COLORS[k]})` }}
                  initial={{ pathLength: 0 }}
                  whileInView={{ pathLength: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 1.4 }}
                />
                {pts.map((p, i) => (
                  <circle
                    key={i}
                    cx={sx(x(p))}
                    cy={sy(p.best)}
                    r={hover?.k === k && hover.i === i ? 6 : 4}
                    fill={RUN_COLORS[k]}
                    stroke="#040a17"
                    strokeWidth={2}
                    onMouseEnter={() => setHover({ k, i })}
                    onMouseLeave={() => setHover(null)}
                  />
                ))}
              </g>
            );
          })}
        </svg>
        {hp && hover && (
          <div
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-lg border border-line-strong bg-night-raised/95 px-3 py-1.5 text-sm text-ink shadow-xl"
            style={{ left: `${(sx(x(hp)) / w) * 100}%`, top: `${(sy(hp.best) / h) * 100 - 4}%` }}
          >
            <div className="font-semibold">{runs[hover.k].label}</div>
            <div className="tabular-nums">
              best {hp.best} · {hp.candidates} candidates{hp.seconds != null ? ` · ${xLabel(hp.seconds)}` : ""}
            </div>
          </div>
        )}
      </div>
    </figure>
  );
}
