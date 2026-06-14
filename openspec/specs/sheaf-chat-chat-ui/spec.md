# Capability: Chat UI

Project: `projects/sheaf-chat`
ID prefix: `ui` — requirement IDs are append-only; never renumber or reuse.

## Purpose

The service-owned browser application (`src/ui/`): three hash-routed screens
(piles, sessions, chat) over the REST API and the chat WebSocket, including
the chat screen's session-root file workspace. Transcript rendering is
delegated to the shared AGUI renderer
(`projects/web/src/agui-chat.js`, exposed as `window.ChatView`), which is
outside this project's spec. Repository web UI rules:
[structure/webui.md](../../../structure/webui.md).
## Requirements
### Requirement: ui-1 — Shell and routing: dependency-free first-party scripts

THE UI SHALL be dependency-free first-party scripts that render into `#app` in `src/ui/index.html`, loading Markdown-it/KaTeX and Highlight.js vendor assets from `/assets/vendor/`, the shared renderer assets from `/assets/web/`, and its own assets from `/assets/sheaf-chat/`.

#### Scenario: UI loads assets

- **WHEN** the UI page is loaded
- **THEN** it renders into `#app` in `src/ui/index.html`, loading Markdown-it/KaTeX and Highlight.js vendor assets from `/assets/vendor/`, shared renderer assets from `/assets/web/`, and its own assets from `/assets/sheaf-chat/`

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

### Requirement: ui-3 — Shell and routing: stable client id

THE UI SHALL keep a stable client id in `localStorage` under key `sheaf-chat-client-id` (generated UUID; regenerated per call when storage is unavailable) and send it as the `client` query parameter on every WebSocket connect.

#### Scenario: Client id persisted

- **WHEN** the UI connects a WebSocket
- **THEN** it sends the stable client id from `localStorage` key `sheaf-chat-client-id` as the `client` query parameter

#### Scenario: Storage unavailable

- **WHEN** `localStorage` is unavailable
- **THEN** a new UUID is generated per call and sent as the `client` query parameter

### Requirement: ui-6 — Chat screen: WebSocket connect and hello

WHEN a chat becomes selected in the chat pane — whether by selecting it from the chat list or by loading a URL whose `chatId` segment names it — THE UI SHALL connect to `/ws/chat` (`ws:`/`wss:` per page protocol) with `repo`, `workspace`, `chat`, `client`, and — when a sequence is known — `after`, and SHALL send a `client.hello` (`supportsSnapshots`, `supportsLazyHistory`, `lastSeenSequence`) when the socket opens.

#### Scenario: Chat selected in the pane

- **WHEN** a chat is selected in the chat pane (by list selection or a chat-bearing URL)
- **THEN** the UI connects to `/ws/chat` with `repo`, `workspace`, `chat`, `client`, and `after` (when a sequence is known) query parameters, and sends a `client.hello` with `supportsSnapshots`, `supportsLazyHistory`, and `lastSeenSequence` when the socket opens

### Requirement: ui-7 — Chat screen: server.hello handling

WHEN `server.hello` arrives, THE UI SHALL populate the model selector and active model, adopt the manifest chat name as the title, adopt `latestSequence`, derive lazy-history state from `historyWindow` (more-before when `oldestSequence > 1`), and request an initial history page (`prefer: "snapshots"`, limit 5000).

#### Scenario: server.hello received

- **WHEN** `server.hello` arrives
- **THEN** the UI populates the model selector and active model, adopts the manifest chat name as the title, adopts `latestSequence`, derives lazy-history state from `historyWindow` (more-before when `oldestSequence > 1`), and requests an initial history page with `prefer: "snapshots"` and limit 5000

### Requirement: ui-8 — Chat screen: message rendering from server broadcast

THE UI SHALL render user messages only from the server's `chat.user_message` broadcast (as a synthesized AGUI text triple), not locally on submit, so multiple clients of one session render identical ordering; live `agui.event` frames append to the renderer; duplicate rendering of the same `messageId` is prevented by the renderer.

#### Scenario: User message rendered from broadcast

- **WHEN** the server broadcasts `chat.user_message`
- **THEN** the UI renders it as a synthesized AGUI text triple, not from a local submit

#### Scenario: Live agui.event appended

- **WHEN** a live `agui.event` frame arrives
- **THEN** it is appended to the renderer

#### Scenario: Duplicate messageId prevented

- **WHEN** a `messageId` already rendered arrives again
- **THEN** the renderer prevents duplicate rendering

### Requirement: ui-9 — Chat screen: sequence tracking and ack

