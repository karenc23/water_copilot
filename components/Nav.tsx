import Link from "next/link";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/troubleshoot", label: "Troubleshoot" },
  { href: "/logbook", label: "Logbook" },
  { href: "/readings", label: "Readings" },
  { href: "/handoff", label: "Handoff" },
  { href: "/results", label: "Results" },
];

export default function Nav() {
  return (
    <nav className="border-b border-black/10 dark:border-white/10">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-4">
        <Link href="/" className="font-semibold">
          Water Copilot
        </Link>
        {links.slice(1).map((l) => (
          <Link key={l.href} href={l.href} className="text-sm opacity-70 hover:opacity-100">
            {l.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

export { links };
