"""In-process active quest run tracking for dashboard execution overlay."""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass


@dataclass
class ActiveRunRecord:
    run_id: str
    repo_path: str
    quest_type: str
    quest_number: int
    started_at: float
    last_heartbeat: float


class ActiveRunTracker:
    """Maps in-flight background runs to quest keys for run_status and overlays."""

    def __init__(self) -> None:
        self._mutex = threading.Lock()
        self._by_run_id: dict[str, ActiveRunRecord] = {}
        self._quest_to_run: dict[tuple[str, str, int], str] = {}

    def register(
        self,
        run_id: str,
        repo_path: str,
        quest_type: str,
        quest_number: int,
    ) -> None:
        now = time.time()
        rec = ActiveRunRecord(
            run_id=run_id,
            repo_path=repo_path,
            quest_type=quest_type,
            quest_number=quest_number,
            started_at=now,
            last_heartbeat=now,
        )
        key = (repo_path, quest_type, quest_number)
        with self._mutex:
            self._by_run_id[run_id] = rec
            self._quest_to_run[key] = run_id

    def heartbeat(self, run_id: str) -> None:
        with self._mutex:
            rec = self._by_run_id.get(run_id)
            if rec is not None:
                rec.last_heartbeat = time.time()

    def unregister(self, run_id: str) -> None:
        with self._mutex:
            rec = self._by_run_id.pop(run_id, None)
            if rec is None:
                return
            key = (rec.repo_path, rec.quest_type, rec.quest_number)
            if self._quest_to_run.get(key) == run_id:
                del self._quest_to_run[key]

    def get_for_quest(
        self,
        repo_path: str,
        quest_type: str,
        quest_number: int,
    ) -> ActiveRunRecord | None:
        key = (repo_path, quest_type, quest_number)
        with self._mutex:
            run_id = self._quest_to_run.get(key)
            if run_id is None:
                return None
            return self._by_run_id.get(run_id)
