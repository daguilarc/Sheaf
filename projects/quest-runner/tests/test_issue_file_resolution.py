"""Tests for workflow-backed issue file resolution."""

from __future__ import annotations

import unittest
from pathlib import Path

from quest_runner_service import issue_service, quest_fs
from quest_runner_service.dashboard_data import DashboardBadRequest

from .test_helpers import TempRepo, ensure_project, make_app_client, quest_dir_on_checkout


class IssueFileResolutionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repo_root = Path(__file__).resolve().parents[1]
        self.temp = TempRepo(self.repo_root)
        self.addCleanup(self.temp.cleanup)

    def _create_quest(self, svc, name: str = "Issue File Quest") -> dict:
        ensure_project(self.temp.root, "example")
        return svc.create_quest(
            repo_path=str(self.temp.root),
            project="example",
            quest_type="main",
            name=name,
        )

    def _ctx(self, out: dict, issue_file: str, **kwargs: object):
        return issue_service.resolve_issue_context_by_file(
            self.temp.root,
            project="example",
            quest_type="main",
            quest_number=out["quest_number"],
            issue_file=issue_file,
            **kwargs,
        )

    def test_physicalplan_issue_file_resolves(self) -> None:
        _client, svc = make_app_client(self.temp.root, self.repo_root)
        out = self._create_quest(svc)
        ctx = self._ctx(out, "physicalplan_issues.md")
        self.assertEqual(ctx.issue_file, "physicalplan_issues.md")
        self.assertEqual(ctx.workflow_issue_alias, "physical_plan")
        self.assertEqual(ctx.id_prefix, "QP")
        self.assertEqual(ctx.owner_role, "physical_plan_reviewer")
        self.assertTrue(
            str(ctx.issues_path).endswith("physicalplan_issues.md")
        )
        self.assertTrue(
            str(ctx.responses_path).endswith("physicalplan_issue_responses.md")
        )

    def test_polishing_issue_file_resolves_for_inactive_slice(self) -> None:
        _client, svc = make_app_client(self.temp.root, self.repo_root)
        out = self._create_quest(svc)
        qdir = quest_dir_on_checkout(self.temp.root, out)
        slice_dir = qdir / "slices" / "0009_inactive_slice"
        slice_dir.mkdir(parents=True)
        (slice_dir / "polishing_issues.md").write_text("# Issues\n", encoding="utf-8")
        issue_file = "slices/0009_inactive_slice/polishing_issues.md"
        ctx = self._ctx(out, issue_file)
        self.assertEqual(ctx.issue_file, issue_file)
        self.assertEqual(ctx.workflow_issue_alias, "polishing")
        self.assertEqual(ctx.id_prefix, "PL")
        self.assertEqual(ctx.owner_role, "polisher_reviewer")
        self.assertEqual(ctx.slice_dir, slice_dir.resolve())

    def test_owner_role_override(self) -> None:
        _client, svc = make_app_client(self.temp.root, self.repo_root)
        out = self._create_quest(svc)
        ctx = self._ctx(
            out,
            "physicalplan_issues.md",
            owner_role_override="custom_reviewer",
        )
        self.assertEqual(ctx.owner_role, "custom_reviewer")

    def test_rejects_absolute_path(self) -> None:
        _client, svc = make_app_client(self.temp.root, self.repo_root)
        out = self._create_quest(svc)
        with self.assertRaises(DashboardBadRequest) as ctx_err:
            self._ctx(out, "/tmp/physicalplan_issues.md")
        self.assertIn("issue_file", ctx_err.exception.fields)

    def test_rejects_parent_escape(self) -> None:
        _client, svc = make_app_client(self.temp.root, self.repo_root)
        out = self._create_quest(svc)
        with self.assertRaises(DashboardBadRequest):
            self._ctx(out, "../physicalplan_issues.md")

    def test_rejects_undeclared_issue_file(self) -> None:
        _client, svc = make_app_client(self.temp.root, self.repo_root)
        out = self._create_quest(svc)
        with self.assertRaises(DashboardBadRequest) as ctx_err:
            self._ctx(out, "notes/random_issues.md")
        self.assertEqual(ctx_err.exception.fields.get("issue_file"), "undeclared")

    def test_rejects_non_issues_suffix(self) -> None:
        _client, svc = make_app_client(self.temp.root, self.repo_root)
        out = self._create_quest(svc)
        with self.assertRaises(DashboardBadRequest):
            self._ctx(out, "physicalplan_issue_responses.md")

    def test_create_uses_qp_prefix_and_default_owner(self) -> None:
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = self._create_quest(svc)
        resp = client.post(
            "/api/issues",
            json={
                "project": "example",
                "quest_type": "main",
                "quest_number": out["quest_number"],
                "issue_file": "physicalplan_issues.md",
                "title": "New",
                "body": "Details",
            },
        )
        self.assertEqual(resp.status_code, 201)
        body = resp.get_json()
        self.assertEqual(body["issue_id"], "QP-0001")
        self.assertEqual(body["owner_role"], "physical_plan_reviewer")

    def test_create_polishing_uses_pl_prefix(self) -> None:
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = self._create_quest(svc)
        qdir = quest_dir_on_checkout(self.temp.root, out)
        slice_dir = qdir / "slices" / "0003_polish"
        slice_dir.mkdir(parents=True)
        (slice_dir / "polishing_issues.md").write_text("# Issues\n", encoding="utf-8")
        issue_file = "slices/0003_polish/polishing_issues.md"
        resp = client.post(
            "/api/issues",
            json={
                "project": "example",
                "quest_type": "main",
                "quest_number": out["quest_number"],
                "issue_file": issue_file,
                "title": "Polish",
                "body": "Body",
            },
        )
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.get_json()["issue_id"], "PL-0001")

    def test_create_owner_role_override(self) -> None:
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = self._create_quest(svc)
        resp = client.post(
            "/api/issues",
            json={
                "project": "example",
                "quest_type": "main",
                "quest_number": out["quest_number"],
                "issue_file": "physicalplan_issues.md",
                "owner_role": "alternate_reviewer",
                "title": "Owned",
                "body": "Body",
            },
        )
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.get_json()["owner_role"], "alternate_reviewer")

    def test_respond_writes_derived_response_file(self) -> None:
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = self._create_quest(svc)
        qdir = quest_dir_on_checkout(self.temp.root, out)
        slice_dir = qdir / "slices" / "0002_slice"
        slice_dir.mkdir(parents=True)
        issue_file = "slices/0002_slice/polishing_issues.md"
        quest_fs.write_issues(
            slice_dir / "polishing_issues.md",
            [],
        )
        client.post(
            "/api/issues",
            json={
                "project": "example",
                "quest_type": "main",
                "quest_number": out["quest_number"],
                "issue_file": issue_file,
                "title": "T",
                "body": "B",
            },
        )
        resp = client.post(
            "/api/issues/PL-0001/responses",
            json={
                "project": "example",
                "quest_type": "main",
                "quest_number": out["quest_number"],
                "issue_file": issue_file,
                "outcome": "Fixed",
                "explanation": "Done.",
            },
        )
        self.assertEqual(resp.status_code, 201)
        responses = quest_fs.read_issue_responses(
            slice_dir / "polishing_issue_responses.md"
        )
        self.assertEqual(len(responses), 1)
        self.assertEqual(responses[0].explanation, "Done.")

    def test_missing_issue_file_parameter(self) -> None:
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = self._create_quest(svc)
        resp = client.get(
            "/api/issues",
            query_string={
                "project": "example",
                "quest_type": "main",
                "quest_number": str(out["quest_number"]),
            },
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("issue_file", resp.get_json().get("fields", {}))


if __name__ == "__main__":
    unittest.main()
