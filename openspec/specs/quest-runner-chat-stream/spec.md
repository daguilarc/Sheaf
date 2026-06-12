# Capability: Chat Stream

Project: `projects/quest-runner`
ID prefix: `chat` — requirement IDs are append-only; never renumber or reuse.

## Purpose

The chat stream turns quest-local agent log JSONL files into a live, read-only
chat transcript over WebSocket. `WS /api/dashboard/agent_log/stream` replays
the selected step log through `QuestLogToAguiMapper` — which normalizes
harness-specific events (cursor, codex, claude_code, pi) into AGUI events —
then streams new events live from the in-process `ChatEventBus` as the
harness appends them. The dashboard's Agents page is the consumer.

## Requirements

### Requirement: chat-1 — Connection and setup: WebSocket endpoint and parameters
THE service SHALL accept WebSocket connections at `/api/dashboard/agent_log/stream` with query parameters `project`, `quest_type`, `quest_number` (required), and optional `experiment_id` and `step`, resolving the same step-log file as `GET /api/dashboard/agent_log` (the log with the given `step`, or the highest-numbered step log when `step` is omitted).

#### Scenario: Valid connection
- **WHEN** a client connects to `WS /api/dashboard/agent_log/stream` with valid `project`, `quest_type`, and `quest_number` parameters
- **THEN** the service accepts the connection and resolves the appropriate step-log file

#### Scenario: Step omitted
- **WHEN** a client connects without the optional `step` parameter
- **THEN** the service resolves the highest-numbered step log for the quest

#### Scenario: Step specified
- **WHEN** a client connects with an explicit `step` parameter
- **THEN** the service resolves the log with the given step number

### Requirement: chat-2 — Connection and setup: Setup failure error frame
IF setup fails — missing/invalid query parameters, unknown quest, no step logs, or unknown `step` — THEN THE service SHALL send a single `{"type": "error", "message": <reason>}` frame and close the stream; unexpected setup failures send `{"type": "error", "message": "Internal server error"}`.

#### Scenario: Missing required parameter
- **WHEN** a client connects with a missing required query parameter
- **THEN** the service sends `{"type": "error", "message": <reason>}` and closes the stream

#### Scenario: Unknown quest
- **WHEN** a client connects with an unknown quest
- **THEN** the service sends `{"type": "error", "message": <reason>}` and closes the stream

#### Scenario: No step logs
- **WHEN** a client connects for a quest with no step logs
- **THEN** the service sends `{"type": "error", "message": <reason>}` and closes the stream

#### Scenario: Unknown step
- **WHEN** a client connects with an unknown `step` value
- **THEN** the service sends `{"type": "error", "message": <reason>}` and closes the stream

#### Scenario: Unexpected setup failure
- **WHEN** an unexpected internal error occurs during setup
- **THEN** the service sends `{"type": "error", "message": "Internal server error"}` and closes the stream

### Requirement: chat-3 — Replay-then-live protocol: Replay from beginning
WHEN a connection is established, THE service SHALL first replay the log file from the beginning: each JSONL line is parsed and mapped to zero or more AGUI events, sent in `events` batches of at most 100 events.

#### Scenario: Connection established
- **WHEN** a WebSocket connection is established
- **THEN** the service replays the log file from the beginning, sending AGUI events in batches of at most 100

### Requirement: chat-4 — Replay-then-live protocol: Malformed JSONL handling
IF a replayed line is not valid JSON, THEN THE service SHALL send `{"type": "error", "message": "invalid JSON: <detail>"}` and continue with the next line; IF a line parses to a non-object, THEN it sends `{"type": "error", "message": "expected JSON object per line"}` and continues.

#### Scenario: Invalid JSON line
- **WHEN** a replayed line is not valid JSON
- **THEN** the service sends `{"type": "error", "message": "invalid JSON: <detail>"}` and continues with the next line

#### Scenario: Non-object JSON line
- **WHEN** a replayed line parses to a non-object
- **THEN** the service sends `{"type": "error", "message": "expected JSON object per line"}` and continues

