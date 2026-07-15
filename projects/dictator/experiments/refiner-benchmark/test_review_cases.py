import json
import tempfile
import unittest
from pathlib import Path

import review_cases


class ReviewCasesTests(unittest.TestCase):
    def test_promotes_explicitly_approved_case_with_provenance(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "cases.jsonl"
            case = review_cases.ReviewedCase(
                case_id="awkward-001",
                raw="I I need the deploy script.",
                expected="I need the deploy script.",
                approved_by="joyo",
                approved_at="2026-07-15T16:00:00Z",
                source="2026-07-13-awkward-dictation-review.md#1",
                note="Immediate stutter only.",
            )

            review_cases.promote(output, case)

            row = json.loads(output.read_text().strip())
            self.assertEqual(row["id"], "awkward-001")
            self.assertEqual(row["dataset_status"], "human-reviewed")
            self.assertEqual(row["expected"], "I need the deploy script.")
            self.assertEqual(row["review"]["approved_by"], "joyo")

    def test_rejects_missing_approval_or_expected_output(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "cases.jsonl"
            base = dict(
                case_id="awkward-001",
                raw="raw",
                expected="expected",
                approved_by="joyo",
                approved_at="2026-07-15T16:00:00Z",
                source="report#1",
                note="reviewed",
            )
            for key in ("expected", "approved_by", "approved_at", "source"):
                invalid = dict(base)
                invalid[key] = ""
                with self.subTest(key=key), self.assertRaises(ValueError):
                    review_cases.promote(output, review_cases.ReviewedCase(**invalid))

    def test_conflicting_duplicate_id_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "cases.jsonl"
            first = review_cases.ReviewedCase(
                case_id="awkward-001",
                raw="raw",
                expected="first",
                approved_by="joyo",
                approved_at="2026-07-15T16:00:00Z",
                source="report#1",
                note="reviewed",
            )
            review_cases.promote(output, first)
            with self.assertRaises(ValueError):
                review_cases.promote(output, review_cases.ReviewedCase(**{**first.__dict__, "expected": "second"}))


if __name__ == "__main__":
    unittest.main()
