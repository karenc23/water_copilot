"use client";

import { motion, useReducedMotion } from "framer-motion";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

// Re-mounted on every navigation, so each page fades and rises in. The transform and filter are
// cleared when it ends: left in place they would trap position:fixed children (modals).
export default function Template({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  // The story intro is a full-screen overlay with its own transitions.
  if (usePathname() === "/") return children;
  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14, filter: "blur(4px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)", transitionEnd: { filter: "none", transform: "none" } }}
      transition={{ duration: 0.45, ease: [0.2, 0.7, 0.2, 1] }}
    >
      {children}
    </motion.div>
  );
}
