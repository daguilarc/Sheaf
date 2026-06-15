## ADDED Requirements

### Requirement: arm-22 — Lifecycle: Deterministic teardown drains in-flight work

WHEN an Agent Review service instance is disposed or its connection/workspace is closed, THE service SHALL stop accepting new Launchpad cell-press events, inbound WebSocket messages, and Dictator RPC callbacks, SHALL await or cancel all in-flight command, refresh, git, and Dictator RPC work it started, and SHALL NOT produce any asynchronous activity (including unhandled promise rejections) after teardown has resolved. Errors from in-flight work SHALL be observed by the teardown drain rather than escaping as unhandled rejections, and teardown SHALL NOT swallow such errors silently.

#### Scenario: Cell press in flight during dispose

- **WHEN** a Launchpad cell press has started command/git work and the service is disposed before that work completes
- **THEN** dispose awaits (or cancels) the in-flight work before resolving
- **AND** no git or Dictator RPC activity runs after dispose resolves
- **AND** no unhandled promise rejection is emitted

#### Scenario: New events after teardown begins are ignored

- **WHEN** the service has begun teardown and a new cell press, inbound message, or Dictator RPC callback arrives
- **THEN** the service ignores it without starting new command, git, or RPC work

#### Scenario: Dictator RPC closes with pending calls

- **WHEN** the Dictator RPC socket closes while the service has pending RPC calls
- **THEN** each pending call's rejection is observed by the service's lifecycle handling
- **AND** no unhandled promise rejection escapes from a fire-and-forget RPC callsite

#### Scenario: Teardown completes before resource removal

- **WHEN** a caller closes the service and then removes the underlying workspace/repository
- **THEN** the close completes only after all in-flight git and RPC work has settled, so later removal cannot race in-flight work
