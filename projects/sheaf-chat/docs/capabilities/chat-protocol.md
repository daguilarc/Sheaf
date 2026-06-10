# Capability: Chat Protocol

ID prefix: `chat`

## Purpose

The bidirectional WebSocket protocol at `/ws/chat`: how connections are
validated and bootstrapped (hello → replay → caught-up → live), the client
and server frame vocabulary, user-message acceptance and deduplication, and
which envelopes are persisted versus connection-local. Every frame is a chat
envelope ([session files](../contracts/session-files.md)).

## Requirements

### Connection

- **[chat-1]** THE service SHALL accept WebSocket upgrades only at path
  `/ws/chat` with query parameters `p` (or `pile`) and `session` required,
  `client` (stable browser client id) and `after` (last processed sequence,
  integer) optional. Non-matching upgrade paths destroy the socket.
- **[chat-2]** IF the pile/session parameters are missing or invalid, THEN
  THE service SHALL reject the upgrade with a plain HTTP 400 response before
  the WebSocket opens; IF the session's Pi session file does not exist, THEN
  it SHALL reject with HTTP 404 (`session not found`).
- **[chat-3]** WHEN a connection is accepted, THE service SHALL attach the
  session runtime (cold-resuming if needed,
  [agent-runtime](agent-runtime.md)) and send `server.hello` as the first
  frame, then: replay persisted envelopes with sequence > `after` (when
  `after` was supplied) up to the sequence known at registration time, send
  `server.caught_up`, replay any envelopes persisted during the bootstrap
  window, and only then deliver live broadcasts.
- **[chat-4]** WHILE the bootstrap (hello/replay/caught-up) is in progress,
  THE service SHALL queue incoming client frames and process them in order
  after the backlog drains, rather than dropping or interleaving them.
- **[chat-5]** IF runtime attachment or bootstrap fails, THEN THE service
  SHALL send a fatal `server.error` frame (code from the underlying storage
  error, otherwise `connection_failed`) and close the socket.
- **[chat-6]** WHEN a socket closes, THE service SHALL detach its client
  reference from the runtime (starting the idle-offload clock when it was
  the last one) and release the session broadcaster if no clients remain.

### Client frames

- **[chat-7]** THE service SHALL validate every inbound frame as a v1
  envelope (required `v:1`, `kind`, `id`, `pile`, `sessionId`, `timestamp`)
  and respond to malformed JSON or invalid envelopes with a non-fatal
  `server.error` (`invalid_frame`, messages in the catalogue) instead of
  closing.
- **[chat-8]** IF a frame's `pile`/`sessionId` do not match the connection,
  THEN THE service SHALL reply non-fatal `invalid_frame`
  (`frame pile/sessionId does not match connection`) with `requestId` set to
  the frame id, and ignore the frame.
- **[chat-9]** THE service SHALL accept these client kinds and reject any
  other kind with `invalid_frame`
  (`unsupported client frame kind: <kind>`): `client.hello`,
  `client.user_message`, `client.history_request`, `client.model_select`,
  `client.ack`, `client.cancel`, `client.stop_generating`, `client.ping`.
- **[chat-10]** WHEN it accepts a `client.user_message` (payload:
  required `messageId` and `text`; optional `attachments` array, defaulting
  to `[]`; optional `steer`, defaulting under persistence to `true`), THE
  service SHALL, in order: persist and broadcast a `chat.user_message`
  envelope, persist and broadcast the three user-text AGUI events
  (`TEXT_MESSAGE_START`/`CONTENT`/`END` with the client `messageId`), then
  deliver the text to the Pi session.
- **[chat-11]** THE service SHALL deduplicate user messages by `messageId`
  per session (including ids replayed from the history log at hub
  initialization): a duplicate is silently ignored. Acceptance is serialized
  per session so concurrent submissions get monotonic sequences.
- **[chat-12]** IF Pi delivery of an accepted user message fails, THEN THE
  service SHALL keep the accepted turn in history and persist+broadcast a
  non-fatal `server.error` envelope with code
  `user_message_delivery_failed`.
- **[chat-13]** WHEN it receives `client.history_request` (same
  `before`/`after`/`limit` semantics as
  [session-history](session-history.md), WebSocket default `prefer` is
  `snapshots`), THE service SHALL reply — only to the requesting connection —
  with a `history.page` frame whose payload echoes the request frame id as
  `requestId`. Live broadcasts are not blocked while the page is read.
