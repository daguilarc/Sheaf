## Why

The Conductor web UI currently only reflects service health after manual refreshes or the normal 30-second health poll cycle, which makes start/stop/restart and crash feedback feel laggy during active monitoring. When an operator is actively focused on the page, Conductor should trade a small amount of local polling work for near-immediate service status updates.

## What Changes

- Add a focused-web-UI heartbeat mode for Conductor that polls registered service health every 1 second while at least one main-page browser client is visible and focused.
- Add a short-lived foreground lease/renewal mechanism so fast polling automatically falls back to the normal 30-second cadence if the browser tab closes, loses focus, becomes hidden, or stops renewing.
- Update the main Conductor page script to enter foreground heartbeat mode only while the page is visible and focused, refresh the service table at the same 1-second cadence, and refresh immediately when focus/visibility returns.
- Preserve the existing 30-second background health polling behavior when no focused UI is present.
- Avoid changing lifecycle action semantics, log streaming behavior, or the shape of service health JSON returned by existing endpoints.

## Capabilities

### New Capabilities

### Modified Capabilities
- `conductor-service-management`: add focused foreground health polling semantics and the REST surface/methods needed for the web UI to request them.
- `conductor-web-ui`: add visible/focused main-page behavior that requests foreground heartbeat polling and refreshes displayed service state.

## Impact

- Affected code: `projects/conductor/src/health_poller.ts`, `projects/conductor/src/server.ts`, `projects/conductor/src/ui/main.js`, and related Conductor tests.
- Affected APIs: add a Conductor-local REST endpoint for focused UI heartbeat lease renewal/release; existing `/api/services` and heartbeat response shapes remain compatible.
- Affected tests/docs: extend Conductor service-management and web-UI specs, add/update unit tests around adaptive poll scheduling and browser script behavior, and update coverage docs if present.
- Dependencies: no new runtime dependency expected.
