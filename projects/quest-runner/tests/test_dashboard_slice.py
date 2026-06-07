"""Tests for slice_page and agent_log dashboard APIs."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from quest_runner_service import quest_fs
from quest_runner_service.dashboard_slice import (
    DashboardNotFound,
    agents_subpage_payload,
    collect_step_logs_for_role,
    parse_agent_key,
    quest_agents_payload,
    render_dashboard_markdown,
    validate_agent_role,
)
from quest_runner_service.quest_types import IssueEntry, SliceState, SliceStateInfo, utc_now_iso

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
        quest_fs.write_slice_state(
            sdir,
            SliceStateInfo(
                state=SliceState.NotStarted,
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

    def test_quest_agents_page(self) -> None:
        client, qdir = self._make_quest_with_slice()
        quest_fs.write_thread_registry(
            qdir,
            {
                "documenter": {
                    "thread_name": "doc-thread",
                    "harness_kind": "cursor",
                    "provider_thread_id": "x",
                    "pass_id": 0,
                    "round_count": 0,
                    "created_at": "2026-01-01T00:00:00Z",
                    "last_used_at": "2026-01-04T00:00:00Z",
                }
            },
        )
        logs = qdir / "logs"
        logs.mkdir()
        (logs / "step_0007_documenter.jsonl").write_text(
            '{"event_kind":"quest"}\n', encoding="utf-8"
        )
        r = client.get(
            "/api/dashboard/quest_agents",
            query_string={
                "project": "example",
                "quest_type": "main",
                "quest_number": "0",
            },
        )
        self.assertEqual(r.status_code, 200)
        agents = r.get_json()["agents"]
        self.assertTrue(all(a["scope"] == "quest" for a in agents))

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
                "agent_key": "slice:polisher",
            },
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_json()["metadata"]["step"], 10)


class AgentAssemblyUnitTests(unittest.TestCase):
    def test_collect_step_logs_order(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            qdir = Path(tmp) / "quest"
            logs = qdir / "logs"
            logs.mkdir(parents=True)
            (logs / "step_0002_implementer.jsonl").write_text("b", encoding="utf-8")
            (logs / "step_0001_implementer.jsonl").write_text("a", encoding="utf-8")
            found = collect_step_logs_for_role(qdir, "implementer")
            self.assertEqual([t[0] for t in found], [1, 2])

    def test_parse_agent_key(self) -> None:
        self.assertEqual(parse_agent_key("quest:documenter"), ("quest", "documenter"))

    def test_validate_agent_role_quest_on_slice_fails(self) -> None:
        with self.assertRaises(DashboardNotFound):
            validate_agent_role("slice", "physical_planner")

    def test_render_dashboard_markdown_formats_basic_markdown(self) -> None:
        html = render_dashboard_markdown("# Title\n\n- **bold** item\n\n`code`")
        self.assertIn("<h1>Title</h1>", html)


if __name__ == "__main__":
    unittest.main()
