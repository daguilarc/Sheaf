# Capability: Config

ID prefix: `cfg`

## Purpose

The library locates the Sheaf repository root by directory walking, loads
project configuration from `config/realtime-agent.json` and the OpenAI API
key from `config/api_keys.json`, and writes structured JSONL runtime logs
with secret/audio redaction. Repo-wide rules:
[Configuration](../../../../structure/configuration.md),
[Logs And Data](../../../../structure/logs-and-data.md).

## Requirements

- **[cfg-1]** THE library SHALL discover the repository root
  (`FindRepositoryRoot(startPath?)`) by walking up from the start directory
  (default `process.cwd()`; path helpers also try the module's own
  directory first) until it finds a directory containing both
  `config/services.json` and a `structure/` entry, returning `undefined` at
  the filesystem root.
- **[cfg-2]** WHEN `LoadRealtimeAgentConfig` is called, THE library SHALL
  read `<root>/config/realtime-agent.json`; IF the file is absent (ENOENT),
  THEN it SHALL return the built-in defaults; IF the file exists but cannot
  be read or parsed, THEN it SHALL throw
  `ConfigLoadError("Failed to load <path>: <message>")`. Each missing field
  in a present file falls back to its default individually.
- **[cfg-3]** THE resolved config SHALL contain the raw fields plus
  absolute paths resolved against the repo root: `configFile`,
  `databasePath` (from `database_path`), `defaultPromptPath` (from
  `default_prompt_file`), `logsDir` (from `logs_dir`), and `runtimeLogPath`
  — which is always `<root>/logs/realtime-agent/realtime-agent.jsonl`
  regardless of `logs_dir` (known quirk, see [coverage](../coverage.md)).
- **[cfg-4]** IF no repository root can be found when one is required, THEN
  config loading SHALL throw `ConfigLoadError("repository root not found")`.
- **[cfg-5]** WHEN `LoadOpenAiApiKey` is called, THE library SHALL read
  `<root>/config/api_keys.json` and return the trimmed `openai_api_key`
  string when non-empty; IF the file is missing or the key is
  absent/blank, THEN it SHALL throw
  `ConfigLoadError('OpenAI API key not found. Add "openai_api_key" to <path>.')`;
  IF the file exists but cannot be read/parsed, THEN
  `ConfigLoadError("Failed to load <path>: <message>")`.
- **[cfg-6]** WHEN `CreateRuntimeLogger({logPath?, repoRoot?})` is called,
  THE library SHALL create the log file's parent directory and return a
  logger that appends one JSON object per line in the runtime-log format
  (see Contracts) via `Log` (info), `LogWarn`, and `LogError`; `Close()` is
  a no-op (writes are synchronous appends).
- **[cfg-7]** THE runtime logger SHALL replace the value of any top-level
  field whose key matches `/api[_-]?key|authorization|secret|token|password/i`,
  or whose key is exactly `pcmBase64`, `audio`, or `frame`, with the string
  `"[redacted]"` before writing.
- **[cfg-8]** THE library SHALL read no environment variables for
  configuration or API keys; the only environment variable in the project
  is `REALTIME_AGENT_REC_PATH` ([audio-capture](audio-capture.md) aud-5).

## Contracts

### `config/realtime-agent.json`

```json
{
  "model": "gpt-realtime-2",
  "data_dir": "data/realtime-agent",
  "database_path": "data/realtime-agent/realtime-agent.sqlite",
  "logs_dir": "logs/realtime-agent",
  "default_prompt_file": "projects/realtime-agent/prompts/system-prompts/basic_realtime_conversation_v1.md",
  "updated_at": "2026-06-07T00:00:00Z",
  "version": 1
}
```

| Field | Default | Meaning |
|---|---|---|
| `model` | `gpt-realtime-2` | CLI default model when `--model` omitted |
| `data_dir` | `data/realtime-agent` | project data directory (informational; nothing resolves it) |
| `database_path` | `data/realtime-agent/realtime-agent.sqlite` | CLI SQLite path, repo-root-relative |
| `logs_dir` | `logs/realtime-agent` | resolved to `logsDir` (informational) |
| `default_prompt_file` | `projects/realtime-agent/prompts/system-prompts/basic_realtime_conversation_v1.md` | CLI default system prompt, repo-root-relative |
| `updated_at`, `version` | — | optional metadata, passed through |

### `config/api_keys.json` (git-ignored)

```json
{ "openai_api_key": "sk-..." }
```

### Runtime log entry (canonical JSONL format)

One JSON object per line:

```json
{"timestamp":"2026-06-07T12:00:00.000Z","level":"info","event":"cli_startup","fields":{"model":"gpt-realtime-2"}}
```

- `timestamp` — ISO-8601 write time.
- `level` — `info` | `warn` | `error`.
- `event` — snake_case event name chosen by the caller.
- `fields` — optional object, post-redaction (cfg-7).

Files using this format: `logs/realtime-agent/realtime-agent.jsonl`
([cli](cli.md)) and `logs/realtime-agent/vscode-extension.jsonl`
([vscode-extension](vscode-extension.md)). Both are git-ignored runtime
output.

### Default path set (`GetDefaultRealtimeAgentPaths`)

| Key | Repo-relative path |
|---|---|
| `configFile` | `config/realtime-agent.json` |
| `apiKeysFile` | `config/api_keys.json` |
| `defaultPromptFile` | `projects/realtime-agent/prompts/system-prompts/basic_realtime_conversation_v1.md` |
| `databasePath` | `data/realtime-agent/realtime-agent.sqlite` |
| `runtimeLogPath` | `logs/realtime-agent/realtime-agent.jsonl` |

### Error catalogue

| Condition | Error | Message (exact) |
|---|---|---|
| Repo root not found | `ConfigLoadError` | `repository root not found` |
| Config file unreadable/invalid (non-ENOENT) | `ConfigLoadError` | `Failed to load <path>: <message>` |
| API key file missing or key blank | `ConfigLoadError` | `OpenAI API key not found. Add "openai_api_key" to <path>.` |
| API keys file unreadable/invalid (non-ENOENT) | `ConfigLoadError` | `Failed to load <path>: <message>` |
| Path helpers without a root | `Error` | `repository root not found` |

## Design

- `src/agent/src/repo_paths.ts` — root discovery and the relative-path
  constants; `ResolveRepositoryPath(relative, root?)` joins against the
  root.
- `src/agent/src/config.ts` — `LoadRealtimeAgentConfig` (per-field default
  merge), `LoadOpenAiApiKey`, `ConfigLoadError`. Both accept `repoRoot` /
  explicit path overrides for tests.
- `src/agent/src/runtime_log.ts` — `CreateRuntimeLogger`, `SanitizeFields`;
  writes with `appendFileSync`.
- Tests: `tests/agent/config/config.test.ts`,
  `tests/agent/runtime_log/runtime_log.test.ts`.

## Interactions

- [cli](cli.md) — loads config + API key at startup; resolves prompt,
  model, database, and log paths from here.
- [vscode-extension](vscode-extension.md) — uses `FindRepositoryRoot` (plus
  its own `projects/realtime-agent` check), reads `api_keys.json` directly,
  and writes its JSONL log in this format.
- [persistence](persistence.md) — consumes `databasePath`.
- [audio-capture](audio-capture.md) — owns the one environment variable.
