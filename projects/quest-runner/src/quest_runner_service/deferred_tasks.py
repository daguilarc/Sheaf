"""Process-local deferred task scheduler."""

from __future__ import annotations

import heapq
import logging
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Callable


log = logging.getLogger("conductor")


def _utc_iso_after(delay_seconds: float) -> str:
    when = datetime.now(timezone.utc) + timedelta(seconds=delay_seconds)
    return when.strftime("%Y-%m-%dT%H:%M:%SZ")


@dataclass(order=True)
class _ScheduledTask:
    due_monotonic: float
    seq: int
    task_id: str = field(compare=False)
    callback: Callable[[], None] = field(compare=False)
    delay_seconds: float = field(compare=False)
    scheduled_for: str = field(compare=False)
    description: dict[str, Any] = field(compare=False)


class DeferredTaskScheduler:
    """Run callbacks after a relative delay in a single background worker."""

    def __init__(self) -> None:
        self._cv = threading.Condition()
        self._queue: list[_ScheduledTask] = []
        self._seq = 0
        self._stopped = False
        self._worker = threading.Thread(
            target=self._run,
            name="conductor-deferred-tasks",
            daemon=True,
        )
        self._worker.start()

    def schedule(
        self,
        *,
        delay_seconds: float,
        callback: Callable[[], None],
        description: dict[str, Any],
    ) -> dict[str, Any]:
        if delay_seconds < 0:
            raise ValueError("delay_seconds must be non-negative")
        with self._cv:
            if self._stopped:
                raise RuntimeError("scheduler is stopped")
            self._seq += 1
            task = _ScheduledTask(
                due_monotonic=time.monotonic() + delay_seconds,
                seq=self._seq,
                task_id=str(uuid.uuid4()),
                callback=callback,
                delay_seconds=delay_seconds,
                scheduled_for=_utc_iso_after(delay_seconds),
                description=dict(description),
            )
            heapq.heappush(self._queue, task)
            self._cv.notify()
        return {
            "task_id": task.task_id,
            "scheduled_for": task.scheduled_for,
            "delay_seconds": task.delay_seconds,
            "description": dict(task.description),
        }

    def shutdown(self) -> None:
        with self._cv:
            self._stopped = True
            self._cv.notify_all()
        self._worker.join(timeout=1)

    def _run(self) -> None:
        while True:
            task: _ScheduledTask | None = None
            with self._cv:
                while True:
                    if self._stopped:
                        return
                    if not self._queue:
                        self._cv.wait()
                        continue
                    next_task = self._queue[0]
                    wait_seconds = next_task.due_monotonic - time.monotonic()
                    if wait_seconds > 0:
                        self._cv.wait(timeout=wait_seconds)
                        continue
                    task = heapq.heappop(self._queue)
                    break
            assert task is not None
            try:
                task.callback()
            except Exception:
                log.exception(
                    "Deferred task %s failed (description=%s)",
                    task.task_id,
                    task.description,
                )
