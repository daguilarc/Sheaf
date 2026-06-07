# Implementation complete: Web UI and operational APIs

## Summary

Replaced the native AppKit operational surface with a web dashboard and `/api/*` data APIs served by `DictatorService`.

### Backend

- Added `WebRouter`, `WebAPIModels`, `StaticAssets`, `WebAPIService`, `WebServiceFactory`, and `DictationActivityTracker`.
- Extended `DictationHTTPServer` to serve static assets (`/`, `/assets/*`) and operational APIs:
  - `/api/status`, `/api/config` (GET/PATCH), `/api/config/reset`, `/api/config/options`
  - `/api/prompts`, `/api/prompts/preview`, `/api/prompts/selection`
  - `/api/interactions`, `/api/interactions/<id>`
  - `/api/models`, `/api/api-key-status`
- Wired web services in `DictatorServiceMain` with repo-root asset loading from `projects/dictator/src/web/`.
- Extended `RuntimeConfigProvider` with `persistCurrentToDisk()` and `restoreDefaultsToDisk()` for safe web config persistence.
- Extended `InteractionHistoryStore` with list/detail helpers for the web UI.

### Frontend

- Added operational dashboard at `projects/dictator/src/web/` (`index.html`, `styles.css`, `app.js`):
  - status strip (health, dictation state, provider/models, prerequisites)
  - runtime configuration editor with save/reset
  - prompt browser, preview, and primary/auxiliary selection
  - interaction history list and detail pane
  - dictation API workflow panel for local `POST /v1/dictate-audio` verification

### Tests

- Added `WebAPITests` covering static shell routes, all `/api/*` endpoints, config persistence, prompt safety, interaction history, model listing, and API-key status (no secret leakage).
- Full suite passes: `make -C projects/dictator test` (194 tests).
