import type { ReactNode } from "react";

export function PageHeader({
  title,
  subtitle,
  children,
  agent,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
  /** An agent orb shown beside the title (components/agents/AgentBadge). */
  agent?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-4">
        {agent}
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight text-ink">{title}</h1>
          {subtitle && <p className="mt-1 text-lg text-ink-muted">{subtitle}</p>}
        </div>
      </div>
      {children}
    </header>
  );
}

export function Card({ title, aside, children, className = "" }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`glass rounded-2xl p-5 md:p-6 ${className}`}>
      {(title || aside) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-xl font-bold text-ink">{title}</h2>}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

export function Spinner({ className = "size-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`animate-spin ${className}`} fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export const buttonPrimary =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-accent px-6 text-lg font-bold text-accent-ink shadow-[0_0_28px_-6px_rgba(94,234,212,0.6)] transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none";

export const buttonSecondary =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-line-strong bg-glass px-4 text-base font-medium text-ink transition hover:border-accent/60 hover:bg-glass-strong disabled:opacity-50";

/** "2026-09-30" → "Sep 30, 2026" without timezone drift. */
export function formatDate(iso: string, opts: { year?: boolean } = { year: true }): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(opts.year ? { year: "numeric" } : {}), timeZone: "UTC" });
}
