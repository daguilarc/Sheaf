# Capability: CLI

Project: `projects/realtime-agent`
ID prefix: `cli` — requirement IDs are append-only; never renumber or reuse.

## Purpose

The `realtime-agent` CLI (the `bin` of `realtime-agent-lib`) runs an
unattended microphone session against the Realtime API: server-VAD turns,
text-only output, one JSON line per non-audio event on stdout, SQLite
persistence in the repository data directory, and a JSONL runtime log. It is
configured entirely from files (`config/`) and flags — no environment
variables.

## Requirements

### Requirement: cli-1 — Accepted flags

THE CLI SHALL accept exactly these flags and no positionals: `--context-file <path>` (required for a run), `--prompt-file <path>`, `--model <name>`, `--tool <name>` (repeatable; each value may itself be a comma-separated list, split and trimmed), `--input-device <id-or-name>`, `--list-input-devices` (boolean), `--safety-identifier <id>`.

#### Scenario: CLI invoked
- **WHEN** the CLI is invoked
- **THEN** it accepts exactly the specified flags and no positionals

### Requirement: cli-2 — Device-list mode

WHEN `--list-input-devices` is set, THE CLI SHALL print the formatted device list ([audio-capture](../realtime-agent-audio-capture/spec.md) aud-4) to stdout and exit 0 without loading config or the API key.

#### Scenario: --list-input-devices set
- **WHEN** `--list-input-devices` is set
- **THEN** the CLI prints the formatted device list to stdout and exits 0 without loading config or the API key

### Requirement: cli-3 — Missing context-file

IF `--context-file` is missing or blank on a run, THEN THE CLI SHALL print `--context-file is required.` to stderr and exit 1.

#### Scenario: --context-file missing or blank
- **WHEN** `--context-file` is missing or blank on a run
- **THEN** the CLI prints `--context-file is required.` to stderr and exits 1

### Requirement: cli-4 — Config defaults and ConfigLoadError

THE CLI SHALL resolve defaults from [config](../realtime-agent-config/spec.md): prompt file ← `default_prompt_file` (a blank `--prompt-file` counts as omitted), model ← `model`; IF config or API-key loading throws `ConfigLoadError`, THEN THE CLI SHALL print the error message to stderr and exit 1.

#### Scenario: Defaults resolved from config
- **WHEN** the CLI runs without explicit `--prompt-file` or `--model` flags
- **THEN** it resolves prompt file from `default_prompt_file` and model from `model` in config

#### Scenario: ConfigLoadError during config or API-key loading
- **WHEN** config or API-key loading throws `ConfigLoadError`
- **THEN** the CLI prints the error message to stderr and exits 1

### Requirement: cli-5 — Unknown tool names

IF any `--tool` name is not in the built-in registry, THEN THE CLI SHALL print `Unknown tool(s): <comma-joined names>` to stderr and exit 1 before connecting. The built-in registry contains exactly `echo` (see Contracts); the resulting tool call set is named `cli_selected` when tools were chosen and `cli_empty` otherwise.

#### Scenario: Unknown tool name supplied
- **WHEN** any `--tool` name is not in the built-in registry
- **THEN** the CLI prints `Unknown tool(s): <comma-joined names>` to stderr and exits 1 before connecting

### Requirement: cli-6 — Session startup

THE CLI SHALL start the session with the default server-VAD turn mode (500 ms silence, auto create-response, interrupt-response — [turn-model](../realtime-agent-turn-model/spec.md) turn-1) and the prompt/context file contents as `systemPrompt` / `initialContext`.

#### Scenario: Session started
- **WHEN** the CLI starts a session
- **THEN** it uses the default server-VAD turn mode (500 ms silence, auto create-response, interrupt-response) and the prompt/context file contents as `systemPrompt` / `initialContext`

### Requirement: cli-7 — Stdout event lines

THE CLI SHALL write one JSON line to stdout for every routed event in both directions except `input_audio_buffer.append`: `{"session_id":<id>,"direction":"incoming"|"outgoing","event_type":<type>,"event":<full event>}`.

#### Scenario: Routed event received or sent
- **WHEN** a routed event occurs in either direction (except `input_audio_buffer.append`)
- **THEN** the CLI writes one JSON line to stdout with `session_id`, `direction`, `event_type`, and `event`

