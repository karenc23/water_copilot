"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function EmergencyButton({
  reason,
  compact,
}: {
  reason?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function declare() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/emergency", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ declared_by: name || "Operator", source: "operator" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to declare.");
        return;
      }
      setOpen(false);
      router.push("/emergency");
      router.refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        className="emergency-trigger"
        style={compact ? { padding: "8px 14px", fontSize: 13 } : undefined}
        onClick={() => setOpen(true)}
      >
        ⚠ Declare Water Emergency
      </button>

      {open && (
        <div className="modal-backdrop" onClick={() => !submitting && setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ color: "var(--danger)" }}>Declare a water emergency?</h2>
            <p className="muted">
              This activates the drinking-water emergency protocol for{" "}
              <code>chena-village-01</code>:
            </p>
            <ul className="muted" style={{ marginTop: 0 }}>
              <li>Issues a public boil-water or do-not-drink advisory</li>
              <li>Notifies the state program, RMW, tribal health, EPA, and the village council</li>
              <li>Opens an immutable incident record and response timeline</li>
            </ul>
            {reason && (
              <div className="alert danger">
                <strong>Triggering condition:</strong> {reason}
              </div>
            )}
            <label>Your name (declaring operator)</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Joe N."
            />
            <label>
              Type <strong>DECLARE</strong> to confirm
            </label>
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DECLARE"
            />
            {error && <div className="alert danger">{error}</div>}
            <div className="row" style={{ marginTop: 8 }}>
              <button
                className="secondary"
                onClick={() => setOpen(false)}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                className="emergency-trigger"
                disabled={confirmText !== "DECLARE" || submitting}
                onClick={declare}
              >
                {submitting ? "Activating…" : "Activate emergency protocol"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
