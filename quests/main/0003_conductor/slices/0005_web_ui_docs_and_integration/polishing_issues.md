# Issues

## Issue PR-0001

- status: open
- owner_role: polisher_reviewer
- created_at: 2026-06-06T21:50:00Z
- updated_at: 2026-06-06T21:50:00Z
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
- resolution_notes: none

  To mark completed, the log view container must have a bounded visible height
  (e.g. a `max-height` on `.sheaf-log-view` or an equivalent height constraint
  applied to `#log-view`) so that long content produces an internal scrollbar
  and scrolling to the top of the element fires the `scroll` handler that calls
  `requestEarlierBytes()`. The fix must keep `read_before` reachable through
  normal upward scrolling in the rendered logs page.
