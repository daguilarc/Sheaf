## ADDED Requirements

### Requirement: svc-17 — Logging: control-surface command failures
WHEN the Sheaf Chat service handles a failed command initiated by a non-browser control surface and the failure is returned or reflected to connected clients without crashing the process, THE service SHALL emit a single-line server log entry to stderr containing a stable event name, severity, feature area, available correlation identifiers, command action when available, stale-state flag when applicable, and error message.

#### Scenario: Launchpad command failure is logged
- **WHEN** a Sheaf Chat-owned Launchpad control invokes an Agent Review command that returns a failed command result
- **THEN** the service emits one stderr log entry for that handled failure
- **AND** the log entry includes the feature area, command action, and failure message

#### Scenario: Control-surface log excludes sensitive content
- **WHEN** the service logs a handled command failure from a non-browser control surface
- **THEN** the log entry excludes secrets, authorization tokens, chat message text, hunk patch bodies, full file contents, and request bodies

#### Scenario: Client behavior unchanged
- **WHEN** the service logs a handled command failure from a non-browser control surface
- **THEN** any REST response, WebSocket frame, state refresh, or command result sent to connected clients remains unchanged except for timing effects inherent to logging
