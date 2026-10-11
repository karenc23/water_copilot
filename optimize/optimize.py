"""Standalone optimization script (separate from the Next.js app).

Placeholder: reads data/scenarios_train.json and data/scenarios_test.json and
evaluates/optimizes the copilot against each scenario's `expected` block.

Usage:
    python optimize/optimize.py
"""

import json
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def load_scenarios(split: str) -> list[dict]:
    return json.loads((DATA_DIR / f"scenarios_{split}.json").read_text())


def main() -> None:
    train, test = load_scenarios("train"), load_scenarios("test")
    print(f"Loaded {len(train)} train and {len(test)} test scenario(s)")
    # TODO: implement


if __name__ == "__main__":
    main()
