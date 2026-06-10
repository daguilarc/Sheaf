# Capability: Web UI

ID prefix: `web`

## Purpose

The service serves a browser-based operational dashboard at `/` (the
registered home path) plus JSON APIs under `/api/*`: live status, runtime
config editing with pickers and reset, system-prompt browsing/selection,
interaction history review, model listing, and API-key status. It replaces
the legacy AppKit menu-bar UI. Repo-wide UI rules:
[Web UI](../../../../structure/webui.md).

## Requirements

### Static shell

- **[web-1]** WHEN it receives `GET /`, THE service SHALL serve
  `projects/dictator/src/web/index.html` as `text/html; charset=utf-8`;
  `GET /assets/<path>` serves files from the same directory (`app.js` as
  `application/javascript; charset=utf-8`, `styles.css` as
  `text/css; charset=utf-8`; `.json`, `.svg`, `.png` get matching types,
  anything else `application/octet-stream`).
- **[web-2]** IF an asset path is empty, absolute, or escapes the web root
  (`..` components; backslashes are normalized to `/` first), THEN THE
  service SHALL respond 404 with `{"error": "Not found."}`; missing files
  also 404.

### Status and keys

- **[web-3]** WHEN it receives `GET /api/status`, THE service SHALL respond
  200 with the status body (see Contracts): health fields, `dictation_state`
  (`idle` | `processing`), `provider_mode` (`cloud` | `local`), the active
  config values, `api_keys.openai_configured`, STT model presence and path,
  live Ollama reachability (2-second probe of `<ollama_host>/api/tags`),
  log/data paths, and the dictate/health endpoint strings. It SHALL never
  include API key material.
- **[web-4]** WHEN it receives `GET /api/api-key-status`, THE service SHALL
  respond 200 with `{"openai": {"configured": <bool>}}` — configured means
  `config/api_keys.json` has a non-blank `openai_api_key`.

### Runtime configuration

- **[web-5]** WHEN it receives `GET /api/config`, THE service SHALL respond
  200 with `{"fields": [...], "updated_at": <config timestamp>}` listing
  exactly the seven editable fields sorted by name — `auxiliary_system_prompt_1`,
  `auxiliary_system_prompt_2`, `cloud_model`, `interactions_buffer_bytes`,
  `local_model`, `system_prompt`, `use_cloud` — each as `{name, label, type
  ("bool"|"string"), editable: true, current: {kind, value}, default: {kind,
  value}}`. `interactions_buffer_bytes` is presented as a megabyte string
  such as `100 MB`; defaults come from `config/dictator.safe` when present at
  startup, else bootstrap values.
- **[web-6]** WHEN it receives `PATCH /api/config` with any subset of
  `use_cloud` (bool), `cloud_model`, `local_model`, `system_prompt`,
  `auxiliary_system_prompt_1`, `auxiliary_system_prompt_2` (strings), and
  `interactions_buffer_bytes` (integer bytes), THE service SHALL apply the
  fields, persist the result to `config/dictator.json`, and respond 200 with
  the updated config snapshot; IF no field is present, THEN it SHALL respond
  400 (`config patch must include at least one field`).
- **[web-7]** WHEN setting `cloud_model` or `local_model`, THE service SHALL
  resolve the requested value against the available options (cloud presets /
  live Ollama tags) by normalized exact match, then containment, then
  Levenshtein distance, and store the best match (cloud labels are
  canonicalized to preset model ids); IF the option source is unavailable
  (e.g. Ollama unreachable while setting `local_model`), THEN the patch SHALL
  fail 400.
- **[web-8]** WHEN setting `interactions_buffer_bytes`, THE service SHALL
  clamp to whole megabytes (`max(1, bytes / 1 MiB)`) and immediately apply the
  new cap to the in-memory interaction buffer; system-prompt fields SHALL be
  validated against the prompt catalog (unknown path → 400); empty
  models/prompts and non-positive buffer sizes → 400.
- **[web-9]** WHEN it receives `POST /api/config/reset`, THE service SHALL
  rewrite `config/dictator.json` from the startup defaults
  (`config/dictator.safe` snapshot or bootstrap), refresh `updated_at`, apply
  the restored buffer size, and respond 200 with the new snapshot.
- **[web-10]** WHEN it receives `GET /api/config/options?name=<field>`, THE
  service SHALL respond 200 with `{"name": <field>, "options": [{kind,
  value}, ...]}`: `use_cloud` → `false, true`; `cloud_model` → the presets
  `gpt-4.1-mini`, `gpt-5.2`; `local_model` → live Ollama tag names (failure →
  400); prompt fields → the recursive prompt-file list;
  `interactions_buffer_bytes` → `25 MB, 50 MB, 100 MB, 200 MB, 500 MB`.
  Missing `name` → 400 `name query parameter is required`; unknown field →
  400.

