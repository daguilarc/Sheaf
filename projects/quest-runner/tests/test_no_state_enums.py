from __future__ import annotations

import unittest
from pathlib import Path


class NoStateEnumReferencesTests(unittest.TestCase):
    def test_runner_and_tests_do_not_reference_deleted_state_enums(self) -> None:
        root = Path(__file__).resolve().parents[1]
        needles = ("Quest" + "State", "Slice" + "State")
        search_roots = (root / "src" / "quest_runner_service", root / "tests")
        offenders: list[str] = []
        for search_root in search_roots:
            for path in search_root.rglob("*"):
                if path == Path(__file__).resolve():
                    continue
                if path.is_dir() or path.suffix in {".pyc", ".png"}:
                    continue
                text = path.read_text(encoding="utf-8", errors="ignore")
                for needle in needles:
                    if needle in text:
                        rel = path.relative_to(root)
                        offenders.append(f"{rel}: contains {needle}")
        self.assertEqual(offenders, [])
