# Capability: Piles And Sessions

Project: `projects/sheaf-chat`
ID prefix: `ps` — requirement IDs are append-only; never renumber or reuse.

## Purpose

The REST surface for organizing chat sessions: list and create piles, create
blank session shells inside a pile, and read session manifests. A pile is a
storage directory; a session shell is the minimum on-disk state needed to
open a WebSocket and start chatting.
## Requirements
### Requirement: ps-10 — Workspace chats: list chats

WHEN the service receives `GET /api/repositories/:repoId/workspaces/:workspaceId/chats`, THE service SHALL respond 200 with `{"chats": [<manifest>...]}` for the selected workspace, sorted newest-first by chat activity `updatedAt`; only chats with manifests appear, and message history is not included.

#### Scenario: List workspace chats

- **WHEN** the service receives `GET /api/repositories/:repoId/workspaces/:workspaceId/chats`
- **THEN** it responds 200 with manifests for that workspace sorted newest-first by chat activity `updatedAt`
- **AND** it does not include message history

#### Scenario: Fresh workspace

- **WHEN** no manifested chats exist for the workspace
- **THEN** it responds 200 with `{"chats": []}`

### Requirement: ps-11 — Workspace chats: create chat shell

WHEN the service receives `POST /api/repositories/:repoId/workspaces/:workspaceId/chats` with a valid `model`, THE service SHALL allocate a blank chat shell under that workspace: an empty Pi session file, an empty history log, and a provisional record using the workspace root directory; it SHALL respond 201 with the `chatId`, provisional chat metadata, and WebSocket URL, and SHALL NOT write a manifest.

#### Scenario: Create workspace chat

- **WHEN** the service receives a valid create-chat request for a workspace
- **THEN** it allocates a blank chat shell using the workspace root directory
- **AND** it responds with the `chatId`, provisional chat metadata, and WebSocket URL

#### Scenario: No manifest written

- **WHEN** a blank workspace chat shell is created
- **THEN** no manifest file is written

### Requirement: ps-12 — Workspace chats: read chat manifest

WHEN the service receives `GET /api/repositories/:repoId/workspaces/:workspaceId/chats/:chatId`, THE service SHALL respond 200 with `{"manifest": <manifest>}`; IF no manifest exists for the chat, THEN it SHALL respond 404 `manifest_not_found`.

#### Scenario: Manifest found

- **WHEN** a workspace chat manifest exists
- **THEN** the service returns it in a `manifest` response body

#### Scenario: Manifest not found

- **WHEN** no manifest exists for the chat
- **THEN** the service responds 404 `manifest_not_found`

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
