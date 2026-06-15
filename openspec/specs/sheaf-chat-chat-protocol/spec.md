# Capability: Chat Protocol

Project: `projects/sheaf-chat`
ID prefix: `chat` — requirement IDs are append-only; never renumber or reuse.

## Purpose

The bidirectional WebSocket protocol at `/ws/chat`: how connections are
validated and bootstrapped (hello → replay → caught-up → live), the client
and server frame vocabulary, user-message acceptance and deduplication, and
which envelopes are persisted versus connection-local. Every frame is a chat
envelope ([session files](../../../projects/sheaf-chat/docs/contracts/session-files.md)).
## Requirements
### Requirement: chat-1 — Connection: WebSocket upgrade path and parameters

THE service SHALL accept WebSocket upgrades only at path `/ws/chat` with query parameters `repo`, `workspace`, and `chat` required, `client` (stable browser client id) and `after` (last processed sequence, integer) optional. Non-matching upgrade paths destroy the socket.

#### Scenario: Valid upgrade path and parameters

- **WHEN** a WebSocket upgrade request arrives at `/ws/chat` with valid `repo`, `workspace`, and `chat` parameters
- **THEN** the service accepts the upgrade after validating that the chat shell exists

#### Scenario: Non-matching path

- **WHEN** a WebSocket upgrade request arrives at a path other than `/ws/chat`
- **THEN** the service destroys the socket

### Requirement: chat-2 — Connection: Reject invalid or missing parameters

IF the repo/workspace/chat parameters are missing or invalid, THEN THE service SHALL reject the upgrade with a plain HTTP 400 response before the WebSocket opens; IF the chat's Pi session file does not exist, THEN it SHALL reject with HTTP 404 (`chat not found`).

#### Scenario: Missing repo, workspace, or chat parameter

- **WHEN** the `repo`, `workspace`, or `chat` parameter is missing
- **THEN** the service rejects the upgrade with HTTP 400 before the WebSocket opens

#### Scenario: Invalid repo, workspace, or chat parameter

- **WHEN** the `repo`, `workspace`, or `chat` parameter is invalid
- **THEN** the service rejects the upgrade with HTTP 400 before the WebSocket opens

#### Scenario: Chat session file missing

- **WHEN** the chat's Pi session file does not exist
- **THEN** the service rejects the upgrade with HTTP 404 (`chat not found`)

### Requirement: chat-3 — Connection: Bootstrap sequence on accepted connection

WHEN a connection is accepted, THE service SHALL attach the session runtime (cold-resuming if needed, [agent-runtime](../sheaf-chat-agent-runtime/spec.md)) and send `server.hello` as the first frame, then: replay persisted envelopes with sequence > `after` (when `after` was supplied) up to the sequence known at registration time, send `server.caught_up`, replay any envelopes persisted during the bootstrap window, and only then deliver live broadcasts.

#### Scenario: Connection accepted with after parameter
- **WHEN** a connection is accepted with an `after` parameter supplied
- **THEN** the service attaches the runtime, sends `server.hello`, replays persisted envelopes with sequence > `after`, sends `server.caught_up`, replays any envelopes persisted during the bootstrap window, and then delivers live broadcasts

#### Scenario: Connection accepted without after parameter
- **WHEN** a connection is accepted without an `after` parameter
- **THEN** the service attaches the runtime, sends `server.hello`, sends `server.caught_up`, and then delivers live broadcasts

### Requirement: chat-4 — Connection: Queue client frames during bootstrap

WHILE the bootstrap (hello/replay/caught-up) is in progress, THE service SHALL queue incoming client frames and process them in order after the backlog drains, rather than dropping or interleaving them.

#### Scenario: Client frames arrive during bootstrap
- **WHEN** client frames arrive while bootstrap is in progress
- **THEN** the service queues them and processes them in order after the backlog drains

### Requirement: chat-5 — Connection: Fatal error on bootstrap failure

IF runtime attachment or bootstrap fails, THEN THE service SHALL send a fatal `server.error` frame (code from the underlying storage error, otherwise `connection_failed`) and close the socket.

