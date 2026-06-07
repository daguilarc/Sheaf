# Configuration Reference

Realtime Agent follows Sheaf repository configuration rules. See also
[structure/configuration.md](../../../../structure/configuration.md).

## Project config file

Path: `config/realtime-agent.json`

Example:

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

| Field | Description |
|---|---|
| `model` | Default Realtime model for the CLI when `--model` is omitted. |
| `data_dir` | Project data directory relative to repository root. |
| `database_path` | CLI SQLite database path relative to repository root. |
| `logs_dir` | Project logs directory relative to repository root. |
| `default_prompt_file` | Default system prompt path relative to repository root. |
| `version` | Config schema version. |
| `updated_at` | Last update timestamp. |

When the config file is missing, the library uses the same defaults as above.

Loader: `LoadRealtimeAgentConfig` in `src/agent/src/config.ts`.

## API keys

Path: `config/api_keys.json` (git-ignored)

The CLI and extension read the OpenAI API key from:

```json
{
  "openai_api_key": "sk-..."
}
```

Loader: `LoadOpenAiApiKey` in `src/agent/src/config.ts`.

## No environment variable dependencies

Realtime Agent does not use environment variables for project configuration or
API keys.

## CLI configuration resolution

On startup the CLI:

1. Finds the Sheaf repository root via `config/services.json` and `structure/`.
2. Loads `config/realtime-agent.json`.
3. Loads `openai_api_key` from `config/api_keys.json`.
4. Resolves paths such as `database_path`, `logs_dir`, and `default_prompt_file`
   against the repository root.

Runtime log path default: `logs/realtime-agent/realtime-agent.jsonl`.

## VS Code extension configuration resolution

### API key priority

1. VS Code Secret Storage key `sheaf.realtime.openAiApiKey`
2. `config/api_keys.json` when the workspace resolves to a Sheaf repository root
3. `sheaf.realtime.openAiApiKey` workspace setting

The workspace setting remains supported for explicit backwards compatibility when
Secret Storage and repository config do not provide a key.

Resolver: `ResolveOpenAiApiKey` in `src/vscode-extension/src/configCore.ts`.

### Other extension settings

Model, system prompt, input device, and safety identifier come from
`sheaf.realtime.*` workspace settings. When `sheaf.realtime.systemPrompt` is
empty, the extension uses a built-in prompt for the `sheaf VS Code` tool set.

### Repository workspace detection

The extension treats a folder as a Sheaf repository workspace when
`FindRepositoryRoot` succeeds and `projects/realtime-agent/` exists. In that
case it can load `config/api_keys.json` and write extension runtime logs under
`logs/realtime-agent/`.
