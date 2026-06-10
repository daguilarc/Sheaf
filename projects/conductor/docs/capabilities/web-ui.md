# Capability: Web UI

ID prefix: `ui`

## Purpose

The browser interface served by conductor itself: a main page listing every
registered service with health, links, and Start/Stop/Restart controls, and a
per-service log viewer page that streams file contents over the
[log-access](log-access.md) WebSocket. Pages are server-rendered HTML shells;
behavior lives in two plain-JS browser scripts served as static assets along
with the shared stylesheet from `projects/web`.

## Requirements

### Pages

- **[ui-1]** THE service SHALL respond to `GET /` with 200 and an HTML page
  titled `Conductor` that links the shared stylesheet
  `/assets/web/sheaf.css`, loads the script `/assets/conductor/main.js`, and
  contains the service table skeleton (`id="services-table"`).
- **[ui-2]** THE service SHALL respond to `GET /services/<name>/logs` for a
  registered service with 200 and an HTML page titled `Logs: <name>` that
  links the shared stylesheet, loads `/assets/conductor/logs.js`, embeds the
  service name as JSON in a `<script type="application/json">` element
  (HTML-escaped), and contains no log file paths; unknown services get 404
  `{"error": "service not found"}`.

### Static assets

- **[ui-3]** THE service SHALL serve `GET /assets/web/<path>` from
  `<repo>/projects/web/src/` and `GET /assets/conductor/<path>` from
  `<repo>/projects/conductor/src/ui/`, with content types for `.css`, `.js`,
  and `.html` only; IF the path has any other extension, contains `..` or
  `\`, escapes the root, or matches no asset root, THEN THE service SHALL
  respond 404 `{"error": "not found"}`.

### Main page behavior

- **[ui-4]** WHEN the main page loads, THE browser script SHALL fetch
  `GET /api/services` and render one table row per service with: name; a
  health badge (`Healthy` / `Unhealthy` / `Unknown`) plus the `last_error`
  text when present; `last_checked_at` as a locale timestamp (`—` when null);
  uptime as `<n>s` with one decimal (`—` when absent); the `warning` text
  (`—` when absent); a `Logs` link to `/services/<name>/logs`; and, when
  `home_url` is present, a `Home` link opening in a new tab.
- **[ui-5]** WHEN rendering a `home_url` whose hostname is `0.0.0.0`, THE
  browser script SHALL replace the hostname with the page's own hostname.
- **[ui-6]** WHEN a Start, Stop, or Restart button is clicked, THE browser
  script SHALL `POST /api/services/<name>/<action>` (service name
  URL-encoded) and on success re-fetch and re-render the service list; IF the
  response is non-2xx, THEN it SHALL show
  `<action> failed for <name>: <error from the body, or "Request failed
  (<status>)">` in the status line without reloading.

### Logs page behavior

- **[ui-7]** WHEN the logs page loads, THE browser script SHALL fetch
  `GET /api/services/<name>/logs` and populate a file selector
  (`<path> (<size> bytes)` per option); IF the listing is empty, THEN it
  SHALL show `No log files are available for this service yet.` and hide the
  controls.
- **[ui-8]** WHEN a file is selected (including the initial automatic
  selection of the first file), THE browser script SHALL open a WebSocket to
  `/api/services/<name>/logs/stream` and send
  `{"type": "open", "file": <path>, "tail_bytes": 65536}` followed by the
  current follow state — file paths travel only in WebSocket messages, never
  in URLs.
- **[ui-9]** WHILE the follow checkbox is on (the default), THE browser
  script SHALL send `{"type": "follow", "enabled": true}` and append incoming
  `append` text to the view, keeping it scrolled to the bottom; toggling
  sends the new state.
- **[ui-10]** WHEN the log view is scrolled to the top and earlier bytes
  exist, THE browser script SHALL send `{"type": "read_before", "before":
  <earliest received offset>, "max_bytes": 65536}` (one outstanding request
  at a time) and prepend the returned chunk while preserving the reader's
  scroll position.
- **[ui-11]** IF a stream `error` message arrives (e.g. truncation) or a
  frame is malformed, THEN THE browser script SHALL display the message and
  reveal a `Reopen file` button that reopens the selected file with a fresh
  WebSocket.

## Contracts

The HTTP surfaces are fully described by the requirements above; JSON shapes
they consume are owned by [service-management](service-management.md) and
[log-access](log-access.md).

Pinned asset paths (exported as constants and asserted by tests):

| Asset | URL |
|---|---|
| Shared stylesheet | `/assets/web/sheaf.css` |
| Main page script | `/assets/conductor/main.js` |
| Logs page script | `/assets/conductor/logs.js` |

| Condition | Status | Body |
|---|---|---|
| Logs page for unknown service | 404 | `{"error": "service not found"}` |
| Asset missing, disallowed extension, traversal, or unknown root | 404 | `{"error": "not found"}` |

## Design

- `src/ui.ts` — `renderMainPageHtml` / `renderLogsPageHtml` build the page
  shells (shared `renderPageShell`, `escapeHtml`); no templating engine.
- `src/ui_helpers.ts` — `matchLogsPagePath` (`/services/<name>/logs`, name
  URL-decoded), `buildConductorStaticRoots` (the two asset roots),
  `resolveBrowserHomeUrl` (the `0.0.0.0` hostname rewrite, also exported for
  tests; the browser copy lives in `main.js`), and the `x_*AssetPath`
  constants.
- `src/static.ts` — extension allow-list (`.css`, `.js`, `.html`), traversal
  rejection, containment check per asset root; first matching root wins.
- `src/ui/main.js` — service table rendering, lifecycle button wiring,
  status-line updates; re-renders the whole table after each successful
  action. No periodic auto-refresh.
- `src/ui/logs.js` — WebSocket client: tail/append/scrollback state
  (`earliestStart`, `readBeforePending`, `suppressScrollLoad`), follow
  toggle, reopen-on-error.
- Tests: `tests/ui.test.ts` (HTML shape, asset resolution, regex pins on the
  browser scripts' API usage), `tests/ui_integration.test.ts` (real server:
  pages, assets, listing + WebSocket round trip, empty state, 404s).

## Interactions

- [service-management](service-management.md) — data source
  (`GET /api/services`) and action target (start/stop/restart); stopping
  `conductor` from its own UI kills the page's backend after the response.
- [log-access](log-access.md) — file listing and the streaming protocol the
  logs page speaks.
- Shared stylesheet ownership: `projects/web` (see
  [projects/web/docs](../../../web/docs/README.md)); conductor only serves
  the file.
