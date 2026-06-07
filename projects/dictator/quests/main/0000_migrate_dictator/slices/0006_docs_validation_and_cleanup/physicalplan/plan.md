# Physical Plan: Docs Validation And Cleanup

## Objective

Finish the migration by hardening tests, writing current-state documentation, removing obsolete compatibility/dead code, and proving the migrated Dictator project satisfies every acceptance criterion without carrying external repository debris.

Expected outcome:

- `projects/dictator/docs/` contains current-state Dictator docs in the Sheaf documentation structure.
- Automated tests cover service config, API keys, service registry, health/exit, dictation API, pipeline behavior, web UI APIs/static shell, iOS client contract, logs/data paths, and migration exclusions.
- Obsolete AppKit UI, Conductor trace/startup compatibility, old public routes, app-local config/secrets paths, old port defaults, and copied generated artifacts are removed.
- `make dictator-run` starts the service registered on port `9003`.
- Final static checks prove external quest artifacts, realtime-agent code, VS Code extension code, generated outputs, caches, local secrets, crash logs, and runtime data were not migrated.

## Key Files And Systems

Likely affected files:

- `projects/dictator/README.md`
- `projects/dictator/docs/README.md`
- `projects/dictator/docs/reference/api.md`
- `projects/dictator/docs/reference/config.md`
- `projects/dictator/docs/reference/services.md`
- `projects/dictator/docs/reference/data.md`
- `projects/dictator/docs/reference/testing.md`
- `projects/dictator/docs/explanation/architecture.md`
- `projects/dictator/docs/explanation/dictation-pipeline.md`
- `projects/dictator/docs/explanation/web-ui.md`
- `projects/dictator/Makefile`
- `Makefile`
- `config/services.json`
- `config/dictator.json`
- `config/api_keys.example.json`
- `projects/dictator/src/**`
- `projects/dictator/tests/**`

## Existing APIs To Reuse As-Is

- Reuse the final service APIs from slices 2 through 4 for integration tests and documentation.
- Reuse the final iOS endpoint/client behavior from slice 5 for contract tests and docs.
- Reuse old external docs only as source material, rewriting them into current Sheaf layout:
  - product intent from `README.md`, PRD, and roadmap
  - architecture and decisions from `DECISIONS.md` and `docs/architecture/ARCHITECTURE.md`
  - Talon Lite material from `Talon_lite_pipeline.md` and `talon_lite_grammar.md`
  - rendering/platform integration rationale from `Rendering_pipeline.md`
  - testing strategy from `docs/testing/TEST_STRATEGY.md`.
- Reuse `structure/docs-structure.md`, `structure/project-rules.md`, `structure/services.md`, `structure/configuration.md`, `structure/logs-and-data.md`, `structure/makefile.md`, and `structure/webui.md` as the documentation rules.

## APIs To Extend Or Modify

- Tighten any remaining temporary compatibility APIs:
  - remove app-local `Config/runtime-config*` search
  - remove app-local `Config/secrets*` search
  - remove `/tmp/dictator-trace.log` default
  - remove public `/v1/transcribe` and `/v1/refine` route handlers
  - remove external `/Users/joyo/dictator` fallbacks
  - remove Conductor service-manager trace/restart lookup from active Dictator and iOS code.
- Add any missing tests found by acceptance criteria review.
- Add final migration validation tests that inspect project files for excluded path/classes/artifacts.

## Documentation Plan

Update `projects/dictator/README.md` as a concise entry point with:

- what Dictator is
- service command
- API/UI entry points
- links to docs.

Update `projects/dictator/docs/README.md` as the docs index.

Create/update reference docs:

- `reference/api.md`
  - `GET /health`
  - `POST /exit`
  - `POST /v1/dictate-audio`
  - web UI static routes
  - web data APIs for status, config, prompts, interactions, models, and API-key status
  - request/response shapes and error status codes
  - explicit note that `/v1/transcribe` and `/v1/refine` are not public routes.
- `reference/config.md`
  - `config/dictator.json` fields
  - `config/api_keys.json` shape using `dictator.openai_api_key`
  - `config/api_keys.example.json`
  - no environment-variable persistent config
  - no app-local config/secrets
  - service endpoint source from `config/services.json`.
- `reference/services.md`
  - `dictator` service entry
  - port `9003`
  - `make dictator-run`
  - logs/data paths
  - shutdown behavior.
