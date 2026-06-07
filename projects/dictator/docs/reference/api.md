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

### `POST /exit`

Requests a clean service shutdown.

## Dictation endpoint

### `POST /v1/dictate-audio`

Accepts WAV audio and returns transcription plus refinement results.

**Request headers**

| Header | Required | Description |
|--------|----------|-------------|
| `Content-Type` | yes | Must be `audio/wav` |
| `X-Sample-Rate` | yes | Sample rate in Hz (for example `16000`) |
| `X-Locale` | yes | BCP-47 locale (for example `en-US`) |
| `X-Session-Id` | yes | Client session identifier |
| `X-Request-Id` | yes | Per-request trace identifier |
| Context/style headers | no | Optional pipeline context when available |

**Success response**

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

## iOS keyboard client

The iOS keyboard host app uploads recordings to `POST /v1/dictate-audio` on the configured Dictator base URL.

- Default base URL: `http://127.0.0.1:9003`
- Override in the host app **Status** section or via `ios_client_host_url` in `Info.plist`
- On a physical iPhone, set the base URL to your Mac LAN address with port `9003` (not `127.0.0.1`)

The iOS client does not call legacy standalone routes such as `POST /v1/transcribe` or `POST /v1/refine`.

## Web UI and operational APIs

The service also exposes web UI static assets and JSON APIs for configuration, prompts, interaction history, and service status. See the web UI documentation for those routes.
