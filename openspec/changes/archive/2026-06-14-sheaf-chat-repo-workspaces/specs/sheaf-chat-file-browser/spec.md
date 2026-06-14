## MODIFIED Requirements

### Requirement: fb-1 — Root scoping: session root resolution

THE file browser SHALL resolve every file API request against the requested workspace chat's root directory, using the chat manifest root when a manifest exists and the provisional workspace root otherwise.

#### Scenario: Manifest root present

- **WHEN** a file API request arrives for a workspace chat that has a manifest root
- **THEN** the request is resolved against the manifest root directory

#### Scenario: No manifest root

- **WHEN** a file API request arrives for a workspace chat with no manifest root
- **THEN** the request is resolved against the provisional workspace root directory

### Requirement: fb-4 — Root scoping: missing session rejection

IF the workspace chat does not exist or has no bootstrap root, THEN THE file browser SHALL return REST error `chat_not_found`.

#### Scenario: Chat not found

- **WHEN** a file API request references a workspace chat that does not exist or has no bootstrap root
- **THEN** the file browser returns REST error `chat_not_found`

### Requirement: fb-5 — REST file API: whole-file read route

THE service SHALL serve `GET /api/repositories/:repoId/workspaces/:workspaceId/chats/:chatId/file?path=<path>` as a whole-file read of a supported document under the workspace chat root.

#### Scenario: File read request

- **WHEN** `GET /api/repositories/:repoId/workspaces/:workspaceId/chats/:chatId/file?path=<path>` is requested
- **THEN** the service performs a whole-file read of the supported document at that path under the workspace chat root

### Requirement: fb-9 — REST file API: directory listing route

THE service SHALL serve `GET /api/repositories/:repoId/workspaces/:workspaceId/chats/:chatId/files?path=<path>` as a read-only directory listing under the workspace chat root.

#### Scenario: Directory listing request

- **WHEN** `GET /api/repositories/:repoId/workspaces/:workspaceId/chats/:chatId/files?path=<path>` is requested
- **THEN** the service performs a read-only directory listing under the workspace chat root

## ADDED Requirements

### Requirement: fb-27 — Browser workspace: restore file tabs from server state

WHEN the workspace editor renders, THE file browser SHALL restore valid file tabs, the selected file, expanded directories, and viewport positions from server-stored workspace editor state before the user opens a new file.

#### Scenario: Server has valid file state

- **WHEN** the workspace editor renders and the server returns valid file state
- **THEN** the file browser restores tabs, selection, expanded directories, and viewport positions

#### Scenario: Server has invalid file state

- **WHEN** the workspace editor renders and the server returns invalid file paths
- **THEN** the file browser ignores the invalid entries
