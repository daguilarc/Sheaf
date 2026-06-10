# Spec Coverage

Last audit: living-spec migration (one-time rewrite from code), 2026-06-10

| Capability | Status | Gaps |
|---|---|---|
| web-utilities | partial | unhandled schema event types, CSS visuals inventory-level, browser floor approximate (see below) |

## Known gaps

### web-utilities

- The AGUI schema defines event types the reducer treats as no-ops:
  `TEXT_MESSAGE_CHUNK`, `TOOL_CALL_CHUNK`, `REASONING_MESSAGE_CHUNK`, and the
  `THINKING_*` family. Whether they should be rendered or are intentionally
  ignored is unspecified (they currently fall into the web-25 default).
- CSS appearance is specified at inventory level (tokens, class names,
  structural roles), not rule-by-rule (exact spacing, font sizes, radii). A
  rebuild would be functionally equivalent but not pixel-identical.
- The browser support floor is stated by feature (`color-mix`, classic
  scripts, feature-detected `WebSocket`/`requestAnimationFrame`), not as a
  tested browser matrix.
- `ChatView` has no reconnect/backoff; consumers own reconnection. The handle
  field `_owned.reconnectTimer` is cleared on destroy but never set anywhere
  — dead code, kept unspecified.
- The `_test` export surface is enumerated in Contracts, but its members'
  individual semantics are specified only through the public behavior they
  expose; the fake-DOM contract in `tests/agui-chat.test.mjs` is test
  infrastructure, not spec.
- `prependHistory` accepts the snapshot-message shape but does not validate
  roles; unknown roles render via the bare-fallback path (web-26's "any other
  role" row) — intentional leniency, exact set of producible roles owned by
  the producers.

## Observed code/spec mismatches (candidate fixes, not spec gaps)

- `projects/web/Makefile` `test` only checks that `src/sheaf.css` exists; it
  does not run `tests/agui-chat.test.mjs`, so `make web-test` passes even if
  the chat widget tests fail. The suite only runs when invoked directly with
  `node --test`.
- `projects/web/README.md` (project root, not this spec) still describes the
  project as CSS-only for conductor and does not mention the chat widget or
  quest-runner/sheaf-chat consumers.
