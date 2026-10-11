"use client";

import { useEffect, useRef, useState } from "react";
import type { EscalationPacket } from "@/lib/pipeline";
import { buttonSecondary } from "@/components/ui";

// The escalation packet as an editable draft. The app never sends anything: the operator copies it,
// downloads it, or opens it in their own email app and sends it themselves.

export function draftSubject(packet: EscalationPacket): string {
  const mode = packet.failure_mode ? ` · ${packet.failure_mode.id} ${packet.failure_mode.name}` : "";
  return `Water Copilot escalation · ${packet.plant_id} · tier ${packet.tier.toUpperCase()}${mode}`;
}

export default function DraftMessage({ packet, onClose }: { packet: EscalationPacket; onClose: () => void }) {
  const [text, setText] = useState(packet.message);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }), []);

  const subject = draftSubject(packet);
  const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;

  function download() {
    const blob = new Blob([`${subject}\n\n${text}\n`], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `escalation-${packet.plant_id}-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <section ref={ref} id="draft-message" aria-labelledby="draft-title" className="glass scroll-mt-6 rounded-2xl border-2 border-red-500/70 p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="draft-title" className="text-2xl font-bold text-ink">
            Draft message to expert
          </h2>
          <p className="mt-1 text-base text-ink-muted">
            Drafted from plant data, not written by AI. Edit it, then send it yourself. Nothing is sent from this app.
          </p>
        </div>
        <button type="button" className={buttonSecondary} onClick={onClose}>
          Close
        </button>
      </div>
      <p className="mt-4 text-sm font-semibold text-ink-soft">Subject: <span className="font-normal">{subject}</span></p>
      <label htmlFor="draft-body" className="sr-only">
        Message
      </label>
      <textarea
        id="draft-body"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={Math.min(24, text.split("\n").length + 2)}
        spellCheck
        className="mt-2 block w-full resize-y rounded-xl border border-line-strong bg-night/60 p-4 font-mono text-base leading-relaxed text-ink focus:border-accent focus:outline-none"
      />
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          className={buttonSecondary}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(`${subject}\n\n${text}`);
              setCopyError(false);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              setCopyError(true);
            }
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" className={buttonSecondary} onClick={download}>
          Download .txt
        </button>
        <a href={mailto} className={buttonSecondary}>
          Open in email
        </a>
      </div>
      {copyError && (
        <p role="alert" className="mt-3 text-base text-amber-200">
          Couldn’t copy automatically. Select the text above and copy it by hand.
        </p>
      )}
    </section>
  );
}
