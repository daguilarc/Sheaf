# Implementation Accepted — Slice 0005 Dashboard Integration

## Verdict

Accepted. No open polishing issues. The slice correctly and completely integrates the
shared `ChatView` transcript into the dashboard agent log view, replacing the raw JSONL
`<pre>` dump.

## What was reviewed

Full diff of commit `28507d8` against `physicalplan/plan.md` and the quest spec
`specs/01_chat_ui.md`, plus targeted reads of the consuming/served code:
`dashboard_assets/{index.html,styles.css,app.js}`, `projects/web/src/agui-chat.{js,css}`,
`api.py` asset/stream routes, and `tests/test_dashboard_shell.py`.

## Verified

- Asset loading: `index.html` loads `/assets/web/agui-chat.css` and
  `/assets/web/agui-chat.js` before the dashboard module script.
- Theme mapping: every `--agui-chat-*` variable consumed by `agui-chat.css`
  (bg, surface, surface-muted, text, muted, border, accent, live, warning) is mapped to
  an existing `--dash-*` token; all source tokens exist.
- Rendering: raw JSONL `<pre>` body removed; `#dash-agent-chat` container rendered and a
  `ChatView` WebSocket transcript created; error row shown when `window.ChatView` is
  missing, with no raw-JSONL fallback.
- WebSocket URL: correct `ws:`/`wss:` selection, `location.host`, path
  `/api/dashboard/agent_log/stream`, and `step` omitted when null.
- Lifecycle: single `state.contentCache = {}` reset is guarded by `DestroyActiveChat`;
  `render()` destroys the chat whenever the active view is neither the agents page nor a
  slice agents subpage; agent/step switches destroy before re-fetch; poll-driven
  re-renders reparent the live handle via a matching session key so transcripts survive
  refreshes; `ChatView.destroy` closes the socket and clears the container.
- Handle shape (`root`/`container`) matches the reparent helpers.
- Remaining `dash-pre--raw` usages are the Human-intervention and plan-file views, not
  the agent log.
- Server route `/assets/web/<path>` serves both css and js with no-cache; shell test
  asserts the references and `no-store` headers.

## Test sufficiency

Per the plan, chat lifecycle/URL helpers remain inline in `app.js` rather than being
extracted into a separately unit-tested module, so coverage stays at the shell/static
level (`test_dashboard_shell.py`) plus the shared component tests
(`projects/web/tests/agui-chat.test.mjs`). This matches the plan's stated allowance.
Implementer reported 20/20 node tests and 22/22 dashboard tests passing.

## Non-blocking observation (not filed)

`dashboard_slice.py` still returns the full `jsonl_raw` field on every
`/api/dashboard/agent_log` response, which the browser no longer consumes. This is
outside the slice's declared file scope and the spec explicitly preserved that endpoint,
so it is noted only and not raised as an issue.