### Requirement: chat-5 — Replay-then-live protocol: End-of-file flush and caught_up
WHEN replay reaches end of file, THE service SHALL flush the mapper (emitting balancing `TOOL_CALL_END`, `REASONING_MESSAGE_END`, `REASONING_END`, `TEXT_MESSAGE_END`, and `RUN_FINISHED` events for any still-open entities), send any remaining batch, and then send `{"type": "caught_up"}` exactly once.

#### Scenario: Replay reaches end of file
- **WHEN** replay reaches end of the log file
- **THEN** the service flushes the mapper, sends any remaining batch, and then sends `{"type": "caught_up"}` exactly once

### Requirement: chat-6 — Replay-then-live protocol: Live event forwarding
WHILE the connection stays open after `caught_up`, THE service SHALL forward live events published for that log file, mapping each through the same mapper instance and sending the mapped events as an `events` frame immediately (one source event per frame; no batching delay).

#### Scenario: Live event received after caught_up
- **WHEN** a live event is published for the log file after `caught_up` has been sent
- **THEN** the service maps it through the same mapper instance and sends the mapped events immediately as an `events` frame

### Requirement: chat-7 — Replay-then-live protocol: Subscribe-before-read and deduplication
THE service SHALL subscribe to the event bus *before* reading the file and SHALL drop live events whose integer `sequence` is less than or equal to the highest `sequence` seen during replay, so no event is lost or duplicated across the replay/live boundary.

#### Scenario: Subscribe before file read
- **WHEN** a connection is established
- **THEN** the service subscribes to the event bus before reading the file

#### Scenario: Duplicate live event during boundary
- **WHEN** a live event arrives whose `sequence` is less than or equal to the highest sequence seen during replay
- **THEN** the service drops the event

### Requirement: chat-8 — Replay-then-live protocol: Session cleanup on close or send failure
WHEN the WebSocket closes or a send fails (including during replay), THE service SHALL stop the session and remove its event-bus subscription; the live loop detects a closed socket within ~1 second (queue poll timeout).

#### Scenario: WebSocket closes
- **WHEN** the WebSocket connection closes
- **THEN** the service stops the session and removes its event-bus subscription

#### Scenario: Send failure
- **WHEN** a send fails (including during replay)
- **THEN** the service stops the session and removes its event-bus subscription

### Requirement: chat-9 — Event bus: In-memory fan-out bus
THE chat event bus SHALL be in-memory and process-local, keyed by the resolved (absolute) log path, fanning out each published event to every subscriber's queue; live updates therefore exist only for logs written by the currently running service process — history always comes from the file.

#### Scenario: Event published to bus
- **WHEN** an event is published to the chat event bus for a given log path
- **THEN** the event is fanned out to every subscriber's queue for that log path

### Requirement: chat-10 — Event bus: Publish-after-flush ordering
THE harness log sink SHALL publish each quest-log event to the bus only after appending and flushing it to the JSONL file, so a reconnecting client can always recover the event from disk.

#### Scenario: Event published to bus
- **WHEN** the harness log sink publishes an event to the bus
- **THEN** the event has already been appended and flushed to the JSONL file

### Requirement: chat-11 — AGUI mapping: Quest-runner control events
THE mapper SHALL map quest-runner control events: `sheaf.run_started` → `RUN_STARTED`; `sheaf.run_completed` → balancing END events then `RUN_FINISHED` (with `result`); `sheaf.run_failed` → balancing END events then `RUN_ERROR` (with `message` and `code`); `sheaf.prompt` → a user `TEXT_MESSAGE_START`/`CONTENT`/`END` triplet; `sheaf.path_enforcement` → `CUSTOM` named `sheaf.path_enforcement`.

#### Scenario: sheaf.run_started event
- **WHEN** the mapper receives a `sheaf.run_started` event
- **THEN** it emits `RUN_STARTED`

