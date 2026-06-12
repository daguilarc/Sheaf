# Capability: AGUI Mapping

Project: `projects/sheaf-chat`
ID prefix: `agui` — requirement IDs are append-only; never renumber or reuse.

## Purpose

The translation layer between Pi agent events / Sheaf activity and the AGUI
event vocabulary consumed by the shared browser renderer: stateful streaming
mapping, sanitization of secrets and host paths, and the snapshot reduction
used for lazy history. AGUI event field shapes are canonical in
[`structure/schemas/ag_ui_events.schema.json`](../../../structure/schemas/ag_ui_events.schema.json)
and are not restated here.

## Requirements

### Requirement: agui-1 — Pi event mapping: Per-session stateful mapper

THE service SHALL map each session's Pi events through a per-session stateful mapper that tracks open runs, text messages, reasoning phases, and tool calls so that emitted AGUI streams are well-formed (every START eventually closed, no duplicate STARTs for one id).

#### Scenario: Pi events mapped through stateful mapper

- **WHEN** a session's Pi events arrive
- **THEN** the service maps them through a per-session stateful mapper that tracks open runs, text messages, reasoning phases, and tool calls, producing well-formed AGUI streams (every START eventually closed, no duplicate STARTs for one id)

### Requirement: agui-2 — Pi event mapping: Pi event type mapping

THE mapper SHALL map Pi event types as follows: `agent_start` → `RUN_STARTED` (run id `<threadId>:step:<step>:run:<n>`, counter per mapper); `agent_end` → close all open tools/reasoning/text (sorted by id), then `RUN_FINISHED` with the sanitized source event as `result`; `turn_start`/`turn_end` → `STEP_STARTED`/`STEP_FINISHED` with `stepName: "pi.turn"`.

#### Scenario: agent_start event

- **WHEN** an `agent_start` Pi event arrives
- **THEN** the mapper emits `RUN_STARTED` with run id `<threadId>:step:<step>:run:<n>` (counter per mapper)

#### Scenario: agent_end event

- **WHEN** an `agent_end` Pi event arrives
- **THEN** the mapper closes all open tools/reasoning/text (sorted by id), then emits `RUN_FINISHED` with the sanitized source event as `result`

#### Scenario: turn_start/turn_end events

- **WHEN** a `turn_start` or `turn_end` Pi event arrives
- **THEN** the mapper emits `STEP_STARTED` or `STEP_FINISHED` respectively with `stepName: "pi.turn"`

### Requirement: agui-3 — Pi event mapping: Assistant message stream mapping

THE mapper SHALL map assistant message streams: `message_start` → `TEXT_MESSAGE_START` (deduplicated); `text_delta` → `TEXT_MESSAGE_CONTENT` (empty deltas dropped, START synthesized if missing); `text_end` → any missing tail of the final content (when the final text strictly extends the buffered deltas) followed by `TEXT_MESSAGE_END`; `message_end` → close reasoning then text for that message.

#### Scenario: message_start event

- **WHEN** a `message_start` Pi event arrives
- **THEN** the mapper emits `TEXT_MESSAGE_START` (deduplicated)

#### Scenario: text_delta event

- **WHEN** a `text_delta` Pi event arrives
- **THEN** the mapper emits `TEXT_MESSAGE_CONTENT` (empty deltas dropped, START synthesized if missing)

#### Scenario: text_end event

- **WHEN** a `text_end` Pi event arrives
- **THEN** the mapper emits any missing tail of the final content (when the final text strictly extends the buffered deltas) followed by `TEXT_MESSAGE_END`

#### Scenario: message_end event

- **WHEN** a `message_end` Pi event arrives
- **THEN** the mapper closes reasoning then text for that message

### Requirement: agui-4 — Pi event mapping: Thinking stream mapping

THE mapper SHALL map thinking streams to reasoning events with message id `<piMessageId>:thinking`: first delta emits `REASONING_START` and `REASONING_MESSAGE_START` (role `reasoning`), deltas emit `REASONING_MESSAGE_CONTENT`, and close emits `REASONING_MESSAGE_END` then `REASONING_END`, with the same missing-tail completion as text.

#### Scenario: First thinking delta

- **WHEN** the first thinking delta arrives for a message
- **THEN** the mapper emits `REASONING_START` and `REASONING_MESSAGE_START` (role `reasoning`) with message id `<piMessageId>:thinking`

#### Scenario: Subsequent thinking deltas

