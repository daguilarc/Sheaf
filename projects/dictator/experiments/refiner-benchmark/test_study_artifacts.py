from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

import study_artifacts


class StudyArtifactsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.data_root = self.root / "private-study"
        self.repo_root = self.root / "repo"
        (self.data_root / "inputs").mkdir(parents=True)
        self.repo_root.mkdir()

        self.private_file = self.data_root / "inputs" / "sample.jsonl"
        self.private_file.write_text('{"id":1}\n{"id":2}\n', encoding="utf-8")
        self.tracked_file = self.repo_root / "prompt.md"
        self.tracked_file.write_text("prompt\n", encoding="utf-8")
        self.manifest_path = self.root / "manifest.json"
        self.write_manifest()

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def write_manifest(self) -> None:
        manifest = {
            "schema_version": 1,
            "study_id": "test-study",
            "private_artifacts": [
                {
                    "path": "inputs/sample.jsonl",
                    "sha256": self.sha256(self.private_file),
                    "records": 2,
                }
            ],
            "tracked_artifacts": [
                {
                    "path": "prompt.md",
                    "sha256": self.sha256(self.tracked_file),
                }
            ],
        }
        self.manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    def test_verify_manifest_accepts_matching_artifacts(self) -> None:
        self.assertEqual(
            study_artifacts.verify_manifest(self.manifest_path, self.data_root, self.repo_root),
            [],
        )

    def test_verify_manifest_reports_missing_artifact(self) -> None:
        self.private_file.unlink()

        errors = study_artifacts.verify_manifest(self.manifest_path, self.data_root, self.repo_root)

        self.assertTrue(any("missing" in error and "inputs/sample.jsonl" in error for error in errors))

    def test_verify_manifest_reports_hash_and_record_count_mismatch(self) -> None:
        self.private_file.write_text('{"id":1}\n', encoding="utf-8")

        errors = study_artifacts.verify_manifest(self.manifest_path, self.data_root, self.repo_root)

        self.assertTrue(any("sha256 mismatch" in error for error in errors))
        self.assertTrue(any("record count mismatch" in error for error in errors))

    def test_build_manifest_and_summary_inventory_artifacts_deterministically(self) -> None:
        manifest = study_artifacts.build_manifest(
            study_id="test-study",
            data_root=self.data_root,
            repo_root=self.repo_root,
            tracked_paths=[self.tracked_file],
            metadata={"dataset_status": "distribution-sample"},
        )
        summary = study_artifacts.build_summary(manifest)

        self.assertEqual(manifest["metadata"]["dataset_status"], "distribution-sample")
        self.assertEqual(manifest["private_artifacts"][0]["path"], "inputs/sample.jsonl")
        self.assertEqual(manifest["private_artifacts"][0]["records"], 2)
        self.assertEqual(manifest["tracked_artifacts"][0]["path"], "prompt.md")
        self.assertEqual(summary["private_artifacts"], 1)
        self.assertEqual(summary["categories"]["inputs"]["records"], 2)

    @staticmethod
    def sha256(path: Path) -> str:
        return hashlib.sha256(path.read_bytes()).hexdigest()


if __name__ == "__main__":
    unittest.main()
