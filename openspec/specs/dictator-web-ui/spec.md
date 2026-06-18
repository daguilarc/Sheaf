# Capability: Web UI

Project: `projects/dictator`
ID prefix: `web` — requirement IDs are append-only; never renumber or reuse.

## Purpose

The service serves a browser-based operational dashboard at `/` (the
registered home path) plus JSON APIs under `/api/*`: live status, runtime
config editing with pickers and reset, system-prompt browsing/selection,
interaction history review, model listing, and API-key status. It replaces
the legacy AppKit menu-bar UI. Repo-wide UI rules:
[Web UI](../../../structure/webui.md).

## Requirements

### Requirement: web-1 — Static shell: GET / and assets

WHEN it receives `GET /`, THE service SHALL serve `projects/dictator/src/web/index.html` as `text/html; charset=utf-8`; `GET /assets/<path>` serves files from the same directory (`app.js` as `application/javascript; charset=utf-8`, `styles.css` as `text/css; charset=utf-8`; `.json`, `.svg`, `.png` get matching types, anything else `application/octet-stream`).

#### Scenario: GET /

- **WHEN** the service receives `GET /`
- **THEN** it serves `projects/dictator/src/web/index.html` as `text/html; charset=utf-8`

#### Scenario: GET /assets/<path>

- **WHEN** the service receives `GET /assets/<path>`
- **THEN** it serves the file from the same directory with the appropriate content type (`app.js` as `application/javascript; charset=utf-8`, `styles.css` as `text/css; charset=utf-8`, `.json`/`.svg`/`.png` get matching types, anything else `application/octet-stream`)

### Requirement: web-2 — Static shell: path traversal and missing files

IF an asset path is empty, absolute, or escapes the web root (`..` components; backslashes are normalized to `/` first), THEN THE service SHALL respond 404 with `{"error": "Not found."}`; missing files also 404.

#### Scenario: Traversal or invalid path

- **WHEN** an asset path is empty, absolute, or contains `..` components (backslashes normalized to `/` first)
- **THEN** the service responds 404 with `{"error": "Not found."}`

#### Scenario: Missing file

- **WHEN** a requested asset file does not exist
- **THEN** the service responds 404 with `{"error": "Not found."}`

### Requirement: web-3 — Status and keys: GET /api/status

WHEN it receives `GET /api/status`, THE service SHALL respond 200 with the status body (see Contracts): health fields, `dictation_state` (`idle` | `processing`), `provider_mode` (`cloud` | `local`), the active config values including `audio_input`, audio-input availability fields, `api_keys.openai_configured`, STT model presence and path, live Ollama reachability (2-second probe of `<ollama_host>/api/tags`), log/data paths, and the dictate/health endpoint strings. It SHALL never include API key material.

#### Scenario: GET /api/status

- **WHEN** the service receives `GET /api/status`
- **THEN** it responds 200 with the full status body including health fields, `dictation_state`, `provider_mode`, active config values including `audio_input`, audio-input availability fields, `api_keys.openai_configured`, STT model presence and path, live Ollama reachability, log/data paths, and endpoint strings — and never includes API key material

### Requirement: web-4 — Status and keys: GET /api/api-key-status

WHEN it receives `GET /api/api-key-status`, THE service SHALL respond 200 with `{"openai": {"configured": <bool>}}` — configured means `config/api_keys.json` has a non-blank `openai_api_key`.

#### Scenario: GET /api/api-key-status

- **WHEN** the service receives `GET /api/api-key-status`
- **THEN** it responds 200 with `{"openai": {"configured": <bool>}}` where configured means `config/api_keys.json` has a non-blank `openai_api_key`

### Requirement: web-5 — Runtime configuration: GET /api/config

WHEN it receives `GET /api/config`, THE service SHALL respond 200 with `{"fields": [...], "updated_at": <config timestamp>}` listing exactly the eight editable fields sorted by name — `audio_input`, `auxiliary_system_prompt_1`, `auxiliary_system_prompt_2`, `cloud_model`, `interactions_buffer_bytes`, `local_model`, `system_prompt`, `use_cloud` — each as `{name, label, type ("bool"|"string"), editable: true, current: {kind, value}, default: {kind, value}}`. `audio_input` is presented as a string where empty means default input; `interactions_buffer_bytes` is presented as a megabyte string such as `100 MB`; defaults come from `config/dictator.safe` when present at startup, else bootstrap values.

#### Scenario: GET /api/config

