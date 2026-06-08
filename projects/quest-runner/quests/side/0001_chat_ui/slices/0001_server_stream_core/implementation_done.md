# Implementation Complete: Server Stream Core

## Summary

Added the reusable server-side primitives for chat log streaming without Flask or harness wiring.

## Delivered

- **`chat_event_bus.py`** — `ChatEventBus` and `ChatSubscription` with thread-safe path-keyed pub/sub, lock-protected registry snapshotting, and idempotent `unsubscribe()`.
- **`dashboard_chat.py`** — `ChatStreamSession` replays JSONL through `QuestLogToAguiMapper`, batches AG UI events (max 100), sends `caught_up`, then streams live bus events with sequence deduplication.
- **`dashboard_slice.py`** — `resolve_agent_log_path()` helper extracted from `agent_log_payload()` (behavior-preserving refactor).

## Tests

- `tests/test_chat_event_bus.py` — pub/sub, path isolation, unsubscribe, concurrent smoke.
- `tests/test_dashboard_chat.py` — replay, batching, live streaming, deduplication, malformed JSON, send failure cleanup.

All 267 quest-runner tests pass (`make -C projects/quest-runner test`).