### Requirement: cli-8 — Runtime-log entries

THE CLI SHALL append runtime-log entries ([config](../realtime-agent-config/spec.md) format) to `logs/realtime-agent/realtime-agent.jsonl`; the emitted event names are enumerated in Contracts.

#### Scenario: Runtime-log written
- **WHEN** the CLI runs
- **THEN** it appends runtime-log entries to `logs/realtime-agent/realtime-agent.jsonl` using the config log format

### Requirement: cli-9 — Signal shutdown

WHEN the session is running, `SIGINT` or `SIGTERM` SHALL trigger shutdown with reason `signal`: stop microphone capture, stop the session, close the database, log `cli_shutdown`, exit 0.

#### Scenario: SIGINT or SIGTERM received
- **WHEN** `SIGINT` or `SIGTERM` is received while the session is running
- **THEN** the CLI stops microphone capture, stops the session, closes the database, logs `cli_shutdown`, and exits 0 with reason `signal`

### Requirement: cli-10 — Microphone errors

IF microphone setup throws at startup, THEN THE CLI SHALL shut down with reason `audio_setup_error` and exit 1; IF capture errors mid-run, THEN it SHALL print `Microphone capture failed: <message>` to stderr and shut down with reason `audio_error`, exit 1.

#### Scenario: Microphone setup throws at startup
- **WHEN** microphone setup throws at startup
- **THEN** the CLI shuts down with reason `audio_setup_error` and exits 1

#### Scenario: Capture error mid-run
- **WHEN** capture errors occur mid-run
- **THEN** the CLI prints `Microphone capture failed: <message>` to stderr and shuts down with reason `audio_error`, exiting 1

### Requirement: cli-11 — Connection lost

IF the session ends with reason `connection_lost`, THEN THE CLI SHALL print `Realtime connection lost; session ended.` to stderr and shut down with exit 1.

#### Scenario: Session ends with connection_lost
- **WHEN** the session ends with reason `connection_lost`
- **THEN** the CLI prints `Realtime connection lost; session ended.` to stderr and exits 1

### Requirement: cli-12 — Startup failures

IF the prompt or context file cannot be read, THEN THE CLI SHALL print `Failed to read prompt or context file: <message>` to stderr and exit 1; IF connecting fails with a transport error, THEN it SHALL print the transport error message and exit 1; other startup failures print their message and exit 1.

#### Scenario: Prompt or context file unreadable
- **WHEN** the prompt or context file cannot be read
- **THEN** the CLI prints `Failed to read prompt or context file: <message>` to stderr and exits 1

#### Scenario: Transport connect failure
- **WHEN** connecting fails with a transport error
- **THEN** the CLI prints the transport error message and exits 1

#### Scenario: Other startup failure
- **WHEN** another startup failure occurs
- **THEN** the CLI prints the failure message and exits 1

### Requirement: cli-13 — Package bin and exports

THE package SHALL publish the bin `realtime-agent` → `dist/src/agent/src/cli.js`; the module SHALL run `Main` only when invoked directly (importing it must not start a CLI run), and SHALL export `ParseCliArgs`, `ResolveCliRunOptions`, `RunCli`, `StartCliRuntime`, `CliUsageError`, and `CreateFakeMicrophoneCapture` for embedding and tests.

#### Scenario: Package bin published
- **WHEN** the package is installed
- **THEN** the `realtime-agent` bin resolves to `dist/src/agent/src/cli.js`

#### Scenario: Module imported
- **WHEN** the module is imported (not invoked directly)
- **THEN** `Main` does not run and the module exports `ParseCliArgs`, `ResolveCliRunOptions`, `RunCli`, `StartCliRuntime`, `CliUsageError`, and `CreateFakeMicrophoneCapture`

## Contracts

### Invocation

```bash
node projects/realtime-agent/src/agent/dist/src/agent/src/cli.js \
  --context-file <path> [--prompt-file <path>] [--model <name>] \
  [--tool <name>[,<name>…]]… [--input-device <id-or-name>] \
  [--safety-identifier <id>]

node …/cli.js --list-input-devices
```

