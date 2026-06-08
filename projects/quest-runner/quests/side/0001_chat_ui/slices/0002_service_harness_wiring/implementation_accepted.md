# Implementation Accepted: Service And Harness Wiring

## Verdict

Accepted. The slice is spec-compliant, complete for its intended scope, and well
covered by tests. No open polishing issues.

## What was reviewed (git diff)

- `requirements.txt` — `flask-sock>=0.7`
- `quest_service.py` — `QuestService.chat_event_bus`; `event_bus` passed into the runner
- `harness.py` — `HarnessJsonlLogSink` optional `event_bus`, publish-after-flush
- `quest_runner.py` / `quest_runner_v2.py` — `event_bus` threaded through `run_quest`,
  `run_quest_v2`, `perform_role_harness_sequence`
- `state_machine/context.py` / `quest_v2_nodes.py` — `RunContext.event_bus` carried and
  passed at the harness call site
- `api.py` — `Sock(app)` route `/api/dashboard/agent_log/stream` and no-cache
  `/assets/web/<filename>` static route
- `tests/test_harness_quest_thread_core.py`, `tests/test_dashboard_chat.py`,
  `tests/test_dashboard_shell.py`

## Verification against the slice plan

- **Event bus ownership**: a single `ChatEventBus` lives on `QuestService` and is passed
  via `_run_quest_locked` -> `run_quest` -> `run_quest_v2` -> `RunContext` ->
  `perform_role_harness_sequence` -> `HarnessJsonlLogSink`. Because `schedule_run_quest`
  routes through the same `_run_quest_locked` on the same instance, background runs and
  WebSocket subscribers share the exact same bus instance. Matches the plan.
- **Harness publishing**: `_append` writes + flushes the JSONL line, then publishes the
  same `event` only when `_event_bus` is present. Publish happens after the disk write and
  after sequence assignment; verified by `test_jsonl_log_sink_publishes_event_after_disk_write`
  (sequences `[1, 2]` on both disk and bus) and `..._without_bus_keeps_old_behavior`.
- **Backward compatibility**: every new parameter defaults to `None`; existing
  `run_quest`/`run_quest_v2`/`perform_role_harness_sequence`/`HarnessJsonlLogSink` callers
  remain valid. No call sites were broken (grep-verified).
- **WebSocket route**: reuses `_quest_context()`, `parse_optional_step`, and the slice-1
  `resolve_agent_log_path` helper; constructs `ChatStreamSession(log_path, ws,
  quest_service.chat_event_bus)` and blocks on `run()`. On `DashboardBadRequest`/
  `DashboardNotFound` it sends `{"type":"error","message":...}` with the existing message;
  unexpected errors are logged and reported as a generic message without leaking tracebacks.
- **Static route**: `GET /assets/web/<path:filename>` serves `<source_root>/projects/web/src`
  via `send_from_directory(..., conditional=False, max_age=0)` wrapped in `_no_cache`,
  matching the existing dashboard asset route; traversal is handled by `send_from_directory`.
- **No circular imports**: `chat_event_bus` imports only stdlib; `harness.py` keeps its
  import under `TYPE_CHECKING`.

## Test coverage

- Harness sink: publish-after-write with correct sequences/fields; no-bus path preserved.
- Stream route: valid params replay events then `caught_up`; invalid `agent_key` and
  missing-log cases each send the expected single `error` message.
- Static route: `/assets/web/agui-chat.css` served with `no-store` cache control.
- `QuestService.chat_event_bus` presence asserted.
- Implementer/polisher reported slice-related modules passing via `make test`.

## Non-blocking note (carried over from slice 1)

`dashboard_slice.agent_log_payload()` still re-parses the agent key and re-scans logs
after `resolve_agent_log_path()`. This is behavior-preserving and negligible in cost; it
was already recorded as an optional future cleanup in slice 1 and is not a blocker here.
