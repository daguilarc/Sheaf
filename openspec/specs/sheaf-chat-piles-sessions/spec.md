# Capability: Piles And Sessions

Project: `projects/sheaf-chat`
ID prefix: `ps` — requirement IDs are append-only; never renumber or reuse.

## Purpose

The REST surface for organizing chat sessions: list and create piles, create
blank session shells inside a pile, and read session manifests. A pile is a
storage directory; a session shell is the minimum on-disk state needed to
open a WebSocket and start chatting.

## Requirements

### Requirement: ps-1 — List piles

WHEN it receives `GET /api/piles`, THE service SHALL respond 200 with `{"piles": [...]}` sorted by pile name; each summary counts `*.manifest.json` files as `sessionCount` and reports the newest manifest file mtime as `latestUpdatedAt` (ISO string, or `null` when none). The piles root is created on demand, so a fresh checkout returns `{"piles": []}`.

#### Scenario: List piles

- **WHEN** the service receives `GET /api/piles`
- **THEN** it responds 200 with `{"piles": [...]}` sorted by pile name, with each summary including `sessionCount` (count of `*.manifest.json` files) and `latestUpdatedAt` (newest manifest mtime as ISO string, or `null` when none)

#### Scenario: Fresh checkout

- **WHEN** no piles have been created yet (fresh checkout)
- **THEN** the service responds 200 with `{"piles": []}`

### Requirement: ps-2 — Create pile

WHEN it receives `POST /api/piles` with `{"pile": "<name>"}`, THE service SHALL create the pile directory (idempotently) and respond 201 with `{"pile": "<name>", "sessionCount": 0, "latestUpdatedAt": null}`.

#### Scenario: Create pile

- **WHEN** the service receives `POST /api/piles` with a valid `{"pile": "<name>"}` body
- **THEN** it creates the pile directory idempotently and responds 201 with `{"pile": "<name>", "sessionCount": 0, "latestUpdatedAt": null}`

### Requirement: ps-3 — Create-pile validation errors

IF the create-pile body is not an object or `pile` is not a non-empty string, THEN THE service SHALL respond 400 `invalid_request`; IF the name fails validation, THEN 400 `invalid_pile` (or `invalid_name` for non-NFC input) — patterns in [session files](../../../projects/sheaf-chat/docs/contracts/session-files.md).

#### Scenario: Body not an object or pile missing

- **WHEN** the create-pile body is not an object or `pile` is not a non-empty string
- **THEN** the service responds 400 `invalid_request`

#### Scenario: Name fails validation

- **WHEN** the `pile` name fails the validation pattern
- **THEN** the service responds 400 `invalid_pile` (or 400 `invalid_name` for non-NFC input)

### Requirement: ps-4 — List sessions in pile

WHEN it receives `GET /api/piles/:pile/sessions`, THE service SHALL respond 200 with `{"sessions": [<manifest>...]}` sorted newest-first by `updatedAt`. Only sessions with a manifest appear; entries whose manifest is unreadable, invalid, or has an invalid session-id stem are silently skipped. Message history is never included.

#### Scenario: List sessions

- **WHEN** the service receives `GET /api/piles/:pile/sessions`
- **THEN** it responds 200 with `{"sessions": [<manifest>...]}` sorted newest-first by `updatedAt`, silently skipping entries whose manifest is unreadable, invalid, or has an invalid session-id stem, and never including message history

### Requirement: ps-5 — Create session shell

WHEN it receives `POST /api/piles/:pile/sessions` with valid `rootDirectory` and `model`, THE service SHALL allocate a blank session shell — an empty Pi session file, an empty history log, and a provisional record — and respond 201 with the session id, the provisional session (root relativized to the repository root when inside it), and the WebSocket URL (see Contracts). It SHALL NOT write a manifest.

#### Scenario: Create session shell

- **WHEN** the service receives `POST /api/piles/:pile/sessions` with valid `rootDirectory` and `model`
- **THEN** it allocates a blank session shell (empty Pi session file, empty history log, provisional record) and responds 201 with the session id, provisional session, and WebSocket URL

#### Scenario: No manifest written

- **WHEN** a blank session shell is allocated
- **THEN** no manifest file is written

### Requirement: ps-6 — Relative root resolution and session id generation

THE service SHALL resolve a relative `rootDirectory` against the repository root, store it absolute, and generate the session id as a UUID with hyphens removed.

#### Scenario: Resolve relative rootDirectory

- **WHEN** a session shell is created with a relative `rootDirectory`
- **THEN** the service resolves it against the repository root and stores the absolute path

#### Scenario: Generate session id

- **WHEN** a session shell is created
- **THEN** the session id is generated as a UUID with hyphens removed

### Requirement: ps-7 — Create-session validation errors

IF `rootDirectory` is missing/empty or `model.provider` / `model.id` are missing/empty, THEN THE service SHALL respond 400 `invalid_request`; IF the resolved root does not exist or is not a directory, THEN 400 `invalid_root_directory`; IF the model is unknown, THEN 404 `model_not_found`; IF the model is known but unavailable, THEN 400 `model_unavailable` (see [models](../sheaf-chat-models/spec.md)).

#### Scenario: Missing required fields

- **WHEN** `rootDirectory` is missing/empty or `model.provider` / `model.id` are missing/empty
- **THEN** the service responds 400 `invalid_request`