#### Scenario: Bootstrap failure
- **WHEN** runtime attachment or bootstrap fails
- **THEN** the service sends a fatal `server.error` frame and closes the socket

### Requirement: chat-6 — Connection: Cleanup on socket close

WHEN a socket closes, THE service SHALL detach its client reference from the runtime (starting the idle-offload clock when it was the last one) and release the session broadcaster if no clients remain.

#### Scenario: Last client disconnects
- **WHEN** the last connected socket closes
- **THEN** the service detaches the client reference (starting the idle-offload clock) and releases the session broadcaster

#### Scenario: Non-last client disconnects
- **WHEN** a socket closes but other clients remain
- **THEN** the service detaches its client reference without releasing the broadcaster

### Requirement: chat-7 — Client frames: Envelope validation

THE service SHALL validate every inbound frame as a v1 envelope (required `v:1`, `kind`, `id`, `repoId`, `workspaceId`, `chatId`, `timestamp`) and respond to malformed JSON or invalid envelopes with a non-fatal `server.error` (`invalid_frame`, messages in the catalogue) instead of closing.

#### Scenario: Malformed JSON

- **WHEN** a client sends malformed JSON
- **THEN** the service replies with a non-fatal `server.error` (`invalid_frame`) instead of closing

#### Scenario: Invalid envelope

- **WHEN** a client sends an envelope missing required v1 identity fields
- **THEN** the service replies with a non-fatal `server.error` (`invalid_frame`) instead of closing

### Requirement: chat-8 — Client frames: Identity mismatch rejection

IF a frame's `repoId`/`workspaceId`/`chatId` do not match the connection, THEN THE service SHALL reply non-fatal `invalid_frame` (`frame repoId/workspaceId/chatId does not match connection`) with `requestId` set to the frame id, and ignore the frame.

#### Scenario: Identity mismatch

- **WHEN** a frame's `repoId`/`workspaceId`/`chatId` do not match the connection
- **THEN** the service replies non-fatal `invalid_frame` (`frame repoId/workspaceId/chatId does not match connection`) with `requestId` set to the frame id, and ignores the frame

### Requirement: chat-9 — Client frames: Accepted kinds and unknown-kind rejection

THE service SHALL accept these client kinds and reject any other kind with `invalid_frame` (`unsupported client frame kind: <kind>`): `client.hello`, `client.user_message`, `client.history_request`, `client.model_select`, `client.ack`, `client.cancel`, `client.stop_generating`, `client.ping`.

#### Scenario: Known client frame kind
- **WHEN** an inbound frame has a known client kind
- **THEN** the service accepts and processes it

#### Scenario: Unknown client frame kind
- **WHEN** an inbound frame has an unknown kind
- **THEN** the service responds with `invalid_frame` (`unsupported client frame kind: <kind>`)

### Requirement: chat-10 — Client frames: user_message acceptance and delivery

WHEN it accepts a `client.user_message` (payload: required `messageId` and `text`; optional `attachments` array, defaulting to `[]`; optional `steer`, defaulting under persistence to `true`), THE service SHALL, in order: persist and broadcast a `chat.user_message` envelope, persist and broadcast the three user-text AGUI events (`TEXT_MESSAGE_START`/`CONTENT`/`END` with the client `messageId`), then deliver the text to the Pi session.

#### Scenario: Valid user_message received
- **WHEN** a `client.user_message` with required `messageId` and `text` is accepted
- **THEN** the service persists and broadcasts a `chat.user_message` envelope, persists and broadcasts the three user-text AGUI events, then delivers the text to the Pi session

### Requirement: chat-11 — Client frames: user_message deduplication

THE service SHALL deduplicate user messages by `messageId` per session (including ids replayed from the history log at hub initialization): a duplicate is silently ignored. Acceptance is serialized per session so concurrent submissions get monotonic sequences.

#### Scenario: Duplicate messageId received
- **WHEN** a `client.user_message` arrives with a `messageId` already seen in the session
- **THEN** the service silently ignores the duplicate

#### Scenario: Concurrent submissions
- **WHEN** concurrent user messages are submitted for the same session
- **THEN** acceptance is serialized so they receive monotonic sequences

### Requirement: chat-12 — Client frames: Pi delivery failure handling

