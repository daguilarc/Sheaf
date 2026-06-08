# Server Stream Core

## Objective

Add the reusable server-side primitives for chat log streaming without yet wiring them into Flask or the harness writer.

Expected outcome: a thread-safe `ChatEventBus` can fan out quest log events by resolved log path, and `ChatStreamSession` can replay a JSONL log through `QuestLogToAguiMapper`, emit AG UI event batches, send `caught_up`, then consume live events from the bus with sequence deduplication.

## Sequencing

This slice is first because the API route and harness integration in the next slice should depend on these stable primitives rather than mixing WebSocket route concerns with replay/live stream behavior.

## Key Files And Systems

- `projects/quest-runner/src/quest_runner_service/chat_event_bus.py`
- `projects/quest-runner/src/quest_runner_service/dashboard_chat.py`
- `projects/quest-runner/src/quest_runner_service/agui_mapper.py`
- `projects/quest-runner/src/quest_runner_service/dashboard_slice.py`
- `projects/quest-runner/tests/test_chat_event_bus.py`
- `projects/quest-runner/tests/test_dashboard_chat.py`

## Existing APIs To Reuse As-Is

- `QuestLogToAguiMapper.consume(event)` and `QuestLogToAguiMapper.flush()` for all quest-log-to-AG-UI conversion. Do not modify mapper behavior in this quest.
- `dashboard_slice.collect_step_logs_for_role(...)`, `parse_agent_key(...)`, `validate_agent_role(...)`, and `parse_optional_step(...)` for log selection semantics.
- `dashboard_data.DashboardBadRequest` and `DashboardNotFound` for parameter and missing-log failures if a log resolution helper is added.

## APIs To Add Or Modify

### `chat_event_bus.py`

Add:

- `ChatEventBus`
  - Internal registry keyed by `Path.resolve()`.
  - `publish(log_path: Path, event: dict) -> None`: copy the current subscriber list under a `threading.Lock`, then enqueue the original event to each subscriber outside the lock.
  - `subscribe(log_path: Path) -> ChatSubscription`: register and return a subscription with its own `queue.SimpleQueue`.
- `ChatSubscription`
  - `queue: queue.SimpleQueue[dict]`.
  - `unsubscribe() -> None`, idempotent, removing only that subscription from the bus registry.

Use a lock only for registry mutation/snapshotting. Do not hold the lock while queueing events.

### Log path resolution helper

Add a small helper in `dashboard_chat.py` or `dashboard_slice.py`, for example:

```python
def resolve_agent_log_path(
    *,
    quest_dir: Path,
    agent_key: str,
    step: int | None,
) -> tuple[int, Path]:
    ...
```

It should reuse `parse_agent_key`, `validate_agent_role`, and `collect_step_logs_for_role`, choose the latest step when `step is None`, and raise the same dashboard exceptions as `agent_log_payload(...)`. `agent_log_payload(...)` may be updated to call this helper to avoid duplicate selection logic, but keep its response shape unchanged.

### `dashboard_chat.py`

Add `ChatStreamSession`:

- Constructor inputs: `log_path: Path`, `ws`, `event_bus: ChatEventBus`.
- `run() -> None`:
  1. Subscribe to the resolved log path before opening the file.
  2. Create one `QuestLogToAguiMapper` for the whole session.
  3. Read the JSONL file line by line.
  4. For each valid JSON object, track the highest integer `sequence` seen, call `mapper.consume(event)`, and batch returned AG UI events into `{"type": "events", "events": [...]}` messages of at most 100 events.
  5. Ignore blank lines. For malformed JSON lines, send one `{"type": "error", "message": "..."}` message and continue replaying subsequent lines unless the WebSocket send fails.
  6. After EOF, call `mapper.flush()`, send remaining events, then send `{"type": "caught_up"}`.
  7. In the live loop, call `subscription.queue.get(timeout=...)`, skip events with integer `sequence <= replay_high_water`, convert remaining events through the same mapper, and send returned events immediately as event batches.
  8. On WebSocket close or send failure, exit the loop.
  9. Always unsubscribe in `finally`.

Keep WebSocket operations narrow: `ChatStreamSession` should only call `ws.send(json.dumps(message))`. It should not import Flask request state or parse query parameters.

## Enabling Refactor

The only enabling refactor is extracting log path selection out of `agent_log_payload(...)` if needed. Keep it behavior-preserving and covered by the existing dashboard slice tests.

## Validation Expectations

Add `tests/test_chat_event_bus.py`:

- Single subscriber receives a published event for the same path.
- Multiple subscribers receive the same event.
- A subscriber for a different path does not receive the event.
- `unsubscribe()` stops delivery and is idempotent.
- A concurrent publish/subscribe smoke test does not crash and does not mutate the registry unsafely.

Add `tests/test_dashboard_chat.py` unit coverage for `ChatStreamSession` with a fake WebSocket:

- Replays a JSONL file containing `sheaf.run_started`, `sheaf.prompt`, and `sheaf.run_completed`; sends `events` messages followed by `caught_up`.
- Batches replayed AG UI events at 100 events per message.
- Publishes a live event after replay and verifies it is streamed through the same mapper.
- Publishes an event with `sequence` already seen during replay and verifies it is skipped.
- Malformed JSON line sends an error message without preventing valid later lines from replaying.
- WebSocket send failure exits and unsubscribes.

Run:

```text
make -C projects/quest-runner test
```
