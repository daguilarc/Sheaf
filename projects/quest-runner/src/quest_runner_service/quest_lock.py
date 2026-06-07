"""Process-wide per-repository quest lock (in-memory)."""

from __future__ import annotations

import threading
from dataclasses import dataclass


@dataclass
class LockInfo:
    quest_type: str
    quest_number: int
    request_id: str


class QuestLock:
    """At most one active run per repository path (string key)."""

    def __init__(self) -> None:
        self._locks: dict[str, LockInfo] = {}
        self._mutex = threading.Lock()

    def acquire(
        self,
        repo_path: str,
        quest_type: str,
        quest_number: int,
        request_id: str,
    ) -> bool:
        with self._mutex:
            if repo_path in self._locks:
                return False
            self._locks[repo_path] = LockInfo(
                quest_type=quest_type,
                quest_number=quest_number,
                request_id=request_id,
            )
            return True

    def release(self, repo_path: str) -> None:
        with self._mutex:
            self._locks.pop(repo_path, None)

    def get_lock_info(self, repo_path: str) -> LockInfo | None:
        with self._mutex:
            return self._locks.get(repo_path)