IF Pi delivery of an accepted user message fails, THEN THE service SHALL keep the accepted turn in history and persist+broadcast a non-fatal `server.error` envelope with code `user_message_delivery_failed`.

#### Scenario: Pi delivery fails
- **WHEN** Pi delivery of an accepted user message fails
- **THEN** the service keeps the turn in history and persists and broadcasts a non-fatal `server.error` with code `user_message_delivery_failed`

### Requirement: chat-13 — Client frames: history_request handling

WHEN it receives `client.history_request` (same `before`/`after`/`limit` semantics as [session-history](../sheaf-chat-session-history/spec.md), WebSocket default `prefer` is `snapshots`), THE service SHALL reply — only to the requesting connection — with a `history.page` frame whose payload echoes the request frame id as `requestId`. Live broadcasts are not blocked while the page is read.

#### Scenario: history_request received
- **WHEN** a `client.history_request` is received
- **THEN** the service replies only to the requesting connection with a `history.page` frame containing the request frame id as `requestId`, without blocking live broadcasts

### Requirement: chat-14 — Client frames: No duplicate user turns in history serving

WHEN serving history events to clients (history pages in `events` mode and connect replay), THE service SHALL not duplicate user turns: a `chat.user_message` envelope is synthesized into user AGUI events only when no stored `agui.event` with the same `messageId` exists.

#### Scenario: Serving history with existing AGUI events
- **WHEN** serving history events and a stored `agui.event` with the same `messageId` exists
- **THEN** the `chat.user_message` envelope is not synthesized into user AGUI events

#### Scenario: Serving history without existing AGUI events
- **WHEN** serving history events and no stored `agui.event` with the same `messageId` exists
- **THEN** the `chat.user_message` envelope is synthesized into user AGUI events

### Requirement: chat-15 — Client frames: model_select handling

WHEN it receives `client.model_select` (required `provider`, `id`; optional `applyTo` of `next_turn` (default) or `current_turn`), THE service SHALL validate the model ([models](../sheaf-chat-models/spec.md)) and apply it to the session; failures produce a non-fatal `server.error` with the validation code and the frame id as `requestId`.

#### Scenario: Valid model_select received
- **WHEN** a `client.model_select` with valid `provider` and `id` is received
- **THEN** the service validates the model and applies it to the session

#### Scenario: Invalid model in model_select
- **WHEN** a `client.model_select` with an invalid model is received
- **THEN** the service produces a non-fatal `server.error` with the validation code and the frame id as `requestId`

### Requirement: chat-16 — Client frames: cancel and stop_generating handling

WHEN it receives `client.cancel` or `client.stop_generating`, THE service SHALL abort the active Pi turn (a no-op when the session runtime is absent) — see [agent-runtime](../sheaf-chat-agent-runtime/spec.md) for the resulting error envelope.

#### Scenario: cancel or stop_generating received with active runtime
- **WHEN** `client.cancel` or `client.stop_generating` is received and the session runtime is present
- **THEN** the service aborts the active Pi turn

#### Scenario: cancel or stop_generating received without active runtime
- **WHEN** `client.cancel` or `client.stop_generating` is received and the session runtime is absent
- **THEN** the operation is a no-op

### Requirement: chat-17 — Client frames: ack handling

WHEN it receives `client.ack` (`sequence` number), THE service SHALL record the connection's last-acknowledged sequence. Acknowledgements are diagnostics only and do not affect delivery.

#### Scenario: ack received
- **WHEN** `client.ack` is received with a `sequence` number
- **THEN** the service records the connection's last-acknowledged sequence without affecting delivery

### Requirement: chat-18 — Client frames: ping handling

WHEN it receives `client.ping`, THE service SHALL reply to that connection with `server.pong` carrying `requestId` = the ping frame id.

#### Scenario: ping received
- **WHEN** `client.ping` is received
- **THEN** the service replies to that connection with `server.pong` carrying `requestId` equal to the ping frame id

### Requirement: chat-19 — Client frames: hello handling

WHEN it receives `client.hello` (optional `supportsSnapshots`, `supportsLazyHistory`, `lastSeenSequence`), THE service SHALL accept it without reply; the payload is currently unused.