### System prompts

- **[web-11]** WHEN it receives `GET /api/prompts?dir=<subdir>`, THE service
  SHALL respond 200 with `{"directory": <dir>, "entries": [{name, path,
  kind: "directory"|"file"}, ...]}` for the catalog directory
  (`system_prompts_dir`), directories first, names sorted
  case-insensitively; IF the directory does not exist or the path escapes
  the catalog, THEN it SHALL respond 400.
- **[web-12]** WHEN it receives `GET /api/prompts/preview?path=<file>`, THE
  service SHALL respond 200 with `{"path": <sanitized>, "body": <trimmed
  content>, "byte_count": <utf8 length>}`; missing `path` param → 400 `path
  query parameter is required`; empty prompt file or escaping path → 400.
- **[web-13]** WHEN it receives `POST /api/prompts/selection` with
  `{"target": "primary"|"auxiliary1"|"auxiliary2", "path": <file>}`, THE
  service SHALL validate the path against the catalog, persist the selection
  into the matching `config/dictator.json` field, and respond 200 with the
  config snapshot; unknown path or target → 400 (see error catalogue).

### Interaction history and models

- **[web-14]** WHEN it receives `GET /api/interactions`, THE service SHALL
  respond 200 with `{"interactions": [...]}` newest-first; each summary has
  `id`, `occurred_at` (ISO-8601 fractional), `source` (the stored mode),
  `status` (`success` unless `error_message` is set, then `error`),
  `provider`, `model`, `transcribe_ms`, `refine_ms`, `total_pipeline_ms`,
  `output_preview` (160 chars + `…`), and optional `error_preview`.
- **[web-15]** WHEN it receives `GET /api/interactions/<id>`, THE service
  SHALL respond 200 with the full detail (adds `system_prompt_path`,
  `system_prompt_body`, `whisper_output`, `final_output`, `optional_context`,
  `edit_summary`, `uncertainty_flags`, `fallback_used`, `error_message`, and
  the four timings); IF `<id>` is not a UUID, THEN 400 `invalid interaction
  id`; IF no interaction matches, THEN 404.
- **[web-16]** WHEN it receives `GET /api/models?provider=cloud`, THE service
  SHALL respond 200 with `{"provider": "cloud", "models": ["gpt-4.1-mini",
  "gpt-5.2"], "warning": null}`; `provider=local` queries
  `<ollama_host>/api/tags` (5-second timeout) and on failure responds 200
  with `models: []` and a `warning` instead of an error; missing `provider`
  → 400 `provider query parameter is required`; any other value → 400.

### Dashboard behavior

- **[web-17]** THE dashboard SHALL drive all workflows through these APIs:
  status strip + quick edits (`/api/status`, `PATCH /api/config`), config
  panel with per-field pickers (`/api/config`, `/api/config/options`,
  `/api/config/reset`), prompt browser/preview/selection, interaction list
  with detail view, and a "Dictation API workflow" panel that uploads a WAV
  file to `POST /v1/dictate-audio` from the browser (defaults: sample rate
  `16000`, locale `en-US`, session `web-ui-test`, request id
  `web-<timestamp>`). It SHALL reference no retired AppKit controls (pinned
  by `testWebUIDoesNotReferenceRetiredNativeControls` and
  `testAppJSReferencesOnlyImplementedAPIs`).

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
      "name": "use_cloud",
      "label": "Use cloud provider",
      "type": "bool",
      "editable": true,
      "current": { "kind": "bool", "value": "false" },
      "default": { "kind": "bool", "value": "false" }
    }
  ],
  "updated_at": "2026-06-07T20:42:10Z"
}
```

Field labels: `Cloud model`, `Local model`, `Use cloud provider`,
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
(404 `Not found.` — see [service-lifecycle](service-lifecycle.md) svc-10).

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
  exclusively a [launchpad](launchpad.md) behavior.

## Interactions

- [service-lifecycle](service-lifecycle.md) — listener, route fallback, and
  the uptime/warning surfaced in `/api/status`.
- [dictation-pipeline](dictation-pipeline.md) — `dictation_state`, recorded
  interactions, and the dictate endpoint exercised by the dashboard panel.
- [launchpad](launchpad.md) — its interactions appear in the same history;
  the safe-config pad uses the same defaults-restore path as
  `POST /api/config/reset`.
- [Config contract](../contracts/config.md) — file written by patch/reset.
- [Interactions contract](../contracts/interactions.md) — record fields
  exposed by the history endpoints.