- **WHEN** the service receives `GET /api/config`
- **THEN** it responds 200 with `{"fields": [...], "updated_at": <config timestamp>}` listing exactly the eight editable fields sorted by name, each with `{name, label, type, editable: true, current: {kind, value}, default: {kind, value}}`, with `audio_input` as a string where empty means default input, `interactions_buffer_bytes` as a megabyte string, and defaults from `config/dictator.safe` or bootstrap values

### Requirement: web-6 — Runtime configuration: PATCH /api/config

WHEN it receives `PATCH /api/config` with any subset of `audio_input` (string or null), `use_cloud` (bool), `cloud_model`, `local_model`, `system_prompt`, `auxiliary_system_prompt_1`, `auxiliary_system_prompt_2` (strings), and `interactions_buffer_bytes` (integer bytes), THE service SHALL apply the fields, persist the result to `config/dictator.json`, and respond 200 with the updated config snapshot; IF no field is present, THEN it SHALL respond 400 (`config patch must include at least one field`). `audio_input` values that are null or blank after trimming are persisted as the default-input setting; non-blank values are stored without requiring the device to be currently available.

#### Scenario: Valid PATCH /api/config

- **WHEN** the service receives `PATCH /api/config` with at least one recognized field
- **THEN** it applies the fields, persists the result to `config/dictator.json`, and responds 200 with the updated config snapshot

#### Scenario: Audio input patch uses default input

- **WHEN** the service receives `PATCH /api/config` with `audio_input` null or blank after trimming
- **THEN** it persists the default-input setting and responds 200 with the updated config snapshot

#### Scenario: Audio input patch names unavailable device

- **WHEN** the service receives `PATCH /api/config` with a non-blank `audio_input` value that is not currently available
- **THEN** it stores that value without substituting the default input and responds 200 with the updated config snapshot

#### Scenario: Empty PATCH /api/config

- **WHEN** the service receives `PATCH /api/config` with no recognized field present
- **THEN** it responds 400 with `config patch must include at least one field`

### Requirement: web-7 — Runtime configuration: model fuzzy match

WHEN setting `cloud_model` or `local_model`, THE service SHALL resolve the requested value against the available options (cloud presets / live Ollama tags) by normalized exact match, then containment, then Levenshtein distance, and store the best match (cloud labels are canonicalized to preset model ids); IF the option source is unavailable (e.g. Ollama unreachable while setting `local_model`), THEN the patch SHALL fail 400.

#### Scenario: Model resolved by fuzzy match

- **WHEN** setting `cloud_model` or `local_model` with a value that requires fuzzy matching
- **THEN** the service resolves it by normalized exact match, then containment, then Levenshtein distance, and stores the best match (cloud labels canonicalized to preset model ids)

#### Scenario: Option source unavailable

- **WHEN** setting `local_model` while Ollama is unreachable
- **THEN** the patch fails 400

### Requirement: web-8 — Runtime configuration: buffer clamping and validation

WHEN setting `interactions_buffer_bytes`, THE service SHALL clamp to whole megabytes (`max(1, bytes / 1 MiB)`) and immediately apply the new cap to the in-memory interaction buffer; system-prompt fields SHALL be validated against the prompt catalog (unknown path → 400); empty models/prompts and non-positive buffer sizes → 400.

#### Scenario: Buffer bytes clamped

- **WHEN** setting `interactions_buffer_bytes`
- **THEN** the service clamps to whole megabytes (`max(1, bytes / 1 MiB)`) and immediately applies the new cap to the in-memory interaction buffer

#### Scenario: Unknown system-prompt path

- **WHEN** a system-prompt field is set to an unknown path
- **THEN** the service responds 400

#### Scenario: Empty model/prompt or non-positive buffer

- **WHEN** an empty model or prompt value, or a non-positive buffer size is submitted
- **THEN** the service responds 400

### Requirement: web-9 — Runtime configuration: POST /api/config/reset

WHEN it receives `POST /api/config/reset`, THE service SHALL rewrite `config/dictator.json` from the startup defaults (`config/dictator.safe` snapshot or bootstrap), refresh `updated_at`, apply the restored buffer size, and respond 200 with the new snapshot.

#### Scenario: POST /api/config/reset

- **WHEN** the service receives `POST /api/config/reset`
- **THEN** it rewrites `config/dictator.json` from the startup defaults, refreshes `updated_at`, applies the restored buffer size, and responds 200 with the new snapshot

