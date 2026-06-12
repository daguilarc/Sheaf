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

THE UI SHALL be dependency-free first-party scripts that render into `#app` in `src/ui/index.html`, loading Markdown-it/KaTeX vendor assets from `/assets/vendor/`, the shared renderer assets from `/assets/web/`, and its own assets from `/assets/sheaf-chat/`.

#### Scenario: UI loads assets

- **WHEN** the UI page is loaded
- **THEN** it renders into `#app` in `src/ui/index.html`, loading Markdown-it/KaTeX vendor assets from `/assets/vendor/`, shared renderer assets from `/assets/web/`, and its own assets from `/assets/sheaf-chat/`

### Requirement: ui-2 — Shell and routing: hash routing

THE UI SHALL hash-route: `#/` and `#/piles` → piles screen; `#/piles/<pile>` → sessions screen; `#/piles/<pile>/sessions/<id>` → chat screen; anything else falls back to the piles screen. Segments are URI-encoded in links and decoded on parse. Route changes destroy the active chat screen (closing its socket intentionally, no reconnect).

#### Scenario: Root hash navigates to piles

- **WHEN** the URL hash is `#/` or `#/piles`
- **THEN** the piles screen is rendered

#### Scenario: Pile hash navigates to sessions

- **WHEN** the URL hash is `#/piles/<pile>`
- **THEN** the sessions screen for that pile is rendered

#### Scenario: Session hash navigates to chat

- **WHEN** the URL hash is `#/piles/<pile>/sessions/<id>`
- **THEN** the chat screen for that session is rendered

#### Scenario: Unknown hash falls back to piles

- **WHEN** the URL hash is anything else
- **THEN** the piles screen is rendered

#### Scenario: Route change destroys chat screen

- **WHEN** the route changes away from the chat screen
- **THEN** the active chat screen is destroyed, closing its socket intentionally with no reconnect

### Requirement: ui-3 — Shell and routing: stable client id

THE UI SHALL keep a stable client id in `localStorage` under key `sheaf-chat-client-id` (generated UUID; regenerated per call when storage is unavailable) and send it as the `client` query parameter on every WebSocket connect.

#### Scenario: Client id persisted

- **WHEN** the UI connects a WebSocket
- **THEN** it sends the stable client id from `localStorage` key `sheaf-chat-client-id` as the `client` query parameter

#### Scenario: Storage unavailable

- **WHEN** `localStorage` is unavailable
- **THEN** a new UUID is generated per call and sent as the `client` query parameter

### Requirement: ui-4 — Piles and sessions screens: piles listing and creation

THE piles screen SHALL list piles from `GET /api/piles` (name, session count, latest update time) and create piles via `POST /api/piles`, re-fetching the list on success and showing the REST error message on failure.

#### Scenario: Piles listed

- **WHEN** the piles screen loads
- **THEN** it fetches `GET /api/piles` and displays each pile's name, session count, and latest update time

#### Scenario: Pile created successfully

- **WHEN** a new pile is created via `POST /api/piles` and the request succeeds
- **THEN** the piles list is re-fetched and displayed

#### Scenario: Pile creation fails

- **WHEN** a new pile is created via `POST /api/piles` and the request fails
- **THEN** the REST error message is shown

### Requirement: ui-5 — Piles and sessions screens: sessions listing and creation

THE sessions screen SHALL list a pile's sessions from `GET /api/piles/:pile/sessions` (chat name, root, model, updated time) and create sessions via `POST` with a root-directory input (default `projects`) and a model selector populated from `GET /api/models` (unavailable models shown ` (unavailable)` and disabled); on success it SHALL navigate straight to the chat route for the returned session id.

#### Scenario: Sessions listed

- **WHEN** the sessions screen loads for a pile
- **THEN** it fetches `GET /api/piles/:pile/sessions` and displays each session's chat name, root, model, and updated time

#### Scenario: Session created successfully

- **WHEN** a new session is created via `POST` and the request succeeds
- **THEN** the UI navigates to the chat route for the returned session id

#### Scenario: Model selector populated

- **WHEN** the sessions screen loads
- **THEN** the model selector is populated from `GET /api/models`, with unavailable models shown ` (unavailable)` and disabled

### Requirement: ui-6 — Chat screen: WebSocket connect and hello

WHEN the chat screen opens, THE UI SHALL connect to `/ws/chat` (`ws:`/`wss:` per page protocol) with `p`, `session`, `client`, and — when a sequence is known — `after`, and SHALL send a `client.hello` (`supportsSnapshots`, `supportsLazyHistory`, `lastSeenSequence`) when the socket opens.

#### Scenario: Chat screen opens

- **WHEN** the chat screen opens
- **THEN** the UI connects to `/ws/chat` with `p`, `session`, `client`, and `after` (when a sequence is known) query parameters, and sends a `client.hello` with `supportsSnapshots`, `supportsLazyHistory`, and `lastSeenSequence` when the socket opens

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
