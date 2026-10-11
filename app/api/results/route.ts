import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

// Serves the self-improvement benchmark output produced by optimize/optimize.py.
// Falls back to a committed sample so the /results page always renders in a demo.
export async function GET() {
  const candidates = [
    path.join(process.cwd(), "optimize", "results.local.json"),
    path.join(process.cwd(), "optimize", "results.sample.json"),
  ];

  for (const file of candidates) {
    try {
      const raw = await readFile(file, "utf8");
      return NextResponse.json({ source: path.basename(file), ...JSON.parse(raw) });
    } catch {
      // try next
    }
  }

  return NextResponse.json(
    { error: "No benchmark results found. Run `python optimize/optimize.py`." },
    { status: 404 }
  );
}
