# Slice 0009 Implementation Complete

## Summary

Delivered the browser chat UI, shared AGUI interactive extensions, static asset serving, tests, and documentation for Sheaf Chat.

## Changes

- **`projects/web/src/agui-chat.js`** — Optional interactive APIs: `appendAguiEvent`, `prependHistory` (scroll-preserving), `setCaughtUp`, `setConnectionState`, `getUiState`; `create(container, options)` with `onScrollNearTop`; legacy `create(container, wsUrl)` unchanged.
- **`projects/web/src/agui-chat.css`** — Overflow protection for tool/reasoning bodies.
- **`projects/sheaf-chat/src/ui/`** — `index.html`, `sheaf-chat.js` (piles/sessions/chat router, WebSocket protocol, mobile composer), `sheaf-chat.css` (responsive layout, 44px targets, sticky composer).
- **`projects/sheaf-chat/src/server/static.ts`** — Static roots for UI and shared web assets.
- **`projects/sheaf-chat/src/server/server.ts`** — Serves `/`, `/assets/web/*`, `/assets/sheaf-chat/*`.
- **`projects/sheaf-chat/tests/server/static.test.ts`** — Shell and asset route tests.
- **`projects/sheaf-chat/tests/ui/router.test.ts`** — Hash router and protocol helper tests.
- **`projects/web/tests/agui-chat.test.mjs`** — Prepend, connection state, backward-compat coverage.
- **`projects/sheaf-chat/README.md`** and **`projects/sheaf-chat/docs/README.md`** — Run steps, config/data paths, REST/WebSocket summaries, providers, root-scoped tool security, Pi doc links.

## Validation

- `make sheaf-chat-build` — pass
- `make sheaf-chat-test` — 114/114 pass
- `node --test projects/web/tests/agui-chat.test.mjs` — 23/23 pass
