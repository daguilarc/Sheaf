# Architecture

Sheaf Chat is a Node/TypeScript service (ES modules, Node >= 20) that embeds
Pi agent sessions (`@earendil-works/pi-coding-agent`) and exposes them to
browsers. It has no web framework: routing is hand-rolled on Node's `http`
module, with `ws` for WebSocket upgrades and `typebox` for tool parameter
schemas.

## Component Overview

```text
Browser UI (src/ui + shared projects/web/src/agui-chat.js)
  |        REST discovery + file API    WebSocket /ws/chat
  v                                          v
HTTP server (src/server)  ---------  per-chat protocol pair (src/protocol)
  routes/, files/, static.ts, websocket.ts
                                       SessionPersistenceHub  (persist + fan-out)
  |                                    SessionBroadcaster     (socket + file fan-out)
  v                                          |
AgentManager (src/agents)  <-----------------+
  SessionRuntime (lifecycle, idle offload)
  piAdapter (Pi session construction)
  models/auth/localProvider (registry)
  |
  +-- scoped tools extension (src/extensions/sheaf-chat)
  +-- Pi -> AGUI mapping (src/agui)
  v
Storage (src/storage)  -> data/sheaf-chat/repositories/<repoId>/workspaces/<workspaceId>/chats/...
```

## Server Layer

`src/server/main.ts` loads repository-local configuration, reads
`config/services.json`, creates one `AgentManager`, and starts the combined
HTTP/WebSocket server. The server dispatches `/health`, `/api/*`, then static
assets. WebSocket upgrades are validated before opening the socket.

Repository discovery is backend-owned. `GET /api/repositories` inspects only
immediate children of the user's home directory and includes a child only
when that child is itself the canonical Git top-level root. It does not
recursively search nested directories. `GET /api/repositories/:repoId/workspaces`
uses `git worktree list --porcelain` and returns the main worktree plus
linked worktrees, using branch names as display names when available.

## Chat Identity And Storage

Every Sheaf Chat conversation is addressed by `{repoId, workspaceId, chatId}`.
`repoId` and `workspaceId` are deterministic path-derived ids; `chatId` is
generated when a blank chat shell is allocated.

Runtime state uses the new repository layout described in
[chat files](contracts/session-files.md). `repository.json` and
`workspace.json` are cached so a workspace's existing chats remain listable
by id. There is no migration from the old pile layout; delete
`data/sheaf-chat` when switching versions.

Manifests are deliberately deferred: creating a blank chat shell writes the
Pi session file, history log, and provisional record, but no manifest. The
manifest, including the generated chat name, is written only after the first
assistant message completes. Workspace chat lists scan manifests and sort by
manifest `updatedAt`, which is refreshed on each persisted envelope append.

## Protocol Pair

For each active chat the server keeps a `SessionPersistenceHub` and
`SessionBroadcaster`. Their names retain the Pi session terminology, but
their keys are `{repoId, workspaceId, chatId}`.

The hub is the single writer: it subscribes to `AgentManager` lifecycle
events, maps Pi events to AGUI envelopes, appends them to the workspace chat
history log with strictly increasing sequence numbers, and publishes each
persisted envelope to subscribers. The broadcaster fans persisted envelopes
out to connected sockets and serves replay/history-page requests.

`/ws/chat` requires `repo`, `workspace`, and `chat` query parameters. The
browser sends and receives v1 envelopes stamped with `repoId`, `workspaceId`,
and `chatId`.

## Agent Runtime

`AgentManager` keeps an in-memory runtime registry keyed by chat identity.
Startup is serialized per chat so concurrent clients share one runtime. Hot
resume reuses an attached Pi session; cold resume bootstraps from the
manifest when present and from the provisional record otherwise.

Pi sessions are constructed hermetically with service-local agent/auth state,
global Pi resource loading disabled, built-in Pi tools disabled, and exactly
the local-provider plus scoped-tools extensions registered. The scoped tools
root is the selected workspace root.

## Browser UI

`src/ui/sheaf-chat.js` hash-routes:

- `#/` and `#/repositories` to the repository picker.
- `#/repositories/<repoId>` to the workspace picker.
- `#/repositories/<repoId>/workspaces/<workspaceId>` to the three-pane
  editor with the chat list in the chat pane.
- `#/repositories/<repoId>/workspaces/<workspaceId>/chats/<chatId>` to the
  same editor with a selected chat connected.

The editor restores open file tabs, selected file, expanded directories, and
file viewport scroll positions through server-side workspace editor state.
Sheaf Chat does not use cookies for workspace/chat/editor state.

## File Browser And Agent Review

Workspace-level file APIs read from the selected workspace root. Chat-level
file APIs resolve from the chat manifest root when present and the provisional
workspace root otherwise:

- `/api/repositories/:repoId/workspaces/:workspaceId/file`
- `/api/repositories/:repoId/workspaces/:workspaceId/files`
- `/api/repositories/:repoId/workspaces/:workspaceId/chats/:chatId/file`
- `/api/repositories/:repoId/workspaces/:workspaceId/chats/:chatId/files`

Agent Review Mode uses the same workspace chat root and accepts
`repo`/`workspace`/`chat` on `/ws/agent-review`.

## Security Boundaries

- Service-local config and Pi auth storage; global `~/.pi` paths rejected.
- Generated identity ids are validated before storage access.
- Scoped tools resolve every path through a `RootPolicy` pinned to the
  canonical workspace/chat root.
- File-browser REST paths use the same root-policy containment checks and do
  not expose writes, diffs, partial reads, or absolute paths.
- Tool results and AGUI payloads are sanitized before leaving the server.