- **WHEN** subsequent thinking deltas arrive
- **THEN** the mapper emits `REASONING_MESSAGE_CONTENT`

#### Scenario: Thinking stream close

- **WHEN** the thinking stream closes
- **THEN** the mapper emits `REASONING_MESSAGE_END` then `REASONING_END`, with the same missing-tail completion as text

### Requirement: agui-5 — Pi event mapping: Tool activity mapping

THE mapper SHALL map tool activity to `TOOL_CALL_START` (with `toolCallName`, and `parentMessageId` when the call arrives via an assistant `tool_call_delta`), `TOOL_CALL_ARGS` (stringified args: objects serialized with sorted keys; emitted at most once per source that carries args before execution updates), `TOOL_CALL_RESULT` (`messageId` = `<toolCallId>:result`, role `tool`, stringified content; `tool_execution_end` wraps `{result, isError}` when `isError` is present), and `TOOL_CALL_END` on execution end.

#### Scenario: Tool call start

- **WHEN** a tool call begins
- **THEN** the mapper emits `TOOL_CALL_START` with `toolCallName`, and `parentMessageId` when the call arrives via an assistant `tool_call_delta`

#### Scenario: Tool call args

- **WHEN** a source carries args before execution updates
- **THEN** the mapper emits `TOOL_CALL_ARGS` (stringified args: objects serialized with sorted keys; emitted at most once per such source)

#### Scenario: Tool call result

- **WHEN** a tool execution produces a result
- **THEN** the mapper emits `TOOL_CALL_RESULT` with `messageId` = `<toolCallId>:result`, role `tool`, stringified content; `tool_execution_end` wraps `{result, isError}` when `isError` is present

#### Scenario: Tool call end

- **WHEN** tool execution ends
- **THEN** the mapper emits `TOOL_CALL_END`

### Requirement: agui-6 — Pi event mapping: Stable id derivation

THE mapper SHALL derive stable ids from context: pi message id `<threadId>:step:<step>:pi-message:<role>:<timestamp>` (falling back to `<threadId>:step:<step>:seq:<seq>:pi-message` without a timestamp); tool call ids prefer the source `toolCallId` / the message's last `toolCall` content-block id, else `<piMessageId>:tool`.

#### Scenario: Message id with timestamp

- **WHEN** a Pi message has a timestamp
- **THEN** the mapper derives id `<threadId>:step:<step>:pi-message:<role>:<timestamp>`

#### Scenario: Message id without timestamp

- **WHEN** a Pi message lacks a timestamp
- **THEN** the mapper derives id `<threadId>:step:<step>:seq:<seq>:pi-message`

#### Scenario: Tool call id derivation

- **WHEN** a tool call id is needed
- **THEN** the mapper prefers the source `toolCallId` / the message's last `toolCall` content-block id, else uses `<piMessageId>:tool`

### Requirement: agui-7 — Pi event mapping: Misc event handling

THE mapper SHALL map `auto_retry_end` with `success: false` to `RUN_ERROR` (code `auto_retry_failed`); silently drop `compaction_start`, `compaction_end`, `auto_retry_start`, `queue_update`, and successful `auto_retry_end`; map `session_info_changed`, `thinking_level_changed`, `thinking_level_change`, `session`, `model_change`, and `session_info` to `CUSTOM` events named `pi.<type>` with the sanitized event as value; and map a complete `message` event to a START/CONTENT/END triple of its extracted text.

#### Scenario: auto_retry_end with failure

- **WHEN** an `auto_retry_end` event arrives with `success: false`
- **THEN** the mapper emits `RUN_ERROR` with code `auto_retry_failed`

#### Scenario: Silently dropped events

- **WHEN** a `compaction_start`, `compaction_end`, `auto_retry_start`, `queue_update`, or successful `auto_retry_end` event arrives
- **THEN** the mapper silently drops it

#### Scenario: Session info / model change events

- **WHEN** a `session_info_changed`, `thinking_level_changed`, `thinking_level_change`, `session`, `model_change`, or `session_info` event arrives
- **THEN** the mapper emits a `CUSTOM` event named `pi.<type>` with the sanitized event as value

#### Scenario: Complete message event

- **WHEN** a complete `message` event arrives
- **THEN** the mapper emits a START/CONTENT/END triple of its extracted text

### Requirement: agui-8 — Pi event mapping: Unrecognized or malformed events

IF an event is unrecognized or malformed, THEN THE mapper SHALL emit a `RAW` event with the sanitized source under `event` and the source type under `source`, never throwing into the caller.