#### Scenario: sheaf.run_completed event
- **WHEN** the mapper receives a `sheaf.run_completed` event
- **THEN** it emits balancing END events then `RUN_FINISHED` with `result`

#### Scenario: sheaf.run_failed event
- **WHEN** the mapper receives a `sheaf.run_failed` event
- **THEN** it emits balancing END events then `RUN_ERROR` with `message` and `code`

#### Scenario: sheaf.prompt event
- **WHEN** the mapper receives a `sheaf.prompt` event
- **THEN** it emits a user `TEXT_MESSAGE_START`/`CONTENT`/`END` triplet

#### Scenario: sheaf.path_enforcement event
- **WHEN** the mapper receives a `sheaf.path_enforcement` event
- **THEN** it emits a `CUSTOM` event named `sheaf.path_enforcement`

### Requirement: chat-12 — AGUI mapping: provider.text and provider.json events
THE mapper SHALL map `provider.text` events to `CUSTOM` events named `provider.text`, and SHALL dispatch `provider.json` events by the `harness` field to harness-specific rules for `cursor`, `codex`, `claude_code`, and `pi` (summarized in Contracts).

#### Scenario: provider.text event
- **WHEN** the mapper receives a `provider.text` event
- **THEN** it emits a `CUSTOM` event named `provider.text`

#### Scenario: provider.json event
- **WHEN** the mapper receives a `provider.json` event
- **THEN** it dispatches by the `harness` field to harness-specific rules for `cursor`, `codex`, `claude_code`, or `pi`

### Requirement: chat-13 — AGUI mapping: Unrecognized event RAW fallback
IF an event has an unrecognized kind, harness, or payload shape — or mapping raises an exception — THEN THE mapper SHALL emit a single `RAW` AGUI event carrying the source event (no data loss) and record it in `errors()`.

#### Scenario: Unrecognized event kind
- **WHEN** the mapper receives an event with an unrecognized kind, harness, or payload shape
- **THEN** it emits a single `RAW` AGUI event carrying the source event and records it in `errors()`

#### Scenario: Mapping exception
- **WHEN** mapping an event raises an exception
- **THEN** the mapper emits a single `RAW` AGUI event carrying the source event and records it in `errors()`

### Requirement: chat-14 — AGUI mapping: Balanced lifecycle sequences
THE mapper SHALL emit balanced lifecycle sequences: every `TEXT_MESSAGE_START`, `REASONING_START`/`REASONING_MESSAGE_START`, `TOOL_CALL_START`, and `RUN_STARTED` is eventually closed by its matching END/FINISHED event, either from source events or at run end / `flush()`.

#### Scenario: Open entities closed by source events
- **WHEN** source events close previously opened text messages, reasoning phases, tool calls, or runs
- **THEN** the mapper emits the corresponding END/FINISHED events

#### Scenario: Open entities closed at flush
- **WHEN** `flush()` is called with still-open entities
- **THEN** the mapper emits balancing END/FINISHED events for all open entities

### Requirement: chat-15 — AGUI mapping: rawEvent preservation and timestamp
THE mapper SHALL preserve the full source event as `rawEvent` on emitted events and SHALL set `timestamp` (epoch milliseconds) derived from the payload's `timestamp_ms` or the source event's ISO `timestamp` when available.

#### Scenario: rawEvent preserved
- **WHEN** the mapper emits any AGUI event
- **THEN** the full source event is preserved as `rawEvent` on the emitted event

#### Scenario: timestamp set from payload
- **WHEN** the source event has `timestamp_ms` in the payload
- **THEN** `timestamp` is set to epoch milliseconds derived from `timestamp_ms`

#### Scenario: timestamp set from ISO timestamp
- **WHEN** the source event has an ISO `timestamp` but no `timestamp_ms`
- **THEN** `timestamp` is set to epoch milliseconds derived from the ISO `timestamp`

## Contracts

### WebSocket message envelopes

