"""Standalone optimization script (separate from the Next.js app).

Placeholder: reads scenarios from ../data/scenarios and evaluates/optimizes
the copilot against each scenario's `expected` block.

Usage:
    python optimize/optimize.py
"""

import json
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def load_scenarios() -> list[dict]:
    return [json.loads(p.read_text()) for p in sorted((DATA_DIR / "scenarios").glob("*.json"))]


def main() -> None:
    scenarios = load_scenarios()
    print(f"Loaded {len(scenarios)} scenario(s)")
    # TODO: implement


if __name__ == "__main__":
    main()
