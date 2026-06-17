## Context

Sheaf Chat Agent Review Mode owns Launchpad review controls by connecting to Dictator's generic `/ws/rpc` endpoint and sending `launchpad.setCells` updates. Dictator tracks each RPC connection as a client session and releases that session's owned cells and pushed context when the connection closes or exceeds the configured heartbeat timeout.

The current Sheaf Chat RPC client sends requests only when Agent Review state changes, a review is inserted, or hunk dictation context is pushed/popped. During a quiet review period, no request may cross the Sheaf Chat-to-Dictator RPC connection for longer than Dictator's timeout. Dictator can then expire the session and clear the Launchpad cells while the WebSocket remains open from Sheaf Chat's point of view. Later `launchpad.setCells` calls on that stale connection fail with a session error and are currently swallowed by the cell-update path, leaving the lights dark until the browser creates a fresh Agent Review session.

## Goals / Non-Goals

**Goals:**

- Keep Sheaf Chat's Dictator RPC session live for as long as an Agent Review session owns Launchpad cells or pushed context.
- Recover from stale Dictator RPC sessions without requiring a browser refresh.
- Preserve existing Agent Review state, browser WebSocket contracts, Launchpad coordinates, colors, and focus gating.
- Add tests that reproduce the quiet-session expiry path and verify repaint after recovery.
- Document Dictator's `rpc.ping` request as the protocol heartbeat mechanism.

**Non-Goals:**

- No change to Dictator's 30-second default heartbeat timeout.
- No server-push heartbeat from Dictator to clients.
- No durable Agent Review draft storage or browser session persistence changes.
- No change to cell ownership conflict semantics or multi-client ownership rules.

## Decisions

### Sheaf Chat sends periodic `rpc.ping`

The Sheaf Chat `DictatorRPCClient` should start a keepalive loop after the RPC socket opens and stop it when the socket closes or the client disconnects. The loop sends `rpc.ping` at an interval comfortably below Dictator's heartbeat timeout. A fixed client-side interval such as 10 seconds is sufficient because the current Dictator timeout is 30 seconds and the protocol already exposes `rpc.ping`.

Alternative considered: resend `launchpad.setCells` periodically. That would also touch the Dictator session, but it conflates liveness with rendering, creates unnecessary Launchpad invalidations, and can obscure real cell-state changes in tests and logs.

### Heartbeat failures mark the RPC stale and trigger reconnect on useful work

If `rpc.ping` fails because the socket closes, the client should mark the Dictator RPC connection disconnected using the existing status path. If `rpc.ping` or `launchpad.setCells` receives a stale-session error such as `client session not found`, the client should close the current socket and clear pending requests so the next RPC call opens a new Dictator session.

Alternative considered: immediately reconnect from the ping timer. Reconnecting only when there is active useful work avoids a background reconnect loop when Dictator is down, while the active Agent Review session's next cell update, focus update, or explicit repaint can restore ownership.

### Cell updates retry once after stale-session recovery

`UpdateDictatorCells` should not silently abandon a stale-session `launchpad.setCells` failure. When the failure indicates that Dictator no longer recognizes the current session, Sheaf Chat should reconnect and retry the same cell update once. A single retry avoids infinite loops while restoring the common expired-session case.

Alternative considered: log and wait for the next normal state change. That still leaves the hardware dark until the user does something unrelated, which is the current user-visible failure.

### Dictator keeps current heartbeat behavior, but the contract names `rpc.ping`

Dictator already supports `rpc.ping` and refreshes liveness when handling any valid request. The spec should make `rpc.ping` normative so clients have a documented request that has no side effect other than keeping the connection live and returning `{ok: true}`.

Alternative considered: use WebSocket ping frames. Dictator replies to WebSocket ping frames at the WebSocket layer, but the current session liveness tracking is updated by RPC request handling. A JSON-RPC `rpc.ping` matches the existing timeout model without changing SwiftNIO frame handling.

## Risks / Trade-offs

- [Keepalive interval too close to timeout] -> Use an interval well below the default timeout and keep it independent from UI focus events.
- [Background pings hide Dictator outages] -> Surface heartbeat failures through existing Dictator bridge status and avoid swallowing stale-session failures in cell updates.
- [Reconnect races with in-flight calls] -> Reuse the existing pending-request rejection path when closing a stale socket, and retry only idempotent cell repaint operations.
- [Tests become timing-dependent] -> Use fake timers or a fake Dictator that explicitly expires sessions on demand rather than waiting for wall-clock time.

## Migration Plan

1. Add `rpc.ping` support to the Sheaf Chat `DictatorRPCClient` and start/stop a keepalive timer with the socket lifecycle.
2. Add stale-session detection in the client or cell-update path, close the stale socket, reconnect, and retry `launchpad.setCells` once.
3. Add Sheaf Chat regression tests for a quiet Agent Review session that remains owned via pings and for stale-session repaint recovery after Dictator expires ownership.
4. Add or update Dictator RPC tests documenting `rpc.ping` liveness if existing coverage is insufficient.
5. Run the Sheaf Chat Agent Review tests and Dictator service tests.

Rollback is to revert the Sheaf Chat keepalive/reconnect changes and the spec deltas; no data migration is involved.

## Open Questions

- Whether Sheaf Chat should expose a configurable heartbeat interval or keep it as an internal constant. The initial implementation should prefer an internal constant unless operational evidence shows a need for configuration.
