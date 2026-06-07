"""Tests for dashboard git commit list and diff APIs."""

from __future__ import annotations

import subprocess
import unittest
from pathlib import Path

from quest_runner_service.dashboard_data import DashboardBadRequest, DashboardNotFound
from quest_runner_service.dashboard_git import (
    git_commits_payload,
    git_diff_file_payload,
    git_diff_summary_payload,
    list_changed_files,
    parse_unified_diff_to_rows,
    resolve_diff_parent,
    verify_commit_exists,
)

from .test_helpers import TempRepo, ensure_project, make_app_client


def _git_init(path: Path) -> None:
    subprocess.run(["git", "init"], cwd=str(path), check=True, capture_output=True)
    subprocess.run(
        ["git", "config", "user.email", "t@e.st"],
        cwd=str(path),
        check=True,
        capture_output=True,
    )
    subprocess.run(
        ["git", "config", "user.name", "Tester"],
        cwd=str(path),
        check=True,
        capture_output=True,
    )


class UnifiedDiffParserTests(unittest.TestCase):
    def test_parse_add_and_remove(self) -> None:
        text = """diff --git a/x b/x
--- a/x
+++ b/x
@@ -1,2 +1,2 @@
 a
-b
+c
"""
        rows, trunc = parse_unified_diff_to_rows(text)
        self.assertFalse(trunc)
        kinds = [r["kind"] for r in rows if r["kind"] != "hunk_header"]
        self.assertIn("context", kinds)
        self.assertIn("removal", kinds)
        self.assertIn("addition", kinds)


class GitApiHttpTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repo_root = Path(__file__).resolve().parents[1]
        self.temp = TempRepo(self.repo_root)
        self.addCleanup(self.temp.cleanup)

    def _quest_repo(self):
        ensure_project(self.temp.root, "example")
        (self.temp.root / "f.txt").write_text("v1\n", encoding="utf-8")
        subprocess.run(
            ["git", "add", "f.txt"],
            cwd=str(self.temp.root),
            check=True,
            capture_output=True,
        )
        subprocess.run(
            ["git", "commit", "-m", "one"],
            cwd=str(self.temp.root),
            check=True,
            capture_output=True,
        )
        (self.temp.root / "f.txt").write_text("v2\n", encoding="utf-8")
        subprocess.run(
            ["git", "add", "f.txt"],
            cwd=str(self.temp.root),
            check=True,
            capture_output=True,
        )
        subprocess.run(
            ["git", "commit", "-m", "two"],
            cwd=str(self.temp.root),
            check=True,
            capture_output=True,
        )
        client, svc = make_app_client(self.temp.root, self.repo_root)
        svc.create_quest(
            str(self.temp.root), "example", "main", "G"
        )
        return client

    def test_git_commits_paginated(self) -> None:
        client = self._quest_repo()
        r = client.get(
            "/api/dashboard/git_commits",
            query_string={
                "project": "example",
                "quest_type": "main",
                "quest_number": "0",
                "limit": "10",
                "skip": "0",
            },
        )
        self.assertEqual(r.status_code, 200)
        body = r.get_json()
        self.assertGreaterEqual(len(body["commits"]), 2)

    def test_git_diff_summary_then_file(self) -> None:
        client = self._quest_repo()
        log_r = subprocess.run(
            [
                "git",
                "-C",
                str(self.temp.root),
                "log",
                "--format=%H",
                "--",
                "f.txt",
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        sha = log_r.stdout.strip().splitlines()[0]
        s = client.get(
            "/api/dashboard/git_diff",
            query_string={
                "project": "example",
                "quest_type": "main",
                "quest_number": "0",
                "commit": sha,
            },
        )
        self.assertEqual(s.status_code, 200)
        d = client.get(
            "/api/dashboard/git_diff",
            query_string={
                "project": "example",
                "quest_type": "main",
                "quest_number": "0",
                "commit": sha,
                "path": "f.txt",
            },
        )
        self.assertEqual(d.status_code, 200)

    def test_git_diff_unknown_commit_404(self) -> None:
        client = self._quest_repo()
        r = client.get(
            "/api/dashboard/git_diff",
            query_string={
                "project": "example",
                "quest_type": "main",
                "quest_number": "0",
                "commit": "f" * 40,
            },
        )
        self.assertEqual(r.status_code, 404)

    def test_git_diff_missing_commit_400(self) -> None:
        client = self._quest_repo()
        r = client.get(
            "/api/dashboard/git_diff",
            query_string={
                "project": "example",
                "quest_type": "main",
                "quest_number": "0",
            },
        )
        self.assertEqual(r.status_code, 400)


class GitCommitsEmptyRepoTests(unittest.TestCase):
    def test_empty_repo_returns_empty_list(self) -> None:
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _git_init(root)
            out = git_commits_payload(root, limit=20, skip=0)
            self.assertEqual(out["commits"], [])


class VerifyCommitTests(unittest.TestCase):
    def test_invalid_sha_chars(self) -> None:
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _git_init(root)
            with self.assertRaises(DashboardBadRequest):
                verify_commit_exists(root, "not-a-sha!!!")

    def test_unknown_sha(self) -> None:
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _git_init(root)
            (root / "a").write_text("x", encoding="utf-8")
            subprocess.run(
                ["git", "add", "a"],
                cwd=str(root),
                check=True,
                capture_output=True,
            )
            subprocess.run(
                ["git", "commit", "-m", "x"],
                cwd=str(root),
                check=True,
                capture_output=True,
            )
            with self.assertRaises(DashboardNotFound):
                verify_commit_exists(root, "a" * 40)


if __name__ == "__main__":
    unittest.main()
