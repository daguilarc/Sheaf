# Implementation Complete: Service And Harness Wiring

## Summary

Wired the slice-1 chat stream primitives into the Quest Runner Flask service and harness log sink so live quest events reach WebSocket subscribers without file polling.

## Delivered

- **`requirements.txt`** — added `flask-sock>=0.7`.
- **`QuestService`** — owns a `chat_event_bus` instance shared by WebSocket sessions and background quest runs.
- **`HarnessJsonlLogSink`** — optional `event_bus` publishes each event after the JSONL line is flushed to disk.
- **Runner threading** — `event_bus` flows from `QuestService._run_quest_locked` through `run_quest` / `run_quest_v2`, `RunContext`, `perform_role_harness_sequence`, and into the sink constructor.
- **`api.py`** — `Sock(app)` WebSocket route at `/api/dashboard/agent_log/stream` (same query params as `/api/dashboard/agent_log`) and no-cache static route `GET /assets/web/<filename>` serving `projects/web/src/`.

## Tests

- `test_harness_quest_thread_core.py` — bus publish after disk write; no bus preserves prior behavior.
- `test_dashboard_chat.py` — WebSocket route replay/`caught_up`, invalid agent key, missing log error paths; `QuestService.chat_event_bus` presence.
- `test_dashboard_shell.py` — `/assets/web/` static route.
- All slice-related tests pass via `make test` modules for dashboard chat, shell, harness, and quest service API.
