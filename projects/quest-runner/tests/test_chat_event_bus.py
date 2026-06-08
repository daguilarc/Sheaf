"""Tests for ChatEventBus pub/sub."""

from __future__ import annotations

import queue
import threading
import unittest
from pathlib import Path

from quest_runner_service.chat_event_bus import ChatEventBus  # type: ignore[import-not-found]


class ChatEventBusTests(unittest.TestCase):
    def setUp(self) -> None:
        self.bus = ChatEventBus()
        self.log_path = Path("/tmp/quest-runner/test_agent_log.jsonl")

    def _publish(self, event: dict) -> None:
        self.bus.publish(self.log_path, event)

    def test_single_subscriber_receives_event(self) -> None:
        subscription = self.bus.subscribe(self.log_path)
        self.addCleanup(subscription.unsubscribe)

        event = {"sequence": 1, "event_kind": "sheaf.prompt"}
        self._publish(event)

        received = subscription.queue.get(timeout=1.0)
        self.assertIs(received, event)

    def test_multiple_subscribers_receive_same_event(self) -> None:
        first = self.bus.subscribe(self.log_path)
        second = self.bus.subscribe(self.log_path)
        self.addCleanup(first.unsubscribe)
        self.addCleanup(second.unsubscribe)

        event = {"sequence": 2, "event_kind": "sheaf.prompt"}
        self._publish(event)

        self.assertIs(first.queue.get(timeout=1.0), event)
        self.assertIs(second.queue.get(timeout=1.0), event)

    def test_different_path_does_not_receive_event(self) -> None:
        subscription = self.bus.subscribe(Path("/tmp/quest-runner/other_log.jsonl"))
        self.addCleanup(subscription.unsubscribe)

        self._publish({"sequence": 3})

        with self.assertRaises(queue.Empty):
            subscription.queue.get(timeout=0.05)

    def test_unsubscribe_stops_delivery_and_is_idempotent(self) -> None:
        subscription = self.bus.subscribe(self.log_path)

        subscription.unsubscribe()
        subscription.unsubscribe()

        self._publish({"sequence": 4})

        with self.assertRaises(queue.Empty):
            subscription.queue.get(timeout=0.05)

    def test_concurrent_publish_subscribe_smoke(self) -> None:
        errors: list[Exception] = []
        path = self.log_path.resolve()

        def publisher() -> None:
            try:
                for index in range(100):
                    self.bus.publish(path, {"sequence": index})
            except Exception as exc:
                errors.append(exc)

        def subscriber() -> None:
            try:
                for _ in range(10):
                    sub = self.bus.subscribe(path)
                    self.bus.publish(path, {"sequence": 0})
                    sub.unsubscribe()
            except Exception as exc:
                errors.append(exc)

        threads = [
            threading.Thread(target=publisher),
            threading.Thread(target=publisher),
            threading.Thread(target=subscriber),
            threading.Thread(target=subscriber),
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=5.0)
            self.assertFalse(thread.is_alive())

        self.assertEqual(errors, [])


if __name__ == "__main__":
    unittest.main()
