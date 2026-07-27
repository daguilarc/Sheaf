# xagent-cli Specification

## Purpose
TBD - created by archiving change add-xagent-cross-harness-subagent-cli. Update Purpose after archive.
## Requirements
### Requirement: xa-1 — CLI: command and supported flags
WHEN the user starts `xagent run`, THE xagent CLI SHALL require exactly one `--harness <codex|pi|cursor|claude_code>` value, accept optional `--model <string>` and `--thinking-level <low|medium|high|xhigh>` values, require exactly one verbosity flag from `--subagent` or `--full`, and accept an optional trailing initial message string.

#### Scenario: Valid run command
- **WHEN** the user runs `xagent run --harness codex --subagent`
- **THEN** the CLI starts a long-lived Codex-backed stdio session

#### Scenario: Valid run command with initial message
- **WHEN** the user runs `xagent run --harness codex --subagent "hello"`
- **THEN** the CLI starts a long-lived Codex-backed stdio session and submits `hello` as the first user turn before stdin follow-up commands

#### Scenario: Missing harness
- **WHEN** the user runs `xagent run --subagent` without `--harness`
- **THEN** the CLI exits non-zero and writes a usage error naming `--harness`

#### Scenario: Missing verbosity mode
- **WHEN** the user runs `xagent run --harness codex` without `--subagent` or `--full`
- **THEN** the CLI exits non-zero and writes a usage error naming the supported verbosity flags

#### Scenario: Multiple verbosity modes
- **WHEN** the user runs `xagent run --harness codex --subagent --full`
- **THEN** the CLI exits non-zero and writes a usage error saying exactly one verbosity mode is allowed

#### Scenario: Unsupported flag
- **WHEN** the user supplies a flag other than `--harness`, `--model`, `--thinking-level`, `--subagent`, or `--full` to `xagent run`
- **THEN** the CLI exits non-zero and writes a usage error naming the unsupported flag

#### Scenario: Help output
- **WHEN** the user runs `xagent --help` or `xagent run --help`
- **THEN** the CLI exits zero and prints usage text describing run flags, stdin JSONL commands, output modes, logs, and examples

### Requirement: xa-2 — Stdio protocol: input command schema
WHILE an `xagent run` process is active, THE xagent CLI SHALL read stdin as UTF-8 JSON Lines where each line is exactly one input command matching one of the supported command shapes: `{"type":"user.message","text":<non-empty string>,"metadata"?:<object>}` or `{"type":"control.exit"}`.

#### Scenario: User message command
- **WHEN** stdin receives `{"type":"user.message","text":"Review this branch"}`
- **THEN** the CLI submits `Review this branch` as the next turn on the active harness thread

#### Scenario: Exit command
- **WHEN** stdin receives `{"type":"control.exit"}`
- **THEN** the CLI closes the harness session if needed and exits zero after writing any final log records

#### Scenario: Invalid JSON input
- **WHEN** stdin receives a line that is not valid JSON
- **THEN** the CLI writes an `error` output event with `code: "invalid_input_json"` and continues reading stdin

#### Scenario: Unsupported input command
- **WHEN** stdin receives a JSON object whose `type` is not `user.message` or `control.exit`
- **THEN** the CLI writes an `error` output event with `code: "unsupported_input_command"` and continues reading stdin

#### Scenario: Empty user text
- **WHEN** stdin receives `{"type":"user.message","text":""}`
- **THEN** the CLI writes an `error` output event with `code: "invalid_user_message"` and does not submit a harness turn

### Requirement: xa-3 — Stdio protocol: normalized output event schema
WHILE an `xagent run` process is active, THE xagent CLI SHALL write stdout as UTF-8 JSON Lines where every line is an output event with `schema_version: 1`, `type`, `run_id`, `sequence`, and `timestamp`, and the `type` value is one of `session.started`, `session.ready`, `turn.started`, `message.delta`, `message.completed`, `tool.started`, `tool.completed`, `status`, `error`, `turn.completed`, `turn.failed`, `raw.provider`, or `session.ended`.

#### Scenario: Event envelope
- **WHEN** the CLI writes any output event
- **THEN** the event includes `schema_version: 1`, a stable `run_id`, a monotonically increasing integer `sequence`, and an ISO-8601 `timestamp`

