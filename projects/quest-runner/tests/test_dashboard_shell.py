"""Integration tests for dashboard HTML shell and static asset routes."""

from __future__ import annotations

import shutil
import subprocess
import unittest
from pathlib import Path

from .test_helpers import TempRepo, make_app_client


class DashboardShellRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repo_root = Path(__file__).resolve().parents[1]
        self.temp = TempRepo(self.repo_root)
        self.addCleanup(self.temp.cleanup)

    def test_dashboard_and_assets_served(self) -> None:
        client, _svc = make_app_client(self.temp.root, self.repo_root)
        r = client.get("/dashboard")
        self.assertEqual(r.status_code, 200)
        self.assertIn(b"Quest Runner Dashboard", r.data)
        self.assertIn(b"/dashboard/assets/app.js", r.data)
        css = client.get("/dashboard/assets/styles.css")
        self.assertEqual(css.status_code, 200)
        self.assertIn(b"--dash-bg", css.data)
        js = client.get("/dashboard/assets/app.js")
        self.assertEqual(js.status_code, 200)
        self.assertIn(b"RefreshScheduler", js.data)
        logic = client.get("/dashboard/assets/dashboard-logic.mjs")
        self.assertEqual(logic.status_code, 200)
        utils = client.get("/dashboard/assets/dashboard-pages-utils.mjs")
        self.assertEqual(utils.status_code, 200)


class DashboardJsUnitTests(unittest.TestCase):
    def _node_bin(self) -> str:
        return shutil.which("node") or "/opt/homebrew/bin/node"

    def test_dashboard_logic_mjs_passes_node_test(self) -> None:
        root = Path(__file__).resolve().parents[1]
        test_path = (
            root
            / "src"
            / "quest_runner_service"
            / "dashboard_assets"
            / "dashboard-logic.test.mjs"
        )
        proc = subprocess.run(
            [self._node_bin(), "--test", str(test_path)],
            cwd=str(test_path.parent),
            capture_output=True,
            text=True,
        )
        self.assertEqual(
            proc.returncode,
            0,
            msg=proc.stdout + "\n" + proc.stderr,
        )

    def test_dashboard_pages_utils_mjs_passes_node_test(self) -> None:
        root = Path(__file__).resolve().parents[1]
        test_path = (
            root
            / "src"
            / "quest_runner_service"
            / "dashboard_assets"
            / "dashboard-pages-utils.test.mjs"
        )
        proc = subprocess.run(
            [self._node_bin(), "--test", str(test_path)],
            cwd=str(test_path.parent),
            capture_output=True,
            text=True,
        )
        self.assertEqual(
            proc.returncode,
            0,
            msg=proc.stdout + "\n" + proc.stderr,
        )


if __name__ == "__main__":
    unittest.main()
