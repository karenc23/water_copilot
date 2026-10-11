import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chena Copilot — Water Plant Memory",
  description:
    "An AI copilot that remembers your water plant: every fix, every reading, every handoff.",
};

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/troubleshoot", label: "Troubleshoot" },
  { href: "/readings", label: "Readings" },
  { href: "/logbook", label: "Logbook" },
  { href: "/handoff", label: "Handoff" },
  { href: "/emergency", label: "Emergency" },
  { href: "/results", label: "Benchmark" },
];

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <aside className="sidebar">
            <div className="brand">
              <span className="brand-mark">◆</span>
              <div>
                <div className="brand-name">Chena Copilot</div>
                <div className="brand-sub">Plant memory, not a chatbot</div>
              </div>
            </div>
            <nav>
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="nav-link">
                  {n.label}
                </Link>
              ))}
            </nav>
            <div className="sidebar-foot">
              <div className="plant-tag">chena-village-01</div>
              <p>
                In rural Alaska, clean water depends on one local operator.
                Expert help is days away.
              </p>
            </div>
          </aside>
          <main className="content">{children}</main>
        </div>
      </body>
    </html>
  );
}