| Frame | Shape | When |
|---|---|---|
| events | `{"type": "events", "events": [<AGUI event>, ...]}` | Replay batches (≤100 events) and live updates |
| caught_up | `{"type": "caught_up"}` | Once, after the full file has been replayed and flushed |
| error | `{"type": "error", "message": "<text>"}` | Setup failure (then close) or a malformed JSONL line (then continue) |

AGUI events are JSON objects with a `type` discriminator
(`RUN_STARTED`, `RUN_FINISHED`, `RUN_ERROR`, `STEP_STARTED`,
`STEP_FINISHED`, `TEXT_MESSAGE_START|CONTENT|END`,
`REASONING_START|MESSAGE_START|MESSAGE_CONTENT|MESSAGE_END|END`,
`REASONING_ENCRYPTED_VALUE`, `TOOL_CALL_START|ARGS|RESULT|END`,
`ACTIVITY_SNAPSHOT`, `CUSTOM`, `RAW`, ...) — full shapes in the
[AGUI schema](../../../structure/schemas/ag_ui_events.schema.json).
`null`-valued fields are omitted.

### Identity rules

- Run id / thread id: `"<thread>:step:<step>"` from the source event
  (`provider_thread_id` or `thread` preferred for `threadId`).
- Synthetic message/tool ids: `"<thread>:step:<step>:seq:<sequence>:<suffix>"`
  when the harness payload supplies no id.
- Tool results use `messageId: "<toolCallId>:result"` and `role: "tool"`.
  `TOOL_CALL_ARGS.delta` and `TOOL_CALL_RESULT.content` are strings
  (non-string payloads are JSON-serialized with sorted keys).

### Mapping rules by source event

| Source (`event_kind` / payload) | AGUI output |
|---|---|
| `sheaf.run_started` | `RUN_STARTED` |
| `sheaf.run_completed` | close open tools/reasoning/text, `RUN_FINISHED` + `result` |
| `sheaf.run_failed` | close open entities, `RUN_ERROR` (`message` from `detail`/`reason`, `code` from `reason`/`exit_code`/`"run_failed"`) |
| `sheaf.prompt` | user `TEXT_MESSAGE_*` triplet with `text` |
| `sheaf.path_enforcement` | `CUSTOM` (`name: "sheaf.path_enforcement"`) |
| `provider.text` | `CUSTOM` (`name: "provider.text"`, `value: {text}`) |
| cursor `assistant` / `user` | assistant streamed text / user text triplet (content blocks concatenated) |
| cursor `thinking` delta / completed | `REASONING_*` content / close |
| cursor `tool_call` started / completed | `TOOL_CALL_START`(+`ARGS`) / (`START` if unseen) +`RESULT`+`END` |
| cursor `system`, `result`, `interaction_query` | `CUSTOM` (`cursor.<type>`) |
| codex `turn.started` / `turn.completed` | `STEP_STARTED` / `STEP_FINISHED` (`stepName: "codex.turn"`) |
| codex `thread.started` | `CUSTOM` (`codex.thread.started`) |
| codex `item.completed` + `agent_message` | assistant text triplet |
| codex `command_execution` items | `TOOL_CALL_START`/`ARGS`(command)/`RESULT`(exit_code, status, output)/`END` |
| codex `file_change` item | `ACTIVITY_SNAPSHOT` (`activityType: "codex.file_change"`, `replace` on completion) |
| codex `todo_list` item | `CUSTOM` (`codex.todo_list`) |
| claude_code `stream_event` message_start/stop | `TEXT_MESSAGE_START` / `TEXT_MESSAGE_END` (message id tracked per session) |
| claude_code content blocks: `text` / `thinking` / `tool_use` (+ deltas) | streamed `TEXT_MESSAGE_CONTENT` / `REASONING_MESSAGE_CONTENT` / `TOOL_CALL_START`+`ARGS` (`input_json_delta`), closed on `content_block_stop` |
| claude_code `signature_delta` | `REASONING_ENCRYPTED_VALUE` |
| claude_code `user` | user text triplet |
| claude_code `assistant`, `system`, `rate_limit_event`, `result`; `message_delta` | `CUSTOM` (`claude.<type>` / `claude.message_delta`) |
| pi `turn_start` / `turn_end` | `STEP_STARTED` / `STEP_FINISHED` (`stepName: "pi.turn"`) |
| pi `message_start` / `message_update` / `message_end` | text/reasoning/tool-args streaming and closes |
| pi `tool_execution_start/update/end` | `TOOL_CALL_START`(+`ARGS`)/`RESULT` (partial and final)/`END` |
| pi `agent_start/agent_end`, `compaction_*`, `auto_retry_*`, `queue_update` | nothing (intentionally dropped) |
| anything else | `RAW` fallback (recorded by `errors()`) |

