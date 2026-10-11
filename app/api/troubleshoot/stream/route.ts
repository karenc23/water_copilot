import { runTroubleshoot } from "@/lib/pipeline";
import { withLiveLogbook } from "@/components/logbook-data";
import { parseTroubleshootBody } from "@/lib/troubleshoot-input";
import { diagnosticianEvent, governorEvent, keeperEvent, librarianEvent, sentinelEvent, type TraceEvent } from "@/lib/trace";
import { readJSON } from "@/lib/validate";

/**
 * POST — same body as /api/troubleshoot. Runs the same pipeline and streams
 * server-sent events (`data: <TraceEvent JSON>`) as each stage finishes:
 * sentinel, librarian, keeper, diagnostician_start, diagnostician, governor,
 * courier (red only), then done with the full TroubleshootResponse — or error.
 */
export async function POST(request: Request) {
  // The Keeper reads the live logbook (MongoDB, seed fallback) unless the request sends its own.
  const parsed = await parseTroubleshootBody(await withLiveLogbook(await readJSON(request)));
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const input = parsed.input;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (e: TraceEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
        } catch {
          open = false; // client went away
        }
      };
      let alerts: Parameters<typeof governorEvent>[2] = [];

      try {
        const result = await runTroubleshoot(input, {}, {
          onRules(a, asOf) {
            alerts = a;
            send(sentinelEvent(a, input.readings, asOf));
            send(librarianEvent(a, input.manualText));
            // The Keeper's window ends at the newest reading or logbook entry, so an incident saved
            // today is recalled even when the latest reading is older.
            const keeperAsOf = [asOf, ...input.logs.map((l) => l.date)].filter((d): d is string => !!d).sort().at(-1);
            send(keeperEvent(input.logs, a, keeperAsOf));
          },
          onModelStart: () => send({ type: "diagnostician_start" }),
          onModel: (llm, ms) => send(diagnosticianEvent(llm, ms, input.manualText)),
          onSafety: (safe, llm) => send(governorEvent(safe, llm, alerts)),
        });
        if (result.escalation_packet) send({ type: "courier", packet: result.escalation_packet });
        send({ type: "done", result });
      } catch (err) {
        console.error("troubleshoot stream failed", err);
        send({ type: "error", error: "Troubleshooting model request failed" });
      } finally {
        if (open) controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