### Requirement: web-10 — Runtime configuration: GET /api/config/options

WHEN it receives `GET /api/config/options?name=<field>`, THE service SHALL respond 200 with `{"name": <field>, "options": [{kind, value}, ...]}`: `audio_input` → empty/default option plus currently available audio input names or stable identifiers, `use_cloud` → `false, true`; `cloud_model` → the presets `gpt-4.1-mini`, `gpt-5.2`; `local_model` → live Ollama tag names (failure → 400); prompt fields → the recursive prompt-file list; `interactions_buffer_bytes` → `25 MB, 50 MB, 100 MB, 200 MB, 500 MB`. Missing `name` → 400 `name query parameter is required`; unknown field → 400.

#### Scenario: GET /api/config/options for known field

- **WHEN** the service receives `GET /api/config/options?name=<known field>`
- **THEN** it responds 200 with `{"name": <field>, "options": [{kind, value}, ...]}` appropriate to that field

#### Scenario: Audio input options

- **WHEN** the service receives `GET /api/config/options?name=audio_input`
- **THEN** it responds 200 with an empty/default option plus the currently available audio input names or stable identifiers

#### Scenario: Missing name parameter

- **WHEN** the service receives `GET /api/config/options` without a `name` query parameter
- **THEN** it responds 400 with `name query parameter is required`

#### Scenario: Unknown field name

- **WHEN** the service receives `GET /api/config/options?name=<unknown field>`
- **THEN** it responds 400

#### Scenario: local_model options with Ollama failure

- **WHEN** the service receives `GET /api/config/options?name=local_model` and Ollama is unreachable
- **THEN** it responds 400

### Requirement: web-11 — System prompts: GET /api/prompts

WHEN it receives `GET /api/prompts?dir=<subdir>`, THE service SHALL respond 200 with `{"directory": <dir>, "entries": [{name, path, kind: "directory"|"file"}, ...]}` for the catalog directory (`system_prompts_dir`), directories first, names sorted case-insensitively; IF the directory does not exist or the path escapes the catalog, THEN it SHALL respond 400.

#### Scenario: GET /api/prompts for existing directory

- **WHEN** the service receives `GET /api/prompts?dir=<subdir>` for an existing directory within the catalog
- **THEN** it responds 200 with `{"directory": <dir>, "entries": [...]}` directories first, names sorted case-insensitively

#### Scenario: Directory does not exist or path escapes catalog

- **WHEN** the requested directory does not exist or the path escapes the catalog
- **THEN** the service responds 400

### Requirement: web-12 — System prompts: GET /api/prompts/preview

WHEN it receives `GET /api/prompts/preview?path=<file>`, THE service SHALL respond 200 with `{"path": <sanitized>, "body": <trimmed content>, "byte_count": <utf8 length>}`; missing `path` param → 400 `path query parameter is required`; empty prompt file or escaping path → 400.

#### Scenario: GET /api/prompts/preview for valid file

- **WHEN** the service receives `GET /api/prompts/preview?path=<file>` for a valid, non-empty file within the catalog
- **THEN** it responds 200 with `{"path": <sanitized>, "body": <trimmed content>, "byte_count": <utf8 length>}`

#### Scenario: Missing path parameter

- **WHEN** the service receives `GET /api/prompts/preview` without a `path` query parameter
- **THEN** it responds 400 with `path query parameter is required`

#### Scenario: Empty file or escaping path

- **WHEN** the prompt file is empty or the path escapes the catalog
- **THEN** the service responds 400

### Requirement: web-13 — System prompts: POST /api/prompts/selection

WHEN it receives `POST /api/prompts/selection` with `{"target": "primary"|"auxiliary1"|"auxiliary2", "path": <file>}`, THE service SHALL validate the path against the catalog, persist the selection into the matching `config/dictator.json` field, and respond 200 with the config snapshot; unknown path or target → 400 (see error catalogue).

#### Scenario: Valid prompt selection

- **WHEN** the service receives `POST /api/prompts/selection` with a valid target and catalog path
- **THEN** it persists the selection into the matching `config/dictator.json` field and responds 200 with the config snapshot

#### Scenario: Unknown path or target

- **WHEN** the path is not in the catalog or the target is not one of `primary`, `auxiliary1`, `auxiliary2`
- **THEN** the service responds 400

### Requirement: web-14 — Interaction history and models: GET /api/interactions

