# Service And Harness Wiring

## Objective

Expose the chat stream over the Quest Runner Flask service and publish live harness log events into the stream bus.

Expected outcome: `/api/dashboard/agent_log/stream` accepts the same quest and agent query parameters as `/api/dashboard/agent_log`, streams the selected log over WebSocket, and receives live events from `HarnessJsonlLogSink` without polling the file.

## Sequencing

This slice depends on slice 1 for `ChatEventBus`, `ChatStreamSession`, and log path resolution. Browser slices can be developed against this route once it lands.

## Key Files And Systems

- `projects/quest-runner/requirements.txt`
- `projects/quest-runner/src/quest_runner_service/api.py`
- `projects/quest-runner/src/quest_runner_service/__main__.py`
- `projects/quest-runner/src/quest_runner_service/quest_service.py`
- `projects/quest-runner/src/quest_runner_service/quest_runner.py`
- `projects/quest-runner/src/quest_runner_service/quest_runner_v2.py`
- `projects/quest-runner/src/quest_runner_service/state_machine/context.py`
- `projects/quest-runner/src/quest_runner_service/state_machine/quest_v2_nodes.py`
- `projects/quest-runner/src/quest_runner_service/harness.py`
- `projects/quest-runner/tests/test_dashboard_chat.py`
- `projects/quest-runner/tests/test_dashboard_shell.py`
- `projects/quest-runner/tests/test_harness_quest_thread_core.py`
- `projects/quest-runner/tests/test_quest_service_api.py`

## Existing APIs To Reuse As-Is

- `create_app(...)` as the service composition point.
- Existing `_quest_context()` closure in `api.py` for project, quest type, quest number, quest directory, and checkout resolution.
- `dashboard_slice.parse_optional_step(...)` for optional `step`.
- The slice-1 log path helper for selecting the current JSONL file.
- `ChatStreamSession.run()` for all replay/live session behavior.
- `QuestService.schedule_run_quest(...)` and `_run_quest_locked(...)` for the background runner path.

## APIs To Extend Or Modify

### Dependency

Add `flask-sock` to `projects/quest-runner/requirements.txt`.

Do not add gevent, eventlet, npm packages, or `@ag-ui/client`.

### Event bus ownership

Add a `ChatEventBus` instance to `QuestService`, for example:

```python
self.chat_event_bus = ChatEventBus()
```

Use the same `QuestService` instance for both:

- WebSocket route sessions created by `create_app(...)`.
- Harness sink publishing during `run_quest` and scheduled background runs.

### Harness publishing

Modify `HarnessJsonlLogSink`:

- Add optional constructor parameter `event_bus: ChatEventBus | None = None`.
- Store it as `_event_bus`.
- In `_append(...)`, after the JSON line is written and flushed, call `self._event_bus.publish(self.path, event)` when present.
- Do not publish before the disk write succeeds.
- Keep constructor defaults compatible with existing tests and callers.

Thread the bus into the runner:

- Add optional `event_bus` parameters from `QuestService._run_quest_locked(...)` into `quest_runner.run_quest(...)` and `quest_runner_v2.run_quest_v2(...)`.
- Pass `event_bus=self.chat_event_bus` from `QuestService._run_quest_locked(...)`. Because `schedule_run_quest(...)` calls the same `_run_quest_locked(...)` method on the same `QuestService` instance, scheduled background runs must use the exact same `quest_service.chat_event_bus` instance that WebSocket subscribers use.
- Add `event_bus: ChatEventBus | None = None` to `RunContext` in `state_machine/context.py`.
- When `quest_runner_v2.run_quest_v2(...)` constructs `RunContext`, set `event_bus=event_bus` alongside existing carried fields such as `conductor_repo_path`, `quest_docs_dir`, and `role_step_seq_box`.
- In `state_machine/quest_v2_nodes.py`, update the node that invokes `perform_role_harness_sequence(...)` to pass `event_bus=ctx.event_bus`.
- Add `event_bus: ChatEventBus | None = None` to `perform_role_harness_sequence(...)`, and pass it into the `HarnessJsonlLogSink(...)` constructor in `_begin_harness_round(...)`.
- Keep all default values as `None` so direct runner tests do not need updates unless they assert constructor calls.

### WebSocket route

In `api.py`:

- Import and initialize `Sock(app)` inside `create_app(...)`.
- Register:

```text
/api/dashboard/agent_log/stream
```

- Query parameters:
  - `project`
  - `quest_type`
  - `quest_number`
  - `agent_key`
  - optional `step`

The route should:

1. Reuse `_quest_context()`.
2. Parse `agent_key` and `step` using the existing dashboard helpers/log path helper.
3. Create `ChatStreamSession(log_path=path, ws=ws, event_bus=quest_service.chat_event_bus)`.
4. Call `run()` and block until close.

If validation fails after the WebSocket is accepted, send `{"type": "error", "message": "..."}` and return. Use the existing exception messages, but do not expose tracebacks.

### Shared web static route

Add a no-cache static route if one is not already present:

```text
GET /assets/web/<filename> -> <source_repo_root>/projects/web/src/<filename>
```

Use `send_from_directory(...)` and `_no_cache(...)`, matching the existing dashboard asset route. Keep the route narrow to files under `projects/web/src`.

## Validation Expectations

Extend or add tests:

- `test_harness_quest_thread_core.py`: constructing `HarnessJsonlLogSink` with a fake bus publishes exactly the event written to disk, after sequence assignment, and constructing it without a bus keeps old behavior.
- `test_dashboard_chat.py`: Flask WebSocket route connects with valid query parameters, receives AG UI `events`, then `caught_up`; invalid `agent_key` or missing log sends an `error` message.
- `test_dashboard_shell.py`: `/assets/web/agui-chat.css` and `/assets/web/agui-chat.js` are served once those files exist in later slices; until then, the route test may create temporary files or only assert the route root behavior if the assets are not yet present.
- Existing `/api/dashboard/agent_log` tests still pass and keep returning raw JSON for metadata/step selectors.
- Background run tests still pass with `QuestService.chat_event_bus` present.

Run:

```text
make -C projects/quest-runner test
```
