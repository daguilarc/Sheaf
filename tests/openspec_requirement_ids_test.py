from __future__ import annotations

import re
import unittest
from collections import defaultdict
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
LIVE_SPEC_ROOT = REPO_ROOT / "openspec" / "specs"
REQUIREMENT_ID_PATTERN = re.compile(r"^### Requirement:\s+([a-z][a-z0-9]*-[0-9]+)\b")


class LiveOpenSpecRequirementIdTests(unittest.TestCase):
    def test_live_requirement_ids_are_unique_within_each_spec(self) -> None:
        occurrences: dict[tuple[Path, str], list[str]] = defaultdict(list)

        for spec_path in sorted(LIVE_SPEC_ROOT.glob("*/spec.md")):
            relative_path = spec_path.relative_to(REPO_ROOT)
            for line_number, line in enumerate(
                spec_path.read_text(encoding="utf-8").splitlines(), start=1
            ):
                match = REQUIREMENT_ID_PATTERN.match(line)
                if match is not None:
                    occurrences[(relative_path, match.group(1))].append(
                        f"{relative_path}:{line_number}"
                    )

        duplicates = {
            key: locations
            for key, locations in occurrences.items()
            if len(locations) > 1
        }
        formatted_duplicates = "\n".join(
            f"{requirement_id}: {', '.join(locations)}"
            for (_, requirement_id), locations in sorted(duplicates.items())
        )

        self.assertFalse(
            duplicates,
            "duplicate live OpenSpec requirement IDs within a spec:\n"
            + formatted_duplicates,
        )


if __name__ == "__main__":
    unittest.main()
