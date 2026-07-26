## ADDED Requirements

### Requirement: xsvc-1 — Service: Conductor registration

WHERE Sheaf services are configured, THE repository SHALL register `xagent` in `config/services.json` with loopback host `127.0.0.1`, port `9005`, and command `make xagent-service-run`; THE root and project Makefiles SHALL provide that command from tracked source.

#### Scenario: Conductor discovers xagent

- **WHEN** Conductor loads the repository service registry
- **THEN** it discovers an `xagent` service at `127.0.0.1:9005`
- **AND** can start, stop, restart, health-check, and capture logs for it through the existing Conductor lifecycle

#### Scenario: Shipped listener remains local

- **WHEN** the tracked xagent service configuration is inspected
- **THEN** it binds to loopback rather than `0.0.0.0` or another LAN-reachable interface

### Requirement: xsvc-2 — Service: standard lifecycle endpoints

WHEN the xagent service is running, THE service SHALL expose cheap deterministic `GET /health` and orderly idempotent `POST /exit` endpoints compatible with the Sheaf service contract.

#### Scenario: Healthy service

- **WHEN** a client requests `GET /health`
- **THEN** the service responds 200 with `healthy: true` and numeric `uptime`
- **AND** includes a warning only when supervision is degraded

#### Scenario: Reconciliation degrades health

- **WHEN** startup reconciliation cannot cleanly terminate or account for every stale owned process (e.g. identity mismatch, unproven process group, inspection failure, termination failure, or persistence failure)
- **THEN** the service logs each reconciliation outcome to stderr for operator capture
- **AND** `GET /health` includes a bounded `warning` describing the degraded supervision state
- **AND** omits the warning when every stale run was cleaned up cleanly (`terminated` or `process_not_found`)

#### Scenario: Orderly service exit

- **WHEN** a client requests `POST /exit`
- **THEN** the service acknowledges the request before closing listeners
- **AND** closes owned provider sessions and process groups before exiting successfully

#### Scenario: Repeated service exit

- **WHEN** shutdown is already in progress and another exit request arrives
- **THEN** the service does not start a second shutdown sequence or leave additional owned processes

### Requirement: xsvc-3 — Ownership: service survives controller disconnect

WHILE a supervised run is active, THE xagent service SHALL own its supervisor, provider session, timers, durable events, and child process independently of the Codex thread, plugin connection, MCP session, and individual await request that created it.

#### Scenario: Await request is cancelled

- **WHEN** a controller cancels or disconnects an active `xagent_await` request
- **THEN** the await request ends
- **AND** the supervised worker and its timers continue in the xagent service

#### Scenario: Boss reconnects

- **WHEN** a replacement controller knows the `run_id`
- **THEN** it can inspect the persisted phase and cursor
- **AND** can await a durable completion or attention event without restarting the provider session

#### Scenario: Conductor stops xagent

- **WHEN** Conductor explicitly stops or restarts the xagent service
- **THEN** orderly service shutdown closes the provider sessions and process groups owned by active runs

#### Scenario: SIGTERM or SIGINT triggers orderly shutdown

- **WHEN** the xagent service receives `SIGTERM` (e.g. Conductor's stop fallback when `POST /exit` fails or is unresponsive) or `SIGINT` (a human Ctrl-C)
- **THEN** the service drives the same orderly shutdown as `POST /exit` (close owned provider sessions and process groups, then exit `0`)
- **AND** a repeated signal forces a non-zero exit so a wedged orderly shutdown cannot block escalation to `SIGKILL`

### Requirement: xsvc-4 — MCP: Streamable HTTP controller endpoint

WHEN the xagent service is running, THE service SHALL expose Streamable HTTP MCP at `/mcp` with tools `xagent_start`, `xagent_await`, `xagent_inspect`, `xagent_message`, `xagent_interrupt`, and `xagent_close`, all backed by service-owned supervisors.

#### Scenario: MCP initialization

- **WHEN** a compatible MCP client connects to `http://127.0.0.1:9005/mcp`
- **THEN** it can initialize a Streamable HTTP MCP session
- **AND** discovers all six xagent controller tools

#### Scenario: MCP connection closes

- **WHEN** an MCP transport connection closes while its supervised run remains active
- **THEN** the service retains that run independently of the transport session

#### Scenario: Unsupported route

- **WHEN** a client requests an unrecognized service route
- **THEN** the service returns a bounded 404 response
- **AND** does not change any supervised run

### Requirement: xsvc-5 — MCP: long blocking request bounds

WHEN serving `xagent_await`, THE xagent service SHALL support a 7200-second HTTP/MCP request lifetime, default the application await deadline to 7000 seconds, reject larger deadlines, and release request-local resources when the caller cancels without cancelling the supervised run.

#### Scenario: Ninety-minute healthy run

- **WHEN** a controller starts one await with the default deadline and the worker remains healthy for 90 minutes before completing
- **THEN** the same await remains pending through routine progress
- **AND** returns the completion event without an intermediate deadline wake

#### Scenario: Maximum deadline exceeded

- **WHEN** a controller requests an await deadline above 7000 seconds
- **THEN** the service rejects the request before registering a waiter

#### Scenario: Request reaches deadline

- **WHEN** no deliverable event exists by the accepted await deadline
- **THEN** the service returns one compact deadline result with the current cursor
- **AND** leaves the supervised run active

### Requirement: xsvc-6 — Security: working-directory validation

WHEN `xagent_start` receives a working directory, THE xagent service SHALL require an absolute path to an existing directory, resolve it canonically before process launch, use the resolved directory as the provider current working directory, and reject invalid paths without creating run state or a child process.

#### Scenario: Existing worktree

- **WHEN** the controller starts a run with an absolute path to an existing worktree
- **THEN** the provider launches with the canonical worktree path as its current working directory

#### Scenario: Invalid working directory

- **WHEN** the controller supplies a relative, missing, or non-directory path
- **THEN** the service returns a structured `invalid_working_directory` error
- **AND** creates no run or child process

### Requirement: xsvc-7 — Recovery: stale ownership reconciliation

WHEN the xagent service starts with metadata for a non-terminal run that it cannot safely reattach, THE service SHALL mark the run `abandoned`, emit deterministic attention, and clean up a stale provider process only when persisted PID and process-start identity prove that the process is the one xagent owned.

#### Scenario: Stale owned process identity matches

- **WHEN** startup finds active metadata and a live process matching both the persisted PID and process-start identity
- **THEN** the service terminates that stale owned process group
- **AND** records the run as `abandoned`

#### Scenario: Process identity cannot be proven

- **WHEN** startup finds active metadata but no live process has the persisted identity
- **THEN** the service records the run as `abandoned`
- **AND** does not signal or terminate an unproven process
