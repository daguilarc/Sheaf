# Capability: AGUI Mapping

ID prefix: `agui`

## Purpose

The translation layer between Pi agent events / Sheaf activity and the AGUI
event vocabulary consumed by the shared browser renderer: stateful streaming
mapping, sanitization of secrets and host paths, and the snapshot reduction
used for lazy history. AGUI event field shapes are canonical in
[`structure/schemas/ag_ui_events.schema.json`](../../../../structure/schemas/ag_ui_events.schema.json)
and are not restated here.

## Requirements

### Pi event mapping

- **[agui-1]** THE service SHALL map each session's Pi events through a
  per-session stateful mapper that tracks open runs, text messages,
  reasoning phases, and tool calls so that emitted AGUI streams are
  well-formed (every START eventually closed, no duplicate STARTs for one
  id).
- **[agui-2]** THE mapper SHALL map Pi event types as follows:
  `agent_start` → `RUN_STARTED` (run id
  `<threadId>:step:<step>:run:<n>`, counter per mapper);
  `agent_end` → close all open tools/reasoning/text (sorted by id), then
  `RUN_FINISHED` with the sanitized source event as `result`;
  `turn_start`/`turn_end` → `STEP_STARTED`/`STEP_FINISHED` with
  `stepName: "pi.turn"`.
- **[agui-3]** THE mapper SHALL map assistant message streams:
  `message_start` → `TEXT_MESSAGE_START` (deduplicated);
  `text_delta` → `TEXT_MESSAGE_CONTENT` (empty deltas dropped, START
  synthesized if missing); `text_end` → any missing tail of the final
  content (when the final text strictly extends the buffered deltas)
  followed by `TEXT_MESSAGE_END`; `message_end` → close reasoning then
  text for that message.
- **[agui-4]** THE mapper SHALL map thinking streams to reasoning events
  with message id `<piMessageId>:thinking`: first delta emits
  `REASONING_START` and `REASONING_MESSAGE_START` (role `reasoning`),
  deltas emit `REASONING_MESSAGE_CONTENT`, and close emits
  `REASONING_MESSAGE_END` then `REASONING_END`, with the same
  missing-tail completion as text.
- **[agui-5]** THE mapper SHALL map tool activity to
  `TOOL_CALL_START` (with `toolCallName`, and `parentMessageId` when the
  call arrives via an assistant `tool_call_delta`), `TOOL_CALL_ARGS`
  (stringified args: objects serialized with sorted keys; emitted at most
  once per source that carries args before execution updates),
  `TOOL_CALL_RESULT` (`messageId` = `<toolCallId>:result`, role `tool`,
  stringified content; `tool_execution_end` wraps `{result, isError}` when
  `isError` is present), and `TOOL_CALL_END` on execution end.
- **[agui-6]** THE mapper SHALL derive stable ids from context:
  pi message id `<threadId>:step:<step>:pi-message:<role>:<timestamp>`
  (falling back to `<threadId>:step:<step>:seq:<seq>:pi-message` without a
  timestamp); tool call ids prefer the source `toolCallId` / the message's
  last `toolCall` content-block id, else `<piMessageId>:tool`.
- **[agui-7]** THE mapper SHALL map `auto_retry_end` with `success: false`
  to `RUN_ERROR` (code `auto_retry_failed`); silently drop
  `compaction_start`, `compaction_end`, `auto_retry_start`,
  `queue_update`, and successful `auto_retry_end`; map
  `session_info_changed`, `thinking_level_changed`,
  `thinking_level_change`, `session`, `model_change`, and `session_info`
  to `CUSTOM` events named `pi.<type>` with the sanitized event as value;
  and map a complete `message` event to a START/CONTENT/END triple of its
  extracted text.
- **[agui-8]** IF an event is unrecognized or malformed, THEN THE mapper
  SHALL emit a `RAW` event with the sanitized source under `event` and the
  source type under `source`, never throwing into the caller.
- **[agui-9]** Every mapped event SHALL carry the sanitized source event as
  `rawEvent` and, when the context provides one, a `timestamp`; text roles
  outside `developer|system|assistant|user` normalize to `assistant`.

### Sheaf activity and user messages

- **[agui-10]** THE service SHALL map an accepted user message to the
  triple `TEXT_MESSAGE_START` (role `user`) / `TEXT_MESSAGE_CONTENT` /
  `TEXT_MESSAGE_END` keyed by the client `messageId`.
- **[agui-11]** THE service SHALL map Sheaf activity to AGUI:
  `model_changed` → `CUSTOM` named `sheaf.model_changed`;
  `lifecycle_status` → `CUSTOM` named `sheaf.lifecycle_status`;
  `path_escape_denied` → `CUSTOM` named `sheaf.path_enforcement`;
  `cancellation` and `error` → `RUN_ERROR` with the activity code (default
  `cancelled` / `Turn cancelled`). All values pass through the sanitizer.

### Sanitization

- **[agui-12]** THE service SHALL sanitize every string in mapped payloads
  before persistence or broadcast: secret-looking substrings (`Bearer …`
  tokens, `sk-…` keys, `AKIA…` AWS ids, `api_key/token/secret/password
  [:=] value` pairs) are replaced with `[REDACTED]`.
- **[agui-13]** WHERE a canonical session root is known, THE sanitizer
  SHALL rewrite absolute paths in strings: paths under the root become
  root-relative (`/` separated), paths outside it become
  `<outside-root>`.

### Snapshots

- **[agui-14]** THE service SHALL reduce an ordered AGUI event list to
  snapshot messages (`eventsToSnapshots`): one message per id in
  first-seen order, with text/reasoning content accumulated from deltas,
  assistant messages carrying their `toolCalls` (id, name, accumulated
  args, latest result), tool results as role-`tool` messages, `CUSTOM` /
  `RAW` / `ACTIVITY_SNAPSHOT` events as role-`activity` messages, and
  reasoning messages (`…:thinking`) ordered before their parent message.
- **[agui-15]** THE reduction SHALL drop messages whose content is empty
  (whitespace-only) and carry no tool calls, SHALL ignore events for
  already-finalized ids, SHALL materialize still-open messages at the end
  of the page, and SHALL drop `RAW` events that merely wrap Pi
  text/thinking start/end lifecycle markers.

## Contracts

Event field shapes:
[`ag_ui_events.schema.json`](../../../../structure/schemas/ag_ui_events.schema.json).
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
  in [coverage](../coverage.md)).
- The mapper additionally exposes `Errors()` returning clones of all
  fallback (RAW) source events, used for diagnostics in tests.

## Interactions

- [chat-protocol](chat-protocol.md) — persists and broadcasts every mapped
  event.
- [session-history](session-history.md) — snapshot mode pages call
  `eventsToSnapshots`.
- [agent-runtime](agent-runtime.md) — supplies the Pi events and Sheaf
  activity.
- [scoped-tools](scoped-tools.md) — defines the path-escape activity shape
  mapped by [agui-11].
- [chat-ui](chat-ui.md) — renders these events via the shared renderer.