- **[chat-14]** WHEN serving history events to clients (history pages in
  `events` mode and connect replay), THE service SHALL not duplicate user
  turns: a `chat.user_message` envelope is synthesized into user AGUI events
  only when no stored `agui.event` with the same `messageId` exists.
- **[chat-15]** WHEN it receives `client.model_select` (required `provider`,
  `id`; optional `applyTo` of `next_turn` (default) or `current_turn`), THE
  service SHALL validate the model ([models](models.md)) and apply it to the
  session; failures produce a non-fatal `server.error` with the validation
  code and the frame id as `requestId`.
- **[chat-16]** WHEN it receives `client.cancel` or
  `client.stop_generating`, THE service SHALL abort the active Pi turn (a
  no-op when the session runtime is absent) — see
  [agent-runtime](agent-runtime.md) for the resulting error envelope.
- **[chat-17]** WHEN it receives `client.ack` (`sequence` number), THE
  service SHALL record the connection's last-acknowledged sequence.
  Acknowledgements are diagnostics only and do not affect delivery.
- **[chat-18]** WHEN it receives `client.ping`, THE service SHALL reply to
  that connection with `server.pong` carrying `requestId` = the ping frame
  id.
- **[chat-19]** WHEN it receives `client.hello` (optional
  `supportsSnapshots`, `supportsLazyHistory`, `lastSeenSequence`), THE
  service SHALL accept it without reply; the payload is currently unused.

### Server frames and persistence

- **[chat-20]** THE service SHALL persist (with sequences) and broadcast to
  all connected clients of the session: `chat.user_message`, `agui.event`,
  `model.changed`, `agent.status`, `session.updated`, and lifecycle
  `server.error` envelopes. `server.hello`, `server.caught_up`,
  `server.pong`, `history.page`, `file.changed`, and frame-validation
  `server.error`s are never persisted.
- **[chat-21]** WHEN a model change is applied, THE service SHALL persist
  and broadcast `model.changed` (`{"model": {...}, "applyTo": "..."}`)
  followed by a `CUSTOM`/`sheaf.model_changed` AGUI event envelope.
- **[chat-22]** WHEN the agent lifecycle state changes, THE service SHALL
  persist and broadcast `agent.status`
  (`{"state": "...", "previousState": "..."}`) followed by a
  `CUSTOM`/`sheaf.lifecycle_status` AGUI event envelope. States:
  [agent-runtime](agent-runtime.md).
- **[chat-23]** WHEN the manifest is created or updated, THE service SHALL
  persist and broadcast `session.updated` with the manifest as payload,
  `rootDirectory` relativized to the repository root.
- **[chat-24]** WHEN a lifecycle error is reported, THE service SHALL
  persist and broadcast `server.error`
  (`{"code", "message", "fatal": <bool>}`) followed by a `RUN_ERROR` AGUI
  event envelope.
- **[chat-25]** WHEN the service receives a successful scoped edit-tool file
  notification, THE service SHALL broadcast `file.changed` only to currently
  connected sessions whose canonical root contains the changed file; the
  envelope SHALL have no `sequence` and SHALL use a path relative to each
  receiving session root.

## Contracts

### Connect URL

```text
/ws/chat?p=<pile>&session=<sessionId>&client=<clientId>&after=<sequence>
```

### `server.hello` payload

```json
{
  "connectionId": "9c2f4e1a-…",
  "manifest": null,
  "provisionalSession": {
    "rootDirectory": "projects",
    "model": { "provider": "local", "id": "qwen3-coder" }
  },
  "latestSequence": 12,
  "historyWindow": { "oldestSequence": 1, "newestSequence": 12 },
  "models": [ { "provider": "local", "id": "qwen3-coder", "available": true } ],
  "activeModel": { "provider": "local", "id": "qwen3-coder" }
}
```

`manifest` is the persisted manifest or `null`; `provisionalSession` is
present only while no manifest exists and the provisional root is known
(root relativized to the repository root). `latestSequence` is 0 for an
empty log.

### `history.page` payload

```json
{
  "requestId": "<client frame id>",
  "direction": "before",
  "messages": [ { "id": "m1", "role": "user", "content": "hi" } ],
  "events": [],
  "oldestSequence": 3,
  "newestSequence": 9,
  "hasMoreBefore": true,
  "hasMoreAfter": false
}
```

