"""WebSocket chat stream session: JSONL replay and live event bus."""

from __future__ import annotations

import json
import queue
from pathlib import Path

from .agui_mapper import QuestLogToAguiMapper
from .chat_event_bus import ChatEventBus, ChatSubscription

_BATCH_SIZE = 100
_LIVE_POLL_TIMEOUT = 1.0


class ChatStreamSession:
    """Replays a quest log JSONL file then streams live events from a bus."""

    def __init__(self, log_path: Path, ws, event_bus: ChatEventBus) -> None:
        self._log_path = log_path
        self._ws = ws
        self._event_bus = event_bus

    def run(self) -> None:
        subscription = self._event_bus.subscribe(self._log_path)
        try:
            mapper = QuestLogToAguiMapper()
            replay_high_water = self._replay_file(mapper)
            if replay_high_water is None:
                return
            self._live_loop(mapper, subscription, replay_high_water)
        finally:
            subscription.unsubscribe()

    def _send(self, message: dict) -> bool:
        try:
            self._ws.send(json.dumps(message))
            return True
        except Exception:
            return False

    def _send_events(self, events: list[dict]) -> bool:
        if not events:
            return True
        return self._send({"type": "events", "events": events})

    def _replay_file(self, mapper: QuestLogToAguiMapper) -> int | None:
        replay_high_water = 0
        batch: list[dict] = []

        with self._log_path.open(encoding="utf-8") as fh:
            for raw_line in fh:
                line = raw_line.strip()
                if not line:
                    continue
                try:
                    event = json.loads(line)
                except json.JSONDecodeError as exc:
                    if not self._send(
                        {"type": "error", "message": f"invalid JSON: {exc.msg}"}
                    ):
                        return None
                    continue
                if not isinstance(event, dict):
                    if not self._send(
                        {"type": "error", "message": "expected JSON object per line"}
                    ):
                        return None
                    continue

                sequence = event.get("sequence")
                if isinstance(sequence, int):
                    replay_high_water = max(replay_high_water, sequence)

                for agui_event in mapper.consume(event):
                    batch.append(agui_event)
                    if len(batch) >= _BATCH_SIZE:
                        if not self._send_events(batch):
                            return None
                        batch = []

        for agui_event in mapper.flush():
            batch.append(agui_event)
            if len(batch) >= _BATCH_SIZE:
                if not self._send_events(batch):
                    return None
                batch = []

        if batch:
            if not self._send_events(batch):
                return None

        if not self._send({"type": "caught_up"}):
            return None

        return replay_high_water

    def _live_loop(
        self,
        mapper: QuestLogToAguiMapper,
        subscription: ChatSubscription,
        replay_high_water: int,
    ) -> None:
        while True:
            if getattr(self._ws, "closed", False):
                return
            try:
                event = subscription.queue.get(timeout=_LIVE_POLL_TIMEOUT)
            except queue.Empty:
                continue

            sequence = event.get("sequence")
            if isinstance(sequence, int) and sequence <= replay_high_water:
                continue

            agui_events = mapper.consume(event)
            if agui_events and not self._send_events(agui_events):
                return
