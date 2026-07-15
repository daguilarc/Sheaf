"""Tests for the quest runner service entry point."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from quest_runner_service.__main__ import (
    ServiceEndpointError,
    _resolve_bind_endpoint,
)
from quest_runner_service.api import create_app
from quest_runner_service.quest_lock import QuestLock
from quest_runner_service.quest_service import QuestService


class BindEndpointResolutionTests(unittest.TestCase):
    def _repo(self, services: object) -> tempfile.TemporaryDirectory[str]:
        temporary = tempfile.TemporaryDirectory()
        config_dir = Path(temporary.name) / "config"
        config_dir.mkdir()
        (config_dir / "services.json").write_text(
            json.dumps(services),
            encoding="utf-8",
        )
        return temporary

    def test_uses_registered_endpoint_by_default(self) -> None:
        services = [
            {"name": "quest-runner", "host": "0.0.0.0", "port": 9002},
        ]
        with self._repo(services) as repo:
            endpoint = _resolve_bind_endpoint(Path(repo))
        self.assertEqual(endpoint, ("0.0.0.0", 9002))

    def test_cli_overrides_apply_per_field(self) -> None:
        services = [
            {"name": "quest-runner", "host": "0.0.0.0", "port": 9002},
        ]
        with self._repo(services) as repo:
            host_override = _resolve_bind_endpoint(Path(repo), cli_host="127.0.0.1")
            port_override = _resolve_bind_endpoint(Path(repo), cli_port=9100)
        self.assertEqual(host_override, ("127.0.0.1", 9002))
        self.assertEqual(port_override, ("0.0.0.0", 9100))

    def test_missing_registry_fails(self) -> None:
        with tempfile.TemporaryDirectory() as repo:
            with self.assertRaisesRegex(
                ServiceEndpointError,
                "services.json is missing",
            ):
                _resolve_bind_endpoint(Path(repo))

    def test_malformed_or_non_array_registry_fails(self) -> None:
        with tempfile.TemporaryDirectory() as repo:
            config_dir = Path(repo) / "config"
            config_dir.mkdir()
            services_path = config_dir / "services.json"
            services_path.write_text("not-json", encoding="utf-8")
            with self.assertRaisesRegex(ServiceEndpointError, "invalid JSON"):
                _resolve_bind_endpoint(Path(repo))
            services_path.write_text("{}", encoding="utf-8")
            with self.assertRaisesRegex(ServiceEndpointError, "must contain an array"):
                _resolve_bind_endpoint(Path(repo))

    def test_missing_or_duplicate_entry_fails(self) -> None:
        with self._repo([]) as repo:
            with self.assertRaisesRegex(ServiceEndpointError, "is not registered"):
                _resolve_bind_endpoint(Path(repo))
        duplicate = {"name": "quest-runner", "host": "0.0.0.0", "port": 9002}
        with self._repo([duplicate, duplicate]) as repo:
            with self.assertRaisesRegex(ServiceEndpointError, "registered more than once"):
                _resolve_bind_endpoint(Path(repo))

    def test_invalid_registered_host_or_port_fails(self) -> None:
        invalid_entries = [
            ({"name": "quest-runner", "host": " ", "port": 9002}, "invalid host"),
            (
                {"name": "quest-runner", "host": "0.0.0.0", "port": True},
                "invalid port",
            ),
            ({"name": "quest-runner", "host": "0.0.0.0", "port": 0}, "invalid port"),
            (
                {"name": "quest-runner", "host": "0.0.0.0", "port": 65536},
                "invalid port",
            ),
        ]
        for entry, message in invalid_entries:
            with self.subTest(entry=entry):
                with self._repo([entry]) as repo:
                    with self.assertRaisesRegex(ServiceEndpointError, message):
                        _resolve_bind_endpoint(Path(repo))

    def test_invalid_cli_overrides_fail(self) -> None:
        entry = {"name": "quest-runner", "host": "0.0.0.0", "port": 9002}
        with self._repo([entry]) as repo:
            with self.assertRaisesRegex(ServiceEndpointError, "invalid host"):
                _resolve_bind_endpoint(Path(repo), cli_host=" ")
            with self.assertRaisesRegex(ServiceEndpointError, "invalid port"):
                _resolve_bind_endpoint(Path(repo), cli_port=65536)


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

    def test_launcher_does_not_override_registered_port(self) -> None:
        project_root = Path(__file__).resolve().parents[1]
        launcher = (project_root / "start_quest_runner.sh").read_text(
            encoding="utf-8"
        )
        self.assertNotIn("--port 9002", launcher)