WHEN it receives `GET /api/interactions`, THE service SHALL respond 200 with `{"interactions": [...]}` newest-first; each summary has `id`, `occurred_at` (ISO-8601 fractional), `source` (the stored mode), `status` (`success` unless `error_message` is set, then `error`), `provider`, `model`, `transcribe_ms`, `refine_ms`, `total_pipeline_ms`, `output_preview` (160 chars + `…`), and optional `error_preview`.

#### Scenario: GET /api/interactions

- **WHEN** the service receives `GET /api/interactions`
- **THEN** it responds 200 with `{"interactions": [...]}` newest-first, each summary containing `id`, `occurred_at`, `source`, `status`, `provider`, `model`, `transcribe_ms`, `refine_ms`, `total_pipeline_ms`, `output_preview` (160 chars + `…`), and optional `error_preview`

### Requirement: web-15 — Interaction history and models: GET /api/interactions/<id>

WHEN it receives `GET /api/interactions/<id>`, THE service SHALL respond 200 with the full detail (adds `system_prompt_path`, `system_prompt_body`, `whisper_output`, `final_output`, `optional_context`, `edit_summary`, `uncertainty_flags`, `fallback_used`, `error_message`, and the four timings); IF `<id>` is not a UUID, THEN 400 `invalid interaction id`; IF no interaction matches, THEN 404.

#### Scenario: Valid interaction detail

- **WHEN** the service receives `GET /api/interactions/<id>` for a valid UUID that matches an interaction
- **THEN** it responds 200 with the full detail including `system_prompt_path`, `system_prompt_body`, `whisper_output`, `final_output`, `optional_context`, `edit_summary`, `uncertainty_flags`, `fallback_used`, `error_message`, and the four timings

#### Scenario: Non-UUID id

- **WHEN** `<id>` is not a UUID
- **THEN** the service responds 400 with `invalid interaction id`

#### Scenario: Interaction not found

- **WHEN** `<id>` is a valid UUID but no interaction matches
- **THEN** the service responds 404

### Requirement: web-16 — Interaction history and models: GET /api/models

WHEN it receives `GET /api/models?provider=cloud`, THE service SHALL respond 200 with `{"provider": "cloud", "models": ["gpt-4.1-mini", "gpt-5.2"], "warning": null}`; `provider=local` queries `<ollama_host>/api/tags` (5-second timeout) and on failure responds 200 with `models: []` and a `warning` instead of an error; missing `provider` → 400 `provider query parameter is required`; any other value → 400.

#### Scenario: GET /api/models?provider=cloud

- **WHEN** the service receives `GET /api/models?provider=cloud`
- **THEN** it responds 200 with `{"provider": "cloud", "models": ["gpt-4.1-mini", "gpt-5.2"], "warning": null}`

#### Scenario: GET /api/models?provider=local with Ollama available

- **WHEN** the service receives `GET /api/models?provider=local` and Ollama is reachable
- **THEN** it responds 200 with `{"provider": "local", "models": [...], "warning": null}`

#### Scenario: GET /api/models?provider=local with Ollama down

- **WHEN** the service receives `GET /api/models?provider=local` and Ollama fails (5-second timeout)
- **THEN** it responds 200 with `models: []` and a `warning` instead of an error

#### Scenario: Missing provider parameter

- **WHEN** the service receives `GET /api/models` without a `provider` query parameter
- **THEN** it responds 400 with `provider query parameter is required`

#### Scenario: Unknown provider value

- **WHEN** the `provider` query parameter is not `cloud` or `local`
- **THEN** the service responds 400

### Requirement: web-17 — Dashboard behavior

THE dashboard SHALL drive all workflows through these APIs: status strip + quick edits (`/api/status`, `PATCH /api/config`), config panel with per-field pickers (`/api/config`, `/api/config/options`, `/api/config/reset`), prompt browser/preview/selection, interaction list with detail view, and a "Dictation API workflow" panel that uploads a WAV file to `POST /v1/dictate-audio` from the browser (defaults: sample rate `16000`, locale `en-US`, session `web-ui-test`, request id `web-<timestamp>`). It SHALL reference no retired AppKit controls (pinned by `testWebUIDoesNotReferenceRetiredNativeControls` and `testAppJSReferencesOnlyImplementedAPIs`).

#### Scenario: Dashboard API coverage

- **WHEN** any dashboard workflow is executed
- **THEN** it drives the workflow exclusively through the defined APIs (`/api/status`, `PATCH /api/config`, `/api/config`, `/api/config/options`, `/api/config/reset`, prompt browser/preview/selection, `/api/interactions`, `/api/interactions/<id>`, `POST /v1/dictate-audio`)