#### Scenario: Unrecognized or malformed event

- **WHEN** an unrecognized or malformed event arrives
- **THEN** the mapper emits a `RAW` event with the sanitized source under `event` and the source type under `source`, without throwing into the caller

### Requirement: agui-9 — Pi event mapping: rawEvent and timestamp on all mapped events

Every mapped event SHALL carry the sanitized source event as `rawEvent` and, when the context provides one, a `timestamp`; text roles outside `developer|system|assistant|user` normalize to `assistant`.

#### Scenario: rawEvent and timestamp

- **WHEN** any Pi event is mapped
- **THEN** the resulting AGUI event carries the sanitized source event as `rawEvent` and, when the context provides one, a `timestamp`

#### Scenario: Non-standard text role

- **WHEN** a text role outside `developer|system|assistant|user` is encountered
- **THEN** it is normalized to `assistant`

### Requirement: agui-10 — Sheaf activity and user messages: User message mapping

THE service SHALL map an accepted user message to the triple `TEXT_MESSAGE_START` (role `user`) / `TEXT_MESSAGE_CONTENT` / `TEXT_MESSAGE_END` keyed by the client `messageId`.

#### Scenario: Accepted user message

- **WHEN** a user message is accepted
- **THEN** the service emits `TEXT_MESSAGE_START` (role `user`), `TEXT_MESSAGE_CONTENT`, and `TEXT_MESSAGE_END`, all keyed by the client `messageId`

### Requirement: agui-11 — Sheaf activity and user messages: Sheaf activity mapping

THE service SHALL map Sheaf activity to AGUI: `model_changed` → `CUSTOM` named `sheaf.model_changed`; `lifecycle_status` → `CUSTOM` named `sheaf.lifecycle_status`; `path_escape_denied` → `CUSTOM` named `sheaf.path_enforcement`; `cancellation` and `error` → `RUN_ERROR` with the activity code (default `cancelled` / `Turn cancelled`). All values pass through the sanitizer.

#### Scenario: model_changed activity

- **WHEN** a `model_changed` Sheaf activity arrives
- **THEN** the service emits `CUSTOM` named `sheaf.model_changed` with the sanitized value

#### Scenario: lifecycle_status activity

- **WHEN** a `lifecycle_status` Sheaf activity arrives
- **THEN** the service emits `CUSTOM` named `sheaf.lifecycle_status` with the sanitized value

#### Scenario: path_escape_denied activity

- **WHEN** a `path_escape_denied` Sheaf activity arrives
- **THEN** the service emits `CUSTOM` named `sheaf.path_enforcement` with the sanitized value

#### Scenario: cancellation or error activity

- **WHEN** a `cancellation` or `error` Sheaf activity arrives
- **THEN** the service emits `RUN_ERROR` with the activity code (default `cancelled` / `Turn cancelled`)

### Requirement: agui-12 — Sanitization: Secret redaction

THE service SHALL sanitize every string in mapped payloads before persistence or broadcast: secret-looking substrings (`Bearer …` tokens, `sk-…` keys, `AKIA…` AWS ids, `api_key/token/secret/password [:=] value` pairs) are replaced with `[REDACTED]`.

#### Scenario: Secret-looking substring in payload

- **WHEN** a mapped payload string contains a `Bearer …` token, `sk-…` key, `AKIA…` AWS id, or `api_key/token/secret/password [:=] value` pair
- **THEN** the secret-looking substring is replaced with `[REDACTED]` before persistence or broadcast

### Requirement: agui-13 — Sanitization: Path relativization

WHERE a canonical session root is known, THE sanitizer SHALL rewrite absolute paths in strings: paths under the root become root-relative (`/` separated), paths outside it become `<outside-root>`.

#### Scenario: Path under session root

- **WHEN** a canonical session root is known and a string contains an absolute path under that root
- **THEN** the sanitizer rewrites the path to be root-relative (`/` separated)

#### Scenario: Path outside session root

- **WHEN** a canonical session root is known and a string contains an absolute path outside that root
- **THEN** the sanitizer rewrites the path to `<outside-root>`

### Requirement: agui-14 — Snapshots: AGUI event list reduction

THE service SHALL reduce an ordered AGUI event list to snapshot messages (`eventsToSnapshots`): one message per id in first-seen order, with text/reasoning content accumulated from deltas, assistant messages carrying their `toolCalls` (id, name, accumulated args, latest result), tool results as role-`tool` messages, `CUSTOM` / `RAW` / `ACTIVITY_SNAPSHOT` events as role-`activity` messages, and reasoning messages (`…:thinking`) ordered before their parent message.

