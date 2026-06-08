# Slice 0009 — Implementation Accepted

## Acceptance summary

The browser UI, shared AGUI interactive extensions, static asset serving, documentation,
and tests for slice 0009 (Browser UI, Documentation, and Hardening) are accepted. All
polishing issues are resolved; none remain open.

## What was reviewed

Reviewed the slice diff against the physical plan and `specs/01_sheaf_chat.md`:

- **`projects/sheaf-chat/src/ui/`** — `index.html`, `sheaf-chat.js` (hash router for
  piles/sessions/chat, WebSocket protocol handling, composer), `sheaf-chat.css`
  (responsive layout, 44px touch targets, sticky/safe-area composer, touch-vs-desktop
  Send visibility).
- **`projects/sheaf-chat/src/server/static.ts` / `server.ts`** — static roots for the UI
  shell and shared web assets, with path-traversal protection (`..`/backslash reject,
  content-type allowlist, `IsPathInsideRoot`).
- **`projects/web/src/agui-chat.js` / `.css`** — optional interactive APIs
  (`appendAguiEvent`, `prependHistory` with scroll preservation, `setCaughtUp`,
  `setConnectionState`, `getUiState`), `create(container, options)` with
  `onScrollNearTop`; legacy `create(container, wsUrl)` preserved.
- **Docs** — `README.md` and `docs/README.md` run/config/protocol/security content.

## Correctness verification

- Protocol kinds emitted by the UI and server match (`server.hello`, `history.page`,
  `agui.event`, `chat.user_message`, `model.changed`, `agent.status`,
  `session.updated`, `server.caught_up`, `server.error`); client frames match
  `clientFrames.ts`.
- No duplicate user echo: the UI renders user messages only from server broadcasts. The
  `chat.user_message` + `agui.event` dual-render path collapses to a single message
  because both carry the same `messageId` and `role:"user"` (`mapUserMessageToAgui`),
  and the renderer reduces by `messageId`.

## Issue resolution

- **PL-0001** (chat-screen interactive logic had no behavioral test coverage) —
  **completed**. The polisher added `projects/sheaf-chat/tests/ui/chatScreen.test.ts`, a
  VM fake-DOM/fake-WebSocket harness that boots `sheaf-chat.js` against the real shared
  `agui-chat.js` renderer and covers all six required scenarios: server-broadcast-only
  rendering with dual-path user-message dedup (asserts a single `agui-chat-bubble--user`
  with `role:"user"`), disconnected queue/flush + disabled state, sequenced-envelope ack
  and reconnect `after=<lastSequence>`, `client.model_select` frame shape, near-top lazy
  history gating with `before` cursor, and touch-vs-desktop Enter-key behavior. The
  asserted `agui-chat-bubble--user` class is produced by the real renderer, making the
  dedup assertion meaningful.

## Validation (reported by implementer/polisher; not re-run by reviewer)

- `make sheaf-chat-build` — pass.
- `make sheaf-chat-test` — pass (the new UI tests are network-free; an unrelated sandbox
  EPERM on 127.0.0.1 affects only pre-existing server tests, verified separately via
  `node --test` on the compiled router/chatScreen tests).
- `node --test projects/web/tests/agui-chat.test.mjs` — pass.
