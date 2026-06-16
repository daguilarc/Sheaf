## 1. Health Poller

- [x] 1.1 Add foreground heartbeat lease state to `HealthPoller`, including client lease renewal, explicit release, expiry pruning, and active-lease detection.
- [x] 1.2 Replace the fixed recurring timer scheduling with adaptive scheduling that runs immediately on start, uses the 30-second background cadence by default, switches to the 1-second foreground cadence while any lease is active, and skips overlapping poll cycles.
- [x] 1.3 Keep timer, timeout, and clock behavior injectable so foreground cadence, expiry, and overlap handling can be tested deterministically.

## 2. REST Surface

- [x] 2.1 Add `POST /api/health/foreground-lease` routing in `projects/conductor/src/server.ts`.
- [x] 2.2 Validate request bodies for non-empty `client_id` and boolean `active`, returning 400 `{"error": "invalid foreground heartbeat lease"}` for invalid requests.
- [x] 2.3 Wire valid lease renew/release requests to the health poller and return the foreground polling status, poll interval, and expiry fields defined by the spec.
- [x] 2.4 Ensure foreground lease requests remain observational and do not perform lifecycle actions or synchronous per-request health probes.

## 3. Main Web UI

- [x] 3.1 Add a stable per-page foreground lease id in `projects/conductor/src/ui/main.js`.
- [x] 3.2 Track `document.visibilityState`, window `focus`, and window `blur` to start fast refresh only while the main page is visible and focused.
- [x] 3.3 Renew the foreground heartbeat lease and fetch `GET /api/services` immediately on focus/visibility return, then every 1 second while focused.
- [x] 3.4 Stop the foreground refresh loop and release or allow expiry of the lease when the page hides, blurs, or unloads.
- [x] 3.5 Keep the last rendered service table visible when lease renewal fails, retrying renewal on the next foreground tick.

## 4. Tests And Docs

- [x] 4.1 Extend `projects/conductor/tests/health.test.ts` or add focused tests for adaptive cadence, lease expiry, release, and skipped overlapping poll cycles.
- [x] 4.2 Extend Conductor server tests to cover valid/invalid `POST /api/health/foreground-lease` requests and response shapes.
- [x] 4.3 Extend UI tests that pin `main.js` API usage to cover focused lease renewal, release/expiry behavior, and once-per-second service refresh.
- [x] 4.4 Update Conductor coverage documentation if this repo tracks spec-to-test coverage for the affected requirements.
- [x] 4.5 Run the relevant Conductor test suite and `openspec status --change conductor-focused-heartbeats` before applying or merging.
