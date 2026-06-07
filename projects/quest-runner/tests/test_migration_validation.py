"""Migration hardening checks for slice 6 validation."""

from __future__ import annotations

import re
import unittest
from pathlib import Path

from quest_runner_service.quest_runner import runtime_quest_docs_dir

_SRC_ROOT = Path(__file__).resolve().parents[1] / "src" / "quest_runner_service"
_DASHBOARD_ASSETS = _SRC_ROOT / "dashboard_assets"
_FORBIDDEN_SRC_PATTERNS = re.compile(
    r"/Users/joyo/conductor|conductor\.db|sqlite|mcp_server|ServiceManager|"
    r"register_service|start_service|stop_service|restart_service|/mcp|/trace"
)


class RuntimeQuestDocsTests(unittest.TestCase):
    def test_runtime_quest_docs_dir_is_bundled_in_package(self) -> None:
        docs = runtime_quest_docs_dir()
        self.assertTrue(docs.is_dir())
        self.assertEqual(docs.name, "quest_docs")
        self.assertIn("quest_runner_service/quest_docs", docs.as_posix())
        self.assertNotIn("/Users/joyo/conductor", docs.as_posix())
        self.assertTrue((docs / "schemas.md").is_file())

    def test_runtime_quest_docs_dir_differs_from_human_docs(self) -> None:
        human_docs = Path(__file__).resolve().parents[1] / "docs"
        runtime_docs = runtime_quest_docs_dir()
        self.assertNotEqual(runtime_docs.resolve(), human_docs.resolve())


class ProductSourceExclusionTests(unittest.TestCase):
    def test_product_source_has_no_forbidden_orchestrator_patterns(self) -> None:
        offenders: list[str] = []
        for path in _SRC_ROOT.rglob("*"):
            if not path.is_file():
                continue
            if path.suffix not in {".py", ".mjs", ".js", ".html", ".css", ".yaml", ".md"}:
                continue
            text = path.read_text(encoding="utf-8")
            for match in _FORBIDDEN_SRC_PATTERNS.finditer(text):
                rel = path.relative_to(_SRC_ROOT).as_posix()
                offenders.append(f"{rel}: {match.group(0)}")
        self.assertEqual(offenders, [])

    def test_no_service_log_route_strings_in_api_module(self) -> None:
        api_text = (_SRC_ROOT / "api.py").read_text(encoding="utf-8")
        self.assertNotIn('"/logs"', api_text)
        self.assertNotIn('"/trace"', api_text)
        self.assertNotIn('"/mcp"', api_text)


class DashboardCompatibilityCleanupTests(unittest.TestCase):
    def test_app_js_does_not_use_repo_path_query_fallback(self) -> None:
        app_js = (_DASHBOARD_ASSETS / "app.js").read_text(encoding="utf-8")
        self.assertNotIn("repo_path", app_js)

    def test_dashboard_logic_uses_quest_runner_storage_key(self) -> None:
        logic = (_DASHBOARD_ASSETS / "dashboard-logic.mjs").read_text(encoding="utf-8")
        self.assertIn("quest_runner_dashboard.project", logic)
        self.assertNotIn("conductor_dashboard.project", logic)

    def test_dashboard_title_is_quest_runner(self) -> None:
        html = (_DASHBOARD_ASSETS / "index.html").read_text(encoding="utf-8")
        self.assertIn("Quest Runner Dashboard", html)
        self.assertNotIn("Conductor Quest Dashboard", html)


if __name__ == "__main__":
    unittest.main()
