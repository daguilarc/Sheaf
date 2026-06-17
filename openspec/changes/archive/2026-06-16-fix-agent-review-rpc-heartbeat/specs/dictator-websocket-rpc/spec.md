## ADDED Requirements

### Requirement: rpc-8 — Liveness: Ping request
WHEN a connected WebSocket RPC client sends a `rpc.ping` request envelope, THE Dictator service SHALL refresh that client's heartbeat liveness and respond with a successful result without changing Launchpad cell ownership, pushed dictation context, or cursor state.

#### Scenario: Ping succeeds
- **WHEN** a connected client sends `{"id":"ping","method":"rpc.ping"}`
- **THEN** Dictator responds with a result for id `ping`
- **AND** the client's heartbeat liveness is renewed

#### Scenario: Ping has no side effects
- **WHEN** a client that owns Launchpad cells and pushed dictation context sends `rpc.ping`
- **THEN** Dictator preserves that client's Launchpad cell ownership
- **AND** preserves that client's pushed dictation context
- **AND** does not insert text or dispatch Launchpad actions
