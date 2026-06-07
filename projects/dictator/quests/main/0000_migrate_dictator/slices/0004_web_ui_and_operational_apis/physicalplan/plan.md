# Physical Plan: Web UI And Operational APIs

## Objective

Replace the old native AppKit GUI with a usable web UI served by the Dictator service, plus stable web data APIs for service status, runtime config, prompt browsing/preview/selection, interaction history, model/status data, and API key status.

Expected outcome:

- `config/services.json` `home_path` opens directly to the Dictator operational interface at `/`.
- The UI is not a landing page; it opens to status, dictation state, provider/model/fallback visibility, config controls, prompt catalog, interaction history, and prerequisite/API-key status.
- The service exposes web data APIs for all UI workflows.
- Runtime config updates from the web UI persist safely to `config/dictator.json`.
- API key status reports configured/missing without exposing key values.
- Existing AppKit UI files are not active product source.

## Key Files And Systems

Likely affected files:

- `projects/dictator/src/Sources/DictatorService/DictationHTTPServer.swift`
- `projects/dictator/src/Sources/DictatorService/WebRouter.swift`
- `projects/dictator/src/Sources/DictatorService/WebAPIModels.swift`
- `projects/dictator/src/Sources/DictatorService/StaticAssets.swift`
- `projects/dictator/src/Sources/DictatorService/InteractionHistory.swift`
- `projects/dictator/src/Sources/DictatorCore/RuntimeConfiguration.swift`
- `projects/dictator/src/Sources/DictatorCore/SystemPromptCatalog.swift`
- `projects/dictator/src/web/index.html`
- `projects/dictator/src/web/styles.css`
- `projects/dictator/src/web/app.js`
- `projects/web/sheaf.css` or another shared CSS utility only if a generic reusable style is needed
- `projects/dictator/tests/DictatorServiceTests/WebAPITests.swift`
- `projects/dictator/tests/web/**` if a lightweight browser/static smoke test is added.

## Existing APIs To Reuse As-Is

- Reuse `RuntimeConfigurationManager.list`, `getOptions`, `set`, and `resetToDefaults` as the business logic for config controls.
- Reuse `RuntimeConfigProvider.applyPatch` for persistent web updates. Avoid `applyInMemoryPatch` for user-facing web config changes unless a field is intentionally transient and documented.
- Reuse `SystemPromptCatalog.listEntries`, `listPromptFiles`, `loadPrompt`, and `sanitizeRelativePath` for prompt browsing and preview.
- Reuse `InteractionHistoryStore` list/detail loading for history APIs.
- Reuse `ModelAvailabilityChecker`, runtime config, and API-key resolver for status and prerequisite reporting.

## APIs To Extend Or Modify

Add these web/static routes:

- `GET /`: static web UI shell
- `GET /assets/app.js`
- `GET /assets/styles.css`
- any additional project-local static assets under `/assets/*`.

Add these web data APIs:

- `GET /api/status`
  - service health fields
  - uptime
  - current dictation state
  - provider mode (`cloud`, `local`, fallback mode)
  - selected cloud/local models
  - selected prompt paths
  - API key configured flags
  - STT model presence
  - Ollama reachability/model warning when checked
  - log/data paths.
- `GET /api/config`
  - current runtime config values and default values
  - editable schema metadata for fields the UI can change.
- `PATCH /api/config`
  - accepts a JSON patch using existing config field names
  - validates values
  - persists atomically to `config/dictator.json`
  - returns updated config snapshot.
- `POST /api/config/reset`
  - restores built-in safe defaults to `config/dictator.json`
  - preserves service registry endpoint behavior and never writes secrets.
- `GET /api/config/options?name=<field>`
  - returns option lists for models, booleans, prompt fields, and interaction buffer size.
- `GET /api/prompts?dir=<relative-dir>`
  - returns directory/file entries from `SystemPromptCatalog`.
- `GET /api/prompts/preview?path=<relative-path>`
  - returns prompt metadata and body preview/content for selected prompt.
- `POST /api/prompts/selection`
  - accepts `{ "target": "primary|auxiliary1|auxiliary2", "path": "..." }`
  - validates prompt path and persists to `config/dictator.json`.
- `GET /api/interactions`
  - returns newest-first interaction summaries with IDs, timestamps, source, status, provider/model, timings, output preview, and error preview.
- `GET /api/interactions/<id>`
  - returns metadata, timings, transcript, final output, optional context, edit summary, uncertainty flags, provider, model, and errors.
- `GET /api/models?provider=cloud|local`
  - returns cloud presets and/or Ollama model names when available, plus warnings.
- `GET /api/api-key-status`
  - returns `{ "openai": { "configured": true|false } }` without secret values.

## Implementation Notes

Use static HTML/CSS/JS under `projects/dictator/src/web/` and serve it from the Swift service. Dictator-specific business logic stays under `projects/dictator/`; only generic reusable CSS or browser utility code belongs in `projects/web/`.

The UI should be a dense operational tool:

- top status strip for service health, current state, provider, models, fallback mode, API key, STT/Ollama prerequisites
- configuration form with field-specific controls and save/reset actions
- prompt browser with directory/file list, preview, and primary/auxiliary selection controls
- interaction history list and detail pane
- clear inline error states for missing API key, missing STT model, Ollama unavailable, invalid config, and request failures
- links or visible endpoint details needed by iOS keyboard and `POST /v1/dictate-audio` workflows
- a small dictation API workflow panel that can show the active endpoint and submit a WAV fixture/upload through `POST /v1/dictate-audio` for local verification.

Do not migrate:

- macOS menubar UI
- global Caps Lock capture UI
- Launchpad fullscreen overlay windows
- AppKit prompt/config/history tabs
- in-memory OpenAI key entry from the menu bar.

Represent those old native behaviors as status, service controls, or documentation instead. Platform integrations such as audio capture and text insertion may remain service/domain behavior where they make sense, but their controls are web based.

The web UI must not show or edit actual secret values. If key entry is needed in the UI, it should link to documentation for `config/api_keys.json`; do not add a write-secret endpoint unless explicitly required by a future spec.

## Validation

- `make -C projects/dictator test`
- HTTP tests for all `/api/*` routes:
  - status payload includes expected fields and hides secrets
  - config list/update/reset persists to `config/dictator.json`
  - invalid config patches fail clearly
  - prompt list/preview rejects path traversal
  - prompt selection persists primary and auxiliary prompt paths
  - interactions list/detail read persisted records under `data/dictator/`
  - model listing handles available and unavailable Ollama
  - API key status never returns key material.
- Static shell smoke tests:
  - `GET /` returns HTML
  - asset routes return correct content types
  - app JS references only implemented APIs.
- Browser/manual smoke after starting `make dictator-run`:
  - open `http://127.0.0.1:9003/`
  - verify initial UI is the operational dashboard, not a landing page
  - edit config and verify file persistence
  - select a prompt and verify updated config
  - inspect a seeded interaction detail.
- Static checks:
  - `rg "MenuBarController|LaunchpadFullscreenOverlay|NSApplication|AppKit|promptForAPIKey|onSetAPIKey" projects/dictator/src/Sources/DictatorService projects/dictator/src/web`