Make wrappers: `make -C projects/realtime-agent run-cli CONTEXT_FILE=…` and
repo-root `make realtime-agent-run-cli CONTEXT_FILE=…` (the target errors
when `CONTEXT_FILE` is unset). See [Operations](../../../projects/realtime-agent/docs/operations.md#run-the-cli).

### Stdout event line (worked example)

```json
{"session_id":"6f9c…","direction":"incoming","event_type":"response.output_text.delta","event":{"type":"response.output_text.delta","response_id":"resp_1","delta":"Hel"}}
```

Outgoing `input_audio_buffer.append` events are omitted from stdout
(`ShouldLogEvent` in `src/agent/src/stdout_logger.ts`); they are also not
persisted ([persistence](../realtime-agent-persistence/spec.md) db-5).

### Built-in `echo` tool

```json
{
  "name": "echo",
  "description": "Echoes the message field from tool arguments.",
  "inputSchema": { "type": "object", "properties": { "message": { "type": "string" } } }
}
```

Result: `{ "echoed": <args.message ?? ""> }`.

### Runtime-log event names

Info: `cli_startup` (model, turn_mode, prompt_file, context_file),
`realtime_connecting`, `realtime_connected`, `microphone_started`,
`realtime_session_ended` (session_id, reason), `cli_shutdown`
(reason, exit_code). Errors: `prompt_load_failed`, `context_load_failed`,
`persistence_init_failed`, `realtime_connection_failed`,
`realtime_session_start_failed`, `microphone_setup_failed`,
`microphone_capture_failed`, `tool_dispatch_failed` (on `failed` lifecycle
phase), `realtime_connection_lost`, `session_stop_failed`.

### Exit codes / error catalogue

| Condition | Exit | Stderr (exact or pinned substring) |
|---|---|---|
| Normal signal shutdown | 0 | — |
| `--list-input-devices` | 0 | — (list on stdout) |
| Missing/blank `--context-file` | 1 | `--context-file is required.` |
| `ConfigLoadError` (config or API key) | 1 | the `ConfigLoadError` message ([config](../realtime-agent-config/spec.md)) |
| Unknown tool names | 1 | `Unknown tool(s): <names>` |
| Prompt/context file unreadable | 1 | `Failed to read prompt or context file: <message>` |
| Transport connect failure | 1 | the `RealtimeTransportError` message |
| Microphone capture failure | 1 | `Microphone capture failed: <message>` |
| Connection lost mid-session | 1 | `Realtime connection lost; session ended.` |
| Unrecognized flag / positional | crash | uncaught `parseArgs` error (gap — see [coverage](../../../projects/realtime-agent/docs/coverage.md)) |

## Design

- `src/agent/src/cli.ts` — `ParseCliArgs` (node:util `parseArgs`,
  `allowPositionals: false`), `ResolveCliRunOptions`, `StartCliRuntime`
  (config-injected runtime: validates tools, reads prompt/context, opens the
  database, starts the session, then starts capture; returns
  `{session, audioCapture, database, runtimeLogger, shutdown}`), `RunCli`
  (full run incl. signal handling; `registerSignalHandlers: false` makes it
  return immediately after startup for tests), `Main` entry guard.
- Shutdown is idempotent (`shuttingDown` flag); session-stop failures are
  logged (`session_stop_failed`) and printed but do not change the exit
  code.
- `src/agent/src/tool_sets.ts` — registry, `ParseToolNameArguments`
  (comma-splitting), `BuildToolCallSet`.
- `src/agent/src/stdout_logger.ts` — `ShouldLogEvent`, `logEventLine`.
- Tests: `tests/agent/cli/cli.test.ts`,
  `tests/agent/stdout_logger/stdout_logger.test.ts`.

## Interactions

- [config](../realtime-agent-config/spec.md) — config/API-key/path resolution; runtime-log format.
- [session-lifecycle](../realtime-agent-session-lifecycle/spec.md) — `startAgentSession` and the
  `onEvent`/`onSessionEnded`/`onToolLifecycle` callbacks the CLI installs.
- [turn-model](../realtime-agent-turn-model/spec.md) — server-VAD default.
- [audio-capture](../realtime-agent-audio-capture/spec.md) — device listing/selection and frame
  capture.
- [persistence](../realtime-agent-persistence/spec.md) — the repository SQLite database.
