# Spec Coverage

Last audit: living-spec migration (one-time rewrite from code), 2026-06-10

| Capability | Status | Gaps |
|---|---|---|
| service-management | partial | no double-start guard, restart race, owned-process map volatility, poll overlap |
| log-access | partial | UTF-8 boundary behavior, WS close codes, no keepalive |
| web-ui | partial | browser-script behavior pinned by source regex only, no auto-refresh spec |

## Known gaps

### service-management

- Start performs no already-running check: starting a running service spawns
  a second process. Intentional minimalism, but the resulting behavior
  (duplicate processes, both appending to the same logs) is unspecified.
- Restart does not wait for the stopped process to exit before starting; the
  old and new process can briefly coexist and race on ports. Unspecified.
- The owned-process map (svc-19's kill fallback) is in-memory only; after a
  conductor restart, services that ignore `/exit` can no longer be stopped
  through conductor. Unspecified beyond the requirement wording.
- Started children are detached and never reaped/await-ed; conductor has no
  notion of "running" beyond heartbeats. Exit of a started child is invisible
  until the next failed poll.
- Poll cycles are fired on a fixed interval without overlap protection; a
  cycle slower than 30 s can overlap the next (per-service requests do have
  5 s timeouts, which bounds this in practice). Unspecified.
- `HealthPoller`/`LifecycleManager` tunables (`pollIntervalMs`,
  `requestTimeoutMs`, `exitRequestTimeoutMs`) are constructor options with no
  config-file surface; only the defaults are normative.
- The `warning` field of conductor's own `/health` (svc-5) is plumbed but has
  no production writer; degraded-self reporting is unimplemented.
- JSON type strictness of registry values beyond the validated checks (e.g.
  fractional `port` is rejected, but no range check) is unspecified.

### log-access

- `text` is a UTF-8 decode of an arbitrary byte range; chunk boundaries can
  split multibyte characters and produce replacement characters at the seams.
  Unspecified and unhandled.
- WebSocket close codes, ping/keepalive, and behavior on slow consumers are
  unspecified (`ws` defaults, untested).
- A `read_before`/`open` read error other than during follow (e.g. file
  deleted between validation and read) surfaces as an unhandled rejection
  rather than an `error` message. Unspecified.
- The listing endpoint has no pagination or size cap; behavior on very large
  log trees is unspecified.

### web-ui

- Browser-script behavior (ui-4 … ui-11) is tested only by regexes over the
  source files plus one end-to-end WebSocket round trip; no DOM-level tests
  pin the rendering, so visual/markup specifics beyond the listed elements
  are non-normative.
- The main page has no periodic auto-refresh; heartbeat data goes stale until
  the user acts or reloads. Intentional, but the refresh policy is
  unspecified.
- Error handling in `main.js`/`logs.js` for fetch-level network failures
  (promise rejections, as opposed to non-2xx responses) is unspecified.

## Observed code/spec mismatches (candidate fixes, not spec gaps)

- `handleRequest` in `src/server.ts` is invoked as `void handleRequest(...)`
  with no top-level catch: any thrown filesystem error — e.g.
  `GET /assets/web/<file that resolves but does not exist>` (ENOENT from
  `readFile`) or a stat failure during log listing — becomes an unhandled
  promise rejection, which terminates the Node process by default. A request
  should not be able to crash the service manager.
- `tests/scaffold.test.ts` hard-pins the full `conductor` registry entry
  (including `command` and `home_path`), so any registry edit to that entry
  fails the suite even when behavior is unchanged.
- `spawnCommand` accepts separate `cwd` and `repoRoot` parameters but
  `createProcessRunner` always passes the same value for both; the log-file
  location therefore tracks the working directory, not an independent repo
  root.
