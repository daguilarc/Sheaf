## ADDED Requirements

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
