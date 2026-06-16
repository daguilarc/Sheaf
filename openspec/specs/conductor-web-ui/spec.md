# Capability: Web UI

Project: `projects/conductor`
ID prefix: `ui` — requirement IDs are append-only; never renumber or reuse.

## Purpose

The browser interface served by conductor itself: a main page listing every
registered service with health, links, and Start/Stop/Restart controls, and a
per-service log viewer page that streams file contents over the
[log-access](../conductor-log-access/spec.md) WebSocket. Pages are server-rendered HTML shells;
behavior lives in two plain-JS browser scripts served as static assets along
with the shared stylesheet from `projects/web`.

## Requirements

### Requirement: ui-1 — Pages: main page response
THE service SHALL respond to `GET /` with 200 and an HTML page titled `Conductor` that links the shared stylesheet `/assets/web/sheaf.css`, loads the script `/assets/conductor/main.js`, and contains the service table skeleton (`id="services-table"`).

#### Scenario: Main page served
- **WHEN** a request is made to `GET /`
- **THEN** the service responds with 200 and an HTML page titled `Conductor` that links `/assets/web/sheaf.css`, loads `/assets/conductor/main.js`, and contains an element with `id="services-table"`

### Requirement: ui-2 — Pages: logs page response
THE service SHALL respond to `GET /services/<name>/logs` for a registered service with 200 and an HTML page titled `Logs: <name>` that links the shared stylesheet, loads `/assets/conductor/logs.js`, embeds the service name as JSON in a `<script type="application/json">` element (HTML-escaped), and contains no log file paths; unknown services get 404 `{"error": "service not found"}`.

#### Scenario: Logs page for registered service
- **WHEN** a request is made to `GET /services/<name>/logs` for a registered service
- **THEN** the service responds with 200 and an HTML page titled `Logs: <name>` that links the shared stylesheet, loads `/assets/conductor/logs.js`, embeds the service name as JSON in a `<script type="application/json">` element (HTML-escaped), and contains no log file paths

#### Scenario: Logs page for unknown service
- **WHEN** a request is made to `GET /services/<name>/logs` for an unknown service
- **THEN** the service responds with 404 `{"error": "service not found"}`

