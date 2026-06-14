## MODIFIED Requirements

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

## ADDED Requirements

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
