## ADDED Requirements

### Requirement: svc-16 — Logging: handled server errors

WHEN the Sheaf Chat service handles a REST or WebSocket error case that is returned to a client without crashing the process, THE service SHALL emit a single-line server log entry to stderr containing a stable event name, severity, feature area, client correlation identifier when available, error code when available, and error message.

#### Scenario: REST route error is logged

- **WHEN** a REST route returns a handled server error through the standard error envelope
- **THEN** the service emits one stderr log entry for that handled error
- **AND** the log entry includes the error code and message returned to the client

#### Scenario: WebSocket handled error is logged

- **WHEN** a WebSocket handler returns a handled error frame or command-result failure to a client
- **THEN** the service emits one stderr log entry for that handled error
- **AND** the log entry includes a request id or command id when the client frame supplied one

#### Scenario: Sensitive content is excluded

- **WHEN** the service logs a handled error
- **THEN** the log entry excludes secrets, authorization tokens, chat message text, hunk patch bodies, full file contents, and request bodies

#### Scenario: Client response contract unchanged

- **WHEN** the service logs a handled error
- **THEN** the REST response body or WebSocket frame sent to the client remains unchanged except for timing effects inherent to logging
