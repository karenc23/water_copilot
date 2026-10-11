import Link from "next/link";
import { links } from "@/components/Nav";

export default function Home() {
  return (
    <section>
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="mt-2 opacity-70">Plant status at a glance.</p>
      {/* TODO: latest readings, open issues, recent handoffs */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {links.slice(1).map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="rounded-lg border border-black/10 p-4 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
          >
            {l.label}
          </Link>
        ))}
      </div>
    </section>
  );
}
