# Contract: Configuration Files

Shared by [service-lifecycle](../capabilities/service-lifecycle.md) (startup
load), [dictation-pipeline](../capabilities/dictation-pipeline.md) (consumes
every pipeline knob), [web-ui](../capabilities/web-ui.md) (edits/resets), and
[launchpad](../capabilities/launchpad.md) (auxiliary prompts, safe restore).
Repo-wide config rules: [Configuration](../../../../structure/configuration.md).
There is no environment-variable configuration.

## `config/dictator.json`

Runtime settings at the Sheaf repo root. Keys and defaults (defaults apply
when a key is missing or, for strings, blank):

| Key | Type | Default | Meaning |
|---|---|---|---|
| `version` | int | `1` when absent; bootstrap writes `2` | Config schema version |
| `cloud_model` | string | `gpt-4.1-mini` | OpenAI model when `use_cloud` |
| `local_model` | string | `qwen2.5:7b-instruct` | Ollama model otherwise |
| `system_prompt` | string | `intent_refiner_v1.md` | Primary prompt file, relative to the prompts dir |
| `auxiliary_system_prompt_1` | string | `intent_refiner_v1.md` | Launchpad auxiliary slot 1 |
| `auxiliary_system_prompt_2` | string | `intent_refiner_v1.md` | Launchpad auxiliary slot 2 |
| `interactions_buffer_bytes` | int | `104857600` (100 MiB) | In-memory history cap and startup reload budget |
| `use_cloud` | bool | — (**required**) | `true` → OpenAI, `false` → Ollama |
| `fallback_mode` | string | `openai` | `openai` enables Ollama→OpenAI fallback; anything else effectively none |
| `ollama_host` | string | `http://127.0.0.1:11434` | Ollama base URL (trailing slashes trimmed) |
| `stt_model_path` | string | `models/ggml-base.en.bin` | whisper.cpp model, absolute or repo-root-relative |
| `stt_language` | string | `en` | STT language code |
| `ollama_bin_path` | string | `/opt/homebrew/bin/ollama` | `ollama` executable path (currently unused at runtime) |
| `data_dir` | string | `data/dictator` | Interaction data directory |
| `system_prompts_dir` | string | `projects/dictator/src/prompts/system-prompts` | Prompt catalog directory |
| `dictator_server_host` | string | `0.0.0.0` | Display/compat only — the bind endpoint comes from `config/services.json` |
| `dictator_server_port` | int | `9003` | Display/compat only |
| `dictator_server_enabled` | bool | `true` | `false` logs a startup warning; service starts anyway |
| `updated_at` | string | — (**required**) | ISO-8601 timestamp of the last write |

Decode leniency: only `use_cloud` and `updated_at` are required. A legacy
`"model"` key (version-1 files) seeds both `cloud_model` and `local_model`
when those are absent.

Relative `data_dir` / `system_prompts_dir` / `stt_model_path` values resolve
against the Sheaf repo root for known prefixes (`projects/dictator/`,
`config/`, `data/dictator`, `logs/dictator`, `prompts/`, `contracts/`,
`skills/`); other relative paths prefer an existing path under the current
directory, then the repo root.

Writes (config patch, prompt selection, reset, safe restore, first-run
creation) are atomic — pretty-printed JSON with sorted keys written to
`<file>.tmp` then replaced — and refresh `updated_at`
(`yyyy-MM-ddTHH:mm:ssZ`).

Worked example (current production shape):

```json
{
  "auxiliary_system_prompt_1": "intent_refiner_v1.md",
  "auxiliary_system_prompt_2": "intent_refiner_v1.md",
  "cloud_model": "gpt-4.1-mini",
  "data_dir": "data/dictator",
  "dictator_server_enabled": true,
  "dictator_server_host": "0.0.0.0",
  "dictator_server_port": 9003,
  "fallback_mode": "openai",
  "interactions_buffer_bytes": 104857600,
  "local_model": "qwen2.5:7b-instruct",
  "ollama_bin_path": "/opt/homebrew/bin/ollama",
  "ollama_host": "http://127.0.0.1:11434",
  "stt_language": "en",
  "stt_model_path": "models/ggml-base.en.bin",
  "system_prompt": "intent_refiner_v1.md",
  "system_prompts_dir": "projects/dictator/src/prompts/system-prompts",
  "updated_at": "2026-06-07T20:42:10Z",
  "use_cloud": true,
  "version": 2
}
```

## `config/dictator.safe`

Optional file with the same schema. When present at service startup it
becomes the *default config*: the basis for `GET /api/config` default
values, `POST /api/config/reset`, and the Launchpad safe-config pad. When
absent, the in-code bootstrap defaults (table above, `use_cloud: false`)
serve that role. If `config/dictator.json` itself is missing at startup, it
is created from this default.

## `config/api_keys.json`

Git-ignored shared secrets file at the repo root. Dictator reads only the
top-level `openai_api_key`; other keys may coexist for other Sheaf apps.
The value is whitespace-trimmed; empty or missing means "not configured"
(cloud refinement fails with `Missing OpenAI API key`, and the health/status
warning surfaces). The file is read-only to dictator — there is no API that
writes key material, and key material never appears in any response.

```json
{
  "openai_api_key": "sk-..."
}
```

`config/api_keys.example.json` is the committed template; copy it to
`config/api_keys.json` and fill in keys locally.

## Code pointers

- `src/Sources/DictatorCore/RuntimeConfig.swift` — `RuntimeConfigFile`
  (defaults, lenient decoder, path resolution), `RuntimeConfigStore`
  (atomic save), `RuntimeConfigProvider` (in-memory state, patch validation,
  defaults restore).
- `src/Sources/DictatorCore/APIKeysStore.swift`, `APIKeyResolver.swift` —
  secrets read path.
- Tests: `tests/DictatorCoreTests/RuntimeConfigProviderTests.swift`,
  `RuntimeConfigurationManagerTests.swift`, `APIKeysStoreTests.swift`,
  `APIKeyResolverTests.swift`.