### Requirement: ui-3 — Static assets: serving and validation
THE service SHALL serve `GET /assets/web/<path>` from `<repo>/projects/web/src/` and `GET /assets/conductor/<path>` from `<repo>/projects/conductor/src/ui/`, with content types for `.css`, `.js`, and `.html` only; IF the path has any other extension, contains `..` or `\`, escapes the root, or matches no asset root, THEN THE service SHALL respond 404 `{"error": "not found"}`.

#### Scenario: Valid asset request
- **WHEN** a request is made to `GET /assets/web/<path>` or `GET /assets/conductor/<path>` with a `.css`, `.js`, or `.html` extension that maps to an existing file within the asset root
- **THEN** the service serves the file with the appropriate content type

#### Scenario: Invalid extension, traversal, or missing asset
- **WHEN** the requested path has an extension other than `.css`, `.js`, or `.html`; or contains `..` or `\`; or escapes the root; or matches no asset root
- **THEN** the service responds 404 `{"error": "not found"}`

### Requirement: ui-4 — Main page behavior: service table rendering
WHEN the main page loads, THE browser script SHALL fetch `GET /api/services` and render one table row per service with: name; a health badge (`Healthy` / `Unhealthy` / `Unknown`) plus the `last_error` text when present; `last_checked_at` as a locale timestamp (`—` when null); uptime as `<n>s` with one decimal (`—` when absent); the `warning` text (`—` when absent); a `Logs` link to `/services/<name>/logs`; and, when `home_url` is present, a `Home` link opening in a new tab.

#### Scenario: Main page loads
- **WHEN** the main page loads
- **THEN** the browser script fetches `GET /api/services` and renders one table row per service with name, health badge, `last_error` text when present, `last_checked_at` as a locale timestamp (`—` when null), uptime as `<n>s` with one decimal (`—` when absent), `warning` text (`—` when absent), a `Logs` link, and a `Home` link opening in a new tab when `home_url` is present

### Requirement: ui-5 — Main page behavior: home_url hostname rewrite
WHEN rendering a `home_url` whose hostname is `0.0.0.0`, THE browser script SHALL replace the hostname with the page's own hostname.

#### Scenario: home_url with 0.0.0.0 hostname
- **WHEN** the browser script renders a `home_url` whose hostname is `0.0.0.0`
- **THEN** the hostname is replaced with the page's own hostname

### Requirement: ui-6 — Main page behavior: lifecycle button actions
WHEN a Start, Stop, or Restart button is clicked, THE browser script SHALL `POST /api/services/<name>/<action>` (service name URL-encoded) and on success re-fetch and re-render the service list; IF the response is non-2xx, THEN it SHALL show `<action> failed for <name>: <error from the body, or "Request failed (<status>)">` in the status line without reloading.

#### Scenario: Lifecycle button clicked — success
- **WHEN** a Start, Stop, or Restart button is clicked and the response is 2xx
- **THEN** the browser script POSTs to `/api/services/<name>/<action>` (service name URL-encoded) and re-fetches and re-renders the service list

#### Scenario: Lifecycle button clicked — failure
- **WHEN** a Start, Stop, or Restart button is clicked and the response is non-2xx
- **THEN** the browser script shows `<action> failed for <name>: <error from the body, or "Request failed (<status>)">` in the status line without reloading

### Requirement: ui-7 — Logs page behavior: file listing
WHEN the logs page loads, THE browser script SHALL fetch `GET /api/services/<name>/logs` and populate a file selector (`<path> (<size> bytes)` per option); IF the listing is empty, THEN it SHALL show `No log files are available for this service yet.` and hide the controls.

#### Scenario: Logs page loads with files
- **WHEN** the logs page loads and the file listing is non-empty
- **THEN** the browser script fetches `GET /api/services/<name>/logs` and populates a file selector with `<path> (<size> bytes)` per option

#### Scenario: Logs page loads with empty listing
- **WHEN** the logs page loads and the file listing is empty
- **THEN** the browser script shows `No log files are available for this service yet.` and hides the controls

### Requirement: ui-8 — Logs page behavior: WebSocket stream open
WHEN a file is selected (including the initial automatic selection of the first file), THE browser script SHALL open a WebSocket to `/api/services/<name>/logs/stream` and send `{"type": "open", "file": <path>, "tail_bytes": 65536}` followed by the current follow state — file paths travel only in WebSocket messages, never in URLs.

#### Scenario: File selected
- **WHEN** a file is selected (including the initial automatic selection of the first file)
- **THEN** the browser script opens a WebSocket to `/api/services/<name>/logs/stream` and sends `{"type": "open", "file": <path>, "tail_bytes": 65536}` followed by the current follow state, with file paths only in WebSocket messages and never in URLs

### Requirement: ui-9 — Logs page behavior: follow mode
WHILE the follow checkbox is on (the default), THE browser script SHALL send `{"type": "follow", "enabled": true}` and append incoming `append` text to the view, keeping it scrolled to the bottom; toggling sends the new state.

#### Scenario: Follow mode on
- **WHEN** the follow checkbox is on
- **THEN** the browser script sends `{"type": "follow", "enabled": true}`, appends incoming `append` text to the view, and keeps it scrolled to the bottom

#### Scenario: Follow toggled
- **WHEN** the follow checkbox is toggled
- **THEN** the browser script sends the new follow state

### Requirement: ui-10 — Logs page behavior: scrollback
WHEN the log view is scrolled to the top and earlier bytes exist, THE browser script SHALL send `{"type": "read_before", "before": <earliest received offset>, "max_bytes": 65536}` (one outstanding request at a time) and prepend the returned chunk while preserving the reader's scroll position.

#### Scenario: Scrolled to top with earlier bytes
- **WHEN** the log view is scrolled to the top and earlier bytes exist
- **THEN** the browser script sends `{"type": "read_before", "before": <earliest received offset>, "max_bytes": 65536}` (one outstanding request at a time) and prepends the returned chunk while preserving the reader's scroll position

### Requirement: ui-11 — Logs page behavior: stream error handling
IF a stream `error` message arrives (e.g. truncation) or a frame is malformed, THEN THE browser script SHALL display the message and reveal a `Reopen file` button that reopens the selected file with a fresh WebSocket.

#### Scenario: Stream error or malformed frame
- **WHEN** a stream `error` message arrives or a frame is malformed
- **THEN** the browser script displays the message and reveals a `Reopen file` button that reopens the selected file with a fresh WebSocket

### Requirement: ui-12 — Main page behavior: focused heartbeat refresh
WHILE the main page document is visible and the browser window is focused, THE browser script SHALL renew a foreground heartbeat lease at least once per second, fetch `GET /api/services` at least once per second, and re-render the service table from the returned heartbeat state.

#### Scenario: Main page visible and focused
- **WHEN** the main page document is visible and the browser window is focused
- **THEN** the browser script renews a foreground heartbeat lease at least once per second and refreshes the service table from `GET /api/services` at least once per second

#### Scenario: Main page regains visibility or focus
- **WHEN** the main page becomes visible or the browser window regains focus
- **THEN** the browser script immediately renews the foreground heartbeat lease and refreshes the service table

#### Scenario: Main page hidden or blurred
- **WHEN** the main page document becomes hidden or the browser window loses focus
- **THEN** the browser script stops the once-per-second refresh loop and releases or allows expiry of its foreground heartbeat lease

#### Scenario: Foreground lease renewal fails
- **WHEN** renewing the foreground heartbeat lease fails while the page remains visible and focused
- **THEN** the browser script continues refreshing `GET /api/services` on the foreground cadence and retries lease renewal on the next foreground tick without replacing the last rendered service table with an empty state

## Contracts

The HTTP surfaces are fully described by the requirements above; JSON shapes
they consume are owned by [service-management](../conductor-service-management/spec.md) and
[log-access](../conductor-log-access/spec.md).

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
  action. While the page is visible and focused, it renews a foreground
  heartbeat lease and refreshes `GET /api/services` once per second; blur,
  hide, and pagehide stop the loop and release or allow expiry of the lease.
- `src/ui/logs.js` — WebSocket client: tail/append/scrollback state
  (`earliestStart`, `readBeforePending`, `suppressScrollLoad`), follow
  toggle, reopen-on-error.
- Tests: `tests/ui.test.ts` (HTML shape, asset resolution, regex pins on the
  browser scripts' API usage), `tests/ui_integration.test.ts` (real server:
  pages, assets, listing + WebSocket round trip, empty state, 404s).

## Interactions

- [service-management](../conductor-service-management/spec.md) — data source
  (`GET /api/services`), foreground heartbeat lease target
  (`POST /api/health/foreground-lease`), and action target
  (start/stop/restart); stopping `conductor` from its own UI kills the page's
  backend after the response.
- [log-access](../conductor-log-access/spec.md) — file listing and the streaming protocol the
  logs page speaks.
- Shared stylesheet ownership: `projects/web` (see
  [projects/web/docs](../../../projects/web/docs/README.md)); conductor only serves
  the file.
