# Capability: Workspace Chats

Project: `projects/sheaf-chat`
ID prefix: `wc` — requirement IDs are append-only; never renumber or reuse.

## Purpose

The REST surface for chats inside a selected workspace: list the chats for a
workspace, create a blank chat shell, and read a chat manifest. A chat shell is
the minimum on-disk state needed to open a WebSocket and start chatting; its
root directory is the workspace path supplied by repository/workspace
discovery, not a client-provided directory.

## Requirements
### Requirement: wc-1 — Workspace chats: list chats

WHEN the service receives `GET /api/repositories/:repoId/workspaces/:workspaceId/chats`, THE service SHALL respond 200 with `{"chats": [<manifest>...]}` for the selected workspace, sorted newest-first by chat activity `updatedAt`; only chats with manifests appear, and message history is not included.

#### Scenario: List workspace chats

- **WHEN** the service receives `GET /api/repositories/:repoId/workspaces/:workspaceId/chats`
- **THEN** it responds 200 with manifests for that workspace sorted newest-first by chat activity `updatedAt`
- **AND** it does not include message history

#### Scenario: Fresh workspace

- **WHEN** no manifested chats exist for the workspace
- **THEN** it responds 200 with `{"chats": []}`

### Requirement: wc-2 — Workspace chats: create chat shell

WHEN the service receives `POST /api/repositories/:repoId/workspaces/:workspaceId/chats` with a valid `model`, THE service SHALL allocate a blank chat shell under that workspace: an empty Pi session file, an empty history log, and a provisional record using the workspace root directory; it SHALL respond 201 with the `chatId`, provisional chat metadata, and WebSocket URL, and SHALL NOT write a manifest.

#### Scenario: Create workspace chat

- **WHEN** the service receives a valid create-chat request for a workspace
- **THEN** it allocates a blank chat shell using the workspace root directory
- **AND** it responds with the `chatId`, provisional chat metadata, and WebSocket URL

#### Scenario: No manifest written

- **WHEN** a blank workspace chat shell is created
- **THEN** no manifest file is written

### Requirement: wc-3 — Workspace chats: read chat manifest

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

### `GET /api/repositories/:repoId/workspaces/:workspaceId/chats`

Response — 200:

```json
{ "chats": [ <manifest>, ... ] }
```

Manifests are sorted newest-first by chat activity `updatedAt`; only chats that
have a manifest appear, and message history is not included.

### `POST /api/repositories/:repoId/workspaces/:workspaceId/chats`

Request:

```json
{ "model": { "provider": "local", "id": "qwen3-coder" } }
```

The request carries only `model`; the chat root directory is the discovered
workspace path, not a client-provided directory.

Response — 201:

```json
{
  "chatId": "0123456789abcdef0123456789abcdef",
  "provisionalChat": {
    "repoId": "<repoId>",
    "workspaceId": "<workspaceId>",
    "chatId": "0123456789abcdef0123456789abcdef",
    "repositoryPath": "/Users/name/reporoot",
    "workspacePath": "/Users/name/reporoot",
    "rootDirectory": "/Users/name/reporoot",
    "model": { "provider": "local", "id": "qwen3-coder" },
    "createdAt": "<iso-8601>"
  },
  "webSocketUrl": "/ws/chat?repo=<repoId>&workspace=<workspaceId>&chat=0123456789abcdef0123456789abcdef"
}
```

No manifest is written for a blank chat shell; the manifest appears once the
chat has activity.

### `GET /api/repositories/:repoId/workspaces/:workspaceId/chats/:chatId`

Response — 200:

```json
{ "manifest": <manifest> }
```

### Error catalogue

| Condition | Status / code | Message (exact) |
|---|---|---|
| Body not a JSON object | 400 `invalid_request` | `request body must be a JSON object` |
| `model` not an object | 400 `invalid_request` | `model must be an object` |
| `model.provider` / `model.id` missing | 400 `invalid_request` | `model.provider is required` / `model.id is required` |
| Unknown model | 404 `model_not_found` | `model not found: <provider>/<id>` |
| Model unavailable | 400 `model_unavailable` | `model unavailable: <reason>` |
| Unknown repository / workspace / route | 404 `not_found` | `route not found` |
| Manifest missing (read chat) | 404 `manifest_not_found` | `manifest not found for chat <chatId>` |

## Design

- `src/server/routes/sessions.ts` — `HandleListChats`, `HandleCreateChat`,
  `HandleGetChat` parse requests and shape responses; create parses only
  `model` from the body.
- `src/storage/manifests.ts` — `ReadManifest` (identity check),
  `ListChatManifests` (workspace-scoped, newest-first).
- `src/storage/sessionLog.ts` — `AllocateChatShell` writes the three shell
  files (empty Pi session file, empty history log, provisional record).
- `src/agents/manager.ts` — `AgentManager.createBlankChat` validates the model
  selection and the resolved workspace root directory first, so no files are
  written on validation failure.
- `BuildChatWebSocketUrl` (`src/server/websockets.ts`) builds the returned URL
  with `repo`, `workspace`, and `chat` query parameters.

## Interactions

- [session files](../../../projects/sheaf-chat/docs/contracts/session-files.md) — formats of everything
  written here.
- [models](../sheaf-chat-models/spec.md) — model validation at chat creation.
- [chat-protocol](../sheaf-chat-chat-protocol/spec.md) — consumes the returned `webSocketUrl`;
  connects only to chats whose Pi session file exists.
- [agent-runtime](../sheaf-chat-agent-runtime/spec.md) — writes the manifest these listings
  depend on.
- [chat-ui](../sheaf-chat-chat-ui/spec.md) — the repository/workspace pickers and the editor chat tab drive this API.