#### Scenario: No retired AppKit controls

- **WHEN** the dashboard source is inspected
- **THEN** it references no retired AppKit controls (enforced by `testWebUIDoesNotReferenceRetiredNativeControls` and `testAppJSReferencesOnlyImplementedAPIs`)

### Requirement: web-18 — Injectable rules management
WHEN the dashboard manages injectable rules, THE Dictator service SHALL expose the `injectable_rules` object from `config/dictator.json` as editable trigger-to-prompt-file pairs, allow adding or replacing a non-empty trigger key with a valid prompt file path relative to `system_prompts_dir`, allow deleting an existing key, persist successful changes atomically, and render the current stored pairs in the web UI.

#### Scenario: View injectable rules
- **WHEN** the dashboard loads the injectable rules section
- **THEN** it shows all currently stored `injectable_rules` pairs from runtime config

#### Scenario: Add injectable rule
- **WHEN** the user enters a non-empty trigger key, chooses a valid prompt file path, and activates the plus control
- **THEN** the service stores that pair in `config/dictator.json` and the dashboard renders it in the current rules list

#### Scenario: Replace injectable rule prompt file
- **WHEN** the user adds a rule with a key that already exists
- **THEN** the service replaces the existing prompt file path for that key and the dashboard renders the updated path

#### Scenario: Delete injectable rule
- **WHEN** the user activates the delete control for an existing injectable rule
- **THEN** the service removes that key from `config/dictator.json` and the dashboard no longer renders it

#### Scenario: Reject invalid injectable rule edits
- **WHEN** an injectable rule edit contains a blank key, blank prompt file path, absolute prompt file path, escaping prompt file path, unknown prompt file path, empty prompt file, or a delete request for a blank key
- **THEN** the service rejects the edit with a 400 error and does not mutate runtime config

### Requirement: web-19 — Dashboard behavior: Audio input availability
WHEN the dashboard renders Dictator recording controls, THE dashboard SHALL hide the record button when `/api/status` reports `audio_input_available: false`, and SHALL show the record button when the default input is selected or the configured non-blank `audio_input` is available.

#### Scenario: Selected audio input unavailable
- **WHEN** `/api/status` reports `audio_input_available: false`
- **THEN** the dashboard does not render the record button

#### Scenario: Default audio input selected
- **WHEN** `/api/status` reports the default audio input setting is active and recording is available
- **THEN** the dashboard renders the record button

#### Scenario: Selected audio input available
- **WHEN** `/api/status` reports a non-blank `audio_input` and `audio_input_available: true`
- **THEN** the dashboard renders the record button

## Contracts

### `GET /api/status` — 200

```json
{
  "healthy": true,
  "uptime": 42.7,
  "warning": null,
  "dictation_state": "idle",
  "provider_mode": "local",
  "use_cloud": false,
  "fallback_mode": "openai",
  "cloud_model": "gpt-4.1-mini",
  "local_model": "qwen2.5:7b-instruct",
  "audio_input": "",
  "audio_input_effective": "Built-in Microphone",
  "audio_input_mode": "default",
  "audio_input_available": true,
  "audio_input_unavailable_reason": "",
  "system_prompt": "intent_refiner_v1.md",
  "auxiliary_system_prompt_1": "intent_refiner_v1.md",
  "auxiliary_system_prompt_2": "intent_refiner_v1.md",
  "api_keys": { "openai_configured": true },
  "stt_model_present": true,
  "stt_model_path": "/abs/repo/models/ggml-base.en.bin",
  "ollama_reachable": true,
  "ollama_warning": null,
  "log_path": "/abs/repo/logs/dictator",
  "data_path": "/abs/repo/data/dictator",
  "dictate_endpoint": "POST http://127.0.0.1:9003/v1/dictate-audio",
  "health_endpoint": "GET http://127.0.0.1:9003/health"
}
```

### `GET /api/config` — 200 (one field shown)

```json
{
  "fields": [
    {
      "name": "audio_input",
      "label": "Audio input",
      "type": "string",
      "editable": true,
      "current": { "kind": "string", "value": "" },
      "default": { "kind": "string", "value": "" }
    }
  ],
  "updated_at": "2026-06-07T20:42:10Z"
}
```

Field labels: `Audio input`, `Cloud model`, `Local model`, `Use cloud provider`,
`Primary system prompt`, `Auxiliary prompt 1`, `Auxiliary prompt 2`,
`Interaction history buffer`.

