## ADDED Requirements

### Requirement: svc-15 — Standard service endpoints: POST /exit shutdown

WHEN the service receives `POST /exit`, THE service SHALL respond 200 with `{"exiting": true}`, flush that response before starting shutdown, then stop accepting new work, close the HTTP server, close the chat and Agent Review WebSocket servers, dispose server registries and Agent Review resources, and let the production process exit with code 0. WHILE shutdown is in progress, THE service SHALL reject WebSocket upgrades with HTTP 404 and answer non-exit HTTP requests with the standard 404 REST error body. Repeated shutdown requests SHALL be idempotent.

#### Scenario: Exit request received

- **WHEN** the service receives `POST /exit`
- **THEN** it responds 200 with `{"exiting": true}`
- **AND** after that response is flushed, it closes the HTTP server, chat WebSocket server, Agent Review WebSocket server, registries, and Agent Review resources
- **AND** the production process exits with code 0

#### Scenario: Repeated exit request

- **WHEN** `POST /exit` is received while shutdown is already in progress and the HTTP server can still respond
- **THEN** the service responds 200 with `{"exiting": true}`
- **AND** it does not run cleanup more than once

#### Scenario: Request during shutdown

- **WHEN** shutdown is in progress and a non-exit HTTP request arrives before the HTTP server closes
- **THEN** the service responds 404 with the standard REST error body

#### Scenario: WebSocket upgrade during shutdown

- **WHEN** shutdown is in progress and a WebSocket upgrade request arrives before the HTTP server closes
- **THEN** the service rejects the upgrade with HTTP 404

#### Scenario: Non-POST method on /exit

- **WHEN** a request with any method other than POST is received for `/exit`
- **THEN** the service returns 405 with the standard REST error body
