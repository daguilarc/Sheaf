## ADDED Requirements

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