#### Scenario: hello received
- **WHEN** `client.hello` is received
- **THEN** the service accepts it without reply

### Requirement: chat-20 — Server frames and persistence: Persisted and broadcast frame kinds

THE service SHALL persist (with sequences) and broadcast to all connected clients of the session: `chat.user_message`, `agui.event`, `model.changed`, `agent.status`, `session.updated`, and lifecycle `server.error` envelopes. `server.hello`, `server.caught_up`, `server.pong`, `history.page`, `file.changed`, and frame-validation `server.error`s are never persisted.

#### Scenario: Persistable frame kinds
- **WHEN** the service produces `chat.user_message`, `agui.event`, `model.changed`, `agent.status`, `session.updated`, or lifecycle `server.error` envelopes
- **THEN** they are persisted with sequences and broadcast to all connected clients

#### Scenario: Non-persisted frame kinds
- **WHEN** the service produces `server.hello`, `server.caught_up`, `server.pong`, `history.page`, `file.changed`, or frame-validation `server.error` frames
- **THEN** they are never persisted

### Requirement: chat-21 — Server frames and persistence: model.changed broadcast

WHEN a model change is applied, THE service SHALL persist and broadcast `model.changed` (`{"model": {...}, "applyTo": "..."}`) followed by a `CUSTOM`/`sheaf.model_changed` AGUI event envelope.

#### Scenario: Model change applied
- **WHEN** a model change is applied to the session
- **THEN** the service persists and broadcasts `model.changed` followed by a `CUSTOM`/`sheaf.model_changed` AGUI event envelope

### Requirement: chat-22 — Server frames and persistence: agent.status broadcast

WHEN the agent lifecycle state changes, THE service SHALL persist and broadcast `agent.status` (`{"state": "...", "previousState": "..."}`) followed by a `CUSTOM`/`sheaf.lifecycle_status` AGUI event envelope. States: [agent-runtime](../sheaf-chat-agent-runtime/spec.md).

#### Scenario: Agent lifecycle state changes
- **WHEN** the agent lifecycle state changes
- **THEN** the service persists and broadcasts `agent.status` followed by a `CUSTOM`/`sheaf.lifecycle_status` AGUI event envelope

### Requirement: chat-23 — Server frames and persistence: session.updated broadcast

WHEN the manifest is created or updated, THE service SHALL persist and broadcast `session.updated` with the manifest as payload, `rootDirectory` relativized to the repository root.

#### Scenario: Manifest created or updated
- **WHEN** the manifest is created or updated
- **THEN** the service persists and broadcasts `session.updated` with the manifest payload and `rootDirectory` relativized to the repository root

### Requirement: chat-24 — Server frames and persistence: lifecycle error broadcast

WHEN a lifecycle error is reported, THE service SHALL persist and broadcast `server.error` (`{"code", "message", "fatal": <bool>}`) followed by a `RUN_ERROR` AGUI event envelope.

#### Scenario: Lifecycle error reported
- **WHEN** a lifecycle error is reported
- **THEN** the service persists and broadcasts `server.error` followed by a `RUN_ERROR` AGUI event envelope

### Requirement: chat-25 — Server frames and persistence: file.changed broadcast

WHEN the service receives a successful scoped edit-tool file notification, THE service SHALL broadcast `file.changed` only to currently connected sessions whose canonical root contains the changed file; the envelope SHALL have no `sequence` and SHALL use a path relative to each receiving session root.

#### Scenario: Scoped file notification received
- **WHEN** the service receives a successful scoped edit-tool file notification
- **THEN** it broadcasts `file.changed` only to connected sessions whose canonical root contains the changed file, with no `sequence` and a path relative to each session root

### Requirement: chat-26 — Server frames and persistence: workspace chat identity

THE service SHALL stamp every persisted or broadcast chat envelope with `repoId`, `workspaceId`, and `chatId` instead of `pile` and `sessionId`.

#### Scenario: Server envelope persisted

- **WHEN** the service persists a chat envelope
- **THEN** the envelope includes `repoId`, `workspaceId`, and `chatId`
- **AND** it does not include `pile` or `sessionId`

