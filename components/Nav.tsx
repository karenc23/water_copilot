"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Troubleshoot is the home page: it's what an operator opens the app for.
export const links = [
  { href: "/dashboard", label: "Dashboard", icon: "M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6v-9h-6v9Zm0-16v5h6V4h-6Z" },
  { href: "/troubleshoot", label: "Troubleshoot", icon: "M11 4a7 7 0 1 0 4.2 12.6l4.1 4.1 1.4-1.4-4.1-4.1A7 7 0 0 0 11 4Zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z" },
  { href: "/logbook", label: "Logbook", icon: "M6 3h11a2 2 0 0 1 2 2v16H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm1 4v2h9V7H7Zm0 4v2h9v-2H7Zm0 4v2h6v-2H7Z" },
  { href: "/handoff", label: "Handoff", icon: "M8 7V4l-6 6 6 6v-3h7V7H8Zm8 0v2h4v6h-4v2h6V7h-6Z" },
  { href: "/evolution", label: "Evolution", icon: "M12 2a3 3 0 0 1 1 5.8V11h4a2 2 0 0 1 2 2v3.2a3 3 0 1 1-2 0V13h-4v3.2a3 3 0 1 1-2 0V13H7v3.2a3 3 0 1 1-2 0V13a2 2 0 0 1 2-2h4V7.8A3 3 0 0 1 12 2Z" },
  { href: "/results", label: "Results", icon: "M4 20V10h3v10H4Zm6.5 0V4h3v16h-3ZM17 20v-7h3v7h-3Z" },
];

export default function Nav() {
  const pathname = usePathname();
  // The story intro at "/" is full-screen.
  if (pathname === "/") return null;
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <nav className="bg-[#0f1c2e] text-white md:sticky md:top-0 md:flex md:h-screen md:w-60 md:shrink-0 md:flex-col">
      <div className="px-5 pt-5 pb-3 md:pt-7 md:pb-6">
        <div className="text-xl font-bold tracking-tight">Water Copilot</div>
        <div className="mt-1 text-sm leading-snug text-slate-300">
          Plant A
          <span className="block text-slate-400">Fictional village water plant</span>
        </div>
      </div>
      <ul className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible md:pb-0">
        {links.map((l) => {
          const active = isActive(l.href);
          return (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-12 items-center gap-3 whitespace-nowrap rounded-lg px-3 text-base font-medium transition-colors ${
                  active ? "bg-white text-[#0f1c2e]" : "text-slate-200 hover:bg-white/10"
                }`}
              >
                <svg viewBox="0 0 24 24" className="size-5 shrink-0" fill="currentColor" aria-hidden>
                  <path d={l.icon} />
                </svg>
                {l.label}
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="mt-auto hidden px-5 pb-5 text-xs leading-relaxed text-slate-400 md:block">
        Demo data only. Not for operating a real water system.
      </p>
    </nav>
  );
}