#### Scenario: Invalid root directory

- **WHEN** the resolved root does not exist or is not a directory
- **THEN** the service responds 400 `invalid_root_directory`

#### Scenario: Unknown model

- **WHEN** the requested model is unknown
- **THEN** the service responds 404 `model_not_found`

#### Scenario: Model unavailable

- **WHEN** the model is known but unavailable
- **THEN** the service responds 400 `model_unavailable`

### Requirement: ps-8 — Pile not found

IF the pile of any `/api/piles/:pile/...` route does not exist as a directory, THEN THE service SHALL respond 404 `pile_not_found` with message `pile not found: <pile>`.

#### Scenario: Pile not found

- **WHEN** a request is made to any `/api/piles/:pile/...` route and the pile does not exist as a directory
- **THEN** the service responds 404 `pile_not_found` with message `pile not found: <pile>`

### Requirement: ps-9 — Get session manifest

WHEN it receives `GET /api/piles/:pile/sessions/:sessionId`, THE service SHALL respond 200 with `{"manifest": <manifest>}`; IF no manifest exists for the session (including blank shells), THEN 404 `manifest_not_found` with message `manifest not found for session <sessionId>`.

#### Scenario: Manifest found

- **WHEN** the service receives `GET /api/piles/:pile/sessions/:sessionId` and a manifest exists
- **THEN** it responds 200 with `{"manifest": <manifest>}`

#### Scenario: Manifest not found

- **WHEN** the service receives `GET /api/piles/:pile/sessions/:sessionId` and no manifest exists for the session (including blank shells)
- **THEN** it responds 404 `manifest_not_found` with message `manifest not found for session <sessionId>`

## Contracts

Manifest, provisional, and validation shapes:
[session files](../../../projects/sheaf-chat/docs/contracts/session-files.md).

### `POST /api/piles`

Request `{"pile": "default"}` → 201:

```json
{ "pile": "default", "sessionCount": 0, "latestUpdatedAt": null }
```

### `POST /api/piles/:pile/sessions`

Request:

```json
{
  "rootDirectory": "projects",
  "model": { "provider": "local", "id": "qwen3-coder" }
}
```

Response — 201:

```json
{
  "sessionId": "0123456789abcdef0123456789abcdef",
  "provisionalSession": {
    "rootDirectory": "projects",
    "model": { "provider": "local", "id": "qwen3-coder" }
  },
  "webSocketUrl": "/ws/chat?p=default&session=0123456789abcdef0123456789abcdef"
}
```

`provisionalSession.rootDirectory` is repo-relative (`.` for the repo root
itself, `<outside-root>` if the stored absolute root is outside the
repository).

### Error catalogue

| Condition | Status / code | Message (exact) |
|---|---|---|
| Body not a JSON object | 400 `invalid_request` | `request body must be a JSON object` |
| `pile` missing/empty | 400 `invalid_request` | `pile name is required` |
| Pile name fails pattern | 400 `invalid_pile` | `pile name must be a safe single path segment` |
| Name not NFC-normalized | 400 `invalid_name` | `<label> must use Unicode NFC normalization` |
| `rootDirectory` missing/empty | 400 `invalid_request` | `rootDirectory is required` |
| `model` not an object | 400 `invalid_request` | `model must be an object` |
| `model.provider` / `model.id` missing | 400 `invalid_request` | `model.provider is required` / `model.id is required` |
| Root missing | 400 `invalid_root_directory` | `root directory does not exist: <input>` |
| Root not a directory | 400 `invalid_root_directory` | `root directory is not a directory: <input>` |
| Unknown model | 404 `model_not_found` | `model not found: <provider>/<id>` |
| Model unavailable | 400 `model_unavailable` | `model unavailable: <reason>` |
| Pile missing | 404 `pile_not_found` | `pile not found: <pile>` |
| Manifest missing | 404 `manifest_not_found` | `manifest not found for session <sessionId>` |

## Design

- `src/server/routes/piles.ts`, `src/server/routes/sessions.ts` — request
  parsing and response shaping; `RelativizeAbsolutePath` (from the AGUI
  sanitizer) produces the repo-relative root in responses.
- `src/storage/piles.ts` — `CreatePile` (mkdir recursive + containment
  assert), `ListPiles` (skips non-directories and invalid names),
  `EnsurePileExists`.
- `src/storage/manifests.ts` — `ReadManifest` (identity check),
  `ListSessionManifests`.
- `src/storage/sessionLog.ts` — `AllocateSessionShell` writes the three
  shell files; `AgentManager.createBlankSession`
  (`src/agents/manager.ts`) validates pile/root/model first, so no files are
  written on validation failure.
- `BuildChatWebSocketUrl` (`src/server/websockets.ts`) builds the returned
  URL with `p` and `session` query parameters.

## Interactions

- [session files](../../../projects/sheaf-chat/docs/contracts/session-files.md) — formats of everything
  written here.
- [models](../sheaf-chat-models/spec.md) — model validation at session creation.
- [chat-protocol](../sheaf-chat-chat-protocol/spec.md) — consumes the returned `webSocketUrl`;
  connects only to sessions whose Pi session file exists.
- [agent-runtime](../sheaf-chat-agent-runtime/spec.md) — writes the manifest these listings
  depend on.
- [chat-ui](../sheaf-chat-chat-ui/spec.md) — the piles/sessions screens drive this API.
