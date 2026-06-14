## MODIFIED Requirements

### Requirement: arm-1 — Availability: Git repository detection

WHEN the service receives `GET /api/repositories/:repoId/workspaces/:workspaceId/agent-review`, THE Sheaf Chat service SHALL resolve Agent Review availability from the selected workspace (worktree) root, independent of any chat; it SHALL report Agent Review Mode as available WHEN that workspace root resolves to a Git worktree top level — the repository's main worktree or any linked worktree — and include the repository root, the workspace-root-relative path, and the ordered unstaged hunks and file summaries computed from that worktree; IF the workspace root does not resolve to a Git worktree, THEN THE service SHALL report Agent Review Mode as unavailable without exposing hunk commands.

#### Scenario: Main worktree

- **WHEN** the selected workspace is the repository's main worktree
- **THEN** Agent Review Mode is available and its state reflects the unstaged hunks in that worktree

#### Scenario: Linked worktree

- **WHEN** the selected workspace is a linked Git worktree
- **THEN** Agent Review Mode is available and its state reflects the unstaged hunks in that worktree

#### Scenario: Availability does not depend on a chat

- **WHEN** availability is requested for a workspace with no open or selected chat
- **THEN** the service still resolves availability and hunks from the workspace worktree root

#### Scenario: Workspace root outside a Git worktree

- **WHEN** the workspace root does not resolve to a Git worktree
- **THEN** Agent Review Mode is unavailable
- **AND** no hunk mutation command is exposed

### Requirement: arm-2 — Review WebSocket: Upgrade and bootstrap

THE Sheaf Chat service SHALL accept dedicated Agent Review Mode WebSocket upgrades at `/ws/agent-review` with valid `repo`, `workspace`, and `client` parameters and no `chat` parameter; WHEN the connection is accepted, THE service SHALL send a non-persisted bootstrap frame containing availability, current hunk state, ordered file summaries, and ordered unstaged hunks computed from the selected workspace worktree.

#### Scenario: Valid review socket upgrade

- **WHEN** a WebSocket upgrade arrives at `/ws/agent-review` with valid `repo`, `workspace`, and `client` parameters for a workspace whose root exists
- **THEN** the service accepts the socket and sends an Agent Review bootstrap frame

#### Scenario: Invalid review socket upgrade

- **WHEN** a WebSocket upgrade arrives with missing or invalid `repo`/`workspace` parameters
- **THEN** the service rejects the upgrade before opening the WebSocket

#### Scenario: Review frames are not persisted

- **WHEN** the service sends Agent Review bootstrap, state, command-result, or error frames
- **THEN** those frames are not appended to any chat history

### Requirement: arm-9 — Safety: Root-scoped Git side effects

WHEN Agent Review Mode runs Git commands, THE Sheaf Chat service SHALL execute them with argument arrays scoped to the resolved repository root, SHALL limit hunk discovery and commands to paths contained by the selected workspace worktree root, and SHALL reject commands whose target file or patch would escape that root.

#### Scenario: Hunk under workspace root

- **WHEN** a hunk target path resolves under the workspace worktree root
- **THEN** the service may run the requested hunk command subject to the command's other validation rules

#### Scenario: Hunk outside workspace root

- **WHEN** a hunk target path does not resolve under the workspace worktree root
- **THEN** the service rejects the command and does not mutate Git state

#### Scenario: Git command construction

- **WHEN** the service invokes Git for Agent Review Mode
- **THEN** it uses explicit executable arguments rather than shell-interpolated command strings
