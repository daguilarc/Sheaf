"""Tests for slice_page and agent_log dashboard APIs."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from quest_runner_service import quest_fs
from quest_runner_service.dashboard_slice import (
    DashboardNotFound,
    collect_agent_step_logs,
    render_dashboard_markdown,
    resolve_agent_log_path,
)
from quest_runner_service.quest_types import IssueEntry, SliceFileState, utc_now_iso

from .test_helpers import TempRepo, ensure_project, make_app_client, quest_dir_on_checkout


class SlicePageHttpTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repo_root = Path(__file__).resolve().parents[1]
        self.temp = TempRepo(self.repo_root)
        self.addCleanup(self.temp.cleanup)

    def _make_quest_with_slice(self):
        ensure_project(self.temp.root, "example")
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = svc.create_quest(
            str(self.temp.root), "example", "main", "Slicey"
        )
        qdir = quest_dir_on_checkout(self.temp.root, out)
        sdir = qdir / "slices" / "0000_alpha"
        sdir.mkdir(parents=True)
        quest_fs.write_slice_file_state(
            sdir,
            SliceFileState(
                state="NotStarted",
                updated_at=utc_now_iso(),
            ),
        )
        pp = sdir / "physicalplan"
        pp.mkdir()
        (pp / "z_plan.md").write_text("# Z\n", encoding="utf-8")
        (pp / "a_plan.md").write_text("# A\n", encoding="utf-8")
        quest_fs.write_issues(
            sdir / "polishing_issues.md",
            [
                IssueEntry(
                    issue_id="PL-0001",
                    status="open",
                    owner_role="polisher_reviewer",
                    created_at="2026-01-01T00:00:00Z",
                    updated_at="2026-01-02T00:00:00Z",
                    title="T",
                    details="D",
                ),
            ],
        )
        return client, qdir

    def test_slice_page_physicalplan_sorted(self) -> None:
        client, _qdir = self._make_quest_with_slice()
        r = client.get(
            "/api/dashboard/slice_page",
            query_string={
                "project": "example",
                "quest_type": "main",
                "quest_number": "0",
                "slice_number": "0",
                "subpage": "physicalplan",
            },
        )
        self.assertEqual(r.status_code, 200)
        names = [f["name"] for f in r.get_json()["payload"]["files"]]
        self.assertEqual(names, ["a_plan.md", "z_plan.md"])

    def test_slice_page_issues(self) -> None:
        client, _qdir = self._make_quest_with_slice()
        r = client.get(
            "/api/dashboard/slice_page",
            query_string={
                "project": "example",
                "quest_type": "main",
                "quest_number": "0",
                "slice_number": "0",
                "subpage": "issues",
            },
        )
        self.assertEqual(r.status_code, 200)
        p = r.get_json()["payload"]
        self.assertEqual(p["open_count"], 1)

    def test_agent_steps_page_discovers_all_logs(self) -> None:
        client, qdir = self._make_quest_with_slice()
        logs = qdir / "logs"
        logs.mkdir()
        (logs / "step_0007_documenter.jsonl").write_text(
            '{"event_kind":"quest"}\n', encoding="utf-8"
        )
        (logs / "step_0011_unexpected_role.jsonl").write_text(
            '{"event_kind":"custom"}\n', encoding="utf-8"
        )
        r = client.get(
            "/api/dashboard/agent_steps",
            query_string={
                "project": "example",
                "quest_type": "main",
                "quest_number": "0",
            },
        )
        self.assertEqual(r.status_code, 200)
        body = r.get_json()
        self.assertEqual(body["default_step"], 11)
        self.assertEqual([s["step"] for s in body["steps"]], [11, 7])
        self.assertEqual(body["steps"][0]["role"], "unexpected_role")

    def test_agent_log_latest(self) -> None:
        client, qdir = self._make_quest_with_slice()
        logs = qdir / "logs"
        logs.mkdir()
        (logs / "step_0005_polisher.jsonl").write_text(
            '{"event_kind":"polish"}\n', encoding="utf-8"
        )
        (logs / "step_0010_polisher.jsonl").write_text(
            '{"event_kind":"newer polish"}\n', encoding="utf-8"
        )
        r = client.get(
            "/api/dashboard/agent_log",
            query_string={
                "project": "example",
                "quest_type": "main",
                "quest_number": "0",
            },
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_json()["metadata"]["step"], 10)

    def test_agent_log_explicit_step(self) -> None:
        client, qdir = self._make_quest_with_slice()
        logs = qdir / "logs"
        logs.mkdir()
        (logs / "step_0005_polisher.jsonl").write_text(
            '{"event_kind":"polish"}\n', encoding="utf-8"
        )
        (logs / "step_0010_polisher_reviewer.jsonl").write_text(
            '{"event_kind":"review"}\n', encoding="utf-8"
        )
        r = client.get(
            "/api/dashboard/agent_log",
            query_string={
                "project": "example",
                "quest_type": "main",
                "quest_number": "0",
                "step": "5",
            },
        )
        self.assertEqual(r.status_code, 200)
        body = r.get_json()
        self.assertEqual(body["metadata"]["step"], 5)
        self.assertEqual(body["metadata"]["role"], "polisher")


class AgentAssemblyUnitTests(unittest.TestCase):
    def test_collect_step_logs_order(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            qdir = Path(tmp) / "quest"
            logs = qdir / "logs"
            logs.mkdir(parents=True)
            (logs / "step_0002_implementer.jsonl").write_text("b", encoding="utf-8")
            (logs / "step_0001_implementer.jsonl").write_text("a", encoding="utf-8")
            (logs / "step_0003_custom_role.jsonl").write_text("c", encoding="utf-8")
            found = collect_agent_step_logs(qdir)
            self.assertEqual([t.step for t in found], [3, 2, 1])
            self.assertEqual(found[0].role, "custom_role")

    def test_resolve_agent_log_path_unknown_step_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            qdir = Path(tmp) / "quest"
            logs = qdir / "logs"
            logs.mkdir(parents=True)
            (logs / "step_0002_implementer.jsonl").write_text("b", encoding="utf-8")
            with self.assertRaises(DashboardNotFound):
                resolve_agent_log_path(quest_dir=qdir, step=99)

    def test_render_dashboard_markdown_formats_basic_markdown(self) -> None:
        html = render_dashboard_markdown("# Title\n\n- **bold** item\n\n`code`")
        self.assertIn("<h1>Title</h1>", html)


if __name__ == "__main__":
    unittest.main()
