## MODIFIED Requirements

### Requirement: hist-1 — Persist server-side envelopes

THE service SHALL persist every server-side envelope for a workspace chat by appending `{"sequence": n, "envelope": {...}}` as one JSON line to `<chatId>.sheaf-history.jsonl`.

#### Scenario: Envelope appended

- **WHEN** a server-side envelope is produced for a workspace chat
- **THEN** `{"sequence": n, "envelope": {...}}` is appended as one JSON line to `<chatId>.sheaf-history.jsonl`

### Requirement: hist-3 — Serialized sequence allocation per session

THE service SHALL serialize sequence allocation and append per workspace chat (in-process lock), so concurrent appends produce monotonic sequences without duplicates.

#### Scenario: Concurrent appends

- **WHEN** multiple concurrent appends are requested for the same workspace chat
- **THEN** sequences are assigned monotonically without duplicates

### Requirement: hist-4 — Manifest update on append

WHEN an envelope is appended and the workspace chat's manifest exists, THE service SHALL update the manifest's `history.lastSequence` to the new sequence and update `updatedAt` to the append time; IF no manifest exists yet, THEN the append SHALL succeed without one.

#### Scenario: Manifest exists on append

- **WHEN** an envelope is appended and the workspace chat's manifest exists
- **THEN** the manifest's `history.lastSequence` is updated to the new sequence
- **AND** `updatedAt` is updated to the append time

#### Scenario: No manifest on append

- **WHEN** an envelope is appended and no manifest exists yet
- **THEN** the append succeeds without a manifest

### Requirement: hist-11 — History REST endpoint

THE service SHALL serve `GET /api/repositories/:repoId/workspaces/:workspaceId/chats/:chatId/history` with query parameters `before`, `after`, `limit` (integers) and `prefer` (`events` | `snapshots`, REST default `events`), returning the page body in Contracts. Non-integer cursor/limit values and unknown `prefer` values fail 400 `invalid_history_request`.

#### Scenario: Valid history request

- **WHEN** `GET /api/repositories/:repoId/workspaces/:workspaceId/chats/:chatId/history` is called with valid parameters
- **THEN** the service returns the page body as defined in Contracts

#### Scenario: Non-integer cursor or limit

- **WHEN** `before`, `after`, or `limit` is non-integer
- **THEN** the service fails with 400 `invalid_history_request`

#### Scenario: Unknown prefer value

- **WHEN** `prefer` is not `events` or `snapshots`
- **THEN** the service fails with 400 `invalid_history_request`

### Requirement: hist-13 — Empty page for missing history file

WHEN reading a page for a workspace chat with no history file, THE service SHALL return an empty page (`oldestSequence`/`newestSequence` null) rather than failing, provided the repo/workspace/chat identifiers validate.

#### Scenario: No history file exists

- **WHEN** a history page is requested for a workspace chat with no history file
- **THEN** the service returns an empty page with `oldestSequence` and `newestSequence` null
