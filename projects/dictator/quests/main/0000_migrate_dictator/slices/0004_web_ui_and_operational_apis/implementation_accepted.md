# Implementation accepted: Web UI and operational APIs

Reviewed by polisher_reviewer for slice 0004. No open polishing issues.

## What was verified

- **Static shell + assets**: `GET /`, `/assets/*` served via `StaticAssets` with
  path-traversal normalization (rejects `..`, absolute, and backslash paths). Content
  types correct for html/css/js.
- **Operational APIs**: All spec-mandated routes present and wired through
  `WebRouter` → `WebAPIService`: `/api/status`, `/api/config` (GET/PATCH),
  `/api/config/reset`, `/api/config/options`, `/api/prompts`, `/api/prompts/preview`,
  `/api/prompts/selection`, `/api/interactions`, `/api/interactions/<id>`,
  `/api/models`, `/api/api-key-status`.
- **Config persistence**: PATCH applies via `applyInMemoryPatch` + explicit
  `persistCurrentToDisk()`; reset via `restoreDefaultsToDisk()`. Interaction buffer
  changes propagate to `InteractionHistoryStore.setMaxBytes` through `onBytesUpdated`.
  Prompt selection persists via `applyPatch` and rebuilds the config manager.
- **Reuse of existing logic**: `RuntimeConfigurationManager`, `SystemPromptCatalog`
  (list/preview/selection + `sanitizeRelativePath`), and `InteractionHistoryStore`
  list/detail helpers are reused as intended.
- **Security**: Secrets never exposed — status and api-key-status report only
  `configured` booleans; tests assert no `sk-` material leaks. Prompt path traversal
  throws `DictatorError` → HTTP 400.
- **Frontend**: `index.html`/`app.js`/`styles.css` implement a dense operational
  dashboard (status strip, config editor, prompt browser/preview/selection,
  interaction history list+detail, `/v1/dictate-audio` workflow panel). All element
  IDs referenced by `app.js` exist in the HTML; `app.js` references only implemented
  endpoints.
- **Tests**: `WebAPITests` cover shell/asset content types, status fields + secret
  hiding, config persistence/invalid-patch/reset, prompt traversal rejection, prompt
  selection persistence, interactions list/detail, Ollama available/unavailable,
  cloud presets, api-key status, and a web-dir retired-native-controls guard.
  Implementer reports the full suite (194 tests) passing.

## Non-blocking observation

The cloud-model preset list is duplicated: `WebAPIService.modelList`
(`WebAPIService.swift:323`) hardcodes `["gpt-4.1-mini", "gpt-5.2"]` while the
canonical list lives in `RuntimeModelConfiguration.cloudModelPresets`
(`RuntimeConfiguration.swift:94-97`), which backs `/api/config/options?name=cloud_model`.
These are two independent sources of truth that could diverge if presets change.
Impact is low (the UI sources cloud options from `/api/config/options`, not
`/api/models`, and the lists currently match), so this is recorded as a maintainability
note rather than a blocking issue. A future consolidation through a single shared
preset source would remove the divergence risk.
