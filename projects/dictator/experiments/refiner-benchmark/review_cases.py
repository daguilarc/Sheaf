#!/usr/bin/env python3
"""Promote explicitly approved refiner disagreements into the reviewed set."""

from __future__ import annotations

import argparse
import dataclasses
import json
from pathlib import Path


DEFAULT_OUTPUT = Path(__file__).resolve().parent / "datasets/reviewed/cases.jsonl"


@dataclasses.dataclass(frozen=True)
class ReviewedCase:
    case_id: str
    raw: str
    expected: str
    approved_by: str
    approved_at: str
    source: str
    note: str = ""

    def row(self) -> dict:
        required = {
            "id": self.case_id,
            "raw": self.raw,
            "expected": self.expected,
            "approved_by": self.approved_by,
            "approved_at": self.approved_at,
            "source": self.source,
        }
        missing = [name for name, value in required.items() if not value.strip()]
        if missing:
            raise ValueError(f"reviewed case requires non-empty {', '.join(missing)}")
        return {
            "id": self.case_id,
            "dataset_status": "human-reviewed",
            "raw": self.raw,
            "expected": self.expected,
            "review": {
                "approved_by": self.approved_by,
                "approved_at": self.approved_at,
                "source": self.source,
                "note": self.note,
            },
        }


def read_rows(path: Path) -> list[dict]:
    if not path.exists():
        return []
    rows = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError as error:
            raise ValueError(f"{path}:{line_number}: {error}") from error
    return rows


def promote(path: Path, case: ReviewedCase) -> None:
    row = case.row()
    rows = read_rows(path)
    existing = next((value for value in rows if value.get("id") == case.case_id), None)
    if existing is not None:
        if existing == row:
            return
        raise ValueError(f"reviewed case id already exists with different content: {case.case_id}")

    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        "".join(json.dumps(value, ensure_ascii=False, sort_keys=True) + "\n" for value in [*rows, row]),
        encoding="utf-8",
    )
    temporary.replace(path)


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    result.add_argument("--id", required=True)
    result.add_argument("--raw", required=True)
    result.add_argument("--expected", required=True)
    result.add_argument("--approved-by", required=True)
    result.add_argument("--approved-at", required=True)
    result.add_argument("--source", required=True)
    result.add_argument("--note", default="")
    return result


def main() -> None:
    args = parser().parse_args()
    case = ReviewedCase(
        case_id=args.id,
        raw=args.raw,
        expected=args.expected,
        approved_by=args.approved_by,
        approved_at=args.approved_at,
        source=args.source,
        note=args.note,
    )
    promote(args.output, case)
    print(f"reviewed case {case.case_id} is present in {args.output}")


if __name__ == "__main__":
    main()
