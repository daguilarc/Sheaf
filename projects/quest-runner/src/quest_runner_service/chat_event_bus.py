"""In-process pub/sub for live quest log events keyed by JSONL path."""

from __future__ import annotations

import queue
import threading
from pathlib import Path


class ChatSubscription:
    """Receives live log events for one subscribed path."""

    def __init__(
        self,
        *,
        queue: queue.SimpleQueue[dict],
        bus: ChatEventBus,
        key: Path,
    ) -> None:
        self.queue = queue
        self._bus = bus
        self._key = key
        self._unsubscribed = False

    def unsubscribe(self) -> None:
        if self._unsubscribed:
            return
        self._unsubscribed = True
        self._bus._remove_subscriber(self._key, self)


class ChatEventBus:
    """Thread-safe fan-out of quest log events to WebSocket sessions."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._subscribers: dict[Path, list[ChatSubscription]] = {}

    def publish(self, log_path: Path, event: dict) -> None:
        key = log_path.resolve()
        with self._lock:
            subscribers = list(self._subscribers.get(key, ()))
        for subscription in subscribers:
            subscription.queue.put(event)

    def subscribe(self, log_path: Path) -> ChatSubscription:
        key = log_path.resolve()
        subscription = ChatSubscription(
            queue=queue.SimpleQueue(),
            bus=self,
            key=key,
        )
        with self._lock:
            self._subscribers.setdefault(key, []).append(subscription)
        return subscription

    def _remove_subscriber(self, key: Path, subscription: ChatSubscription) -> None:
        with self._lock:
            subscribers = self._subscribers.get(key)
            if not subscribers:
                return
            try:
                subscribers.remove(subscription)
            except ValueError:
                return
            if not subscribers:
                del self._subscribers[key]