In `snapshots` mode `messages` is populated and `events` is `[]`; in
`events` mode the reverse.

### `chat.user_message` payload (persisted/broadcast)

```json
{ "messageId": "client-id-1", "text": "hello", "attachments": [], "steer": true }
```

### `server.error` payload

```json
{ "code": "invalid_frame", "message": "frame version must be 1", "fatal": false, "requestId": "<frame id>" }
```

`requestId` is present when the error responds to an identifiable frame.

### `file.changed` payload

Live-only frame, not present in replay or history pages:

```json
{
  "eventType": "fileChanged",
  "path": "docs/readme.md",
  "fileId": "docs/readme.md",
  "changedAt": "2026-06-10T00:00:00.000Z",
  "source": "edit_tool"
}
```

The payload path and `fileId` are root-relative for the receiving session.

### Error catalogue

| Condition | Surface | Code / message (exact) |
|---|---|---|
| Upgrade with missing `p`/`session` | HTTP 400 on upgrade | `pile query parameter is required` / `session query parameter is required` |
| Upgrade with invalid pile/session/`after` | HTTP 400 on upgrade | validation messages from [session files](../contracts/session-files.md); `after must be an integer` |
| Session file missing | HTTP 404 on upgrade | `session not found` |
| Malformed JSON frame | non-fatal `server.error` | `invalid_frame` / `malformed JSON frame` |
| `v` != 1 | non-fatal `server.error` | `invalid_frame` / `frame version must be 1` |
| Missing envelope field | non-fatal `server.error` | `invalid_frame` / `frame <field> is required` |
| Identity mismatch | non-fatal `server.error` | `invalid_frame` / `frame pile/sessionId does not match connection` |
| Unknown kind | non-fatal `server.error` | `invalid_frame` / `unsupported client frame kind: <kind>` |
| `before`+`after` in history request | non-fatal `server.error` | `invalid_history_request` |
| Frame handler failure | non-fatal `server.error` | underlying code or `request_failed`, with `requestId` |
| Bootstrap failure | fatal `server.error`, then close | underlying code or `connection_failed` |
| Pi delivery failure | persisted non-fatal `server.error` | `user_message_delivery_failed` |

WebSocket close codes are not specified (library defaults).

## Design

- `src/server/websocket.ts` — upgrade validation
  (`ResolveChatWebSocketUpgrade`, `rejectUpgradeWithHttpStatus`), the
  attach/bootstrap sequence (`AttachChatWebSocketConnection`), and the
  per-kind frame switch (`HandleClientMessage`).
- `src/protocol/clientFrames.ts` — envelope and payload validation with the
  pinned error strings.
- `src/protocol/sessionPersistenceHub.ts` — the per-session single writer:
  initializes `latestSequence` and the accepted-`messageId` set from the
  log, subscribes to lifecycle events (`agentEvent`, `model`, `status`,
  `manifestUpdated`, `error`), maps them via [agui-mapping](agui-mapping.md),
  appends through [session-history](session-history.md), and publishes each
  persisted envelope. User messages run on a per-session promise chain.
  Hubs are registered per process and are not released on disconnect (their
  lifecycle subscription keeps persisting agent events for detached
  sessions).
- `src/protocol/sessionBroadcaster.ts` — socket registry and fan-out;
  `RegisterClient` assigns a random `connectionId`; `ActivateClient` defers
  live delivery until after replay; `ReplayAfter` re-reads the log file;
  `BroadcastFileChanged` emits live unsequenced file events for matching
  roots; `ReleaseIfIdle` disposes the broadcaster when the last client
  leaves (hub remains).
- Replay reads the persisted log, so a reconnecting client receives exactly
  the persisted envelope kinds (chat-20), not connection-local frames.

## Interactions

- [session files](../contracts/session-files.md) — envelope schema.
- [session-history](session-history.md) — append, sequencing, paging.
- [agent-runtime](agent-runtime.md) — attach/detach, message delivery,
  model select, cancel.
- [agui-mapping](agui-mapping.md) — payloads of `agui.event` envelopes.
- [chat-ui](chat-ui.md) — the reference client.
- [file-browser](file-browser.md) — source and client semantics for
  `file.changed`.
