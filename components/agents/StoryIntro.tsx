"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AgentOrb, type OrbState } from "@/components/agents/AgentOrb";
import Aurora from "@/components/agents/Aurora";
import { AGENTS, RING_POS } from "@/components/agents/meta";

// Landing: three short scenes, then the six agents introduce themselves one by one.

const SCENES: string[][] = [
  ["A fictional village of 320 people.", "−30°F.", "One water operator."],
  ["The nearest expert covers 190 communities.", "When operators leave, what they knew leaves too."],
];

const SCENE_MS = [5200, 6200];
const TEAM_TITLE_MS = 2600;
const AGENT_MS = 2600;

const line = {
  hidden: { opacity: 0, y: 24, filter: "blur(6px)" },
  show: (i: number) => ({ opacity: 1, y: 0, filter: "blur(0px)", transition: { delay: 0.3 + i * 1.1, duration: 0.9, ease: [0.2, 0.7, 0.2, 1] as const } }),
  exit: { opacity: 0, y: -16, transition: { duration: 0.5 } },
};

export default function StoryIntro() {
  const router = useRouter();
  // 0, 1: text scenes. 2: team. Within the team scene, `intro` counts agents introduced (−1 = title only).
  const [scene, setScene] = useState(0);
  const [intro, setIntro] = useState(-1);
  const teamDone = scene === 2 && intro >= AGENTS.length;

  useEffect(() => {
    router.prefetch("/troubleshoot");
  }, [router]);

  useEffect(() => {
    if (scene < 2) {
      const id = setTimeout(() => setScene((s) => s + 1), SCENE_MS[scene]);
      return () => clearTimeout(id);
    }
    if (intro < AGENTS.length) {
      const id = setTimeout(() => setIntro((i) => i + 1), intro === -1 ? TEAM_TITLE_MS : AGENT_MS);
      return () => clearTimeout(id);
    }
  }, [scene, intro]);

  function advance() {
    if (scene < 2) setScene(scene + 1);
    else if (intro < AGENTS.length) setIntro(intro + 1);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        advance();
      } else if (e.key === "Escape") {
        router.push("/troubleshoot");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const current = scene === 2 && intro >= 0 && intro < AGENTS.length ? AGENTS[intro] : null;
  const orbState = (i: number): OrbState => (teamDone ? "done" : i === intro ? "active" : i < intro ? "done" : "idle");

  return (
    <div className="fixed inset-0 z-50 overflow-hidden text-white" onClick={advance}>
      <Aurora />

      <div className="absolute top-4 right-4 z-20 flex items-center gap-3 md:top-6 md:right-6">
        <Link
          href="/troubleshoot"
          onClick={(e) => e.stopPropagation()}
          className="rounded-full border border-white/25 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 backdrop-blur hover:bg-white/15"
        >
          Skip intro →
        </Link>
      </div>

      <div className="absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 gap-2" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span key={i} className={`h-1.5 rounded-full transition-all duration-500 ${i === scene ? "w-8 bg-teal-300" : "w-1.5 bg-white/30"}`} />
        ))}
      </div>

      <AnimatePresence mode="wait">
        {scene < 2 ? (
          <motion.div
            key={`scene-${scene}`}
            className="relative z-10 flex h-full flex-col items-center justify-center gap-4 px-6 text-center"
            initial="hidden"
            animate="show"
            exit="exit"
          >
            {SCENES[scene].map((t, i) => (
              <motion.p
                key={t}
                custom={i}
                variants={line}
                className={
                  scene === 0 && i === 1
                    ? "text-6xl font-black tracking-tight text-sky-200 md:text-8xl"
                    : "max-w-3xl text-3xl leading-tight font-semibold tracking-tight md:text-5xl"
                }
              >
                {t}
              </motion.p>
            ))}
          </motion.div>
        ) : (
          <motion.div
            key="team"
            className="relative z-10 flex h-full flex-col items-center justify-center px-4 py-14"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8 }}
          >
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9 }}
              className="text-center text-3xl font-bold tracking-tight md:text-5xl"
            >
              Meet the team that never leaves
            </motion.h1>

            <motion.svg
              viewBox="0 0 1000 600"
              className="mt-4 h-auto max-h-[55vh] w-full max-w-4xl"
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.6, duration: 1 }}
              role="img"
              aria-label="The six agents"
            >
              {AGENTS.map((a, i) => (
                <AgentOrb key={a.id} agent={a} x={RING_POS[a.id].x} y={RING_POS[a.id].y} state={orbState(i)} wakeKey={i} />
              ))}
            </motion.svg>

            <div className="flex min-h-36 w-full max-w-2xl flex-col items-center justify-start text-center" aria-live="polite">
              <AnimatePresence mode="wait">
                {current ? (
                  <motion.div
                    key={current.id}
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.45 }}
                  >
                    <p className="text-lg font-bold tracking-widest uppercase" style={{ color: current.color }}>
                      {current.name}
                    </p>
                    <p className="mt-1 text-xl leading-snug text-slate-100 md:text-2xl">“{current.intro}”</p>
                  </motion.div>
                ) : teamDone ? (
                  <motion.div key="enter" initial={{ opacity: 0, y: 14, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 180, damping: 16 }}>
                    <Link
                      href="/troubleshoot"
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex min-h-14 items-center gap-2 rounded-full bg-teal-300 px-10 text-xl font-bold text-[#04121f] shadow-[0_0_40px_rgba(94,234,212,0.45)] hover:bg-teal-200"
                    >
                      Enter
                      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" aria-hidden>
                        <path d="M5 12h14M13 6l6 6-6 6" />
                      </svg>
                    </Link>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <p className="pointer-events-none absolute bottom-10 left-1/2 z-20 -translate-x-1/2 text-xs text-slate-400">
        {teamDone ? "" : "Click or press → to continue"}
      </p>
    </div>
  );
}