- `reference/data.md`
  - `data/dictator/` structure
  - interaction history record fields
  - generated runtime data policy
  - model binary policy.
- `reference/testing.md`
  - `make -C projects/dictator test`
  - root `make dictator-test`
  - Swift package tests
  - iOS build/test commands and local simulator prerequisites
  - HTTP/web smoke tests
  - static exclusion checks.

Create/update explanation docs:

- `explanation/architecture.md`
  - project layout
  - service composition
  - core pipeline
  - web UI/service API relationship
  - iOS keyboard relationship
  - what was intentionally not migrated.
- `explanation/dictation-pipeline.md`
  - audio input
  - STT
  - prompt building
  - provider routing
  - cloud/local model selection
  - fallback behavior
  - Talon Lite parsing/correction
  - context capture and insertion/platform behavior.
- `explanation/web-ui.md`
  - replacement of AppKit UI
  - status/config/prompt/history workflows
  - API key status and prerequisite errors
  - platform integration limitations.

Docs must describe the migrated current state only. They can mention the external repo only in "not migrated" or migration provenance notes, not as active layout.

## Cleanup Plan

- Delete active references to copied AppKit UI files or remove those files from target membership if kept only as archived source material. Prefer removal from `projects/dictator/src` unless a non-AppKit domain type is still used.
- Remove old `ConductorIntegration` naming and service-manager routes from active source and iOS tests.
- Remove old app-local config and secret example files from active paths. Keep only `config/api_keys.example.json` and documentation.
- Remove generated files accidentally copied during implementation:
  - `.build/`
  - `.swiftpm-module-cache/`
  - `build/`
  - `node_modules/`
  - `dist/`
  - `.env`
  - `.secrets.json`
  - `secrets.json`
  - `crash.log`
  - runtime `data/` contents
  - external quest records
  - temporary save files.
- Remove duplicate README/docs that conflict with the new docs hierarchy. Preserve useful content by rewriting it into canonical docs rather than copying verbatim.

## Validation

Required automated checks:

- `make dictator-build`
- `make dictator-test`
- `make -C projects/dictator build`
- `make -C projects/dictator test`
- `make -C projects/dictator ios-build`
- `make -C projects/dictator ios-test` when the local simulator environment is available.

Required focused tests:

- configuration loading from `config/dictator.json`
- API key loading from `config/api_keys.json`
- absence of environment-variable dependency for persistent config
- service registration lookup from `config/services.json`
- binding to port `9003`
- `GET /health` standard response shape
- `POST /exit` clean shutdown behavior
- `POST /v1/dictate-audio` validation and success/failure paths
- absence of public `/v1/transcribe` and `/v1/refine`
- prompt catalog listing, preview, and selected prompt updates
- runtime config listing, update, and reset
- interaction history persistence under `data/dictator/`
- logging under `logs/dictator/`
- web UI data APIs and static shell
- iOS keyboard endpoint configuration/client contract
- exclusion of realtime-agent code
- exclusion of external quest artifacts
- exclusion of generated build output and dependency directories.

Required manual/runtime checks:

- Start the service with `make dictator-run`.
- Verify `GET http://127.0.0.1:9003/health`.
- Open `http://127.0.0.1:9003/` and verify the operational UI.
- Exercise config edit/reset and prompt selection in the UI.
- Send a WAV fixture to `POST /v1/dictate-audio` with required headers.
- Verify a successful or failed interaction appears in the UI and under `data/dictator/`.
- Verify logs appear under `logs/dictator/`.
- Stop with `POST /exit`.

Static checks:

- `rg "/Users/joyo/dictator|apps/dictator-main|apps/realtime-agent|quests/main|apps/vscode-extension|Config/runtime-config|Config/secrets|/tmp/dictator-trace|8787|192\\.168\\.1\\.56|/v1/transcribe|/v1/refine|ProcessInfo\\.processInfo\\.environment" projects/dictator`
- `find projects/dictator -path '*/.build/*' -o -path '*/build/*' -o -path '*/node_modules/*' -o -path '*/dist/*' -o -name 'crash.log' -o -name 'secrets.json' -o -name '.secrets.json' -o -name '.env'`
- `rg "openai_api_key\"\\s*:\\s*\"[^\"[:space:]]" config projects/dictator` should only match templates with blank values or docs examples.