#### Scenario: AGUI event list reduced to snapshots

- **WHEN** `eventsToSnapshots` is called with an ordered AGUI event list
- **THEN** the service produces one snapshot message per id in first-seen order, accumulating text/reasoning content from deltas, attaching `toolCalls` to assistant messages, representing tool results as role-`tool` messages, representing `CUSTOM`/`RAW`/`ACTIVITY_SNAPSHOT` events as role-`activity` messages, and ordering reasoning messages (`…:thinking`) before their parent message

### Requirement: agui-15 — Snapshots: Reduction filtering rules

THE reduction SHALL drop messages whose content is empty (whitespace-only) and carry no tool calls, SHALL ignore events for already-finalized ids, SHALL materialize still-open messages at the end of the page, and SHALL drop `RAW` events that merely wrap Pi text/thinking start/end lifecycle markers.

#### Scenario: Empty message with no tool calls

- **WHEN** reducing and a message has whitespace-only content and no tool calls
- **THEN** the reduction drops that message

#### Scenario: Event for already-finalized id

- **WHEN** an event arrives for an already-finalized id
- **THEN** the reduction ignores it

#### Scenario: Still-open messages at end of page

- **WHEN** a page ends with still-open messages
- **THEN** the reduction materializes those messages at the end of the page

#### Scenario: RAW event wrapping Pi lifecycle markers

- **WHEN** a `RAW` event merely wraps Pi text/thinking start/end lifecycle markers
- **THEN** the reduction drops it

## Contracts

Event field shapes:
[`ag_ui_events.schema.json`](../../../structure/schemas/ag_ui_events.schema.json).
Worked example — one user turn as persisted (payloads of consecutive
`agui.event` envelopes):

```json
{ "type": "TEXT_MESSAGE_START", "messageId": "msg-1", "role": "user" }
{ "type": "TEXT_MESSAGE_CONTENT", "messageId": "msg-1", "delta": "Inspect src/app.ts" }
{ "type": "TEXT_MESSAGE_END", "messageId": "msg-1" }
```

Sheaf path-enforcement activity value (inside
`CUSTOM`/`sheaf.path_enforcement`):

```json
{ "inputPath": "../outside", "reason": "parent_traversal", "tool": "read" }
```

Snapshot message shapes (produced by [agui-14]):

```json
{ "id": "m2", "role": "assistant", "content": "Done.",
  "toolCalls": [ { "id": "t1", "name": "read", "args": "{\"path\":\"src/app.ts\"}", "result": "…" } ] }
{ "id": "t1:result", "role": "tool", "content": "…", "toolCallId": "t1" }
{ "id": "custom:3", "role": "activity", "activityType": "sheaf.model_changed", "content": "{…}" }
```

## Design

- `src/agui/mapper.ts` — `PiToAguiMapper` (the stateful core; one instance
  per persistence hub), `mapUserMessageToAgui`, `mapSheafActivityToAgui`,
  `Flush`/`CloseOpenForEvent` for closing dangling streams.
- `src/agui/sanitizer.ts` — `RedactSecrets` patterns,
  `RelativizeAbsolutePath`, `RelativizePathsInText`, `SanitizeValue`
  (deep walk).
- `src/agui/snapshots.ts` — `eventsToSnapshots` and the snapshot builder
  state machine.
- `src/agui/schemaValidation.ts` — an Ajv validator over the repository
  schema; exercised by tests only, not on the runtime hot path (gap noted
  in [coverage](../../../projects/sheaf-chat/docs/coverage.md)).
- The mapper additionally exposes `Errors()` returning clones of all
  fallback (RAW) source events, used for diagnostics in tests.

## Interactions

- [chat-protocol](../sheaf-chat-chat-protocol/spec.md) — persists and broadcasts every mapped
  event.
- [session-history](../sheaf-chat-session-history/spec.md) — snapshot mode pages call
  `eventsToSnapshots`.
- [agent-runtime](../sheaf-chat-agent-runtime/spec.md) — supplies the Pi events and Sheaf
  activity.
- [scoped-tools](../sheaf-chat-scoped-tools/spec.md) — defines the path-escape activity shape
  mapped by [agui-11].
- [chat-ui](../sheaf-chat-chat-ui/spec.md) — renders these events via the shared renderer.
