# Contract: Configuration Files

Shared by [service-lifecycle](../../../../openspec/specs/dictator-service-lifecycle/spec.md) (startup
load), [dictation-pipeline](../../../../openspec/specs/dictator-dictation-pipeline/spec.md) (consumes
every pipeline knob), [web-ui](../../../../openspec/specs/dictator-web-ui/spec.md) (edits/resets), and
[launchpad](../../../../openspec/specs/dictator-launchpad/spec.md) (auxiliary prompts, safe restore).
Repo-wide config rules: [Configuration](../../../../structure/configuration.md).
There is no environment-variable configuration.

## `config/dictator.json`

Runtime settings at the Sheaf repo root. Keys and defaults (defaults apply
when a key is missing or, for strings, blank):

| Key | Type | Default | Meaning |
|---|---|---|---|
| `version` | int | `1` when absent; bootstrap writes `2` | Config schema version |
| `audio_input` | string or null | `null` | Dictator recording input selector; missing, null, or blank after trimming uses the system default input |
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
| `injectable_rules` | object | `{}` | Trigger string → prompt file path, relative to `system_prompts_dir`; matching triggers append prompt file contents during refinement |
| `updated_at` | string | — (**required**) | ISO-8601 timestamp of the last write |

Decode leniency: only `use_cloud` and `updated_at` are required. A legacy
`"model"` key (version-1 files) seeds both `cloud_model` and `local_model`
when those are absent.

`audio_input` selects the macOS input used by Dictator recording surfaces,
including the web dashboard and Launchpad record pad. Missing, `null`, or
blank values mean "use the current system default input". A nonblank value is
trimmed and matched exactly against an available input's stable ID or display
name. There is no fallback for a configured input: if the selected input is
missing, ambiguous, has no input channels, or cannot be opened for recording,
Dictator fails that recording attempt instead of using the system default.
The web dashboard hides its record/submit affordance while the selected input
is unavailable; Launchpad renders the `(0,7)` record-status pad off and
ignores dictation actions until the selected input becomes available again.

Relative `data_dir` / `system_prompts_dir` / `stt_model_path` values resolve
against the Sheaf repo root for known prefixes (`projects/dictator/`,
`config/`, `data/dictator`, `logs/dictator`, `prompts/`, `contracts/`,
`skills/`); other relative paths prefer an existing path under the current
directory, then the repo root.

`injectable_rules` matching is case-insensitive simple substring matching
against the raw Whisper transcript. Values are prompt file paths, not inline
instruction text. When a trigger matches, Dictator loads that prompt file from
the prompt catalog and appends its contents to the refinement prompt only; the
raw transcript and refinement input are not modified.

Writes (config patch, prompt selection, injectable rule edits, reset, safe restore, first-run
creation) are atomic — pretty-printed JSON with sorted keys written to
`<file>.tmp` then replaced — and refresh `updated_at`
(`yyyy-MM-ddTHH:mm:ssZ`).

Worked example (current production shape):

```json
{
  "audio_input": null,
  "auxiliary_system_prompt_1": "intent_refiner_v1.md",
  "auxiliary_system_prompt_2": "intent_refiner_v1.md",
  "cloud_model": "gpt-4.1-mini",
  "data_dir": "data/dictator",
  "dictator_server_enabled": true,
  "dictator_server_host": "0.0.0.0",
  "dictator_server_port": 9003,
  "fallback_mode": "openai",
  "injectable_rules": {},
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
