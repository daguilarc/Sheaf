# Dictator Configuration

Dictator reads persistent configuration from the Sheaf `config/` directory. There is no environment-variable configuration and no app-local `Config/` tree.

## `config/dictator.json`

Project-specific runtime settings. Fields:

| Field | Type | Description |
|-------|------|-------------|
| `version` | int | Config schema version (currently `2`) |
| `cloud_model` | string | OpenAI model name when `use_cloud` is true |
| `local_model` | string | Ollama model name when `use_cloud` is false |
| `system_prompt` | string | Primary refinement prompt filename under the system-prompts directory |
| `auxiliary_system_prompt_1` | string | First auxiliary prompt filename |
| `auxiliary_system_prompt_2` | string | Second auxiliary prompt filename |
| `interactions_buffer_bytes` | int | In-memory and startup reload budget for interaction history |
| `use_cloud` | bool | When true, refinement uses the cloud provider |
| `fallback_mode` | string | Fallback provider identifier (for example `openai`) |
| `ollama_host` | string | Ollama HTTP base URL |
| `stt_model_path` | string | Repo-relative or absolute path to the whisper.cpp model binary |
| `stt_language` | string | STT language code |
| `ollama_bin_path` | string | Path to the `ollama` executable for local bootstrap |
| `data_dir` | string | Repo-relative data directory (default `data/dictator`) |
| `system_prompts_dir` | string | Repo-relative prompt catalog directory |
| `dictator_server_host` | string | Compatibility/display field for the service host default |
| `dictator_server_port` | int | Compatibility/display field for the service port default (`9003`) |
| `dictator_server_enabled` | bool | When false, logs a warning but still starts using the registered endpoint |
| `updated_at` | string | ISO-8601 timestamp of the last config write |

The web UI and `PATCH /api/config` update the editable subset. `POST /api/config/reset` restores values from `config/dictator.safe` when present, otherwise bootstrap defaults.

## `config/api_keys.json`

Git-ignored secrets file. Shape:

```json
{
  "dictator": {
    "openai_api_key": "sk-..."
  }
}
```

Only the `dictator.openai_api_key` field is read. Empty or missing keys disable cloud refinement and surface warnings in the web UI status strip.

## `config/api_keys.example.json`

Committed template with a blank key:

```json
{
  "dictator": {
    "openai_api_key": ""
  }
}
```

Copy to `config/api_keys.json` and fill in the key locally. Never commit real key material.

## Service endpoint

The bind host and port come from `config/services.json` for service name `dictator`. Dictator loads the registry entry on startup and uses port **9003** unless a deliberate CLI override is supplied with `--host` or `--port`.

The `dictator_server_host`, `dictator_server_port`, and `dictator_server_enabled` fields remain in `config/dictator.json` for compatibility and dashboard display. They do not silently override the Sheaf service registry during normal service startup.

See [Services](services.md) for registry and shutdown rules.

## What is not used

- Environment variables for persistent configuration
- App-local `Config/runtime-config.json` or `Config/secrets.json`
- External repository paths or legacy default ports
