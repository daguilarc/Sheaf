# Capability: CLI

ID prefix: `cli`

## Purpose

The `realtime-agent` CLI (the `bin` of `realtime-agent-lib`) runs an
unattended microphone session against the Realtime API: server-VAD turns,
text-only output, one JSON line per non-audio event on stdout, SQLite
persistence in the repository data directory, and a JSONL runtime log. It is
configured entirely from files (`config/`) and flags — no environment
variables.

## Requirements

- **[cli-1]** THE CLI SHALL accept exactly these flags and no positionals:
  `--context-file <path>` (required for a run), `--prompt-file <path>`,
  `--model <name>`, `--tool <name>` (repeatable; each value may itself be a
  comma-separated list, split and trimmed), `--input-device <id-or-name>`,
  `--list-input-devices` (boolean), `--safety-identifier <id>`.
- **[cli-2]** WHEN `--list-input-devices` is set, THE CLI SHALL print the
  formatted device list ([audio-capture](audio-capture.md) aud-4) to stdout
  and exit 0 without loading config or the API key.
- **[cli-3]** IF `--context-file` is missing or blank on a run, THEN THE
  CLI SHALL print `--context-file is required.` to stderr and exit 1.
- **[cli-4]** THE CLI SHALL resolve defaults from
  [config](config.md): prompt file ← `default_prompt_file` (a blank
  `--prompt-file` counts as omitted), model ← `model`; IF config or API-key
  loading throws `ConfigLoadError`, THEN THE CLI SHALL print the error
  message to stderr and exit 1.
- **[cli-5]** IF any `--tool` name is not in the built-in registry, THEN
  THE CLI SHALL print `Unknown tool(s): <comma-joined names>` to stderr and
  exit 1 before connecting. The built-in registry contains exactly `echo`
  (see Contracts); the resulting tool call set is named `cli_selected` when
  tools were chosen and `cli_empty` otherwise.
- **[cli-6]** THE CLI SHALL start the session with the default server-VAD
  turn mode (500 ms silence, auto create-response, interrupt-response —
  [turn-model](turn-model.md) turn-1) and the prompt/context file contents
  as `systemPrompt` / `initialContext`.
- **[cli-7]** THE CLI SHALL write one JSON line to stdout for every routed
  event in both directions except `input_audio_buffer.append`:
  `{"session_id":<id>,"direction":"incoming"|"outgoing","event_type":<type>,"event":<full event>}`.
- **[cli-8]** THE CLI SHALL append runtime-log entries
  ([config](config.md) format) to
  `logs/realtime-agent/realtime-agent.jsonl`; the emitted event names are
  enumerated in Contracts.
- **[cli-9]** WHEN the session is running, `SIGINT` or `SIGTERM` SHALL
  trigger shutdown with reason `signal`: stop microphone capture, stop the
  session, close the database, log `cli_shutdown`, exit 0.
- **[cli-10]** IF microphone setup throws at startup, THEN THE CLI SHALL
  shut down with reason `audio_setup_error` and exit 1; IF capture errors
  mid-run, THEN it SHALL print `Microphone capture failed: <message>` to
  stderr and shut down with reason `audio_error`, exit 1.
- **[cli-11]** IF the session ends with reason `connection_lost`, THEN THE
  CLI SHALL print `Realtime connection lost; session ended.` to stderr and
  shut down with exit 1.
- **[cli-12]** IF the prompt or context file cannot be read, THEN THE CLI
  SHALL print `Failed to read prompt or context file: <message>` to stderr
  and exit 1; IF connecting fails with a transport error, THEN it SHALL
  print the transport error message and exit 1; other startup failures
  print their message and exit 1.
- **[cli-13]** THE package SHALL publish the bin `realtime-agent` →
  `dist/src/agent/src/cli.js`; the module SHALL run `Main` only when
  invoked directly (importing it must not start a CLI run), and SHALL
  export `ParseCliArgs`, `ResolveCliRunOptions`, `RunCli`,
  `StartCliRuntime`, `CliUsageError`, and `CreateFakeMicrophoneCapture` for
  embedding and tests.

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
when `CONTEXT_FILE` is unset). See [Operations](../operations.md#run-the-cli).

### Stdout event line (worked example)

```json
{"session_id":"6f9c…","direction":"incoming","event_type":"response.output_text.delta","event":{"type":"response.output_text.delta","response_id":"resp_1","delta":"Hel"}}
```

Outgoing `input_audio_buffer.append` events are omitted from stdout
(`ShouldLogEvent` in `src/agent/src/stdout_logger.ts`); they are also not
persisted ([persistence](persistence.md) db-5).

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
| `ConfigLoadError` (config or API key) | 1 | the `ConfigLoadError` message ([config](config.md)) |
| Unknown tool names | 1 | `Unknown tool(s): <names>` |
| Prompt/context file unreadable | 1 | `Failed to read prompt or context file: <message>` |
| Transport connect failure | 1 | the `RealtimeTransportError` message |
| Microphone capture failure | 1 | `Microphone capture failed: <message>` |
| Connection lost mid-session | 1 | `Realtime connection lost; session ended.` |
| Unrecognized flag / positional | crash | uncaught `parseArgs` error (gap — see [coverage](../coverage.md)) |

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

- [config](config.md) — config/API-key/path resolution; runtime-log format.
- [session-lifecycle](session-lifecycle.md) — `startAgentSession` and the
  `onEvent`/`onSessionEnded`/`onToolLifecycle` callbacks the CLI installs.
- [turn-model](turn-model.md) — server-VAD default.
- [audio-capture](audio-capture.md) — device listing/selection and frame
  capture.
- [persistence](persistence.md) — the repository SQLite database.
