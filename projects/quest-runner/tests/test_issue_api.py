"""REST route tests for quest issue APIs."""

from __future__ import annotations

import unittest
from pathlib import Path
from unittest.mock import patch

from quest_runner_service import quest_fs
from quest_runner_service.dashboard_data import lock_key_for_quest
from quest_runner_service.quest_lock import QuestLock
from quest_runner_service.quest_types import IssueEntry

from .test_helpers import (
    TempRepo,
    cleanup_worktrees,
    ensure_project,
    make_app_client,
    quest_dir_on_checkout,
)


def _query(project: str, quest_type: str, quest_number: int, **extra: str) -> dict:
    params = {
        "project": project,
        "quest_type": quest_type,
        "quest_number": str(quest_number),
    }
    params.update(extra)
    return params


def _body(
    project: str,
    quest_type: str,
    quest_number: int,
    scope: str,
    **extra: object,
) -> dict:
    payload: dict = {
        "project": project,
        "quest_type": quest_type,
        "quest_number": quest_number,
        "scope": scope,
    }
    payload.update(extra)
    return payload


class IssueApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repo_root = Path(__file__).resolve().parents[1]
        self.temp = TempRepo(self.repo_root)
        self.addCleanup(self.temp.cleanup)

    def _create_quest(self, svc, name: str = "Issue Quest") -> dict:
        ensure_project(self.temp.root, "example")
        return svc.create_quest(
            repo_path=str(self.temp.root),
            project="example",
            quest_type="main",
            name=name,
        )

    def test_list_empty_when_file_absent(self) -> None:
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = self._create_quest(svc)
        resp = client.get(
            "/api/issues",
            query_string=_query("example", "main", out["quest_number"], scope="physicalplan"),
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json()["issues"], [])

    def test_list_status_filters(self) -> None:
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = self._create_quest(svc)
        qdir = quest_dir_on_checkout(self.temp.root, out)
        quest_fs.write_issues(
            qdir / "physicalplan_issues.md",
            [
                IssueEntry(
                    issue_id="QP-0001",
                    status="open",
                    owner_role="physical_plan_reviewer",
                    created_at="2026-01-01T00:00:00Z",
                    updated_at="2026-01-01T00:00:00Z",
                    title="Open",
                    details="Body",
                ),
                IssueEntry(
                    issue_id="QP-0002",
                    status="completed",
                    owner_role="physical_plan_reviewer",
                    created_at="2026-01-01T00:00:00Z",
                    updated_at="2026-01-02T00:00:00Z",
                    title="Done",
                    details="Body",
                ),
            ],
        )
        base = _query("example", "main", out["quest_number"], scope="physicalplan")
        all_resp = client.get("/api/issues", query_string=base)
        self.assertEqual(len(all_resp.get_json()["issues"]), 2)
        open_resp = client.get(
            "/api/issues",
            query_string={**base, "status": "open"},
        )
        self.assertEqual(len(open_resp.get_json()["issues"]), 1)
        self.assertEqual(open_resp.get_json()["issues"][0]["issue_id"], "QP-0001")
        done_resp = client.get(
            "/api/issues",
            query_string={**base, "status": "completed"},
        )
        self.assertEqual(len(done_resp.get_json()["issues"]), 1)
        self.assertEqual(done_resp.get_json()["issues"][0]["issue_id"], "QP-0002")

    def test_read_issue_with_responses(self) -> None:
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = self._create_quest(svc)
        qdir = quest_dir_on_checkout(self.temp.root, out)
        quest_fs.write_issues(
            qdir / "physicalplan_issues.md",
            [
                IssueEntry(
                    issue_id="QP-0001",
                    status="open",
                    owner_role="physical_plan_reviewer",
                    created_at="2026-01-01T00:00:00Z",
                    updated_at="2026-01-01T00:00:00Z",
                    title="T",
                    details="D",
                ),
            ],
        )
        (qdir / "physicalplan_issue_responses.md").write_text(
            "# Issue responses\n\n"
            "## Response QP-0001 2026-01-02T00:00:00Z\n\n"
            "- issue_id: QP-0001\n"
            "- outcome: Fixed\n"
            "- explanation: Done it.\n",
            encoding="utf-8",
        )
        resp = client.get(
            "/api/issues/QP-0001",
            query_string=_query("example", "main", out["quest_number"], scope="physicalplan"),
        )
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertEqual(body["issue_id"], "QP-0001")
        self.assertEqual(body["body"], "D")
        self.assertEqual(len(body["responses"]), 1)
        self.assertEqual(body["responses"][0]["outcome"], "Fixed")

    def test_read_missing_issue_404(self) -> None:
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = self._create_quest(svc)
        resp = client.get(
            "/api/issues/QP-0099",
            query_string=_query("example", "main", out["quest_number"], scope="physicalplan"),
        )
        self.assertEqual(resp.status_code, 404)

    def test_create_physicalplan_issue(self) -> None:
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = self._create_quest(svc)
        resp = client.post(
            "/api/issues",
            json=_body(
                "example",
                "main",
                out["quest_number"],
                "physicalplan",
                title="New issue",
                body="Issue details here.",
            ),
        )
        self.assertEqual(resp.status_code, 201)
        body = resp.get_json()
        self.assertEqual(body["issue_id"], "QP-0001")
        self.assertEqual(body["status"], "open")
        self.assertEqual(body["owner_role"], "physical_plan_reviewer")
        self.assertEqual(body["title"], "New issue")
        self.assertEqual(body["body"], "Issue details here.")
        self.assertEqual(body["details"], "Issue details here.")
        qdir = quest_dir_on_checkout(self.temp.root, out)
        loaded = quest_fs.read_issues(qdir / "physicalplan_issues.md")
        self.assertEqual(len(loaded), 1)
        self.assertEqual(loaded[0].issue_id, "QP-0001")

    def test_edit_preserves_omitted_fields(self) -> None:
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = self._create_quest(svc)
        with patch(
            "quest_runner_service.issue_service.utc_now_iso",
            side_effect=["2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z"],
        ):
            client.post(
                "/api/issues",
                json=_body(
                    "example",
                    "main",
                    out["quest_number"],
                    "physicalplan",
                    title="Original",
                    body="Original body",
                ),
            )
            resp = client.patch(
                "/api/issues/QP-0001",
                json=_body(
                    "example",
                    "main",
                    out["quest_number"],
                    "physicalplan",
                    status="completed",
                ),
            )
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertEqual(body["status"], "completed")
        self.assertEqual(body["title"], "Original")
        self.assertEqual(body["body"], "Original body")
        self.assertEqual(body["created_at"], "2026-01-01T00:00:00Z")
        self.assertEqual(body["updated_at"], "2026-01-02T00:00:00Z")

    def test_edit_rejects_invalid_status(self) -> None:
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = self._create_quest(svc)
        client.post(
            "/api/issues",
            json=_body(
                "example",
                "main",
                out["quest_number"],
                "physicalplan",
                title="T",
                body="B",
            ),
        )
        resp = client.patch(
            "/api/issues/QP-0001",
            json=_body(
                "example",
                "main",
                out["quest_number"],
                "physicalplan",
                status="invalid",
            ),
        )
        self.assertEqual(resp.status_code, 400)

    def test_respond_appends_without_changing_status(self) -> None:
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = self._create_quest(svc)
        client.post(
            "/api/issues",
            json=_body(
                "example",
                "main",
                out["quest_number"],
                "physicalplan",
                title="T",
                body="B",
            ),
        )
        resp = client.post(
            "/api/issues/QP-0001/responses",
            json=_body(
                "example",
                "main",
                out["quest_number"],
                "physicalplan",
                outcome="Fixed",
                explanation="Resolved in tests.",
            ),
        )
        self.assertEqual(resp.status_code, 201)
        payload = resp.get_json()
        self.assertEqual(payload["issue"]["status"], "open")
        self.assertEqual(payload["response"]["outcome"], "Fixed")
        qdir = quest_dir_on_checkout(self.temp.root, out)
        responses = quest_fs.read_issue_responses(
            qdir / "physicalplan_issue_responses.md"
        )
        self.assertEqual(len(responses), 1)
        self.assertEqual(responses[0].explanation, "Resolved in tests.")

    def test_respond_rejects_invalid_outcome(self) -> None:
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = self._create_quest(svc)
        client.post(
            "/api/issues",
            json=_body(
                "example",
                "main",
                out["quest_number"],
                "physicalplan",
                title="T",
                body="B",
            ),
        )
        resp = client.post(
            "/api/issues/QP-0001/responses",
            json=_body(
                "example",
                "main",
                out["quest_number"],
                "physicalplan",
                outcome="Maybe",
                explanation="Nope",
            ),
        )
        self.assertEqual(resp.status_code, 400)

    def test_respond_rejects_empty_explanation(self) -> None:
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = self._create_quest(svc)
        client.post(
            "/api/issues",
            json=_body(
                "example",
                "main",
                out["quest_number"],
                "physicalplan",
                title="T",
                body="B",
            ),
        )
        resp = client.post(
            "/api/issues/QP-0001/responses",
            json=_body(
                "example",
                "main",
                out["quest_number"],
                "physicalplan",
                outcome="Fixed",
                explanation="   ",
            ),
        )
        self.assertEqual(resp.status_code, 400)

    def test_list_responses_chronological_and_filtered(self) -> None:
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = self._create_quest(svc)
        qdir = quest_dir_on_checkout(self.temp.root, out)
        quest_fs.write_issues(
            qdir / "physicalplan_issues.md",
            [
                IssueEntry(
                    issue_id="QP-0001",
                    status="open",
                    owner_role="physical_plan_reviewer",
                    created_at="2026-01-01T00:00:00Z",
                    updated_at="2026-01-01T00:00:00Z",
                    title="T",
                    details="D",
                ),
                IssueEntry(
                    issue_id="QP-0002",
                    status="open",
                    owner_role="physical_plan_reviewer",
                    created_at="2026-01-01T00:00:00Z",
                    updated_at="2026-01-01T00:00:00Z",
                    title="T2",
                    details="D2",
                ),
            ],
        )
        (qdir / "physicalplan_issue_responses.md").write_text(
            "# Issue responses\n\n"
            "## Response QP-0001 2026-01-02T00:00:00Z\n\n"
            "- issue_id: QP-0001\n"
            "- outcome: Fixed\n"
            "- explanation: First.\n\n"
            "## Response QP-0002 2026-01-03T00:00:00Z\n\n"
            "- issue_id: QP-0002\n"
            "- outcome: NotFixed\n"
            "- explanation: Other.\n\n"
            "## Response QP-0001 2026-01-04T00:00:00Z\n\n"
            "- issue_id: QP-0001\n"
            "- outcome: Fixed\n"
            "- explanation: Second.\n",
            encoding="utf-8",
        )
        resp = client.get(
            "/api/issues/QP-0001/responses",
            query_string=_query("example", "main", out["quest_number"], scope="physicalplan"),
        )
        self.assertEqual(resp.status_code, 200)
        responses = resp.get_json()["responses"]
        self.assertEqual(len(responses), 2)
        self.assertEqual(responses[0]["explanation"], "First.")
        self.assertEqual(responses[1]["explanation"], "Second.")

    def test_physicalplan_rejects_slice(self) -> None:
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = self._create_quest(svc)
        resp = client.get(
            "/api/issues",
            query_string=_query(
                "example",
                "main",
                out["quest_number"],
                scope="physicalplan",
                slice="1",
            ),
        )
        self.assertEqual(resp.status_code, 400)

    def test_polishing_requires_slice(self) -> None:
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = self._create_quest(svc)
        resp = client.get(
            "/api/issues",
            query_string=_query("example", "main", out["quest_number"], scope="polishing"),
        )
        self.assertEqual(resp.status_code, 400)

    def test_polishing_scope_crud(self) -> None:
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = self._create_quest(svc)
        qdir = quest_dir_on_checkout(self.temp.root, out)
        slice_dir = qdir / "slices" / "0001_polish_test"
        slice_dir.mkdir(parents=True)
        (slice_dir / "state.md").write_text(
            "# Slice State\n\nstate: NotStarted\nupdated_at: 2026-01-01T00:00:00Z\n",
            encoding="utf-8",
        )
        slice_number = 1

        create_resp = client.post(
            "/api/issues",
            json=_body(
                "example",
                "main",
                out["quest_number"],
                "polishing",
                slice=slice_number,
                title="Polish issue",
                body="Polish body",
            ),
        )
        self.assertEqual(create_resp.status_code, 201)
        body = create_resp.get_json()
        self.assertEqual(body["issue_id"], "PL-0001")
        self.assertEqual(body["owner_role"], "polisher_reviewer")

        list_resp = client.get(
            "/api/issues",
            query_string=_query(
                "example",
                "main",
                out["quest_number"],
                scope="polishing",
                slice=str(slice_number),
            ),
        )
        self.assertEqual(len(list_resp.get_json()["issues"]), 1)

    def test_mutation_succeeds_when_run_lock_held(self) -> None:
        lock = QuestLock()
        client, svc = make_app_client(self.temp.root, self.repo_root, lock=lock)
        out = self._create_quest(svc)
        meta = quest_fs.read_quest_meta(Path(out["quest_dir"]))
        lock_key = lock_key_for_quest(self.temp.root, meta)
        self.assertTrue(lock.acquire(lock_key, "main", out["quest_number"], "holder"))
        try:
            resp = client.post(
                "/api/issues",
                json=_body(
                    "example",
                    "main",
                    out["quest_number"],
                    "physicalplan",
                    title="Blocked",
                    body="Should fail",
                ),
            )
            self.assertEqual(resp.status_code, 201)
            self.assertEqual(resp.get_json()["issue_id"], "QP-0001")
        finally:
            lock.release(lock_key)

    def test_mutation_without_worktree_succeeds(self) -> None:
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = self._create_quest(svc)
        cleanup_worktrees(self.temp.root)
        resp = client.post(
            "/api/issues",
            json=_body(
                "example",
                "main",
                out["quest_number"],
                "physicalplan",
                title="Pre-worktree",
                body="Created before worktree exists.",
            ),
        )
        self.assertEqual(resp.status_code, 201)
        source_qdir = quest_fs.find_quest_dir(
            self.temp.root, "example", "main", out["quest_number"]
        )
        assert source_qdir is not None
        issues = quest_fs.read_issues(source_qdir / "physicalplan_issues.md")
        self.assertEqual(len(issues), 1)
        self.assertEqual(issues[0].title, "Pre-worktree")


if __name__ == "__main__":
    unittest.main()