#### Scenario: Session started event
- **WHEN** the harness session is created or resumed
- **THEN** the CLI writes `session.started` with `harness`, `mode`, optional `model`, optional `thinking_level`, and optional `provider_thread_id`

#### Scenario: Ready event
- **WHEN** the CLI is waiting for the next stdin command
- **THEN** the CLI writes `session.ready` with `can_accept_input: true`

#### Scenario: Turn lifecycle events
- **WHEN** a submitted user message starts and finishes
- **THEN** the CLI writes `turn.started` followed by either `turn.completed` or `turn.failed` for the same `turn_id`

#### Scenario: Assistant message events
- **WHEN** the harness emits assistant text
- **THEN** the CLI writes one `message.completed` event containing the final assistant text and may write mode-filtered `message.delta` events before completion

#### Scenario: Tool events
- **WHEN** full-mode visibility includes a harness tool invocation
- **THEN** the CLI writes `tool.started` and `tool.completed` events with `tool_call_id`, `name`, and sanitized input or output fields

#### Scenario: Raw provider events
- **WHEN** full-mode visibility includes a provider-native event
- **THEN** the CLI writes `raw.provider` with `harness` and `payload`

### Requirement: xa-4 — Output modes: subagent visibility
WHEN `xagent run` is started with `--subagent`, THE xagent CLI SHALL suppress routine raw provider events, reasoning/thinking content, routine tool result payloads, and low-level stream noise from stdout while still logging the full normalized and raw event stream to disk.

#### Scenario: Subagent final text
- **WHEN** a turn completes successfully in `--subagent` mode
- **THEN** stdout includes `message.completed`, `turn.completed`, and `session.ready` for the turn

#### Scenario: Subagent streamed text
- **WHEN** a harness streams assistant text in `--subagent` mode
- **THEN** stdout SHALL NOT include raw provider text deltas and MAY include coalesced `message.delta` events at most once every 1500 ms, or once immediately before `message.completed`

#### Scenario: Subagent tool suppression
- **WHEN** a harness tool call completes successfully in `--subagent` mode
- **THEN** stdout SHALL NOT include the routine `tool.completed` output payload

#### Scenario: Subagent error visibility
- **WHEN** a harness turn fails in `--subagent` mode
- **THEN** stdout includes `turn.failed` with a concise error and enough provider detail to diagnose the failed turn

### Requirement: xa-5 — Output modes: full visibility
WHEN `xagent run` is started with `--full`, THE xagent CLI SHALL write every normalized event and every raw provider event that the adapter observes, except secrets and host paths sanitized by the logging policy.

#### Scenario: Full raw provider preservation
- **WHEN** the Codex adapter observes a provider `item.completed` event
- **THEN** stdout includes a `raw.provider` event carrying the sanitized original payload

#### Scenario: Full tool visibility
- **WHEN** a harness tool call starts and completes in `--full` mode
- **THEN** stdout includes normalized `tool.started` and `tool.completed` events for the call

#### Scenario: Full reasoning preservation
- **WHEN** a harness exposes reasoning or thinking content in provider events
- **THEN** stdout includes the sanitized raw provider event in `raw.provider`

### Requirement: xa-6 — Harnesses: supported adapters
WHEN the user selects a harness, THE xagent CLI SHALL support exactly the harness values `codex`, `pi`, `cursor`, and `claude_code`, assuming the selected harness has already been installed and authenticated outside xagent.

#### Scenario: Codex harness selected
- **WHEN** the user starts `xagent run --harness codex`
- **THEN** the CLI starts a Codex session using the local Codex SDK or `codex exec --json` adapter

#### Scenario: Pi harness selected
- **WHEN** the user starts `xagent run --harness pi`
- **THEN** the CLI starts a Pi session using the local `pi` CLI adapter

#### Scenario: Cursor harness selected
- **WHEN** the user starts `xagent run --harness cursor`
- **THEN** the CLI starts a Cursor Agent session using `cursor-agent --print --output-format stream-json`

#### Scenario: Claude Code harness selected
- **WHEN** the user starts `xagent run --harness claude_code`
- **THEN** the CLI starts a Claude Code session using `claude --print --output-format stream-json --permission-mode auto`

