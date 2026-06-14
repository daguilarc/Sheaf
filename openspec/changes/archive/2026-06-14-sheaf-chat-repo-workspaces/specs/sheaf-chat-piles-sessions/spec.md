## ADDED Requirements

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

## REMOVED Requirements

### Requirement: ps-1 — List piles

**Reason**: Piles are replaced by repository and workspace discovery.
**Migration**: Delete `data/sheaf-chat` and use `GET /api/repositories`.

### Requirement: ps-2 — Create pile

**Reason**: Piles are replaced by discovered repositories and workspaces.
**Migration**: No replacement; Sheaf Chat does not create repositories or workspaces.

### Requirement: ps-3 — Create-pile validation errors

**Reason**: Pile creation is removed.
**Migration**: Repository and workspace ids are service-generated.

### Requirement: ps-4 — List sessions in pile

**Reason**: Chats are listed under workspaces instead of sessions under piles.
**Migration**: Use `GET /api/repositories/:repoId/workspaces/:workspaceId/chats`.

### Requirement: ps-5 — Create session shell

**Reason**: Chat shells are created under selected workspaces.
**Migration**: Use `POST /api/repositories/:repoId/workspaces/:workspaceId/chats`.

### Requirement: ps-6 — Relative root resolution and session id generation

**Reason**: Clients no longer provide root directories; workspace discovery supplies the root.
**Migration**: The service generates `chatId` and uses the workspace canonical path.

### Requirement: ps-7 — Create-session validation errors

**Reason**: The create-session body changes to workspace-scoped chat creation.
**Migration**: Model validation remains; root-directory validation is replaced by workspace-id validation.

### Requirement: ps-8 — Pile not found

**Reason**: Pile routes are removed.
**Migration**: Unknown repository/workspace ids return 404 `not_found`.

### Requirement: ps-9 — Get session manifest

**Reason**: Session manifests are replaced by workspace chat manifests.
**Migration**: Use `GET /api/repositories/:repoId/workspaces/:workspaceId/chats/:chatId`.
