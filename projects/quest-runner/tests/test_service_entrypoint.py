"""Tests for the quest runner service entry point."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from quest_runner_service import __main__ as service_main


class ServiceEntrypointTests(unittest.TestCase):
    def test_health_returns_status(self) -> None:
        app = service_main.create_app()

        response = app.test_client().get("/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["healthy"], True)

    def test_exit_endpoint_schedules_process_exit(self) -> None:
        app = service_main.create_app()

        with patch.object(service_main, "_schedule_process_exit") as schedule_exit:
            response = app.test_client().post("/exit")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"status": "exiting"})
        schedule_exit.assert_called_once_with()

    def test_schedule_process_exit_uses_daemon_timer(self) -> None:
        with patch.object(service_main.threading, "Timer") as timer_class:
            timer = timer_class.return_value

            service_main._schedule_process_exit(delay=0.0)

        timer_class.assert_called_once_with(0.0, service_main._exit_process)
        self.assertEqual(timer.daemon, True)
        timer.start.assert_called_once_with()
