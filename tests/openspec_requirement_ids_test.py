from __future__ import annotations

import re
import unittest
from collections import defaultdict
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
PARAMETER_MODULATION_SPEC = (
    REPO_ROOT / "openspec" / "specs" / "synth-parameter-modulation" / "spec.md"
)
REQUIREMENT_ID_PATTERN = re.compile(
    r"^### Requirement:\s+(spm-[0-9]+)\b"
)


class SynthParameterModulationRequirementIdTests(unittest.TestCase):
    def test_live_spm_requirement_ids_are_unique(self) -> None:
        occurrences: dict[str, list[str]] = defaultdict(list)

        relative_path = PARAMETER_MODULATION_SPEC.relative_to(REPO_ROOT)
        for line_number, line in enumerate(
            PARAMETER_MODULATION_SPEC.read_text(encoding="utf-8").splitlines(), start=1
        ):
            match = REQUIREMENT_ID_PATTERN.match(line)
            if match is not None:
                occurrences[match.group(1)].append(
                    f"{relative_path}:{line_number}"
                )

        duplicates = {
            requirement_id: locations
            for requirement_id, locations in occurrences.items()
            if len(locations) > 1
        }
        formatted_duplicates = "\n".join(
            f"{requirement_id}: {', '.join(locations)}"
            for requirement_id, locations in sorted(duplicates.items())
        )

        self.assertFalse(
            duplicates,
            "duplicate live synth parameter-modulation requirement IDs:\n"
            + formatted_duplicates,
        )


if __name__ == "__main__":
    unittest.main()
