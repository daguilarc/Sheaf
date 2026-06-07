# Dictator Web UI

The migrated Dictator service serves a browser-based operational dashboard at `http://127.0.0.1:9003/`. It replaces the legacy macOS AppKit menu-bar UI (`MenuBarController`, fullscreen launchpad overlays, and native config tabs).

## Static shell

| Asset | Purpose |
|-------|---------|
| `src/web/index.html` | Page layout and panels |
| `src/web/assets/app.js` | Fetches JSON APIs and renders state |
| `src/web/assets/styles.css` | Dashboard styling |

The server maps `GET /` and `GET /assets/*` through `WebRouter` and `StaticAssets`.

## Workflows

### Status

The status strip calls `GET /api/status` on load and after config changes. It shows dictation state, provider mode, model names, STT model presence, Ollama reachability, log/data paths, and whether the OpenAI key is configured (without revealing key material).

### Runtime configuration

The config panel loads `GET /api/config`, populates editable fields, and saves with `PATCH /api/config`. Field-specific pickers use `GET /api/config/options?name=...`. **Reset defaults** calls `POST /api/config/reset`, restoring `config/dictator.safe` or bootstrap values.

Editable fields: `use_cloud`, `cloud_model`, `local_model`, `system_prompt`, `auxiliary_system_prompt_1`, `auxiliary_system_prompt_2`, `interactions_buffer_bytes`.

### System prompts

The prompt browser lists files with `GET /api/prompts`, previews content with `GET /api/prompts/preview`, and persists selection with `POST /api/prompts/selection` for primary or auxiliary slots.

### Interaction history

`GET /api/interactions` fills the history list. Selecting an entry loads `GET /api/interactions/{id}` for full transcript, prompt snapshot, timings, and error details. New dictation results appear after `POST /v1/dictate-audio` completes.

## API key status and prerequisite errors

`GET /api/api-key-status` reports whether OpenAI is configured. The status strip surfaces warnings when:

- the OpenAI key is missing but cloud mode is enabled
- the STT model file is absent
- Ollama is unreachable for local mode

Validation errors from config patches return `400` with `{ "error": "..." }` displayed inline in the relevant panel.

## Platform integration limitations

The web UI is operational, not a full replacement for every legacy native control:

- No menu-bar presence or global hotkey overlay
- No Launchpad hardware MIDI overlay (launchpad domain code remains in the service for tests and future integration, but the migrated UI does not drive it)
- No OS-wide text insertion from the browser; clients must paste or use platform-specific insertion paths
- Cloud model listing returns presets; live OpenAI model discovery is not exposed in the UI

For dictation from mobile, use the iOS keyboard host app documented in [Architecture](architecture.md).
