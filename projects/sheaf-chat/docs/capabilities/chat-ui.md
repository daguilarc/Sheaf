# Capability: Chat UI

ID prefix: `ui`

## Purpose

The service-owned browser application (`src/ui/`): three hash-routed screens
(piles, sessions, chat) over the REST API and the chat WebSocket. Transcript
rendering is delegated to the shared AGUI renderer
(`projects/web/src/agui-chat.js`, exposed as `window.ChatView`), which is
outside this project's spec. Repository web UI rules:
[structure/webui.md](../../../../structure/webui.md).

## Requirements

### Shell and routing

- **[ui-1]** THE UI SHALL be a dependency-free script that renders into
  `#app` in `src/ui/index.html`, loading the shared renderer assets from
  `/assets/web/` and its own from `/assets/sheaf-chat/`.
- **[ui-2]** THE UI SHALL hash-route: `#/` and `#/piles` → piles screen;
  `#/piles/<pile>` → sessions screen; `#/piles/<pile>/sessions/<id>` →
  chat screen; anything else falls back to the piles screen. Segments are
  URI-encoded in links and decoded on parse. Route changes destroy the
  active chat screen (closing its socket intentionally, no reconnect).
- **[ui-3]** THE UI SHALL keep a stable client id in `localStorage` under
  key `sheaf-chat-client-id` (generated UUID; regenerated per call when
  storage is unavailable) and send it as the `client` query parameter on
  every WebSocket connect.

### Piles and sessions screens

- **[ui-4]** THE piles screen SHALL list piles from `GET /api/piles` (name,
  session count, latest update time) and create piles via
  `POST /api/piles`, re-fetching the list on success and showing the REST
  error message on failure.
- **[ui-5]** THE sessions screen SHALL list a pile's sessions from
  `GET /api/piles/:pile/sessions` (chat name, root, model, updated time)
  and create sessions via `POST` with a root-directory input (default
  `projects`) and a model selector populated from `GET /api/models`
  (unavailable models shown ` (unavailable)` and disabled); on success it
  SHALL navigate straight to the chat route for the returned session id.

### Chat screen

- **[ui-6]** WHEN the chat screen opens, THE UI SHALL connect to `/ws/chat`
  (`ws:`/`wss:` per page protocol) with `p`, `session`, `client`, and —
  when a sequence is known — `after`, and SHALL send a `client.hello`
  (`supportsSnapshots`, `supportsLazyHistory`, `lastSeenSequence`) when the
  socket opens.
- **[ui-7]** WHEN `server.hello` arrives, THE UI SHALL populate the model
  selector and active model, adopt the manifest chat name as the title,
  adopt `latestSequence`, derive lazy-history state from `historyWindow`
  (more-before when `oldestSequence > 1`), and request an initial history
  page (`prefer: "snapshots"`, limit 5000).
- **[ui-8]** THE UI SHALL render user messages only from the server's
  `chat.user_message` broadcast (as a synthesized AGUI text triple), not
  locally on submit, so multiple clients of one session render identical
  ordering; live `agui.event` frames append to the renderer; duplicate
  rendering of the same `messageId` is prevented by the renderer.
- **[ui-9]** WHEN a sequenced envelope arrives with a sequence above the
  last seen, THE UI SHALL adopt it and send `client.ack` with that
  sequence; reconnects pass the last sequence as `after`.
- **[ui-10]** WHEN the socket closes unintentionally, THE UI SHALL
  reconnect after a fixed 1500 ms delay (no backoff), marking the composer
  disconnected meanwhile; outbound envelopes created while disconnected are
  queued in memory and flushed in order on reconnect.
- **[ui-11]** WHEN the transcript scrolls near the top (<= 80 px) and more
  history exists, THE UI SHALL request the previous page
  (`before: <oldestSequence>`, limit 5000, snapshots) at most one request
  at a time, prepending returned messages, and SHALL keep requesting while
  still pinned near the top.
- **[ui-12]** THE composer SHALL send on Enter (Shift+Enter inserts a
  newline) on non-touch layouts and only via the Send button on touch
  layouts; submissions send `client.user_message` with a generated
  `messageId`, the trimmed text, empty `attachments`, and `steer: true`.
- **[ui-13]** WHEN the model selector changes, THE UI SHALL send
  `client.model_select` with `applyTo: "next_turn"`; `model.changed`
  broadcasts update the selector and status line; `agent.status`
  broadcasts update the status line; `server.caught_up` marks the renderer
  caught up; `server.error` payloads replace the status text with the
  message.
- **[ui-14]** IF the shared renderer (`window.ChatView`) is missing, THEN
  THE chat screen SHALL render `Chat renderer failed to load.` instead of
  connecting.

## Contracts

This capability consumes the REST contracts of
[piles-sessions](piles-sessions.md) / [models](models.md) and the frame
contracts of [chat-protocol](chat-protocol.md). UI-owned constants:

| Constant | Value |
|---|---|
| client-id storage key | `sheaf-chat-client-id` |
| default root directory | `projects` |
| history page limit (initial and lazy) | 5000 |
| near-top threshold | 80 px |
| reconnect delay | 1500 ms |

Shared renderer API used: `ChatView.create(container, {onScrollNearTop})`,
`appendAguiEvent`, `prependHistory`, `setConnectionState`, `setCaughtUp`,
`destroy`.

## Design

- `src/ui/sheaf-chat.js` — single IIFE; route parsing, the three screen
  renderers, the WebSocket client state machine, and the outbound queue.
  Exposes `window.SheafChatApp._test` (parseRoute, buildWebSocketUrl,
  createEnvelope, isTouchLayout) for the DOM-less unit tests.
- `src/ui/sheaf-chat.css` — screen layout, touch/desktop classes
  (`sheaf-chat-touch`/`sheaf-chat-desktop` from a coarse-pointer media
  check).
- `src/ui/index.html` — the shell served at `/`.
- Tests drive the script with a fake DOM and fake WebSocket
  (`tests/ui/chatScreen.test.ts`, `tests/ui/router.test.ts`).

## Interactions

- [service](service.md) — serves the shell and assets.
- [piles-sessions](piles-sessions.md), [models](models.md) — REST calls.
- [chat-protocol](chat-protocol.md) — the WebSocket client behavior
  specified here is the counterpart of that capability.
- Shared renderer: `projects/web/src/agui-chat.js` (specified, if at all,
  in the web project).
