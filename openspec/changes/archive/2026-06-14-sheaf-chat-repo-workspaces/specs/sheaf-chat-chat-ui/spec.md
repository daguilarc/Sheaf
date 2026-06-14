## ADDED Requirements

### Requirement: ui-18 — Front door: repository picker

WHEN the browser UI loads at `#/` or `#/repositories`, THE UI SHALL render a repository picker populated from `GET /api/repositories`; clicking a repository SHALL navigate to that repository's workspace picker.

#### Scenario: Repository picker loads

- **WHEN** the front door route is opened
- **THEN** the UI fetches `GET /api/repositories` and displays the returned repositories

#### Scenario: Repository selected

- **WHEN** the user selects a repository
- **THEN** the UI navigates to the workspace picker for that repository

### Requirement: ui-19 — Workspace picker: list and navigate

WHEN the UI renders the workspace picker for a repository, THE UI SHALL fetch `GET /api/repositories/:repoId/workspaces`, display the main workspace and linked worktrees, provide a back button to the repository picker, and navigate to the workspace editor when a workspace is selected.

#### Scenario: Workspace picker loads

- **WHEN** the workspace picker route is opened for a repository
- **THEN** the UI fetches and displays that repository's workspaces

#### Scenario: Back from workspace picker

- **WHEN** the user presses Back on the workspace picker
- **THEN** the UI returns to the repository picker

#### Scenario: Workspace selected

- **WHEN** the user selects a workspace
- **THEN** the UI navigates to the editor view for that workspace

### Requirement: ui-20 — Workspace editor: chat list and creation

WHEN the chat pane is in its `list` sub-state (no chat selected), THE chat pane SHALL list the workspace's chats from `GET /api/repositories/:repoId/workspaces/:workspaceId/chats` sorted newest-first and expose a plus button that creates a new chat for the workspace using the selected model; creating a chat SHALL open it in the chat pane without re-mounting the workspace editor.

#### Scenario: Chat pane lists chats

- **WHEN** the chat pane is in its list sub-state for a workspace
- **THEN** the chat pane lists existing chats for that workspace newest-first

#### Scenario: New chat created

- **WHEN** the user presses the plus button and selects an available model
- **THEN** the UI creates a workspace chat and opens it in the chat pane without re-mounting the editor

### Requirement: ui-21 — Workspace editor: server-backed file state

WHEN file tabs, selected file, expanded explorer paths, or file viewport positions change in a workspace editor, THE UI SHALL persist that workspace's file state through the server and SHALL restore valid state from the server when opening the same workspace on any device.

#### Scenario: File state changes

- **WHEN** the user opens or selects files, expands explorer directories, or scrolls file views
- **THEN** the UI sends the workspace file state to the server

#### Scenario: Workspace reopened

- **WHEN** the same workspace editor is reopened later
- **THEN** the UI restores valid open tabs, selected file, expanded directories, and viewport positions from the server

#### Scenario: Server returns invalid path

- **WHEN** server-returned workspace state contains an invalid or escaping path
- **THEN** the UI ignores that path while restoring the rest of the workspace state

### Requirement: ui-22 — Workspace editor: no cookies

THE UI SHALL NOT read or write cookies for Sheaf Chat workspace, chat, file, or editor state.

#### Scenario: Workspace state saved

- **WHEN** workspace editor state changes
- **THEN** the UI persists it through the server rather than using cookies

## MODIFIED Requirements

### Requirement: ui-2 — Shell and routing: hash routing

THE UI SHALL hash-route: `#/` and `#/repositories` to the repository picker; `#/repositories/<repoId>` to the workspace picker; `#/repositories/<repoId>/workspaces/<workspaceId>` to the workspace editor; `#/repositories/<repoId>/workspaces/<workspaceId>/chats/<chatId>` to the same workspace editor with that chat selected in the chat pane; anything else falls back to the repository picker. The workspace editor SHALL be a single mounted view keyed by `repoId` + `workspaceId`, and the `chatId` segment SHALL mirror chat-pane state only. A hash change that alters only the `chatId` for the same workspace SHALL update the chat pane in place and SHALL NOT re-mount the editor or re-fetch the workspace's file or editor state; only a change of `repoId` or `workspaceId`, or leaving the editor, mounts or unmounts the editor and destroys the active chat connection. Segments are URI-encoded in links and decoded on parse.

#### Scenario: Root hash navigates to repository picker

- **WHEN** the URL hash is `#/` or `#/repositories`
- **THEN** the repository picker is rendered

#### Scenario: Repository hash navigates to workspace picker

- **WHEN** the URL hash is `#/repositories/<repoId>`
- **THEN** the workspace picker for that repository is rendered

#### Scenario: Workspace hash navigates to editor

- **WHEN** the URL hash is `#/repositories/<repoId>/workspaces/<workspaceId>`
- **THEN** the workspace editor is rendered with the chat pane showing the chat list

#### Scenario: Chat hash selects the chat in the pane

- **WHEN** the URL hash is `#/repositories/<repoId>/workspaces/<workspaceId>/chats/<chatId>`
- **THEN** the workspace editor for that workspace is rendered with that chat opened and connected in the chat pane