WHEN a sequenced envelope arrives with a sequence above the last seen, THE UI SHALL adopt it and send `client.ack` with that sequence; reconnects pass the last sequence as `after`.

#### Scenario: New sequence received

- **WHEN** a sequenced envelope arrives with a sequence above the last seen
- **THEN** the UI adopts it and sends `client.ack` with that sequence

#### Scenario: Reconnect with last sequence

- **WHEN** the UI reconnects
- **THEN** it passes the last seen sequence as `after`

### Requirement: ui-10 — Chat screen: reconnect on unintentional close

WHEN the socket closes unintentionally, THE UI SHALL reconnect after a fixed 1500 ms delay (no backoff), marking the composer disconnected meanwhile; outbound envelopes created while disconnected are queued in memory and flushed in order on reconnect.

#### Scenario: Unintentional socket close

- **WHEN** the socket closes unintentionally
- **THEN** the UI marks the composer disconnected and reconnects after a fixed 1500 ms delay with no backoff

#### Scenario: Queued envelopes flushed on reconnect

- **WHEN** the UI reconnects after an unintentional close
- **THEN** outbound envelopes created while disconnected are flushed in order

### Requirement: ui-11 — Chat screen: lazy history loading

WHEN the transcript scrolls near the top (<= 80 px) and more history exists, THE UI SHALL request the previous page (`before: <oldestSequence>`, limit 5000, snapshots) at most one request at a time, prepending returned messages, and SHALL keep requesting while still pinned near the top.

#### Scenario: Scroll near top with more history

- **WHEN** the transcript scrolls to within 80 px of the top and more history exists
- **THEN** the UI requests the previous page with `before: <oldestSequence>`, limit 5000, and snapshots, at most one request at a time, prepends returned messages, and keeps requesting while still pinned near the top

### Requirement: ui-12 — Chat screen: composer send behavior

THE composer SHALL send on Enter (Shift+Enter inserts a newline) on non-touch layouts and only via the Send button on touch layouts; submissions send `client.user_message` with a generated `messageId`, the trimmed text, empty `attachments`, and `steer: true`.

#### Scenario: Non-touch layout send

- **WHEN** the user presses Enter on a non-touch layout
- **THEN** the composer sends `client.user_message` with a generated `messageId`, trimmed text, empty `attachments`, and `steer: true`

#### Scenario: Non-touch Shift+Enter

- **WHEN** the user presses Shift+Enter on a non-touch layout
- **THEN** a newline is inserted in the composer

#### Scenario: Touch layout send

- **WHEN** the user taps the Send button on a touch layout
- **THEN** the composer sends `client.user_message` with a generated `messageId`, trimmed text, empty `attachments`, and `steer: true`

### Requirement: ui-13 — Chat screen: model selector and status broadcasts

WHEN the model selector changes, THE UI SHALL send `client.model_select` with `applyTo: "next_turn"`; `model.changed` broadcasts update the selector and status line; `agent.status` broadcasts update the status line; `server.caught_up` marks the renderer caught up; `server.error` payloads replace the status text with the message.

#### Scenario: Model selector changed

- **WHEN** the model selector changes
- **THEN** the UI sends `client.model_select` with `applyTo: "next_turn"`

#### Scenario: model.changed broadcast received

- **WHEN** a `model.changed` broadcast arrives
- **THEN** the selector and status line are updated

#### Scenario: agent.status broadcast received

- **WHEN** an `agent.status` broadcast arrives
- **THEN** the status line is updated

#### Scenario: server.caught_up received

- **WHEN** `server.caught_up` arrives
- **THEN** the renderer is marked caught up

#### Scenario: server.error received

- **WHEN** a `server.error` payload arrives
- **THEN** the status text is replaced with the error message

### Requirement: ui-14 — Chat screen: missing renderer fallback

IF the shared renderer (`window.ChatView`) is missing, THEN THE chat screen SHALL render `Chat renderer failed to load.` instead of connecting.

#### Scenario: Renderer missing

- **WHEN** `window.ChatView` is missing
- **THEN** the chat screen renders `Chat renderer failed to load.` instead of connecting

### Requirement: ui-15 — Chat screen: session-root file workspace

WHEN the chat screen renders, THE UI SHALL include the session-root file workspace specified by [file-browser](../sheaf-chat-file-browser/spec.md).

#### Scenario: Chat screen renders

- **WHEN** the chat screen renders
- **THEN** the session-root file workspace is included as specified by the file-browser capability

### Requirement: ui-16 — Chat screen: file-link handler

WHEN chat messages contain supported file links, THE UI SHALL pass a file-link handler to the shared renderer so `sheaf-file:` and root-relative Markdown file links open or focus workspace tabs.

