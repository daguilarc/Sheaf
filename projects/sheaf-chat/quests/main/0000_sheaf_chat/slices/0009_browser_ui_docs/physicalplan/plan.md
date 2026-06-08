# Slice 9: Browser UI, Documentation, And Hardening

## Objective

Build the browser chat experience on top of the REST/WebSocket backend, extend the shared AGUI renderer with optional interactive APIs, complete documentation, and run end-to-end hardening.

Expected outcome:

- Browser UI has piles, sessions, and chat screens with back navigation and practical browser history behavior.
- Chat screen connects to the WebSocket protocol, sends messages, lazy-loads history, reconnects with last seen sequence, selects models, renders status, and avoids duplicate local echoes.
- Shared `projects/web/src/agui-chat.js` remains backward compatible for read-only consumers.
- Mobile layout requirements are met.
- README and docs describe run steps, config/data paths, REST/WebSocket protocol, provider setup, root-scoped tool security, and Pi doc links.

## Key Files And Systems

- `projects/sheaf-chat/src/ui/index.html`
- `projects/sheaf-chat/src/ui/sheaf-chat.js`
- `projects/sheaf-chat/src/ui/sheaf-chat.css`
- `projects/sheaf-chat/src/server/static.ts`
- `projects/web/src/agui-chat.js`
- `projects/web/src/agui-chat.css`
- `projects/sheaf-chat/tests/ui/`
- `projects/sheaf-chat/README.md`
- `projects/sheaf-chat/docs/README.md`

## Existing APIs To Reuse

- Existing AGUI reducer/rendering in `projects/web/src/agui-chat.js` and styles in `projects/web/src/agui-chat.css`.
- Browser `WebSocket`, `fetch`, History API, `ResizeObserver`/viewport APIs where needed.
- REST endpoints from slice 7 and WebSocket protocol from slice 8.

## APIs To Extend Or Modify

- Extend `ChatView`/AGUI assets with optional send/history/model/status hooks while preserving existing read-only initialization paths.
- Add optional APIs for:
  - appending live AGUI events from envelopes
  - prepending history pages while preserving scroll position
  - rendering compact expandable tool calls and reasoning blocks
  - exposing send/disconnect/queued state to the service-owned UI
- Add service-owned UI state/router for piles, sessions, and chat.

## Implementation Notes

- Keep Sheaf Chat-specific browser code under `projects/sheaf-chat/src/ui/`. Only generic AGUI renderer improvements belong in `projects/web/src/`.
- Piles screen uses `GET /api/piles` and supports pile creation.
- Sessions screen uses `GET /api/piles/:pile/sessions` and supports new session creation in that pile, including root directory and model selection.
- Chat screen opens `/ws/chat` for `(pile, sessionId)`, renders `server.hello`, asks for latest history large enough to fill the viewport, sends `client.user_message`, sends `client.history_request` near top scroll, sends `client.model_select`, tracks `client.ack`, and reconnects with `after=<lastSequence>`.
- Render user messages only from server broadcasts/AGUI events, not local echo.
- Desktop composer: Enter sends, Shift+Enter inserts newline. Mobile/touch: Enter inserts newline and an explicit Send button sends.
- Disable or visibly queue sends while disconnected.
- Composer is sticky/fixed at bottom without hiding the last message; textarea grows to a max height; controls meet 44px hit targets.
- Code, tool args, and long paths must avoid horizontal page overflow.
- Use compact expandable blocks for reasoning and tool calls.
- Avoid marketing/landing-page layout. The first screen should be the usable piles UI.
- Final cleanup should remove temporary fixtures only if they are not needed by tests and ensure no compatibility shims remain unused.

## Validation

- Browser/unit tests for piles-to-sessions-to-chat navigation, back navigation, send behavior, broadcast rendering without duplicates, lazy prepend scroll preservation, reconnect/missed-event request behavior, model selection frame, disconnected queue/disabled state, and mobile-critical DOM/classes.
- Manual or automated browser verification at desktop and narrow mobile viewport for no text overlap, no horizontal overflow, sticky composer behavior, and usable touch targets.
- Existing read-only AGUI uses still pass.
- `make sheaf-chat-build`
- `make sheaf-chat-test`
- Update `projects/sheaf-chat/README.md` and `projects/sheaf-chat/docs/README.md` with all documentation requirements from the spec.