#### Scenario: Unknown hash falls back to repository picker

- **WHEN** the URL hash is anything else
- **THEN** the repository picker is rendered

#### Scenario: Changing only the chat does not re-mount the editor

- **WHEN** the hash changes only the `chatId` segment for the same `repoId` + `workspaceId`
- **THEN** only the chat pane updates to the new chat
- **AND** the editor is not re-mounted and the workspace file and editor state are not re-fetched

#### Scenario: Leaving the workspace destroys the chat connection

- **WHEN** the route changes to a different repository or workspace, or leaves the editor
- **THEN** the active chat connection is destroyed, closing its socket intentionally with no reconnect

### Requirement: ui-6 — Chat screen: WebSocket connect and hello

WHEN a chat becomes selected in the chat pane — whether by selecting it from the chat list or by loading a URL whose `chatId` segment names it — THE UI SHALL connect to `/ws/chat` (`ws:`/`wss:` per page protocol) with `repo`, `workspace`, `chat`, `client`, and — when a sequence is known — `after`, and SHALL send a `client.hello` (`supportsSnapshots`, `supportsLazyHistory`, `lastSeenSequence`) when the socket opens.

#### Scenario: Chat selected in the pane

- **WHEN** a chat is selected in the chat pane (by list selection or a chat-bearing URL)
- **THEN** the UI connects to `/ws/chat` with `repo`, `workspace`, `chat`, `client`, and `after` (when a sequence is known) query parameters, and sends a `client.hello` with `supportsSnapshots`, `supportsLazyHistory`, and `lastSeenSequence` when the socket opens

## ADDED Requirements

### Requirement: ui-23 — Workspace editor: chat pane owns open/close with two-level back

THE chat pane SHALL own a `list` ↔ `open` sub-state: with no chat selected it lists the workspace's chats; selecting or creating a chat opens it in the chat pane, and a chat-pane Back returns to the list. Opening or closing a chat SHALL update only the chat pane and SHALL NOT re-mount the workspace editor or re-fetch the workspace's file or editor state, so the explorer and file panes and the restored editor state persist across chat open and close. The top-level (screen) Back SHALL navigate to the workspace picker regardless of whether a chat is open.

#### Scenario: Chat-pane Back returns to the chat list

- **WHEN** a chat is open and the user presses the chat-pane Back
- **THEN** the chat pane returns to the chat list and only the chat pane re-renders
- **AND** the explorer and file panes and the restored editor state are unchanged

#### Scenario: Top-level Back leaves the editor

- **WHEN** the user presses the top-level Back, whether or not a chat is open
- **THEN** the UI navigates to the workspace picker

#### Scenario: Opening a chat preserves the editor

- **WHEN** the user opens a chat from the chat list
- **THEN** only the chat pane swaps to the conversation
- **AND** the explorer and file panes and the restored editor state are unchanged

### Requirement: ui-24 — Chat pane: optimistic local echo of submitted messages

WHEN the user submits a chat message, THE UI SHALL render that message in the transcript immediately, keyed by the client-generated message id, without waiting for any server echo; WHEN the server later echoes the same message id (as `chat.user_message` and/or agui text-message events) or replays it from history, THE UI SHALL reconcile it to the single already-rendered message rather than rendering a duplicate.

#### Scenario: Submitted message renders immediately

- **WHEN** the user submits a chat message
- **THEN** the message appears in the transcript immediately, before any server echo, keyed by the client-generated message id

#### Scenario: Server echo does not duplicate the message

- **WHEN** the server later echoes that message with the same id, or replays it from history
- **THEN** the UI reconciles it to the single already-rendered message and does not render a duplicate

### Requirement: ui-25 — Agent Review tab: workspace-scoped, gated on unstaged hunks

THE workspace editor SHALL resolve Agent Review from the selected workspace (worktree) root via `GET /api/repositories/:repoId/workspaces/:workspaceId/agent-review` and the `/ws/agent-review?repo&workspace&client` socket, independent of any open chat, and SHALL present the Agent Review tab in the file pane only when that worktree has at least one unstaged hunk. This SHALL apply equally to the repository's main worktree and any linked worktree.

#### Scenario: Worktree has unstaged hunks

- **WHEN** the selected workspace worktree has at least one unstaged hunk
- **THEN** the editor presents the Agent Review tab in the file pane

#### Scenario: Worktree has no unstaged hunks

- **WHEN** the selected workspace worktree has no unstaged hunks
- **THEN** the editor does not present the Agent Review tab

#### Scenario: Independent of an open chat

- **WHEN** the selected workspace (main or linked worktree) has unstaged hunks
- **THEN** the editor presents the Agent Review tab regardless of whether a chat is open

## REMOVED Requirements

### Requirement: ui-4 — Piles and sessions screens: piles listing and creation

**Reason**: Piles are removed from the UI.
**Migration**: Use repository and workspace picker requirements.

### Requirement: ui-5 — Piles and sessions screens: sessions listing and creation

**Reason**: Session listing/creation moves into the workspace editor chat pane.
**Migration**: Use workspace chat list and creation requirements.
