"""REST route tests for quest creation and execution."""

from __future__ import annotations

import ast
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlparse

from quest_runner_service import quest_fs
from quest_runner_service.quest_lock import QuestLock
from quest_runner_service.quest_service import QuestService

from .test_helpers import TempRepo, cleanup_worktrees, ensure_project, make_app_client, quest_dir_on_checkout


class ForbiddenImportTests(unittest.TestCase):
    def test_product_code_avoids_forbidden_imports(self) -> None:
        src = Path(__file__).resolve().parents[1] / "src" / "quest_runner_service"
        forbidden = {"sqlite3", "db", "ServiceManager", "mcp_server"}
        offenders: list[str] = []
        for path in src.rglob("*.py"):
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        base = alias.name.split(".")[0]
                        if base in forbidden:
                            offenders.append(f"{path.name}: import {alias.name}")
                elif isinstance(node, ast.ImportFrom):
                    if node.module:
                        base = node.module.split(".")[0]
                        if base in forbidden:
                            offenders.append(f"{path.name}: from {node.module}")
        self.assertEqual(offenders, [])


class AbsentRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repo_root = Path(__file__).resolve().parents[1]
        self.temp = TempRepo(self.repo_root)
        self.addCleanup(self.temp.cleanup)

    def test_service_manager_and_mcp_routes_absent(self) -> None:
        client, _svc = make_app_client(self.temp.root, self.repo_root)
        absent_paths = [
            "/services",
            "/register_service",
            "/logs",
            "/trace",
            "/mcp",
            "/start_service",
            "/stop_service",
            "/restart_service",
            "/all_health",
        ]
        for path in absent_paths:
            get_resp = client.get(path)
            post_resp = client.post(path, json={})
            self.assertEqual(get_resp.status_code, 404, msg=path)
            self.assertEqual(post_resp.status_code, 404, msg=path)


class QuestServiceApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repo_root = Path(__file__).resolve().parents[1]
        self.temp = TempRepo(self.repo_root)
        self.addCleanup(self.temp.cleanup)

    def test_health_shape(self) -> None:
        client, _svc = make_app_client(self.temp.root, self.repo_root, started_at=1000.0)
        with patch("time.time", return_value=1010.5):
            resp = client.get("/health")
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertEqual(body["healthy"], True)
        self.assertEqual(body["uptime"], 10.5)
        self.assertNotIn("service_count", body)

    def test_exit_endpoint(self) -> None:
        called: list[bool] = []

        def shutdown() -> None:
            called.append(True)

        from quest_runner_service.api import create_app as real_create_app

        svc = QuestService(QuestLock(), self.repo_root)
        app = real_create_app(
            quest_service=svc,
            source_repo_root=self.temp.root,
            started_at=1000.0,
            shutdown_callback=shutdown,
        )
        resp = app.test_client().post("/exit")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json(), {"status": "exiting"})
        self.assertEqual(called, [True])

    def test_create_quest_requires_project(self) -> None:
        client, _svc = make_app_client(self.temp.root, self.repo_root)
        resp = client.post(
            "/create_quest",
            json={"quest_type": "main", "name": "X"},
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("project", resp.get_json()["error"])

    def test_create_quest_returns_project_identity(self) -> None:
        ensure_project(self.temp.root, "example")
        client, _svc = make_app_client(self.temp.root, self.repo_root)
        resp = client.post(
            "/create_quest",
            json={
                "project": "example",
                "quest_type": "main",
                "name": "HTTP Quest",
            },
        )
        self.assertEqual(resp.status_code, 201)
        body = resp.get_json()
        self.assertEqual(body["project"], "example")
        self.assertEqual(body["quest_type"], "main")
        self.assertEqual(body["quest_slug"], "http_quest")
        self.assertIn("worktree_path", body)
        self.assertIn("created_files", body)

    def test_run_quest_requires_project(self) -> None:
        client, _svc = make_app_client(self.temp.root, self.repo_root)
        resp = client.post(
            "/run_quest",
            json={"quest_type": "main", "quest_number": 0},
        )
        self.assertEqual(resp.status_code, 400)

    def test_run_quest_not_found(self) -> None:
        ensure_project(self.temp.root, "example")
        client, _svc = make_app_client(self.temp.root, self.repo_root)
        resp = client.post(
            "/run_quest",
            json={
                "project": "example",
                "quest_type": "main",
                "quest_number": 0,
            },
        )
        self.assertEqual(resp.status_code, 404)

    def test_run_quest_missing_worktree_returns_409(self) -> None:
        ensure_project(self.temp.root, "example")
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = svc.create_quest(
            repo_path=str(self.temp.root),
            project="example",
            quest_type="main",
            name="No Worktree",
        )
        cleanup_worktrees(self.temp.root)
        resp = client.post(
            "/run_quest",
            json={
                "project": "example",
                "quest_type": "main",
                "quest_number": out["quest_number"],
            },
        )
        self.assertEqual(resp.status_code, 409)
        body = resp.get_json()
        self.assertEqual(body["project"], "example")
        self.assertEqual(body["quest_type"], "main")
        self.assertIn("expected_worktree", body)

    def test_run_quest_malformed_state_returns_422(self) -> None:
        ensure_project(self.temp.root, "example")
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = svc.create_quest(
            repo_path=str(self.temp.root),
            project="example",
            quest_type="main",
            name="Bad State",
        )
        worktree_qdir = quest_dir_on_checkout(self.temp.root, out)
        (worktree_qdir / "state.md").write_text("broken\n", encoding="utf-8")
        resp = client.post(
            "/run_quest",
            json={
                "project": "example",
                "quest_type": "main",
                "quest_number": out["quest_number"],
            },
        )
        self.assertEqual(resp.status_code, 422)

    def test_run_quest_pre_planning_exit(self) -> None:
        ensure_project(self.temp.root, "example")
        client, svc = make_app_client(self.temp.root, self.repo_root)
        out = svc.create_quest(
            repo_path=str(self.temp.root),
            project="example",
            quest_type="main",
            name="PrePlan",
        )
        resp = client.post(
            "/run_quest",
            json={
                "project": "example",
                "quest_type": "main",
                "quest_number": out["quest_number"],
            },
        )
        self.assertEqual(resp.status_code, 202)
        body = resp.get_json()
        self.assertIn("run_id", body)
        self.assertIn(body["status"], ("running", "paused"))
        self.assertIn("project=example", body["quest_url"])
        parsed = urlparse(body["status_url"])
        status_path = parsed.path
        if parsed.query:
            status_path = f"{status_path}?{parsed.query}"
        deadline = time.time() + 5.0
        rs = None
        while time.time() < deadline:
            rs = client.get(status_path)
            self.assertEqual(rs.status_code, 200)
            if rs.get_json()["execution_overlay_status"] == "none":
                break
            time.sleep(0.03)
        assert rs is not None
        self.assertEqual(rs.get_json()["execution_overlay_status"], "none")
        self.assertEqual(rs.get_json()["quest_state"], "PrePlanning")

    def test_run_quest_lock_contention(self) -> None:
        ensure_project(self.temp.root, "example")
        lock = QuestLock()
        client, svc = make_app_client(self.temp.root, self.repo_root, lock=lock)
        out = svc.create_quest(
            repo_path=str(self.temp.root),
            project="example",
            quest_type="main",
            name="Lock Quest",
        )
        from quest_runner_service import dashboard_data
        from quest_runner_service import quest_fs as qfs

        qdir = qfs.find_quest_dir(
            self.temp.root, "example", "main", out["quest_number"]
        )
        assert qdir is not None
        meta = qfs.read_quest_meta(qdir)
        lock_key = dashboard_data.lock_key_for_quest(self.temp.root, meta)
        self.assertTrue(lock.acquire(lock_key, "main", out["quest_number"], "holding"))
        try:
            resp = client.post(
                "/run_quest",
                json={
                    "project": "example",
                    "quest_type": "main",
                    "quest_number": out["quest_number"],
                    "max_steps": 1,
                },
            )
            self.assertEqual(resp.status_code, 409)
            data = resp.get_json()
            self.assertIn("lock_owner", data)
        finally:
            lock.release(lock_key)

    def test_run_quest_invalid_max_steps(self) -> None:
        client, _svc = make_app_client(self.temp.root, self.repo_root)
        resp = client.post(
            "/run_quest",
            json={
                "project": "example",
                "quest_type": "main",
                "quest_number": 0,
                "max_steps": 0,
            },
        )
        self.assertEqual(resp.status_code, 400)

    def test_run_quest_returns_202_with_mock_schedule(self) -> None:
        client, svc = make_app_client(self.temp.root, self.repo_root)
        with patch.object(
            svc,
            "schedule_run_quest",
            return_value={
                "run_id": "rid-1",
                "status": "running",
                "quest_url": "http://localhost/dashboard?project=example",
                "status_url": "http://localhost/api/dashboard/run_status?project=example",
            },
        ):
            resp = client.post(
                "/run_quest",
                json={
                    "project": "example",
                    "quest_type": "main",
                    "quest_number": 0,
                },
            )
        self.assertEqual(resp.status_code, 202)
        self.assertEqual(resp.get_json()["run_id"], "rid-1")


if __name__ == "__main__":
    unittest.main()
