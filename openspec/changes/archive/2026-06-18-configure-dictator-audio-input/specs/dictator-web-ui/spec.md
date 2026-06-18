## MODIFIED Requirements

### Requirement: web-3 — Status and keys: GET /api/status
WHEN it receives `GET /api/status`, THE service SHALL respond 200 with the status body (see Contracts): health fields, `dictation_state` (`idle` | `processing`), `provider_mode` (`cloud` | `local`), the active config values including `audio_input`, audio-input availability fields, `api_keys.openai_configured`, STT model presence and path, live Ollama reachability (2-second probe of `<ollama_host>/api/tags`), log/data paths, and the dictate/health endpoint strings. It SHALL never include API key material.

#### Scenario: GET /api/status

- **WHEN** the service receives `GET /api/status`
- **THEN** it responds 200 with the full status body including health fields, `dictation_state`, `provider_mode`, active config values including `audio_input`, audio-input availability fields, `api_keys.openai_configured`, STT model presence and path, live Ollama reachability, log/data paths, and endpoint strings — and never includes API key material

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
- **THEN** the service responds 400

#### Scenario: local_model options with Ollama failure

- **WHEN** the service receives `GET /api/config/options?name=local_model` and Ollama is unreachable
- **THEN** it responds 400

## ADDED Requirements

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
