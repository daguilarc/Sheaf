# Issues

## Issue PR-0001

- status: completed
- owner_role: polisher_reviewer
- created_at: 2026-06-06T21:50:00Z
- updated_at: 2026-06-06T22:20:00Z
- title: Logs viewer scrollback unreachable — log view container has no bounded height
- details: The logs UI wires upward-scroll scrollback by attaching a `scroll`
  listener to the `#log-view` element (`projects/conductor/src/ui/logs.js:257`),
  and `requestEarlierBytes()` (which sends the `read_before` message) is only
  invoked from that element's own scroll when `scrollTop === 0`. However the
  `.sheaf-log-view` style in `projects/web/src/sheaf.css` declares
  `overflow: auto` (line 168) but sets no `height` or `max-height`. A `<pre>`
  with `overflow: auto` and no bounded height expands to fit its full content
  and never produces an internal scrollbar; the page body scrolls instead and
  `logViewEl.scrollTop` stays at 0 with no scroll event ever firing on the
  element. As a result, in a real browser the user can never trigger
  `read_before`, so the on-demand scrollback loading is effectively dead.
  This violates the spec requirement that the logs UI "Allow the user to scroll
  upward and load earlier chunks on demand" (spec `## Web UI`) and the physical
  plan's "Upward scrollback sends `read_before` ... as the user scrolls upward"
  (physical plan line 65). The integration tests do not exercise browser scroll
  behavior (no DOM), so this gap is not caught by the current test suite.
- resolution_notes: Verified fixed. `.sheaf-log-view` in
  `projects/web/src/sheaf.css` now sets `max-height: 70vh` (line 162) alongside
  `overflow: auto` (line 169), so long log output produces an internal scrollbar
  on `#log-view` and the existing scroll-to-top handler (`logs.js:257`) can fire
  `requestEarlierBytes()` → `read_before`. A regression test
  ("shared log view CSS keeps scrollback loading reachable",
  `projects/conductor/tests/ui.test.ts:74`) asserts the shared CSS keeps both the
  `max-height` bound and internal `overflow: auto`. Acceptance condition met.
