## Why

Sheaf Chat currently organizes conversations through manually-created piles, but the editor experience is actually rooted in a filesystem workspace. Since old `data/sheaf-chat` state can be deleted, we can replace piles with a repo > workspace > chat hierarchy without migration complexity.

## What Changes

- **BREAKING**: Remove the pile concept from Sheaf Chat APIs, routes, manifests, runtime keys, and browser navigation.
- Add backend discovery for Git repositories whose top-level directory is a direct child of the user's home directory, such as `/Users/name/reporoot`.
- Add backend discovery for a selected repository's workspaces: the main worktree plus any Git worktrees.
- Make every chat belong to exactly one selected workspace, with the workspace path as the chat root directory.
- Replace the current piles screen with a repository picker, then a workspace picker, then the existing three-pane editor view.
- Move chat listing/creation into the editor view's chat tab for the selected workspace.
- Store enough chat metadata to list chats for a workspace newest-first by last persisted message/update.
- Persist per-workspace editor UI state server-side, including open file tabs, selected tab, expanded explorer state, and current file viewport, so another device can continue the same workspace.
- Remove cookie usage from Sheaf Chat; the project should not introduce cookies for state persistence.
- Do not support upgrades from existing pile data; deleting `data/sheaf-chat` is the expected reset path.

### Follow-up refinements (post first human test)

- **Identity resolution without rediscovery**: resolve known `repoId`/`workspaceId` from cached metadata by id; run home-directory repository discovery only for `GET /api/repositories` and worktree discovery only for `GET /api/repositories/:repoId/workspaces`. Stop rewriting unchanged metadata on read/resolve. (Today every chat-list, chat-create, file-browse, history, and editor-state request re-scans `$HOME` with a git subprocess per child and rewrites all metadata JSON, making navigation sluggish.)
- **First-message visibility**: render submitted messages optimistically in the chat pane (keyed by the client `messageId`), give a user message one stable id across echo and history so optimistic render / live echo / replay reconcile to one message, and harden the connection bootstrap so the first message on a cold-starting chat is never lost between catch-up replay and live subscription.
- **Chat open/close belongs to the chat pane**: the workspace editor is a single mounted view keyed by `repoId`+`workspaceId`; the `chatId` URL segment mirrors chat-pane state only and a chat-only change updates the pane without re-mounting the editor. Top-level Back returns to the workspace picker; a chat-pane Back returns to the chat list, re-rendering only the chat pane.
- **Agent Review is workspace-scoped**: resolve Agent Review from the selected workspace (worktree) root rather than a chat, working for the main worktree and any linked worktree, and present the Agent Review tab only when the current worktree has unstaged hunks.

## Capabilities

### New Capabilities

- `sheaf-chat-repo-workspaces`: Repository discovery, workspace discovery, workspace-scoped chat metadata, and workspace identity for chats.

### Modified Capabilities

- `sheaf-chat-chat-ui`: Replace pile/session screens with repository/workspace selection and move chat list/create into the editor chat tab; persist workspace UI state through the server.
- `sheaf-chat-chat-protocol`: Replace WebSocket pile/session identity with workspace/chat identity.
- `sheaf-chat-agent-runtime`: Start and resume Pi sessions from workspace-scoped chat roots instead of pile-scoped sessions.
- `sheaf-chat-session-history`: Read and write history by workspace/chat identity and keep chat recency metadata current.
- `sheaf-chat-file-browser`: Resolve file browsing from the selected workspace root and persist/restore file tab state.
- `sheaf-chat-agent-review-mode`: Resolve review mode from the selected workspace root instead of a pile/session root.
- `sheaf-chat-piles-sessions`: Replace the piles/sessions REST contract with workspace-scoped chat shell creation and manifest listing.

## Impact

- `projects/sheaf-chat/src/storage/*`: storage paths, manifest shape, validation, chat allocation, and list queries.
- `projects/sheaf-chat/src/server/router.ts` and `src/server/routes/*`: REST routes for repositories, workspaces, chats, history, files, and review availability.
- `projects/sheaf-chat/src/server/websocket.ts` and `src/server/websockets.ts`: WebSocket query parsing, validation, and URL generation.
- `projects/sheaf-chat/src/agents/*` and `src/protocol/*`: runtime keys, lifecycle events, persistence hubs, broadcaster registries, and Pi session construction.
- `projects/sheaf-chat/src/ui/sheaf-chat.js` and `.css`: hash routing, repository/workspace pickers, editor chat tab, chat creation, file tab restore, and server-side editor state sync.
- OpenSpec specs and docs that describe `data/sheaf-chat`, routes, manifests, and browser behavior.
- Tests under `projects/sheaf-chat/tests` for repository/workspace discovery, workspace chat REST routes, WebSocket identity, UI routing, server-backed editor state, and removed pile routes.
