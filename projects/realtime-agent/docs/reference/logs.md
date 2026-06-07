# Logs Reference

Runtime logs follow [structure/logs-and-data.md](../../../../structure/logs-and-data.md).

## CLI runtime log

Default path:

```text
logs/realtime-agent/realtime-agent.jsonl
```

Written by `CreateRuntimeLogger` in `src/agent/src/runtime_log.ts`. The CLI
creates the `logs/realtime-agent/` directory as needed.

## VS Code extension runtime log

When the extension runs against a Sheaf repository workspace:

```text
logs/realtime-agent/vscode-extension.jsonl
```

Resolved by `ResolveExtensionRuntimeLogPath` in
`src/vscode-extension/src/repoConfig.ts`.

## Log format

Each line is a JSON object:

```json
{
  "timestamp": "2026-06-07T12:00:00.000Z",
  "level": "info",
  "event": "cli_startup",
  "fields": { "model": "gpt-realtime-2" }
}
```

Levels: `info`, `warn`, `error`.

## Logged event categories

Examples of structured `event` names:

| Event | Typical use |
|---|---|
| `cli_startup` | CLI session start metadata. |
| `microphone_setup_failed` | Audio capture setup failure. |
| `config_lookup_failed` | Extension failed to read `config/api_keys.json`. |
| Session lifecycle and transport errors | Connection loss, shutdown reasons. |

Exact event names are defined at call sites in `src/agent/src/cli.ts`,
`src/vscode-extension/src/extension.ts`, and related modules.

## Secret and audio redaction policy

`CreateRuntimeLogger` sanitizes field keys before writing:

- Keys matching `api_key`, `authorization`, `secret`, `token`, or `password`
  (case-insensitive) are replaced with `[redacted]`.
- Audio-related keys such as `pcmBase64`, `audio`, and `frame` are replaced with
  `[redacted]`.

Stdout logging for the CLI uses a separate filter: outgoing
`input_audio_buffer.append` events are omitted entirely from stdout. See
[CLI reference](cli.md).

## Git ignore

Log files under `logs/realtime-agent/` are runtime output and ignored by git.