#### Scenario: Harness unavailable
- **WHEN** the selected harness binary or package is unavailable
- **THEN** the CLI writes an `error` output event with `code: "harness_unavailable"` and exits non-zero

### Requirement: xa-7 — Harness options: model and thinking level
WHEN `--model` or `--thinking-level` is provided, THE xagent CLI SHALL pass the option to harnesses that support the corresponding concept and SHALL emit a `status` event with `level: "warning"` when a selected harness ignores an option.

#### Scenario: Model option forwarded
- **WHEN** the user runs `xagent run --harness codex --model gpt-5.5 --subagent`
- **THEN** the Codex adapter receives `gpt-5.5` as the requested model

#### Scenario: Thinking level option forwarded
- **WHEN** the user runs `xagent run --harness claude_code --thinking-level high --subagent`
- **THEN** the Claude Code adapter receives `high` as the requested effort level

#### Scenario: Unsupported thinking level ignored
- **WHEN** the user runs a harness that does not support `--thinking-level`
- **THEN** the CLI writes a `status` event with `level: "warning"` explaining that the option was ignored

### Requirement: xa-8 — Turn loop: long-lived follow-up over stdin
WHILE the process remains active, THE xagent CLI SHALL preserve the provider thread across multiple `user.message` commands so each later command is a follow-up to the same harness session.

#### Scenario: Second user message
- **WHEN** stdin sends two `user.message` commands before `control.exit`
- **THEN** the second command is delivered as a follow-up on the same provider thread as the first

#### Scenario: Ready between turns
- **WHEN** a turn reaches `turn.completed` or `turn.failed`
- **THEN** the CLI writes `session.ready` before reading and processing the next valid `user.message`

#### Scenario: EOF without exit command
- **WHEN** stdin reaches EOF without `control.exit`
- **THEN** the CLI closes the harness session if needed, writes `session.ended`, and exits zero unless an active turn failed during shutdown

### Requirement: xa-9 — Offline logs and inspection commands
WHEN `xagent run` starts without an explicit log-root override, THE xagent CLI SHALL create a run directory under the Sheaf repository root's top-level `data/xagent/` directory, including when the CLI process is launched from `projects/xagent`, and offline commands `xagent list` and `xagent logs <run_id>` SHALL read only those persisted files without requiring a live daemon or server.

#### Scenario: Run log created
- **WHEN** `xagent run --harness codex --subagent` starts from the Sheaf repository root
- **THEN** the CLI creates a persistent run record under `data/xagent/` containing `run_id`, `harness`, `mode`, timestamps, exit status, and log paths

#### Scenario: Package directory launch uses top-level data directory
- **WHEN** `xagent run --harness fake --subagent` starts with the current working directory set to `projects/xagent`
- **THEN** the CLI creates the persistent run record under the Sheaf repository root's `data/xagent/`
- **AND** the CLI does not create a persistent run record under `projects/xagent/data/xagent/`

#### Scenario: Offline list
- **WHEN** the user runs `xagent list`
- **THEN** the CLI lists persisted run records from disk and does not contact any live xagent process

#### Scenario: Offline logs
- **WHEN** the user runs `xagent logs <run_id>`
- **THEN** the CLI prints the persisted normalized log for that run and does not contact any live xagent process

### Requirement: xa-10 — Sanitization: secrets and paths
WHEN xagent writes stdout or logs, THE xagent CLI SHALL redact secret-looking strings and relativize paths under the configured working directory before emitting normalized events, while raw provider logs SHALL either apply the same sanitization or be marked unsafe and excluded from `--subagent` output.

#### Scenario: Secret redacted
- **WHEN** a provider event contains an API key-like value
- **THEN** xagent output replaces the secret-looking substring with `[REDACTED]`

#### Scenario: Workspace path relativized
- **WHEN** a provider event contains an absolute path under the working directory
- **THEN** normalized xagent output emits the path relative to the working directory

### Requirement: xa-11 — Distribution: Codex plugin launcher
WHERE xagent is distributed for Codex agents, THE xagent project SHALL provide a globally installable Codex plugin package containing the `xagent-subagents` skill and a stable launcher that executes xagent without requiring the active repository to contain `projects/xagent`, `plugins/xagent`, `node_modules`, or a prebuilt `dist/` directory.