#### Scenario: File links in chat messages

- **WHEN** chat messages contain supported file links
- **THEN** the UI passes a file-link handler to the shared renderer so `sheaf-file:` and root-relative Markdown file links open or focus workspace tabs

### Requirement: ui-17 — Chat screen: Markdown preview fallback

IF `window.SheafMarkdown` is unavailable or cannot render a Markdown file preview, THEN THE UI SHALL fall back to escaped plain-text preview for the file content.

#### Scenario: SheafMarkdown unavailable or fails

- **WHEN** `window.SheafMarkdown` is unavailable or cannot render a Markdown file preview
- **THEN** the UI falls back to escaped plain-text preview for the file content

### Requirement: ui-18 — Chat screen: collapsible side panes

ON non-touch layouts, THE explorer and chat side panes SHALL be collapsible and re-expandable from the collapsed state. A collapsed side pane SHALL keep a visible, clickable rail control, hide pane content that no longer fits, and update the control label/title/arrow to indicate whether it will expand or collapse the pane.

#### Scenario: Non-touch layout pane collapse

- **WHEN** a side pane is collapsed on a non-touch layout
- **THEN** it keeps a visible, clickable rail control, hides pane content that no longer fits, and updates the control label/title/arrow to indicate it will expand the pane

#### Scenario: Non-touch layout pane expand

- **WHEN** a collapsed side pane is re-expanded on a non-touch layout
- **THEN** pane content is shown and the control label/title/arrow updates to indicate it will collapse the pane

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

## Contracts

This capability consumes the REST contracts of
[piles-sessions](../sheaf-chat-piles-sessions/spec.md) / [models](../sheaf-chat-models/spec.md) and the frame
contracts of [chat-protocol](../sheaf-chat-chat-protocol/spec.md). UI-owned constants:

| Constant | Value |
|---|---|
| client-id storage key | `sheaf-chat-client-id` |
| default root directory | `projects` |
| history page limit (initial and lazy) | 5000 |
| near-top threshold | 80 px |
| reconnect delay | 1500 ms |
| explorer width storage key | `sheaf-chat-explorer-width` |
| chat width storage key | `sheaf-chat-chat-width` |
| default explorer width | 240 px |
| default chat width | 360 px |
| explorer width clamp | 160-480 px |
| chat width clamp | 280-640 px |

Shared renderer API used: `ChatView.create(container, {onScrollNearTop})`,
`appendAguiEvent`, `prependHistory`, `setConnectionState`, `setCaughtUp`,
`destroy`.

Shared Markdown helper API used:
`SheafMarkdown.renderMarkdown(markdown)`,
`SheafMarkdown.enhanceRenderedLinks(container, {basePath, rootMode,
onFileLink})`, and `SheafMarkdown.resolveFileLink(href, basePath, rootMode)`.

## Design

- `src/ui/sheaf-chat.js` — single IIFE; route parsing, the three screen
  renderers, the WebSocket client state machine, the outbound queue, and the
  file workspace controller.
  Exposes `window.SheafChatApp._test` (parseRoute, buildWebSocketUrl,
  createEnvelope, isTouchLayout) for the DOM-less unit tests.
- `src/ui/sheaf-chat.css` — screen layout, touch/desktop classes
  (`sheaf-chat-touch`/`sheaf-chat-desktop` from a coarse-pointer media
  check), file workspace panes, tabs, and mobile panels.
- `src/ui/sheaf-markdown.js` — Markdown-it/KaTeX rendering, math protection
  outside code ranges, and safe file-link resolution/enhancement.
- `src/ui/index.html` — the shell served at `/`, including vendor and shared
  assets in load order.
- Tests drive the script with a fake DOM and fake WebSocket
  (`tests/ui/chatScreen.test.ts`, `tests/ui/router.test.ts`) and with a
  Playwright Chromium browser against an in-process fake server
  (`tests/integration/browserChat.integration.test.ts`).

## Interactions

- [service](../sheaf-chat-service/spec.md) — serves the shell and assets.
- [piles-sessions](../sheaf-chat-piles-sessions/spec.md), [models](../sheaf-chat-models/spec.md) — REST calls.
- [chat-protocol](../sheaf-chat-chat-protocol/spec.md) — the WebSocket client behavior
  specified here is the counterpart of that capability.
- [file-browser](../sheaf-chat-file-browser/spec.md) — file REST calls, workspace tab/panel
  semantics, Markdown preview, file links, and `file.changed` handling.
- Shared renderer: `projects/web/src/agui-chat.js` (specified, if at all,
  in the web project).