### Requirement: chat-27 — Connection bootstrap: deliver the first message without a gap

THE service SHALL bootstrap a chat connection so that no persisted envelope can fall between the connection's catch-up replay window and the start of its live subscription. In particular, a user message submitted on a freshly connected chat whose agent is cold-starting SHALL be delivered to the originating connection's live stream exactly once, with no envelope lost in the window between replay and live subscription, regardless of the cold-start status traffic interleaved with the bootstrap.

#### Scenario: First message on a cold-starting chat is delivered live

- **WHEN** a client connects to a chat whose agent must cold-start and submits its first user message during or immediately after the bootstrap
- **THEN** the originating connection receives that user message in its live stream exactly once
- **AND** no persisted envelope is dropped between the catch-up replay and the live subscription

#### Scenario: No duplicate delivery across replay and live

- **WHEN** an envelope is eligible for both the catch-up replay and the live subscription
- **THEN** the connection receives it exactly once

### Requirement: chat-28 — User message identity: stable id across echo and history

THE service SHALL identify a user message by a single stable id — the client-provided `messageId` — across its persisted `chat.user_message` echo, its agui text-message representation, and its history replay, so a client can reconcile its optimistic local render, the live echo, and any replay to one message rather than rendering duplicates.

#### Scenario: Echo carries the client message id

- **WHEN** the service echoes or persists a submitted user message
- **THEN** the `chat.user_message` envelope and its agui text-message events carry the client-provided `messageId`

#### Scenario: History replay reuses the same id

- **WHEN** the service replays a user message from history
- **THEN** the replayed representation uses the same `messageId` as the original echo

## Contracts

### Connect URL

```text
/ws/chat?repo=<repoId>&workspace=<workspaceId>&chat=<chatId>&client=<clientId>&after=<sequence>
```

### `server.hello` payload

```json
{
  "connectionId": "9c2f4e1a-…",
  "manifest": null,
  "provisionalChat": {
    "rootDirectory": "projects",
    "model": { "provider": "local", "id": "qwen3-coder" }
  },
  "latestSequence": 12,
  "historyWindow": { "oldestSequence": 1, "newestSequence": 12 },
  "models": [ { "provider": "local", "id": "qwen3-coder", "available": true } ],
  "activeModel": { "provider": "local", "id": "qwen3-coder" }
}
```

`manifest` is the persisted manifest or `null`; `provisionalChat` is
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
| Upgrade with missing `repo`/`workspace`/`chat` | HTTP 400 on upgrade | `repo query parameter is required` / `workspace query parameter is required` / `chat query parameter is required` |
| Upgrade with invalid repo/workspace/chat/`after` | HTTP 400 on upgrade | validation messages from [session files](../../../projects/sheaf-chat/docs/contracts/session-files.md); `after must be an integer` |
| Session file missing | HTTP 404 on upgrade | `session not found` |
| Malformed JSON frame | non-fatal `server.error` | `invalid_frame` / `malformed JSON frame` |
| `v` != 1 | non-fatal `server.error` | `invalid_frame` / `frame version must be 1` |
| Missing envelope field | non-fatal `server.error` | `invalid_frame` / `frame <field> is required` |
| Identity mismatch | non-fatal `server.error` | `invalid_frame` / `frame repoId/workspaceId/chatId does not match connection` |
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
  `manifestUpdated`, `error`), maps them via [agui-mapping](../sheaf-chat-agui-mapping/spec.md),
  appends through [session-history](../sheaf-chat-session-history/spec.md), and publishes each
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

- [session files](../../../projects/sheaf-chat/docs/contracts/session-files.md) — envelope schema.
- [session-history](../sheaf-chat-session-history/spec.md) — append, sequencing, paging.
- [agent-runtime](../sheaf-chat-agent-runtime/spec.md) — attach/detach, message delivery,
  model select, cancel.
- [agui-mapping](../sheaf-chat-agui-mapping/spec.md) — payloads of `agui.event` envelopes.
- [chat-ui](../sheaf-chat-chat-ui/spec.md) — the reference client.
- [file-browser](../sheaf-chat-file-browser/spec.md) — source and client semantics for
  `file.changed`.