#### Scenario: Installed launcher works outside Sheaf
- **WHEN** a Codex agent invokes xagent from the globally installed plugin while its active repository is not a Sheaf checkout
- **THEN** the launcher starts the packaged xagent runtime from the installed plugin assets
- **AND** it does not read xagent source or plugin files from the active repository

#### Scenario: PATH is not required
- **WHEN** a Codex agent has the xagent plugin installed but no `xagent` binary on `PATH`
- **THEN** the agent can invoke xagent through the launcher path supplied by the installed plugin

#### Scenario: Missing runtime asset
- **WHEN** the installed plugin runtime asset is missing or not executable
- **THEN** the launcher exits non-zero with a diagnostic naming the missing packaged asset

### Requirement: xa-12 — Distribution: active repository and central log semantics
WHEN a Codex agent launches packaged xagent from an active repository root, THE packaged xagent runtime SHALL use that active repository root as the child harness working directory while using the configured xagent log root for persisted run logs, defaulting packaged launches to `/Users/joyo/Sheaf/data/xagent`.

#### Scenario: Logs written to main Sheaf repository by default
- **WHEN** the packaged launcher runs `xagent run --harness fake --subagent` from `/tmp/example-repo`
- **THEN** xagent creates run logs under `/Users/joyo/Sheaf/data/xagent/`
- **AND** it does not write run logs under `/tmp/example-repo/data/xagent/`
- **AND** it does not write run logs under the plugin installation directory

#### Scenario: Configured log root override
- **WHEN** `XAGENT_LOG_ROOT` is set before invoking the packaged launcher
- **THEN** xagent writes persisted run logs under that configured log root instead of the default main Sheaf repository log root

#### Scenario: Harness sees active repository
- **WHEN** the packaged launcher starts a child harness from an active worktree
- **THEN** the child harness receives the active worktree as its current working directory

#### Scenario: Codex child bypasses prompts and sandboxing
- **WHEN** the packaged launcher starts the Codex child harness
- **THEN** xagent invokes Codex with its explicit approval-and-sandbox bypass flag
- **AND** the xagent-spawned Codex child does not stop for command approval prompts
- **AND** the xagent-spawned Codex child is not constrained by a restrictive Codex sandbox profile

#### Scenario: Log root unavailable
- **WHEN** the packaged launcher can be invoked but the configured xagent log root cannot be created or written
- **THEN** xagent writes structured JSONL containing an `error` event with `code: "log_root_unavailable"`
- **AND** xagent exits non-zero before starting a child harness

### Requirement: xa-13 — Distribution: packaged runtime validation
WHEN the xagent package is built for Codex distribution, THE build SHALL verify that the packaged launcher can execute xagent help and a fake-harness smoke run using only packaged runtime assets plus the active working directory.

#### Scenario: Help smoke test
- **WHEN** the Codex package build validation runs
- **THEN** it invokes the packaged launcher with `--help`
- **AND** verifies the command exits zero and prints xagent usage

#### Scenario: Fake harness smoke test
- **WHEN** the Codex package build validation runs
- **THEN** it invokes the packaged launcher with `XAGENT_TEST_ADAPTER=fake` from a temporary non-Sheaf repository directory
- **AND** verifies the run exits successfully and writes logs under a configured central log root rather than under that temporary repository

### Requirement: xa-14 — Distribution: global Codex plugin lifecycle
WHEN a developer invokes the xagent global plugin install target, THE Sheaf build SHALL install or update xagent through Codex's personal-marketplace plugin mechanism without requiring manual marketplace edits.

