## ADDED Requirements

### Requirement: svc-23 — Health polling: focused foreground cadence
WHILE at least one foreground heartbeat lease is active, THE health poller SHALL run a full poll cycle every 1 second (default `foregroundPollIntervalMs` 1000) instead of waiting for the normal background interval; when no foreground lease is active, it SHALL preserve the normal 30-second background cadence from svc-7.

#### Scenario: Foreground lease activates fast polling
- **WHEN** a foreground heartbeat lease becomes active
- **THEN** the health poller runs service health poll cycles every 1 second using the same health classification rules as background polling

#### Scenario: No active foreground lease
- **WHEN** no foreground heartbeat lease is active
- **THEN** the health poller uses the normal 30-second background cadence

#### Scenario: Slow poll cycle overlaps next foreground tick
- **WHEN** a foreground poll tick arrives while the previous poll cycle is still running
- **THEN** the health poller skips the overlapping tick rather than queueing another poll cycle

### Requirement: svc-24 — REST surface: foreground heartbeat lease
WHEN the service receives `POST /api/health/foreground-lease` with JSON body `{ "client_id": <non-empty string>, "active": true }`, THE service SHALL renew that client's foreground heartbeat lease for a short expiry window (default `foregroundLeaseTtlMs` 3000), ensure focused foreground polling is scheduled, and respond 200 with `{ "foreground_polling": true, "poll_interval_ms": 1000, "expires_at": <ISO-8601 timestamp> }`.

#### Scenario: Lease renewed
- **WHEN** `POST /api/health/foreground-lease` receives a non-empty `client_id` with `active: true`
- **THEN** the service renews that client's foreground heartbeat lease and responds with the active foreground polling status, poll interval, and lease expiry timestamp

#### Scenario: Lease released
- **WHEN** `POST /api/health/foreground-lease` receives a non-empty `client_id` with `active: false`
- **THEN** the service releases that client's foreground heartbeat lease and responds 200 with `{ "foreground_polling": <whether any other foreground lease remains active>, "poll_interval_ms": 1000 }`

#### Scenario: Lease request invalid
- **WHEN** `POST /api/health/foreground-lease` receives a missing or invalid JSON body, an empty `client_id`, or an `active` value that is not boolean
- **THEN** the service responds 400 `{"error": "invalid foreground heartbeat lease"}`

#### Scenario: Lease expires
- **WHEN** a foreground heartbeat lease is not renewed before its expiry window elapses
- **THEN** the service treats that lease as inactive without requiring an explicit release request

#### Scenario: Foreground lease remains observational
- **WHEN** a foreground heartbeat lease is renewed or released
- **THEN** the service adjusts only health polling cadence and does not start, stop, restart, or synchronously probe any service for that request
