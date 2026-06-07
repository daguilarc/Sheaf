"""Tests for dashboard HTTP APIs and dashboard_data helpers."""

from __future__ import annotations

import subprocess
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from quest_runner_service import quest_fs
from quest_runner_service.dashboard_data import (
    DashboardBadRequest,
    DashboardNotFound,
    build_quest_step_history,
    execution_overlay_status,
    issue_status_counts,
    parse_project,
    projects_payload,
    resolve_dashboard_checkout,
)
from quest_runner_service.worktrees import quest_worktree_path, remove_partial_worktree
from quest_runner_service.dashboard_runs import ActiveRunTracker
from quest_runner_service.quest_lock import QuestLock
from quest_runner_service.quest_types import IssueEntry, RecursiveSnapshot, StepCommitMetadata, TransitionRecord
from quest_runner_service.state_machine.commit_metadata import render_step_commit_message

from .test_helpers import TempRepo, ensure_project, make_app_client, quest_dir_on_checkout


class DashboardValidationTests(unittest.TestCase):
    def test_parse_project_requires_value(self) -> None:
        with self.assertRaises(DashboardBadRequest):
            parse_project(None)

    def test_parse_project_not_found(self) -> None:
        temp = TempRepo(Path(__file__).resolve().parents[1])
        self.addCleanup(temp.cleanup)
        with self.assertRaises(DashboardNotFound):
            parse_project("missing", source_repo_root=temp.root)


class OverlayPrecedenceTests(unittest.TestCase):
    def test_human_intervention_over_pause(self) -> None:
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            qdir = Path(tmp)
            (qdir / "human_intervention_request.md").write_text(
                "# Human intervention requested\n", encoding="utf-8"
            )
            (qdir / "paused_until.md").write_text(
                "Paused until 2099-01-01T00:00:00Z\n", encoding="utf-8"
            )
            lock = QuestLock()
            key = "/tmp/repo"
            self.assertTrue(lock.acquire(key, "main", 0, "r1"))
            try:
                st = execution_overlay_status(
                    quest_dir=qdir,
                    lock_key=key,
                    quest_type="main",
                    quest_number=0,
                    lock=lock,
                )
                self.assertEqual(st, "human_intervention")
            finally:
                lock.release(key)


class IssueCountTests(unittest.TestCase):
    def test_open_completed_counts(self) -> None:
        issues = [
            IssueEntry(
                issue_id="a",
                status="open",
                owner_role="r",
                created_at="t",
                updated_at="t",
                title="x",
                details="d",
            ),
            IssueEntry(
                issue_id="b",
                status="completed",
                owner_role="r",
                created_at="t",
                updated_at="t",
                title="y",
                details="d",
            ),
        ]
        c = issue_status_counts(issues)
        self.assertEqual(c["open"], 1)
        self.assertEqual(c["completed"], 1)


class ActiveRunTrackerTests(unittest.TestCase):
    def test_register_unregister(self) -> None:
        t = ActiveRunTracker()
        t.register("run-1", "/repo", "main", 1)
        rec = t.get_for_quest("/repo", "main", 1)
        assert rec is not None
        self.assertEqual(rec.run_id, "run-1")
        t.unregister("run-1")
        self.assertIsNone(t.get_for_quest("/repo", "main", 1))


class DashboardHttpTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repo_root = Path(__file__).resolve().parents[1]
        self.temp = TempRepo(self.repo_root)
        self.addCleanup(self.temp.cleanup)

    def test_projects_lists_project_local_quests(self) -> None:
        ensure_project(self.temp.root, "example")
        client, svc = make_app_client(self.temp.root, self.repo_root)
        svc.create_quest(
            str(self.temp.root), "example", "main", "A"
        )
        payload = client.get("/api/dashboard/projects").get_json()
        self.assertEqual(len(payload["projects"]), 1)
        self.assertEqual(payload["projects"][0]["project"], "example")
        self.assertEqual(payload["default_project"], "example")

    def test_projects_omits_empty_project_dirs(self) -> None:
        ensure_project(self.temp.root, "empty")
        ensure_project(self.temp.root, "with-quests")
        client, svc = make_app_client(self.temp.root, self.repo_root)
        svc.create_quest(str(self.temp.root), "with-quests", "main", "Q")
        payload = client.get("/api/dashboard/projects").get_json()
        names = {p["project"] for p in payload["projects"]}
        self.assertIn("with-quests", names)
        self.assertNotIn("empty", names)

    def test_legacy_top_level_quests_excluded_from_snapshot(self) -> None:
        ensure_project(self.temp.root, "example")
        client, svc = make_app_client(self.temp.root, self.repo_root)
        svc.create_quest(str(self.temp.root), "example", "main", "Real")
        legacy = self.temp.root / "quests" / "main" / "0000_legacy"
        legacy.mkdir(parents=True)
        (legacy / "state.md").write_text(
            "# Quest State\n\nstate: PrePlanning\ncurrent_slice: 0\n"
            "updated_at: 2026-01-01T00:00:00Z\n",
            encoding="utf-8",
        )
        snap = client.get(
            "/api/dashboard/project_snapshot",
            query_string={"project": "example"},
        ).get_json()
        slugs = {r["slug"] for r in snap["main"]}
        self.assertIn("real", slugs)
        self.assertNotIn("legacy", slugs)

    def test_project_snapshot_groups(self) -> None:
        ensure_project(self.temp.root, "example")
        client, svc = make_app_client(self.temp.root, self.repo_root)
        svc.create_quest(str(self.temp.root), "example", "main", "A")
        svc.create_quest(str(self.temp.root), "example", "side", "B")
        r = client.get(
            "/api/dashboard/project_snapshot",
            query_string={"project": "example"},
        )
        self.assertEqual(r.status_code, 200)
        body = r.get_json()
        self.assertEqual(body["project"], "example")
        self.assertEqual(len(body["main"]), 1)
        self.assertEqual(len(body["side"]), 1)
        self.assertEqual(body["main"][0]["slug"], "a")
        self.assertEqual(body["main"][0]["project"], "example")

    def test_quest_overview_and_run_status(self) -> None:
        ensure_project(self.temp.root, "example")
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = svc.create_quest(str(self.temp.root), "example", "main", "Ov")
        qdir = quest_dir_on_checkout(self.temp.root, out)
        (qdir / "slices" / "0001_shell_test").mkdir(parents=True)
        ov = client.get(
            "/api/dashboard/quest_overview",
            query_string={
                "project": "example",
                "quest_type": "main",
                "quest_number": "0",
            },
        )
        self.assertEqual(ov.status_code, 200)
        j = ov.get_json()
        self.assertEqual(j["quest_state"], "PrePlanning")
        self.assertEqual(j["quest"]["project"], "example")
        self.assertEqual(j["project"], "example")
        self.assertEqual(j["quest_type"], "main")
        self.assertEqual(j["quest_number"], 0)
        self.assertEqual(j["checkout_kind"], "worktree")
        self.assertFalse(j["worktree_missing"])
        self.assertIn("checkout_path", j)
        self.assertIn("quest_dir_rel", j)
        self.assertIn("quest_dashboard_url", j)
        self.assertIn("project=example", j["quest_dashboard_url"])
        rs = client.get(
            "/api/dashboard/run_status",
            query_string={
                "project": "example",
                "quest_type": "main",
                "quest_number": "0",
            },
        )
        self.assertEqual(rs.status_code, 200)
        rs_body = rs.get_json()
        self.assertEqual(rs_body["quest_state"], "PrePlanning")
        self.assertEqual(rs_body["project"], "example")
        self.assertEqual(rs_body["checkout_kind"], "worktree")
        self.assertFalse(rs_body["worktree_missing"])

    def test_missing_query_params_400(self) -> None:
        client, _svc = make_app_client(self.temp.root, self.repo_root)
        r = client.get("/api/dashboard/project_snapshot")
        self.assertEqual(r.status_code, 400)

    def test_physicalplan_issues_and_human_intervention(self) -> None:
        ensure_project(self.temp.root, "example")
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = svc.create_quest(str(self.temp.root), "example", "main", "PI")
        qdir = quest_dir_on_checkout(self.temp.root, out)
        quest_fs.write_issues(
            qdir / "physicalplan_issues.md",
            [
                IssueEntry(
                    issue_id="QP-0001",
                    status="open",
                    owner_role="physical_plan_reviewer",
                    created_at="2026-01-01T00:00:00Z",
                    updated_at="2026-01-02T00:00:00Z",
                    title="T",
                    details="D",
                ),
            ],
        )
        pi = client.get(
            "/api/dashboard/physicalplan_issues",
            query_string={
                "project": "example",
                "quest_type": "main",
                "quest_number": "0",
            },
        )
        self.assertEqual(pi.status_code, 200)
        self.assertEqual(pi.get_json()["open_count"], 1)
        hi = client.get(
            "/api/dashboard/human_intervention",
            query_string={
                "project": "example",
                "quest_type": "main",
                "quest_number": "0",
            },
        )
        self.assertEqual(hi.status_code, 200)
        self.assertFalse(hi.get_json()["present"])

    def test_malformed_quest_state_422_on_snapshot(self) -> None:
        ensure_project(self.temp.root, "example")
        client, svc = make_app_client(self.temp.root, self.repo_root)
        svc.create_quest(str(self.temp.root), "example", "main", "Bad")
        qdirs = quest_fs.list_quest_dirs(self.temp.root, "example", "main")
        (qdirs[0] / "state.md").write_text("broken\n", encoding="utf-8")
        r = client.get(
            "/api/dashboard/project_snapshot",
            query_string={"project": "example"},
        )
        self.assertEqual(r.status_code, 422)

    def test_schedule_run_quest_shows_running_overlay(self) -> None:
        ensure_project(self.temp.root, "example")
        client, svc = make_app_client(self.temp.root, self.repo_root)
        svc.create_quest(str(self.temp.root), "example", "main", "Slow")

        def slow_locked(*_a, **_k):
            time.sleep(0.3)
            return {
                "status": "pre_planning",
                "steps_executed": 0,
                "last_commit": None,
                "captured_outputs": [],
            }

        with patch.object(svc, "_run_quest_locked", side_effect=slow_locked):
            resp = client.post(
                "/run_quest",
                json={
                    "project": "example",
                    "quest_type": "main",
                    "quest_number": 0,
                },
            )
            self.assertEqual(resp.status_code, 202)
            rs = client.get(
                "/api/dashboard/run_status",
                query_string={
                    "project": "example",
                    "quest_type": "main",
                    "quest_number": "0",
                },
            )
            self.assertEqual(rs.status_code, 200)
            self.assertEqual(rs.get_json()["execution_overlay_status"], "running")
            self.assertIsNotNone(rs.get_json()["active_run"])


class DashboardCheckoutResolutionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repo_root = Path(__file__).resolve().parents[1]
        self.temp = TempRepo(self.repo_root)
        self.addCleanup(self.temp.cleanup)

    def test_resolve_dashboard_checkout_prefers_worktree(self) -> None:
        ensure_project(self.temp.root, "example")
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = svc.create_quest(str(self.temp.root), "example", "main", "Wt")
        qdir = quest_dir_on_checkout(self.temp.root, out)
        meta = quest_fs.read_quest_meta(qdir)
        checkout = resolve_dashboard_checkout(self.temp.root, meta)
        self.assertEqual(checkout.checkout_kind, "worktree")
        self.assertFalse(checkout.worktree_missing)
        self.assertEqual(
            Path(checkout.checkout_path),
            quest_worktree_path(self.temp.root, meta).resolve(),
        )

    def test_resolve_dashboard_checkout_source_fallback_when_worktree_missing(
        self,
    ) -> None:
        ensure_project(self.temp.root, "example")
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = svc.create_quest(str(self.temp.root), "example", "main", "Missing")
        qdir = quest_dir_on_checkout(self.temp.root, out)
        meta = quest_fs.read_quest_meta(qdir)
        remove_partial_worktree(self.temp.root, meta)
        checkout = resolve_dashboard_checkout(self.temp.root, meta)
        self.assertEqual(checkout.checkout_kind, "source")
        self.assertTrue(checkout.worktree_missing)
        self.assertEqual(Path(checkout.checkout_path), self.temp.root.resolve())

    def test_git_commits_use_worktree_when_present(self) -> None:
        ensure_project(self.temp.root, "example")
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = svc.create_quest(str(self.temp.root), "example", "main", "Git")
        qdir = quest_dir_on_checkout(self.temp.root, out)
        meta = quest_fs.read_quest_meta(qdir)
        checkout = resolve_dashboard_checkout(self.temp.root, meta)
        marker = checkout.checkout_root / "worktree-marker.txt"
        marker.write_text("wt\n", encoding="utf-8")
        subprocess.run(
            ["git", "add", "worktree-marker.txt"],
            cwd=str(checkout.checkout_root),
            check=True,
            capture_output=True,
        )
        subprocess.run(
            ["git", "commit", "-m", "worktree-only"],
            cwd=str(checkout.checkout_root),
            check=True,
            capture_output=True,
        )
        r = client.get(
            "/api/dashboard/git_commits",
            query_string={
                "project": "example",
                "quest_type": "main",
                "quest_number": str(out["quest_number"]),
                "limit": "5",
                "skip": "0",
            },
        )
        self.assertEqual(r.status_code, 200)
        titles = [c.get("title") or "" for c in r.get_json()["commits"]]
        self.assertIn("worktree-only", titles)

    def test_overview_reports_source_fallback_when_worktree_missing(self) -> None:
        ensure_project(self.temp.root, "example")
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = svc.create_quest(str(self.temp.root), "example", "main", "NoWt")
        qdir = quest_dir_on_checkout(self.temp.root, out)
        meta = quest_fs.read_quest_meta(qdir)
        remove_partial_worktree(self.temp.root, meta)
        ov = client.get(
            "/api/dashboard/quest_overview",
            query_string={
                "project": "example",
                "quest_type": "main",
                "quest_number": str(out["quest_number"]),
            },
        )
        self.assertEqual(ov.status_code, 200)
        body = ov.get_json()
        self.assertEqual(body["checkout_kind"], "source")
        self.assertTrue(body["worktree_missing"])


class DashboardQuestStepHistoryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repo_root = Path(__file__).resolve().parents[1]
        self.temp = TempRepo(self.repo_root)
        self.addCleanup(self.temp.cleanup)

    def test_build_quest_step_history_dedupes_legacy_row_sharing_metadata_sha(self) -> None:
        ensure_project(self.temp.root, "example")
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = svc.create_quest(str(self.temp.root), "example", "main", "Hist")
        qdir = quest_dir_on_checkout(self.temp.root, out)
        qrel = (
            Path(out["quest_dir"])
            .resolve()
            .relative_to(self.temp.root.resolve())
            .as_posix()
        )
        snap = RecursiveSnapshot(
            machine_path=qrel,
            machine_name="quest",
            node_name="n",
            state_before="PrePlanning",
            state_after="PhysicalPlanning",
            tags={},
            child=None,
        )
        msg = render_step_commit_message(
            StepCommitMetadata(global_step=1, snapshot=snap)
        )
        subprocess.run(
            ["git", "add", "-A"],
            cwd=str(self.temp.root),
            check=True,
            capture_output=True,
        )
        from quest_runner_service.dashboard_data import resolve_quest_dirs

        checkout, _qdir = resolve_quest_dirs(
            self.temp.root, "example", "main", out["quest_number"]
        )
        subprocess.run(
            ["git", "commit", "--allow-empty", "-m", msg],
            cwd=str(checkout),
            check=True,
            capture_output=True,
        )
        r = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=str(checkout),
            capture_output=True,
            text=True,
            check=True,
        )
        meta_sha = r.stdout.strip()
        quest_fs.append_history(
            qdir / "state_history.md",
            TransitionRecord(
                timestamp="2020-01-01T00:00:00Z",
                previous_state="PrePlanning",
                next_state="PhysicalPlanning",
                commit=meta_sha,
                thread_name="runner",
                notes="legacy duplicate of metadata commit",
            ),
        )
        hist = build_quest_step_history(checkout, qdir)
        self.assertEqual(len([h for h in hist if h["source"] == "metadata"]), 1)
        ov = client.get(
            "/api/dashboard/quest_overview",
            query_string={
                "project": "example",
                "quest_type": "main",
                "quest_number": str(out["quest_number"]),
            },
        )
        self.assertEqual(ov.status_code, 200)
        j = ov.get_json()
        self.assertIn("step_history", j)
        self.assertGreaterEqual(len(j["step_history"]), 1)


if __name__ == "__main__":
    unittest.main()
