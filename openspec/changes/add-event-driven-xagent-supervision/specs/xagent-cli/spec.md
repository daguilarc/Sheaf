## ADDED Requirements

### Requirement: xa-14 — CLI: quiet supervision command

WHEN a controller starts `xagent supervise`, THE xagent CLI SHALL accept the supported harness, model, thinking-level, permission-mode, supervision-policy, working-directory, and initial-prompt options; SHALL create and await the run through the Conductor-managed xagent service; and SHALL keep routine provider output off stdout while the service preserves it in run logs.

#### Scenario: Valid supervised command

- **WHEN** the user runs `xagent supervise --harness claude_code --model sonnet "implement the task"`
- **THEN** the CLI requests a supervised Claude Code session from the xagent service in the active repository
- **AND** applies the configured supervision policy

#### Scenario: Healthy progress remains quiet

- **WHEN** a supervised worker emits assistant deltas and routine tool events
- **THEN** the xagent service writes those events to the configured run logs
- **AND** does not emit them on controller-facing stdout

#### Scenario: Supervised command emits attention

- **WHEN** the supervisor produces deterministic or semantic attention
- **THEN** stdout emits the compact sequenced `supervision.attention` event
- **AND** the xagent service retains the supervised session after the CLI exits

#### Scenario: CLI attaches to an existing run

- **WHEN** the controller invokes quiet await, inspect, follow-up, interrupt, or close with an existing `run_id`
- **THEN** the CLI calls the corresponding xagent service operation
- **AND** a command invalid for the current phase emits one compact error without changing the worker

#### Scenario: Service is unavailable

- **WHEN** `xagent supervise` cannot connect to the configured xagent service
- **THEN** the CLI returns a structured infrastructure failure
- **AND** does not start an embedded or unmanaged fallback supervisor

#### Scenario: Existing run command remains compatible

- **WHEN** a caller uses `xagent run --subagent` or `xagent run --full`
- **THEN** xagent preserves the existing persistent stdin protocol and output filtering
- **AND** does not silently apply quiet supervision semantics

### Requirement: xa-15 — Plugin: HTTP MCP service discovery

WHERE xagent is installed as a Codex plugin, THE packaged plugin SHALL declare an HTTP MCP server in `.mcp.json` at `http://127.0.0.1:9005/mcp` with `tool_timeout_sec` set to `7200`, reference that declaration from `.codex-plugin/plugin.json`, and SHALL NOT launch a plugin-local stdio supervisor or own provider processes.

#### Scenario: Installed plugin discovers supervision tools

- **WHEN** a new Codex session loads the installed xagent plugin
- **THEN** Codex discovers the Conductor-managed xagent service through the plugin's HTTP MCP declaration
- **AND** discovers tools for start, await, inspect, follow-up message, interrupt, and close

#### Scenario: MCP server uses active repository

- **WHEN** Codex starts a supervised run from an active worktree
- **THEN** the MCP tool sends the canonical active-worktree path to the xagent service
- **AND** the service starts the provider harness with that worktree as its current working directory
- **AND** writes logs to the configured central xagent log root

#### Scenario: MCP server unavailable

- **WHEN** the installed plugin cannot connect to the registered xagent service
- **THEN** Codex receives a structured infrastructure failure
- **AND** the xagent skill does not silently claim that event-driven supervision is active
- **AND** does not launch a second supervisor process

### Requirement: xa-16 — MCP: blocking cursor await

WHEN Codex calls the xagent await tool with a valid `run_id` and event cursor, THE xagent service SHALL keep the MCP tool call pending through healthy routine progress and return only for a newer completion, failure, attention, cancellation, abandonment, explicit await deadline, or user cancellation.

#### Scenario: Long healthy MCP wait

- **WHEN** a provider runs longer than the normal terminal polling interval while continuing healthy progress
- **THEN** the MCP await tool remains pending
- **AND** does not return message deltas, tool progress, or unchanged status snapshots

#### Scenario: MCP attention wakes leader

- **WHEN** deterministic or semantic attention occurs after the supplied cursor
- **THEN** the MCP await tool returns the compact attention event and its sequence

#### Scenario: MCP completion delivers report

- **WHEN** a provider turn completes successfully after the supplied cursor
- **THEN** the MCP await tool returns one versioned result containing the complete sanitized final assistant report, `run_id`, event sequence, lifecycle phase, and elapsed time
- **AND** does not require the leader to inspect the provider transcript or run logs

#### Scenario: MCP tool timeout supports long work

- **WHEN** the xagent plugin is packaged for Codex
- **THEN** its MCP tool timeout is 7200 seconds
- **AND** await defaults to a 7000-second deadline and rejects values above 7000 seconds
- **AND** the skill requests one default long wait instead of repeated short waits

### Requirement: xa-17 — MCP: persistent session control

WHILE a supervised provider session remains owned by the xagent service, THE service SHALL accept a follow-up only when the session is ready, SHALL allow explicit interruption of an active turn, SHALL preserve the run across controller and MCP disconnects, and SHALL close the session and owned processes only on explicit close, terminal failure, cancellation, or service shutdown.

#### Scenario: Follow-up uses same provider session

- **WHEN** a supervised run is `ready` and Codex submits a follow-up message
- **THEN** xagent delivers the message on the existing provider thread
- **AND** resets per-turn watchdog cadence without losing run-level telemetry

#### Scenario: Follow-up arrives during active turn

- **WHEN** Codex submits a follow-up while the supervised run is `running`
- **THEN** xagent rejects it with a state-specific error
- **AND** does not implicitly interrupt or reorder provider input

#### Scenario: Controller interrupts after attention

- **WHEN** Codex explicitly interrupts a running provider turn after an attention event
- **THEN** xagent stops that active turn
- **AND** preserves the provider session for a later follow-up when the adapter supports safe resumption

#### Scenario: Controller disconnects during active turn

- **WHEN** the Codex thread or MCP client disconnects while a supervised run is `running`
- **THEN** the xagent service keeps the provider turn, watchdog timers, and durable events active
- **AND** permits a later controller to inspect and await the same `run_id`

### Requirement: xa-18 — Distribution: supervision validation

WHEN the xagent Codex package is built or installed, THE package validation SHALL verify HTTP MCP discovery against a test xagent service, the quiet service-client CLI path, blocking await behavior over the plugin MCP `xagent_await` path, final-report delivery, and process cleanup using packaged assets from a temporary non-Sheaf repository. Controller-disconnect survival, attention delivery, and cursor deduplication are covered by in-tree TS tests (`mcp_await.test.ts`, `service_client.test.ts`) rather than packaged validation.

#### Scenario: Packaged quiet CLI smoke

- **WHEN** package validation runs a long fake supervised worker
- **THEN** controller-facing stdout contains no routine deltas or tool progress
- **AND** contains the terminal result or attention event

#### Scenario: Packaged MCP await smoke

- **WHEN** package validation starts a test xagent service and the installed plugin awaits a fake run
- **THEN** the await remains pending through fake progress
- **AND** returns once with the complete final report for completion or a compact injected attention event

#### Scenario: Packaged cleanup smoke

- **WHEN** package validation closes or cancels a fake supervised run
- **THEN** the server reports the terminal state
- **AND** retains no owned fake child process
