"""Tests for the annotation sibling-file format (annotations.py). See
.superpowers/sdd/task-analyzer/task-10-brief.md and
specs/task-analyzer-sdd-annotations/spec.md for the required scenarios.
"""
from __future__ import annotations

import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import annotations  # noqa: E402

KNOWN_ARMS = [("claude-sonnet-5", "medium"), ("gpt-5", "low")]
PLAN_TASKS = ["task-1", "task-2"]


def _valid_doc():
    return {
        "format": 1,
        "change": "add-sdd-task-analyzer",
        "estimator_id": 7,
        "tasks": [
            {
                "task": "task-1",
                "title": "Do the thing",
                "model": "claude-sonnet-5",
                "effort": "medium",
                "complexity": {"C1": 2, "C2": 3, "C3": 4, "C4": 2, "C5": 3, "C6": 2, "C7": 2, "composite": 2.7},
                "predicted": {"p50_usd": 0.42, "p80_usd": 0.71, "review_p80_usd": 0.30, "explore": False},
            },
            {
                "task": "task-2",
                "title": "Do another thing",
                "model": "gpt-5",
                "effort": "low",
                # composite omitted -- validator must not treat this as an error.
                "complexity": {"C1": 1, "C2": 1, "C3": 1, "C4": 1, "C5": 1, "C6": 1, "C7": 1},
                "predicted": {"p50_usd": 0.10, "p80_usd": 0.20, "review_p80_usd": 0.05, "explore": True},
            },
        ],
    }


class TestValidate(unittest.TestCase):
    def test_valid_doc_has_no_errors(self):
        self.assertEqual(annotations.validate(_valid_doc(), PLAN_TASKS, KNOWN_ARMS), [])

    def test_unknown_task_key_is_rejected(self):
        doc = _valid_doc()
        doc["tasks"][0]["task"] = "task-99"
        errors = annotations.validate(doc, PLAN_TASKS, KNOWN_ARMS)
        self.assertTrue(any("task-99" in e and "unknown task key" in e for e in errors))

    def test_c_out_of_range_is_rejected(self):
        doc = _valid_doc()
        doc["tasks"][0]["complexity"]["C3"] = 6
        errors = annotations.validate(doc, PLAN_TASKS, KNOWN_ARMS)
        self.assertTrue(any("task-1" in e and "C3" in e for e in errors))

    def test_c_zero_is_rejected(self):
        doc = _valid_doc()
        doc["tasks"][0]["complexity"]["C1"] = 0
        errors = annotations.validate(doc, PLAN_TASKS, KNOWN_ARMS)
        self.assertTrue(any("C1" in e for e in errors))

    def test_non_integer_c_is_rejected(self):
        doc = _valid_doc()
        doc["tasks"][0]["complexity"]["C4"] = 2.5
        errors = annotations.validate(doc, PLAN_TASKS, KNOWN_ARMS)
        self.assertTrue(any("C4" in e for e in errors))

    def test_unknown_arm_is_rejected(self):
        doc = _valid_doc()
        doc["tasks"][0]["model"] = "not-a-real-model"
        errors = annotations.validate(doc, PLAN_TASKS, KNOWN_ARMS)
        self.assertTrue(any("task-1" in e and "unknown arm" in e for e in errors))

    def test_composite_disagreeing_with_mean_is_rejected(self):
        doc = _valid_doc()
        doc["tasks"][0]["complexity"]["composite"] = 9.9
        errors = annotations.validate(doc, PLAN_TASKS, KNOWN_ARMS)
        self.assertTrue(any("task-1" in e and "composite" in e for e in errors))

    def test_composite_matching_mean_is_accepted(self):
        doc = _valid_doc()
        # mean(2,3,4,2,3,2) = 16/6 = 2.666... -> rounds to 2.7, already set.
        self.assertEqual(annotations.validate(doc, PLAN_TASKS, KNOWN_ARMS), [])

    def test_unknown_format_version_is_rejected(self):
        doc = _valid_doc()
        doc["format"] = 2
        errors = annotations.validate(doc, PLAN_TASKS, KNOWN_ARMS)
        self.assertTrue(any("format" in e for e in errors))

    def test_multiple_errors_all_reported(self):
        doc = _valid_doc()
        doc["tasks"][0]["task"] = "task-99"
        doc["tasks"][0]["complexity"]["C3"] = 9
        doc["tasks"][0]["model"] = "nope"
        errors = annotations.validate(doc, PLAN_TASKS, KNOWN_ARMS)
        self.assertEqual(len(errors), 3)


class TestYamlSubset(unittest.TestCase):
    def test_round_trip_matches_original(self):
        doc = _valid_doc()
        text = annotations.dump_yaml_subset(doc)
        parsed = annotations.parse_yaml_subset(text)
        self.assertEqual(parsed, doc)

    def test_writer_matches_design_d1_shape(self):
        doc = {
            "format": 1,
            "change": "add-sdd-task-analyzer",
            "estimator_id": None,
            "tasks": [
                {
                    "task": "task-1",
                    "model": "gpt-5.5",
                    "effort": "high",
                    "complexity": {"C1": 2, "composite": 2.7},
                }
            ],
        }
        text = annotations.dump_yaml_subset(doc)
        self.assertIn("format: 1", text)
        self.assertIn("estimator_id: null", text)
        self.assertIn("  - task: task-1", text)
        self.assertIn("    model: gpt-5.5", text)
        self.assertIn("complexity: {C1: 2, composite: 2.7}", text)

    def test_parses_booleans_and_null(self):
        text = "format: 1\nestimator_id: null\ntasks:\n  - task: task-1\n    predicted: {explore: true, other: false}\n"
        doc = annotations.parse_yaml_subset(text)
        self.assertIsNone(doc["estimator_id"])
        self.assertIs(doc["tasks"][0]["predicted"]["explore"], True)
        self.assertIs(doc["tasks"][0]["predicted"]["other"], False)

    def test_ignores_comments_and_blank_lines(self):
        text = "# a comment\nformat: 1\n\ntasks:\n  - task: task-1\n"
        doc = annotations.parse_yaml_subset(text)
        self.assertEqual(doc["format"], 1)
        self.assertEqual(doc["tasks"][0]["task"], "task-1")


class TestLoadWrite(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.mkdtemp(prefix="task-analyzer-annotations-test-")
        self.tmp_path = Path(self._tmp)

    def tearDown(self):
        shutil.rmtree(self._tmp, ignore_errors=True)

    def test_json_round_trip(self):
        doc = _valid_doc()
        path = self.tmp_path / "out.json"
        annotations.write(doc, path)
        self.assertEqual(annotations.load(path), doc)

    def test_yaml_round_trip(self):
        doc = _valid_doc()
        path = self.tmp_path / "out.assignments.yaml"
        annotations.write(doc, path)
        self.assertEqual(annotations.load(path), doc)

    def test_write_creates_parent_dirs(self):
        doc = _valid_doc()
        path = self.tmp_path / "nested" / "dir" / "out.assignments.yaml"
        annotations.write(doc, path)
        self.assertTrue(path.exists())

    def test_load_sniffs_json_without_json_suffix(self):
        doc = _valid_doc()
        path = self.tmp_path / "out.txt"
        import json
        path.write_text(json.dumps(doc), encoding="utf-8")
        self.assertEqual(annotations.load(path), doc)


if __name__ == "__main__":
    unittest.main()
