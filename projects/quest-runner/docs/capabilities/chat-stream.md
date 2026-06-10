# Capability: Chat Stream

ID prefix: `chat`

## Purpose

The chat stream turns quest-local agent log JSONL files into a live, read-only
chat transcript over WebSocket. `WS /api/dashboard/agent_log/stream` replays
the selected step log through `QuestLogToAguiMapper` — which normalizes
harness-specific events (cursor, codex, claude_code, pi) into AGUI events —
then streams new events live from the in-process `ChatEventBus` as the
harness appends them. The dashboard's Agents page is the consumer.

## Requirements

### Connection and setup

- **[chat-1]** THE service SHALL accept WebSocket connections at
  `/api/dashboard/agent_log/stream` with query parameters `project`,
  `quest_type`, `quest_number` (required), and optional `experiment_id` and
  `step`, resolving the same step-log file as `GET /api/dashboard/agent_log`
  (the log with the given `step`, or the highest-numbered step log when
  `step` is omitted).
- **[chat-2]** IF setup fails — missing/invalid query parameters, unknown
  quest, no step logs, or unknown `step` — THEN THE service SHALL send a
  single `{"type": "error", "message": <reason>}` frame and close the stream;
  unexpected setup failures send `{"type": "error", "message": "Internal
  server error"}`.

### Replay-then-live protocol

All server frames are JSON text messages with one of three envelopes:
`{"type": "events", "events": [<AGUI event>...]}`, `{"type": "caught_up"}`,
or `{"type": "error", "message": <string>}`. The client never sends
messages; the stream is one-directional.

- **[chat-3]** WHEN a connection is established, THE service SHALL first
  replay the log file from the beginning: each JSONL line is parsed and
  mapped to zero or more AGUI events, sent in `events` batches of at most
  100 events.
- **[chat-4]** IF a replayed line is not valid JSON, THEN THE service SHALL
  send `{"type": "error", "message": "invalid JSON: <detail>"}` and continue
  with the next line; IF a line parses to a non-object, THEN it sends
  `{"type": "error", "message": "expected JSON object per line"}` and
  continues.
- **[chat-5]** WHEN replay reaches end of file, THE service SHALL flush the
  mapper (emitting balancing `TOOL_CALL_END`, `REASONING_MESSAGE_END`,
  `REASONING_END`, `TEXT_MESSAGE_END`, and `RUN_FINISHED` events for any
  still-open entities), send any remaining batch, and then send
  `{"type": "caught_up"}` exactly once.
- **[chat-6]** WHILE the connection stays open after `caught_up`, THE
  service SHALL forward live events published for that log file, mapping
  each through the same mapper instance and sending the mapped events as an
  `events` frame immediately (one source event per frame; no batching delay).
- **[chat-7]** THE service SHALL subscribe to the event bus *before* reading
  the file and SHALL drop live events whose integer `sequence` is less than
  or equal to the highest `sequence` seen during replay, so no event is lost
  or duplicated across the replay/live boundary.
- **[chat-8]** WHEN the WebSocket closes or a send fails (including during
  replay), THE service SHALL stop the session and remove its event-bus
  subscription; the live loop detects a closed socket within ~1 second
  (queue poll timeout).

### Event bus

- **[chat-9]** THE chat event bus SHALL be in-memory and process-local,
  keyed by the resolved (absolute) log path, fanning out each published
  event to every subscriber's queue; live updates therefore exist only for
  logs written by the currently running service process — history always
  comes from the file.
- **[chat-10]** THE harness log sink SHALL publish each quest-log event to
  the bus only after appending and flushing it to the JSONL file, so a
  reconnecting client can always recover the event from disk.

### AGUI mapping

The target event schema is canonical at
[`structure/schemas/ag_ui_events.schema.json`](../../../../structure/schemas/ag_ui_events.schema.json).
Source events are quest-log JSONL events (see
[runtime files](../contracts/runtime-files.md) and the
[agent harness event schema](../../../../structure/agent-harness-event-schema.md)).

- **[chat-11]** THE mapper SHALL map quest-runner control events:
  `sheaf.run_started` → `RUN_STARTED`; `sheaf.run_completed` → balancing END
  events then `RUN_FINISHED` (with `result`); `sheaf.run_failed` → balancing
  END events then `RUN_ERROR` (with `message` and `code`); `sheaf.prompt` →
  a user `TEXT_MESSAGE_START`/`CONTENT`/`END` triplet;
  `sheaf.path_enforcement` → `CUSTOM` named `sheaf.path_enforcement`.
- **[chat-12]** THE mapper SHALL map `provider.text` events to `CUSTOM`
  events named `provider.text`, and SHALL dispatch `provider.json` events by
  the `harness` field to harness-specific rules for `cursor`, `codex`,
  `claude_code`, and `pi` (summarized in Contracts).
- **[chat-13]** IF an event has an unrecognized kind, harness, or payload
  shape — or mapping raises an exception — THEN THE mapper SHALL emit a
  single `RAW` AGUI event carrying the source event (no data loss) and
  record it in `errors()`.
- **[chat-14]** THE mapper SHALL emit balanced lifecycle sequences: every
  `TEXT_MESSAGE_START`, `REASONING_START`/`REASONING_MESSAGE_START`,
  `TOOL_CALL_START`, and `RUN_STARTED` is eventually closed by its matching
  END/FINISHED event, either from source events or at run end / `flush()`.
- **[chat-15]** THE mapper SHALL preserve the full source event as
  `rawEvent` on emitted events and SHALL set `timestamp` (epoch
  milliseconds) derived from the payload's `timestamp_ms` or the source
  event's ISO `timestamp` when available.

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
[AGUI schema](../../../../structure/schemas/ag_ui_events.schema.json).
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
  [dashboard](dashboard.md) for mount/teardown behavior.

## Interactions

- [agent-harness](agent-harness.md) — writes the
  `logs/step_<n>_<role>.jsonl` files this capability replays and publishes
  the live events it streams.
- [dashboard](dashboard.md) — the Agents page selects a step via
  `/api/dashboard/agent_steps` and opens this WebSocket; shared chat assets
  are served at `/assets/web/`.
- [quest-lifecycle](quest-lifecycle.md) — quest/experiment resolution for
  the connection parameters.
- [service-lifecycle](service-lifecycle.md) — the bus lives in the service
  process; restarting the service drops live subscriptions (clients recover
  via file replay on reconnect).
- Shared contracts: [runtime files](../contracts/runtime-files.md) (JSONL
  quest-log format),
  [agent harness event schema](../../../../structure/agent-harness-event-schema.md),
  [AGUI event schema](../../../../structure/schemas/ag_ui_events.schema.json).