## Design

- `src/quest_runner_service/dashboard_chat.py` — `ChatStreamSession.run()`
  implements subscribe → `_replay_file()` → `caught_up` → `_live_loop()`;
  constants `_BATCH_SIZE = 100` and `_LIVE_POLL_TIMEOUT = 1.0`. The route is
  registered with `flask_sock` in `api.py`
  (`dashboard_agent_log_stream`); log resolution reuses
  `dashboard_slice.resolve_agent_log_path`.
- `src/quest_runner_service/chat_event_bus.py` — `ChatEventBus` holds
  `dict[Path, list[ChatSubscription]]` under a `threading.Lock`; each
  subscription owns a `queue.SimpleQueue`. `unsubscribe()` is idempotent.
  The single bus instance hangs off `QuestService.chat_event_bus`.
- `src/quest_runner_service/harness.py` — `HarnessJsonlLogSink._append()`
  writes the JSONL line, flushes, then publishes to the bus (chat-10).
- `src/quest_runner_service/agui_mapper.py` — `QuestLogToAguiMapper` is a
  per-connection stateful adapter tracking open runs, text messages,
  reasoning phases, tool calls, and Claude content blocks (keyed by
  `(session_id, block index)`). `consume()` wraps all per-kind handling in a
  try/except that degrades to the `RAW` fallback. `flush()` closes
  everything still open in deterministic (sorted) order; `errors()` exposes
  fallback events so tests can detect unmapped harness output.
- The replay high-water mark uses the source events' monotonically
  increasing per-file `sequence` field written by the log sink.
- Tests: `tests/test_dashboard_chat.py` (replay, batching, error frames,
  live dedupe, disconnect), `tests/test_chat_event_bus.py`, and
  `tests/test_agui_mapper.py` — the latter replays the entire quest-log
  corpus under `quests/` and `projects/*/quests/` through the mapper,
  validates output against the AGUI schema, and asserts `errors()` stays
  empty (new harness event shapes must be mapped deliberately).
- Browser consumer: `projects/web/src/agui-chat.js` (`window.ChatView`),
  mounted by the dashboard's Agents page; see
  [dashboard](../quest-runner-dashboard/spec.md) for mount/teardown behavior.

## Interactions

- [agent-harness](../quest-runner-agent-harness/spec.md) — writes the
  `logs/step_<n>_<role>.jsonl` files this capability replays and publishes
  the live events it streams.
- [dashboard](../quest-runner-dashboard/spec.md) — the Agents page selects a step via
  `/api/dashboard/agent_steps` and opens this WebSocket; shared chat assets
  are served at `/assets/web/`.
- [quest-lifecycle](../quest-runner-quest-lifecycle/spec.md) — quest/experiment resolution for
  the connection parameters.
- [service-lifecycle](../quest-runner-service-lifecycle/spec.md) — the bus lives in the service
  process; restarting the service drops live subscriptions (clients recover
  via file replay on reconnect).
- Shared contracts: [runtime files](../../../projects/quest-runner/docs/contracts/runtime-files.md) (JSONL
  quest-log format),
  [agent harness event schema](../../../structure/agent-harness-event-schema.md),
  [AGUI event schema](../../../structure/schemas/ag_ui_events.schema.json).
