## ADDED Requirements

### Requirement: arm-26 — Dictator bridge: RPC heartbeat and stale-session recovery
WHILE Agent Review Mode has an active Dictator WebSocket RPC client, THE Sheaf Chat service SHALL keep the Dictator RPC session live by sending periodic heartbeat requests below Dictator's configured heartbeat timeout; IF Dictator reports that the current RPC client session is no longer recognized while Sheaf Chat is updating Agent Review Launchpad cells, THEN THE service SHALL reconnect the Dictator RPC client and retry the cell update once so the owned cells are repainted without requiring a browser refresh.

#### Scenario: Quiet review session remains live
- **WHEN** Agent Review Mode is active, Dictator is reachable, and no hunk navigation, mutation, review insertion, or context push/pop occurs for longer than Dictator's heartbeat timeout
- **THEN** Sheaf Chat sends heartbeat requests that keep Dictator from expiring the Agent Review RPC session
- **AND** Dictator keeps Sheaf Chat's Launchpad cell ownership intact

#### Scenario: Stale session is repainted
- **WHEN** Dictator has expired Sheaf Chat's RPC client session while the Agent Review browser session remains active
- **AND** Sheaf Chat attempts to update Agent Review Launchpad cell colors
- **THEN** Sheaf Chat reconnects the Dictator RPC client
- **AND** retries the cell update once with the current Agent Review state

#### Scenario: Reconnect failure preserves browser review mode
- **WHEN** Sheaf Chat attempts stale-session recovery and Dictator is unavailable
- **THEN** Agent Review Mode remains usable from the browser UI
- **AND** Sheaf Chat reports the Dictator bridge as disconnected or errored without clearing the active review draft

#### Scenario: Focus gating still applies
- **WHEN** no attached Agent Review browser client is focused
- **THEN** Sheaf Chat keeps its owned Launchpad cells off even while heartbeat requests keep the Dictator RPC session live
