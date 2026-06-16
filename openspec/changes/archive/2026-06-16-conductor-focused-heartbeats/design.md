## Context

Conductor currently keeps heartbeat state by polling every registered service once at startup and then every 30 seconds. The main web UI renders `GET /api/services` once on page load and after successful lifecycle actions, so active operators can wait up to a full poll interval before seeing service health changes.

The desired behavior is only useful while someone is actively watching the UI. The implementation should therefore be adaptive: fast while a browser tab is visible and focused, and back to the normal 30-second cadence otherwise.

## Goals / Non-Goals

**Goals:**
- Poll service heartbeats every 1 second while at least one main Conductor page is visible and focused.
- Refresh the main service table every 1 second while focused, with an immediate refresh when focus or visibility returns.
- Fall back automatically to the existing 30-second polling cadence if the tab closes, blurs, hides, or stops renewing.
- Preserve existing service JSON shapes and lifecycle behavior.

**Non-Goals:**
- No supervision, auto-restart, or desired-state reconciliation.
- No fast polling for logs pages; log updates already use their WebSocket stream.
- No push/SSE/WebSocket service-list transport in this change.
- No new dependencies.

## Decisions

1. Use a foreground lease endpoint rather than changing `/api/services`.

   The main page will call `POST /api/health/foreground-lease` with a stable browser-side lease id and `active: true` while it is visible and focused. The server records the lease with a short expiry and responds with the effective fast poll interval and expiry. Calling the same endpoint with `active: false` releases the lease.

   Alternatives considered:
   - Add `?refresh=true` to `/api/services`: simpler, but mixes read and scheduling side effects, and every table refresh would carry hidden server behavior.
   - Let the browser poll `/api/services` every second only: this refreshes the DOM but still shows stale 30-second heartbeat state.

2. Implement adaptive scheduling inside `HealthPoller`.

   `HealthPoller` should keep the existing background interval options and add focused-mode options such as `foregroundPollIntervalMs` (default 1000) and `foregroundLeaseTtlMs` (default around 3000). A foreground lease should trigger an immediate poll when fast mode starts, then continue at the fast cadence while any unexpired lease remains active. When all leases expire or are released, the poller returns to the normal 30-second cadence.

   Alternatives considered:
   - Run two independent timers: easy to add but risks overlapping cycles and duplicate probes.
   - Recreate the poller when focus changes: heavier and makes cleanup harder.

3. Skip overlapping poll cycles.

   Fast polling should not create a backlog if a service health endpoint is slow. The scheduler should track whether a poll cycle is in progress; if the next timer fires while polling is still active, it skips that tick and schedules the next one.

4. Keep foreground polling local and observational.

   The lease endpoint only adjusts polling cadence. It does not start, stop, restart, or perform live probes synchronously for the request. Existing service response shapes remain compatible; only a new endpoint is added.

## Risks / Trade-offs

- Increased local load while focused -> Limit fast polling to focused/visible tabs, use a short lease TTL, and skip overlapping cycles.
- A crashed or suspended tab could otherwise leave fast mode enabled -> Expire leases automatically when renewals stop.
- Multiple focused tabs may duplicate renewals -> Track leases by client id and keep fast mode enabled while at least one unexpired lease exists.
- Timer-sensitive tests can be flaky -> Keep timer/date functions injectable and assert scheduling behavior with controlled fake timers.

## Migration Plan

Implement the server changes first with unit coverage around lease expiry and adaptive scheduling, then wire the browser script to renew/release leases. Existing clients continue using `/api/services` unchanged; rollback is removing the UI lease calls and the unused endpoint while retaining the old poller cadence.

## Open Questions

- The default lease TTL should be long enough to survive brief timer jitter. This design proposes roughly 3 seconds for a 1-second renewal cadence.