#### Scenario: Global install target
- **WHEN** `make xagent-plugin-install-global` runs successfully
- **THEN** it builds and validates an untracked temporary xagent plugin package without modifying tracked plugin assets
- **AND** it creates or updates an `xagent` entry in the personal marketplace at `$HOME/.agents/plugins/marketplace.json`
- **AND** that entry uses `source.source: "local"` with a `source.path` that resolves under the invoking home to `$HOME/.agents/plugins/plugins/xagent`
- **AND** it stages the managed plugin package under `$HOME/.agents/plugins/plugins/xagent/`
- **AND** the staged package contains `.sheaf-managed` with exact contents `sheaf-xagent-plugin\n`
- **AND** the entry contains `policy.installation: "AVAILABLE"`, `policy.authentication: "ON_INSTALL"`, and `category: "Productivity"`
- **AND** it reads the marketplace's top-level name and invokes `codex plugin add xagent@<marketplace-name>`
- **AND** `codex plugin list` reports that plugin identity installed and enabled at the staged package path

#### Scenario: Idempotent global update
- **WHEN** the global install target runs while a managed xagent personal-marketplace package is already installed
- **THEN** it replaces the staged package with the newly validated package
- **AND** it applies one fresh Codex cachebuster to the staged manifest
- **AND** it preserves the existing marketplace name, interface metadata, and unrelated plugin entries
- **AND** it reinstalls the same xagent plugin identity without creating a second marketplace entry or plugin identity

#### Scenario: Unmanaged destination conflict
- **WHEN** the intended global xagent package path exists without Sheaf management metadata
- **THEN** global installation exits non-zero without overwriting or deleting that path

#### Scenario: Required plugin infrastructure unavailable
- **WHEN** the Codex CLI, required plugin-creator helper, package validator, or plugin installation command is unavailable or fails
- **THEN** global installation exits non-zero with a diagnostic naming the failed dependency or command
- **AND** it does not silently install through another path

#### Scenario: Launcher remains executable
- **WHEN** the global install target stages the validated plugin package
- **THEN** `$HOME/.agents/plugins/plugins/xagent/scripts/xagent` retains executable permissions

### Requirement: xa-15 — Distribution: single installed owner
WHERE xagent is installed globally for Codex, THE Sheaf installers SHALL install its skill, launcher, and runtime only as members of the xagent plugin package and SHALL NOT deploy duplicate executable or standalone-skill copies to other user-global or repo-local destinations.

#### Scenario: No standalone xagent skill
- **WHEN** agents and xagent global installation complete
- **THEN** `xagent-subagents` is discoverable through the installed xagent plugin
- **AND** no agents-installer-managed `xagent-subagents` skill exists under `$HOME/.agents/skills/` or `$CODEX_HOME/skills/`
- **AND** no repo-local agents-installer-managed `xagent-subagents` skill exists

#### Scenario: No duplicate executable installation
- **WHEN** xagent global installation completes
- **THEN** the installer has not copied `scripts/xagent` or the packaged runtime into `$HOME/.local/bin`, `$HOME/.agents/skills`, `$CODEX_HOME/skills`, or any repo-local `.claude/skills`, `.cursor/skills`, `.pi/skills`, or `.codex/skills` directory
- **AND** the only Sheaf-managed global deployment containing those executable assets is `$HOME/.agents/plugins/plugins/xagent/`

### Requirement: xa-16 — CLI: quiet supervision command

WHEN a controller starts `xagent supervise`, THE xagent CLI SHALL accept the supported harness, model, thinking-level, permission-mode, supervision-policy, working-directory, and initial-prompt options; SHALL create and await the run through the Conductor-managed xagent service; and SHALL keep routine provider output off stdout. The supervised path persists lifecycle, attention, and watchdog records only; it does not persist routine provider output to the run logs.

#### Scenario: Valid supervised command
- **WHEN** the user runs `xagent supervise --harness claude_code --model sonnet "implement the task"`
- **THEN** the CLI requests a supervised Claude Code session from the xagent service in the active repository
- **AND** applies the configured supervision policy

#### Scenario: Healthy progress remains quiet
- **WHEN** a supervised worker emits assistant deltas and routine tool events
- **THEN** the xagent service does not emit them on controller-facing stdout
- **AND** does not persist them to the configured run logs on the supervised path; only lifecycle, attention, and watchdog records are persisted

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

### Requirement: xa-17 — Plugin: HTTP MCP service discovery

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

### Requirement: xa-18 — MCP: blocking cursor await

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

### Requirement: xa-19 — MCP: persistent session control

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

### Requirement: xa-20 — Distribution: supervision validation

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
