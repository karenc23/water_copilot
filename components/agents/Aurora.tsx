// Arctic-night background: deep navy, a few soft aurora bands and a scatter of stars.
// Only transform/opacity animate (see .aurora-band in globals.css), so it stays on the compositor.

const STARS = Array.from({ length: 70 }, (_, i) => {
  // Deterministic pseudo-random positions so server and client render the same.
  const r = (n: number) => ((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
  // Rounded so server and browser serialize the same style strings.
  const q = (v: number) => Math.round(v * 100) / 100;
  return { x: q(r(1) * 100), y: q(r(2) * 70), s: q(r(3) * 1.4 + 0.4), o: q(r(4) * 0.5 + 0.2), d: q(r(5) * 6) };
});

export default function Aurora({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden className={`pointer-events-none absolute inset-0 overflow-hidden bg-[#040a17] ${className}`}>
      <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_120%,#0b2a3f_0%,transparent_60%)]" />
      <div className="aurora-band aurora-a" />
      <div className="aurora-band aurora-b" />
      <div className="aurora-band aurora-c" />
      {STARS.map((s, i) => (
        <span
          key={i}
          className="aurora-star absolute rounded-full bg-white"
          style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.s, height: s.s, opacity: s.o, animationDelay: `${s.d}s` }}
        />
      ))}
      <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[#040a17] to-transparent" />
    </div>
  );
}
