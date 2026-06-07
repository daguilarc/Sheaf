# CLI Reference

## Binary

Package `realtime-agent-lib` publishes the `realtime-agent` CLI binary.

After building the agent workspace:

```bash
node projects/realtime-agent/src/agent/dist/src/agent/src/cli.js --help
```

Or install the workspace package and invoke `realtime-agent` from `PATH`.

## Arguments

| Argument | Required | Description |
|---|---|---|
| `--context-file <path>` | yes | Initial context file read at session startup. |
| `--prompt-file <path>` | no | System prompt file. When omitted, the CLI uses `default_prompt_file` from `config/realtime-agent.json`. |
| `--model <model>` | no | Realtime model name. Default from config (`gpt-realtime-2`). |
| `--tool <name>` | no | Repeatable tool selector. Comma-separated names in one value are accepted. Built-in registry currently includes `echo`. |
| `--input-device <id-or-name>` | no | Microphone selector by numeric id or unique case-insensitive name substring. |
| `--list-input-devices` | no | Print available input devices and exit. |
| `--safety-identifier <id>` | no | Value for the `OpenAI-Safety-Identifier` request header. |

`--context-file` is always required for a normal run. Unknown tool names fail before the session connects.

## API key and configuration

The CLI loads `config/realtime-agent.json` and `config/api_keys.json` from the
Sheaf repository root. It does not read environment variables for configuration.

See [Configuration](config.md).

## Default prompt lookup

When `--prompt-file` is omitted, the resolved default is:

```text
projects/realtime-agent/prompts/system-prompts/basic_realtime_conversation_v1.md
```

The path comes from `default_prompt_file` in `config/realtime-agent.json`.

## Text-output-only behavior

The CLI configures Realtime sessions for text output only. Audio output is not
enabled. Assistant replies arrive as text events on stdout and in persistence.

## Server VAD behavior

The CLI uses server VAD turn detection with a 500 ms silence threshold,
automatic response creation, and response interruption enabled. Startup sends an
initial `response.create` after injecting the system prompt and context.

Manual turn mode is available through the library API for other consumers such as
the VS Code extension. See [Turn model](../explanation/turn-model.md).

## Stdout event output

The CLI prints one JSON object per non-audio Realtime event:

```json
{"session_id":"...","direction":"incoming","event_type":"response.output_text.delta","event":{}}
```

Outgoing `input_audio_buffer.append` events are omitted from stdout because they
are frequent and contain audio payloads.

Implementation: `ShouldLogEvent` and `logEventLine` in
`src/agent/src/stdout_logger.ts`.

## Input device listing and selection

List devices:

```bash
realtime-agent --list-input-devices
```

Select by numeric id or unique name substring. When no device is supplied, the
PortAudio default input device is used. Ambiguous or missing matches fail
startup with an explicit error.

## Shutdown

`SIGINT` and `SIGTERM` stop microphone capture, close the realtime session, mark
the session ended, and close the database.

## Entry points

- `ParseCliArgs(argv)` — argument parsing and validation.
- `RunCli(argv, deps?)` — full CLI run including config load, API key load, and signal handling.
- `StartCliRuntime(options, deps)` — start a session with injectable dependencies for tests.

Source: `src/agent/src/cli.ts`.
