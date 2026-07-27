## MODIFIED Requirements

### Requirement: xsvc-4 — MCP: Streamable HTTP controller endpoint

WHEN the xagent service is running, THE service SHALL expose Streamable HTTP MCP at `/mcp` with generic tools `xagent_start`, `xagent_await`, `xagent_inspect`, `xagent_message`, `xagent_interrupt`, and `xagent_close` plus SDD facade tools `xagent_sdd_start`, `xagent_sdd_followup`, `xagent_sdd_await`, and `xagent_sdd_close`, all backed by service-owned supervisors.

#### Scenario: MCP initialization

- **WHEN** a compatible MCP client connects to `http://127.0.0.1:9005/mcp`
- **THEN** it can initialize a Streamable HTTP MCP session
- **AND** discovers all six generic xagent controller tools
- **AND** discovers all four xagent SDD facade tools

#### Scenario: MCP connection closes

- **WHEN** an MCP transport connection closes while its supervised run remains active
- **THEN** the service retains that run independently of the transport session

#### Scenario: Unsupported route

- **WHEN** a client requests an unrecognized service route
- **THEN** the service returns a bounded 404 response
- **AND** does not change any supervised run

### Requirement: xsvc-5 — MCP: long blocking request bounds

WHEN serving `xagent_await` or `xagent_sdd_await`, THE xagent service SHALL support a 7200-second HTTP/MCP request lifetime, default the application await deadline to 7000 seconds, reject larger deadlines, and release request-local resources when the caller cancels without cancelling the supervised run.

#### Scenario: Ninety-minute healthy run

- **WHEN** a controller starts one generic or SDD await with the default deadline and the worker remains healthy for 90 minutes before completing
- **THEN** the same await remains pending through routine progress
- **AND** returns the completion event without an intermediate deadline wake

#### Scenario: Maximum deadline exceeded

- **WHEN** a controller requests an await deadline above 7000 seconds from either await tool
- **THEN** the service rejects the request before registering a waiter

#### Scenario: Request reaches deadline

- **WHEN** no deliverable event exists by the accepted generic or SDD await deadline
- **THEN** the service returns one compact deadline result with the current cursor
- **AND** leaves the supervised run active

### Requirement: xsvc-6 — Security: working-directory validation

WHEN `xagent_start` or `xagent_sdd_start` receives a working directory, THE xagent service SHALL require an absolute path to an existing directory, resolve it canonically before process launch, use the resolved directory as the provider and prompt-renderer current working directory, and reject invalid paths without creating run state, SDD session state, or a child process.

#### Scenario: Existing worktree

- **WHEN** the controller starts a generic or SDD run with an absolute path to an existing worktree
- **THEN** the provider launches with the canonical worktree path as its current working directory
- **AND** an SDD prompt renderer uses that same canonical path as its working directory

#### Scenario: Invalid working directory

- **WHEN** the controller supplies a relative, missing, or non-directory path to either start tool
- **THEN** the service returns a structured `invalid_working_directory` error
- **AND** creates no run, SDD ledger row, or child process