### Error catalogue

All errors are `{"error": "<message>"}`. Config/prompt validation failures
are wrapped as `Runtime config update failed: <detail>`.

| Condition | Status | Message (exact or pinned substring) |
|---|---|---|
| Empty config patch | 400 | `Runtime config update failed: config patch must include at least one field` |
| Unknown config field (`options`) | 400 | `Runtime config update failed: unknown config field: <name>` |
| Empty model/prompt, buffer ≤ 0 | 400 | e.g. `Runtime config update failed: cloud model cannot be empty` |
| `local_model` set while Ollama down | 400 | `Network unavailable` (or `Runtime config update failed: Ollama model list ...`) |
| Unknown prompt path (selection/patch) | 400 | `Runtime config update failed: unknown system prompt path: <path>` |
| Bad selection target | 400 | `Runtime config update failed: target must be primary, auxiliary1, or auxiliary2` |
| Prompt path escapes catalog | 400 | contains `system prompt path escapes prompt directory` |
| Prompt directory missing | 400 | contains `system prompt directory not found:` |
| Missing query param | 400 | `name query parameter is required` / `path query parameter is required` / `provider query parameter is required` |
| `provider` not cloud/local | 400 | `Runtime config update failed: provider must be cloud or local` |
| Invalid interaction id | 400 | `invalid interaction id` |
| Interaction not found / asset traversal or missing | 404 | `Not found.` |
| Unexpected handler failure (e.g. unreadable prompt file) | 500 | `{"error": "<description>"}` |

Method+path pairs not in the route table fall through to the base router
(404 `Not found.` — see [service-lifecycle](../dictator-service-lifecycle/spec.md) svc-10).

## Design

- `src/Sources/DictatorService/WebRouter.swift` — exact method+path matching
  with minimal query parsing (`+` → space, percent-decoding).
- `src/Sources/DictatorService/WebAPIService.swift` — actor handling every
  route; builds prompt catalogs per request from the current config so
  `system_prompts_dir` changes apply without restart; Ollama probes use
  injected `URLSession` (2 s reachability / 5 s model list).
- `src/Sources/DictatorService/WebAPIModels.swift` — response structs and
  `WebConfigFieldMapping` (field ↔ manager-name ↔ label tables).
- `src/Sources/DictatorService/WebServiceFactory.swift` +
  `src/Sources/DictatorCore/RuntimeConfiguration.swift` — the
  `RuntimeConfigurationManager` with typed entries (bool, model with
  fuzzy-match `bestMatch`/Levenshtein, system prompt, buffer-MB). Field
  setters patch the provider in memory; `PATCH /api/config` persists once at
  the end; `POST /api/prompts/selection` persists via `applyPatch`.
- `src/Sources/DictatorService/StaticAssets.swift` — web root
  `projects/dictator/src/web`, path normalization, content-type table.
- `src/web/index.html`, `src/web/app.js`, `src/web/styles.css` — the static
  dashboard (no build step, no framework).
- Tests: `tests/DictatorServiceTests/WebAPITests.swift` (status shape and
  secret-hiding, patch persistence, reset, traversal rejection, prompt
  selection, interaction list/detail, model listing with Ollama down, API-key
  status, retired-control guards).

## Design notes / quirks

- `GET /api/config` reads `current`/`default` from the configuration manager
  snapshots created at startup (and rebuilt on reset/prompt-selection), so a
  hand-edit of `config/dictator.json` while running is not reflected until a
  patch/reset path refreshes state.
- The browser dictation panel is a test utility; OS-level text insertion is
  exclusively a [launchpad](../dictator-launchpad/spec.md) behavior.

## Interactions

- [service-lifecycle](../dictator-service-lifecycle/spec.md) — listener, route fallback, and
  the uptime/warning surfaced in `/api/status`.
- [dictation-pipeline](../dictator-dictation-pipeline/spec.md) — `dictation_state`, recorded
  interactions, and the dictate endpoint exercised by the dashboard panel.
- [launchpad](../dictator-launchpad/spec.md) — its interactions appear in the same history;
  the safe-config pad uses the same defaults-restore path as
  `POST /api/config/reset`.
- [Config contract](../../../projects/dictator/docs/contracts/config.md) — file written by patch/reset.
- [Interactions contract](../../../projects/dictator/docs/contracts/interactions.md) — record fields
  exposed by the history endpoints.
