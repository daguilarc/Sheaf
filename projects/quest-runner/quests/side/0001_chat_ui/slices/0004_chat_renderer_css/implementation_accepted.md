# Implementation Accepted — Slice 0004 Chat Renderer CSS

## Decision

Accepted. All polishing issues are resolved; no open issues remain.

## Scope reviewed

- `projects/web/src/agui-chat.js` — `ChatView.create`/`destroy` lifecycle,
  incremental DOM renderer, auto-scroll, role-specific rendering, status bar, and
  markdown formatting.
- `projects/web/src/agui-chat.css` — chat-specific classes and custom properties.
- `projects/web/tests/agui-chat.test.mjs` — renderer/lifecycle test coverage.

## Verification against the slice plan

- All required `agui-chat-*` CSS classes are present and styled solely via
  `--agui-chat-*` custom properties with fallback defaults; no `--dash-*`
  references (token mapping is deferred to slice 5, per plan).
- `create` clears the container, appends root/status/transcript, opens the
  WebSocket, parses JSON messages, and coalesces renders with
  `requestAnimationFrame`; `destroy` closes a connecting/open socket, cancels the
  pending frame, removes listeners, clears the container, and marks the handle
  destroyed.
- Incremental renderer appends new nodes, reuses existing nodes for streaming
  updates, and removes nodes dropped after `MESSAGES_SNAPSHOT`.
- Auto-scroll uses the 50px at-bottom threshold and suppresses scrolling when the
  user has scrolled up.
- Role-specific rendering (user / assistant markdown / collapsible tool &
  reasoning panels / compact activity rows) and the loading/live/complete/error
  status bar with active-step chips match the plan.
- Markdown is HTML-escaped before formatting; code blocks, inline code, bold, and
  italic render without XSS exposure.

## Issues

- PL-0001 (streaming cursor / reasoning spinner persisting after a separate-frame
  END) — fixed via `renderedStreaming` tracking that forces one final re-render
  after streaming ends, plus a regression test covering the cross-frame END for
  both assistant and reasoning roles. Verified and closed.

## Note

The `scripts/quest-runner issues` CLI was unavailable throughout this review (all
invocations were blocked by the permission system and could not be approved), so
PL-0001 was recorded and closed directly in `polishing_issues.md` per the
documented fallback. The polisher's `Fixed` response is in
`polishing_issue_responses.md`. Test execution was not performed as part of this
reviewer pass, per the reviewer test-execution policy; sufficiency was assessed
from the changed test code and the polisher's reported `node --test` outcome.
