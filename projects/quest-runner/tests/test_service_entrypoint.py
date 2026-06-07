"""Tests for the quest runner service entry point."""

from __future__ import annotations

import unittest
from pathlib import Path
from unittest.mock import patch

from quest_runner_service.api import create_app
from quest_runner_service.quest_lock import QuestLock
from quest_runner_service.quest_service import QuestService


class ServiceEntrypointTests(unittest.TestCase):
    def _app(self):
        repo_root = Path(__file__).resolve().parents[1]
        svc = QuestService(QuestLock(), repo_root)
        return create_app(
            quest_service=svc,
            source_repo_root=repo_root,
            started_at=1000.0,
        )

    def test_health_returns_status(self) -> None:
        app = self._app()
        with patch("time.time", return_value=1005.0):
            response = app.test_client().get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["healthy"], True)
        self.assertEqual(response.get_json()["uptime"], 5.0)

    def test_exit_endpoint_schedules_shutdown(self) -> None:
        called: list[bool] = []

        def shutdown() -> None:
            called.append(True)

        repo_root = Path(__file__).resolve().parents[1]
        svc = QuestService(QuestLock(), repo_root)
        app = create_app(
            quest_service=svc,
            source_repo_root=repo_root,
            started_at=1000.0,
            shutdown_callback=shutdown,
        )
        response = app.test_client().post("/exit")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"status": "exiting"})
        self.assertEqual(called, [True])
