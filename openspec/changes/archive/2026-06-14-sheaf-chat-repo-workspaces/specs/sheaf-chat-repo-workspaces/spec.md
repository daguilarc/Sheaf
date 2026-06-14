## ADDED Requirements

### Requirement: rw-1 — Repository discovery: list direct home Git repositories

WHEN the service receives `GET /api/repositories`, THE service SHALL inspect only immediate child directories of the user's home directory and return a child only when that child is itself the canonical Git top-level root, with each repository represented by a stable path-safe `repoId`, display `name`, and canonical absolute `path`.

#### Scenario: Direct child repositories found

- **WHEN** Git top-level repositories exist as direct children of the user's home directory
- **THEN** the response contains one entry per discovered repository with `repoId`, `name`, and canonical absolute `path`

#### Scenario: Nested repository ignored

- **WHEN** a Git top-level repository exists below a non-repository direct child such as `$HOME/src/reporoot`
- **THEN** the response does not include that nested repository

#### Scenario: No repositories found

- **WHEN** no Git top-level repositories are discovered as direct children of the user's home directory
- **THEN** the response is 200 with `{"repositories": []}`

### Requirement: rw-2 — Repository discovery: no repository creation

THE Sheaf Chat service SHALL NOT expose a repository creation endpoint or browser action as part of the repository picker.

#### Scenario: Front door loaded

- **WHEN** the front-door repository picker is rendered
- **THEN** it lists discovered repositories without exposing a create-repository control

### Requirement: rw-3 — Workspace discovery: list main and linked worktrees

WHEN the service receives `GET /api/repositories/:repoId/workspaces`, THE service SHALL return the selected repository's main workspace and linked Git worktrees, with each workspace represented by `workspaceId`, `repoId`, `kind`, branch-preferred display name, canonical absolute `path`, and Git metadata when available.

#### Scenario: Repository has linked worktrees

- **WHEN** a repository has a main worktree and linked worktrees
- **THEN** the response includes the main workspace and each linked worktree

#### Scenario: Repository has only main worktree

- **WHEN** a repository has no linked worktrees
- **THEN** the response includes the main workspace

#### Scenario: Workspace has branch

- **WHEN** Git reports a branch for a workspace
- **THEN** that branch name is used as the workspace display name

#### Scenario: Workspace is detached

- **WHEN** Git reports a detached workspace with no branch name
- **THEN** the workspace display name falls back to the directory basename or short HEAD

### Requirement: rw-4 — Workspace identity: path-safe stable ids

THE service SHALL derive `repoId` and `workspaceId` from canonical absolute paths using a deterministic path-safe encoding, and SHALL reject unknown ids with 404 `not_found`.

#### Scenario: Same path rediscovered

- **WHEN** the same canonical repository or workspace path is rediscovered
- **THEN** the service returns the same id for that path

#### Scenario: Unknown id requested

- **WHEN** a workspace or repository route references an unknown id
- **THEN** the service responds 404 `not_found`

### Requirement: rw-5 — Workspace metadata cache

WHEN a repository or workspace is discovered or used for chat creation, THE service SHALL write or refresh metadata under `data/sheaf-chat/repositories/<repoId>/` so workspace chat lists remain addressable by id. THE service SHALL write metadata only when discovering (the picker endpoints) or when the metadata has actually changed, and SHALL NOT rewrite unchanged metadata on read or resolve operations.

#### Scenario: Workspace listed

- **WHEN** a workspace is returned by the discovery API
- **THEN** the service records its current metadata in the Sheaf Chat data directory

#### Scenario: Workspace used for chat creation

- **WHEN** a chat is created for a workspace
- **THEN** the service refreshes that workspace's cached metadata before writing chat files

#### Scenario: Unchanged metadata is not rewritten

- **WHEN** a repository or workspace is resolved by id and its metadata has not changed
- **THEN** the service does not rewrite the cached metadata file

### Requirement: rw-9 — Identity resolution without rediscovery

WHEN the service resolves a known `repoId` or `workspaceId` for a non-discovery operation — listing or creating chats, reading or writing editor state, browsing files, or reading history — THE service SHALL resolve it from cached metadata by id and SHALL NOT scan the home directory or run repository or worktree discovery. Full home-directory repository discovery SHALL run only for `GET /api/repositories`, and worktree discovery only for `GET /api/repositories/:repoId/workspaces`.

#### Scenario: Chat operation resolves from cache

- **WHEN** the service lists or creates chats, reads or writes editor state, browses files, or reads history for a known workspace
- **THEN** it resolves the repository and workspace from cached metadata by id
- **AND** it does not scan the home directory or run repository or worktree discovery

#### Scenario: Discovery is limited to the picker endpoints

- **WHEN** any request other than `GET /api/repositories` or `GET /api/repositories/:repoId/workspaces` is served
- **THEN** the service does not perform home-directory repository discovery

#### Scenario: Unknown id after cache miss

- **WHEN** a resolve operation references an id with no cached metadata
- **THEN** the service responds 404 `not_found`

### Requirement: rw-6 — Workspace root authority

WHEN a chat is created for a workspace, THE service SHALL use the selected workspace's canonical absolute path as the chat root directory and SHALL NOT accept a client-provided root directory for that chat.

#### Scenario: Chat created

- **WHEN** the client creates a chat for a workspace
- **THEN** the chat root directory is the workspace canonical absolute path

#### Scenario: Client sends root directory

- **WHEN** a create-chat request includes a client-provided root directory
- **THEN** the service ignores or rejects that field and does not use it as the chat root

### Requirement: rw-7 — Workspace editor state: server-side persistence

WHEN the service receives `GET /api/repositories/:repoId/workspaces/:workspaceId/editor-state`, THE service SHALL return the server-stored editor state for that workspace, including open tabs, selected file, expanded directories, and viewport positions; WHEN no state has been stored, it SHALL return an empty valid state.

#### Scenario: Stored editor state exists

- **WHEN** editor state has been stored for the workspace
- **THEN** the service returns that state

#### Scenario: No editor state exists

- **WHEN** no editor state has been stored for the workspace
- **THEN** the service returns an empty valid editor state

### Requirement: rw-8 — Workspace editor state: validate and save

WHEN the service receives `PUT /api/repositories/:repoId/workspaces/:workspaceId/editor-state`, THE service SHALL validate all file paths as workspace-root-relative paths, reject escaping paths with 400 `path_escape`, and persist the valid state server-side with last-writer-wins semantics.

#### Scenario: Valid editor state saved

- **WHEN** the client sends valid workspace editor state
- **THEN** the service persists it server-side for that workspace

#### Scenario: Escaping path rejected

- **WHEN** the client sends editor state containing an absolute path, parent traversal, or otherwise escaping path
- **THEN** the service rejects the request with 400 `path_escape`
