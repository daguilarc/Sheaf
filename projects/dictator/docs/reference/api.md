# Dictator API Reference

The Dictator service is registered in Sheaf as `dictator` on port **9003**.

## Standard service endpoints

### `GET /health`

Returns the standard Sheaf health shape:

```json
{
  "healthy": true,
  "uptime": 123.45,
  "warning": "optional human-readable warning"
}
```

| Status | Body |
|--------|------|
| `200` | Health JSON |

### `POST /exit`

Requests a clean service shutdown.

| Status | Body |
|--------|------|
| `200` | `{ "exiting": true }` |
| `405` | Known route with the wrong method |
| `404` | Unknown route |

## Dictation endpoint

### `POST /v1/dictate-audio`

Accepts WAV audio and returns transcription plus refinement results.

**Request headers**

| Header | Required | Description |
|--------|----------|-------------|
| `Content-Type` | yes | Must be `audio/wav`; `audio/x-wav` is also accepted |
| `X-Sample-Rate` | yes | Sample rate in Hz. Supported values: `8000`, `16000`, `22050`, `24000`, `32000`, `44100`, `48000` |
| `X-Locale` | yes | BCP-47 locale (for example `en-US`) |
| `X-Session-Id` | yes | Client session identifier |
| `X-Request-Id` | no | Per-request trace identifier. The service generates a short ID when omitted |
| `X-Context-Json` | no | JSON object copied into interaction context |
| `X-Style-Prefs-Json` | no | JSON object copied into style preferences |

**Success response (`200`)**

```json
{
  "raw_transcript": "hello world",
  "revised_text": "Hello world.",
  "edit_summary": "capitalized",
  "uncertainty_flags": [],
  "transcribe_ms": 120,
  "refine_ms": 45
}
```

**Error response**

```json
{
  "error": "human-readable message"
}
```

| Status | When |
|--------|------|
| `400` | Missing or invalid headers, unsupported content type |
| `405` | Known route with the wrong method |
| `413` | Audio payload exceeds the configured request size limit |
| `422` | WAV bytes are invalid, sample rate is unsupported, or the header rate does not match the WAV header |
| `500` | Pipeline or internal failure |
| `404` | Unknown route |

### Retired public routes

`POST /v1/transcribe` and `POST /v1/refine` are **not** public HTTP routes in the migrated service. They return `404`. Transcription and refinement run internally inside `POST /v1/dictate-audio`.

## Web UI static routes

| Route | Source file | Content type | Description |
|-------|-------------|--------------|-------------|
| `GET /` | `src/web/index.html` | `text/html; charset=utf-8` | Operational dashboard shell |
| `GET /assets/app.js` | `src/web/app.js` | `application/javascript; charset=utf-8` | UI logic |
| `GET /assets/styles.css` | `src/web/styles.css` | `text/css; charset=utf-8` | UI styles |

## Web operational JSON APIs

### `GET /api/status`

Service and pipeline status for the dashboard strip.

Key fields: `healthy`, `uptime`, `warning`, `dictation_state`, `provider_mode`, `use_cloud`, `cloud_model`, `local_model`, `api_keys.openai_configured`, `stt_model_present`, `ollama_reachable`, `log_path`, `data_path`, `dictate_endpoint`, `health_endpoint`.

Never returns raw API key material.

### `GET /api/config`

Lists editable runtime fields with current and default values.

Response shape:

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
  "updated_at": "2026-06-07T00:00:00Z"
}
```

### `PATCH /api/config`

Partial update. Accepted JSON fields: `use_cloud`, `cloud_model`, `local_model`, `system_prompt`, `auxiliary_system_prompt_1`, `auxiliary_system_prompt_2`, `interactions_buffer_bytes`.

`interactions_buffer_bytes` is accepted as bytes in the patch body and is displayed by `GET /api/config` as a megabyte string such as `100 MB`.

| Status | When |
|--------|------|
| `200` | Updated config snapshot |
| `400` | Validation error with `{ "error": "..." }` |

### `POST /api/config/reset`

Restores defaults from `config/dictator.safe` or bootstrap values.

### `GET /api/config/options?name={field}`

Returns selectable values for a named config field.

### `GET /api/prompts?dir={subdir}`

Lists prompt files under the configured system-prompts directory. Rejects path traversal.

### `GET /api/prompts/preview?path={filename}`

Returns prompt body and byte count for a catalog file.

### `POST /api/prompts/selection`

Body: `{ "target": "primary|auxiliary1|auxiliary2", "path": "filename.md" }`. Persists the selected prompt into `config/dictator.json`.

### `GET /api/interactions`

Returns newest-first interaction summaries.

Response shape: `{ "interactions": [ ... ] }`. Each summary includes `id`, `occurred_at`, `source`, `status`, `provider`, `model`, `transcribe_ms`, `refine_ms`, `total_pipeline_ms`, `output_preview`, and optional `error_preview`.

### `GET /api/interactions/{id}`

Returns full interaction detail for one UUID.

### `GET /api/models?provider={cloud|local}`

Lists preset cloud models or queries Ollama tags for local models.

### `GET /api/api-key-status`

Returns `{ "openai": { "configured": true|false } }` without key material.

## iOS keyboard client

The iOS keyboard host app uploads recordings to `POST /v1/dictate-audio` on the configured Dictator base URL.

- Default base URL: `http://127.0.0.1:9003`
- Override in the host app **Status** section or via `ios_client_host_url` in `Info.plist`
- On a physical iPhone, set the base URL to your Mac LAN address with port `9003`

The iOS client does not call `POST /v1/transcribe` or `POST /v1/refine`.
