# Migrate Dictator

## Quest Overview

Migrate the external Dictator repository at `/Users/joyo/dictator` into the
Sheaf repository as the `dictator` project under `projects/dictator/`.

The external Dictator repository contains several surfaces:

- the Swift macOS Dictator app and shared `DictatorCore` module under
  `apps/dictator-main/`
- the iOS keyboard app under `apps/ios-keyboard/`
- dictation API contracts under `contracts/`
- prompt templates and system prompt catalogs under `prompts/`
- product, architecture, operations, and testing documentation under `docs/`
- a realtime-agent app under `apps/realtime-agent/`
- quest artifacts under `quests/`
- generated build output, local runtime files, caches, and other repository
  noise

This quest migrates Dictator itself into Sheaf. It must not blindly copy the
external repository. The migration must preserve Dictator product behavior while
changing layout, configuration, logging, service registration, API key handling,
documentation, and UI integration to match Sheaf's project structure.

The migrated Dictator must be registered as a Sheaf service named `dictator`
running on port `9003`.

## Required Initial Planning Work

The first physical-planning step must inspect `/Users/joyo/dictator` and produce
an inventory that separates:

- source files to migrate
- tests to migrate or rewrite
- docs and contracts to migrate or rewrite
- prompts and prompt fixtures to migrate
- generated files and local runtime artifacts to discard
- already-migrated or explicitly excluded subsystems

The planner must verify the inventory from source instead of assuming the lists
below are complete.

Likely source areas to migrate include, but are not limited to:

- `apps/dictator-main/Package.swift`
- `apps/dictator-main/Package.resolved`
- `apps/dictator-main/Sources/DictatorCore/`
- non-AppKit service, pipeline, HTTP, recording, context, keyboard insertion,
  launchpad domain, and history logic from `apps/dictator-main/Sources/DictatorApp/`
- `apps/dictator-main/Sources/CWhisper/`
- useful tests from `apps/dictator-main/Tests/`
- iOS keyboard source and tests from `apps/ios-keyboard/`
- `contracts/dictation_v1.yaml`
- `prompts/`
- durable product and architecture decisions from `README.md`, `DECISIONS.md`,
  `Rendering_pipeline.md`, `Talon_lite_pipeline.md`, `talon_lite_grammar.md`,
  and `docs/`

Likely areas that must not be migrated include, but are not limited to:

- `quests/` from the external Dictator repository
- `apps/realtime-agent/`, because the realtime agent has already been migrated
  separately
- any VS Code extension code or docs if present in the source repository, because
  that surface has already been migrated separately
- generated Swift build output such as `.build/`
- generated Xcode build output such as `apps/ios-keyboard/**/build/`
- `.swiftpm-module-cache/`
- `node_modules/`
- `dist/`
- crash logs, runtime data, local temporary files, editor save artifacts, and
  other uncommitted or generated debris
- local secret files such as `secrets.json`, `.env`, or `.secrets.json`

If the source repository contains tracked generated artifacts, the migrated
project must still treat them as generated artifacts and leave them out of Sheaf.

## Goals

- Populate `projects/dictator/` with the migrated Dictator implementation,
  tests, documentation, prompts, and contracts using Sheaf's required project
  layout.
- Preserve Dictator's dictation pipeline behavior: audio capture or audio input,
  transcription, prompt-based refinement, provider routing, local/cloud model
  selection, fallback behavior, Talon Lite parsing/correction, context capture,
  insertion behavior where platform integration still applies, interaction
  history, and iOS keyboard integration.
- Register Dictator as a service named `dictator` on port `9003` in
  `config/services.json`.
- Change service startup so it reads its registered host and port from
  `config/services.json` unless a deliberate visible override is used.
- Change non-secret configuration to live in `config/dictator.json`.
- Change API key and secret resolution to use `config/api_keys.json`.
- Add or update the API key configuration surface needed by Dictator without
  committing real secrets.
- Change runtime logs to write under `logs/dictator/`.
- Change runtime data, including interaction history and local generated data, to
  write under `data/dictator/`.
- Replace the existing native GUI surface with a web UI served by the Dictator
  service.
- Keep the root Makefile thin and add project-local Dictator targets consistent
  with `structure/makefile.md`.
- Clean up external-repo mess during migration by moving only source-of-truth
  files and omitting generated, local, stale, or duplicate artifacts.
- Rewrite or reorganize documentation so the migrated project follows
  `structure/docs-structure.md` and `structure/project-rules.md`.
- Add focused automated tests that cover migrated behavior and the new Sheaf
  integration points.

## Non-Goals

- Do not migrate external Dictator quest records.
- Do not migrate quest logs, slices, state files, thread registries, or execution
  artifacts from `/Users/joyo/dictator/quests/`.
- Do not migrate the realtime agent.
- Do not migrate or duplicate the VS Code extension.
- Do not copy the native AppKit GUI directly into the new product UI.
- Do not preserve the old app-local configuration layout under
  `apps/dictator-main/Config/` as the active configuration source.
- Do not preserve app-local secret files as an active secret source.
- Do not keep port `8787` as the default Dictator service port.
- Do not migrate unused public HTTP routes from the old YAML contract. Current
  source inspection found no active non-test HTTP callers for
  `POST /v1/transcribe` or `POST /v1/refine`; do not expose those routes in the
  migrated service. The internal transcription and refinement pipeline functions
  still must be migrated.
- Do not introduce configuration through environment variables.
- Do not commit real API keys.
- Do not migrate generated build outputs, dependency directories, caches, crash
  logs, or runtime files.
- Do not create a separate service registry or service manager for Dictator.
  Service registration remains centralized in Sheaf's `config/services.json`.
- Do not rewrite unrelated Sheaf projects except for minimal shared UI,
  configuration, service registry, or root Makefile changes required by this
  migration.

## Project Layout

The migrated project must live under:

```text
projects/dictator/
  README.md
  quests/
  src/
  tests/
  docs/
```

The physical planner should choose the final internal source layout, but it must
keep project-owned implementation under `projects/dictator/src/` and tests under
`projects/dictator/tests/`.

The existing Swift package may be moved under `projects/dictator/src/` or adapted
into another project-local Swift package layout if that better fits Swift tooling.
Whichever layout is chosen, root-level Sheaf files should not become a dumping
ground for Dictator implementation files.

Recommended project-local organization:

```text
projects/dictator/
  README.md
  Makefile
  docs/
  quests/
  src/
    Package.swift
    Package.resolved
    Sources/
    prompts/
    contracts/
  tests/
```

If Swift Package Manager requires a different location for `Package.swift`, the
planner must explain the layout and keep the Makefile and docs aligned with it.

Project-specific static web UI files may live in `projects/dictator/src/` beside
the service, or in another project-local directory if the chosen service
framework expects that. Reusable shared presentation utilities belong in
`projects/web/` according to `structure/webui.md`.

## Migration Boundary

The migrated Dictator should preserve the useful behavior from the external repo,
not its old repository shape.

Source to preserve or adapt includes:

- `DictatorCore` pipeline types, contracts, provider routing, prompt building,
  model availability checks, OpenAI and Ollama refinement engines, Talon Lite
  parser and recovery/correction logic, STT abstractions, and secret/config
  abstractions.
- `DictationHTTPServer` behavior for audio dictation requests, updated to the
  Sheaf service API requirements.
- Runtime configuration behavior, rewritten to read from Sheaf config files.
- Interaction history behavior, rewritten to use `data/dictator/`.
- Trace logging behavior, rewritten to use `logs/dictator/`.
- iOS keyboard client behavior, updated to call the migrated Dictator service on
  port `9003` by default or to read the endpoint from Sheaf-compatible config.
- Prompt catalogs and system prompt selection behavior.
- Tests that describe product behavior, updated for the migrated paths and APIs.

Source to redesign rather than directly migrate includes:

- AppKit menubar status UI.
- AppKit Launchpad fullscreen overlay UI.
- AppKit configuration, prompt browser, and interaction history tabs.
- In-memory OpenAI key management from the menubar.

Those GUI behaviors should become web UI capabilities exposed by the Dictator
service.

Source to discard includes:

- generated build products
- checked-in dependency output
- local-only runtime files
- temporary save files
- obsolete docs that only explain the old repository shape
- duplicate docs that should be consolidated into the new documentation layout

## Service Integration

Dictator must be registered in `config/services.json` with:

- `name`: `dictator`
- `host`: `0.0.0.0` unless the physical planner has a concrete reason to use a
  narrower default
- `port`: `9003`
- `command`: a root-relative command that delegates into `projects/dictator/`
- `home_path`: the Dictator web UI path

The service must expose the standard Sheaf service endpoints:

- `GET /health`
- `POST /exit`

`GET /health` must return the standard shape from `structure/services.md`:

```json
{
  "healthy": true,
  "uptime": 123.45,
  "warning": "optional human-readable warning"
}
```

The old `/health` response shape of `{"status":"ok"}` is not sufficient after
migration.

The service must continue to expose Dictator product APIs, including the migrated
dictation API. The old `contracts/dictation_v1.yaml` file lists
`POST /v1/transcribe` and `POST /v1/refine`, but the implemented server and iOS
client use `POST /v1/dictate-audio`. The migrated public HTTP API must focus on
the routes that are actually used. The internal transcription and refinement
pipeline functions remain required implementation behavior.

The migrated service must support:

- audio dictation with WAV input
- transcription and refinement results
- optional context and style preferences
- runtime configuration reads and updates needed by the web UI
- prompt catalog listing, prompt preview, and selected prompt updates
- interaction history listing and detail inspection
- service status needed by the web UI

Do not expose `POST /v1/transcribe` or `POST /v1/refine` as public HTTP routes.
Current source inspection found no active non-test HTTP callers for those routes.
Remove them from the migrated canonical API reference and keep
`POST /v1/dictate-audio` fully covered.

## Configuration And API Keys

Configuration must follow `structure/configuration.md`.

Dictator must not read persistent configuration from environment variables or
from app-local files under `apps/dictator-main/Config/`.

Non-secret Dictator settings must live in:

```text
config/dictator.json
```

Secret material must live only in:

```text
config/api_keys.json
```

The migration must add the Dictator API-key schema expected in
`config/api_keys.json`. The file itself is git-ignored, so the implementation
must not commit real secrets. The migration must provide tracked documentation
and a non-secret example or template that shows the required keys.

The old `apps/dictator-main/Config/secrets.example.json` shape contains:

```json
{
  "openai_api_key": ""
}
```

The migrated key lookup should support the equivalent OpenAI key in
`config/api_keys.json`. The physical planner may choose the exact nested shape,
but it must be documented in `projects/dictator/docs/reference/config.md` and
covered by tests.

The old `runtime-config.json` fields should be mapped into
`config/dictator.json` where still relevant:

- `cloud_model`
- `local_model`
- `use_cloud`
- `fallback_mode`
- `ollama_host`
- `ollama_bin_path`
- `system_prompt`
- `auxiliary_system_prompt_1`
- `auxiliary_system_prompt_2`
- `system_prompts_dir`
- `stt_model_path`
- `stt_language`
- `data_dir`
- `interactions_buffer_bytes`
- `dictator_server_enabled`
- `dictator_server_host`
- `dictator_server_port`
- `version`

The migrated configuration should replace service host and port defaults with
the registered service entry from `config/services.json`. If
`dictator_server_enabled` remains, it must not disable the registered service in
normal Sheaf operation unless that behavior is explicitly documented and tested.

Runtime config updates from the web UI must either persist safely to
`config/dictator.json` or intentionally remain in memory. The selected behavior
must be documented and tested. Safe restore behavior from the old GUI should be
preserved as a web UI action if still useful.

## Logging And Runtime Data

Dictator service logs must be written under:

```text
logs/dictator/
```

The service should log startup, config loading, API-key resolution failures
without secret values, service endpoint binding, requests, dictation pipeline
start and finish, transcription failures, refinement failures, insertion or
platform integration failures, web UI actions, and shutdown.

The implementation must not write active runtime logs to old paths such as
`apps/dictator-main/` or the external Dictator repository.

Dictator runtime data must be written under:

```text
data/dictator/
```

This includes interaction history, captured diagnostic records, local generated
runtime files, and any other mutable data. STT model paths may be configurable,
but large model binaries must not be committed to this repository. Tests should
use small fixtures under `projects/dictator/tests/`.

## Web UI Requirements

Do not directly migrate the AppKit GUI. Build equivalent user-facing
functionality as a web UI served by the Dictator service.

The web UI must include the same operational capabilities as the old native UI
where those capabilities still make sense:

- service status and current dictation state
- current provider/model/fallback mode visibility
- runtime configuration listing and editing
- cloud and local model option listing where available
- system prompt catalog browsing
- prompt preview
- selected system prompt updates
- auxiliary prompt selection where supported
- interaction history list
- interaction detail view showing metadata, timings, transcript, final output,
  optional context, edit summary, uncertainty flags, provider, model, and errors
- API key status that reports whether required keys are configured without
  exposing secret values
- safe restore or reset controls for runtime configuration if that behavior is
  retained
- clear error states for missing microphone/STT/model/API key prerequisites
- links or controls needed by the iOS keyboard and dictation API workflows

The web UI must not be a landing page. It should open to the usable Dictator
operational interface.

Any reusable styling or browser UI utilities should use `projects/web/` according
to `structure/webui.md`; Dictator-specific business logic must stay in
`projects/dictator/`.

The native platform integrations that are not meaningful in a browser, such as
macOS menubar icons, global Caps Lock capture, AppKit fullscreen overlay windows,
and direct Launchpad hardware display rendering, should be represented in the
web UI as status, controls, or documented platform integration behavior rather
than copied as AppKit UI code.

## API Requirements

The migrated service must update the Dictator API contract in a project-local
canonical reference document.

Required endpoints:

- `GET /health`
- `POST /exit`
- `POST /v1/dictate-audio`
- web UI static asset routes
- web UI data APIs for config, prompts, interactions, and service status

`POST /v1/dictate-audio` must preserve the old behavior:

- accepts WAV audio
- validates `Content-Type`
- validates sample rate
- validates locale
- validates session identity
- accepts optional context and style preferences
- returns raw transcript, revised text, edit summary, uncertainty flags, and
  pipeline timings
- returns clear JSON errors for invalid requests and pipeline failures

The migrated API must keep compatibility with the existing iOS keyboard client.
If route names, headers, or response shapes change, the iOS keyboard client must
be updated in the same migration and the docs must call out the new contract.

## iOS Keyboard Requirements

The iOS keyboard app from the external repository is part of Dictator and must
be completely migrated in this quest.

The migrated iOS keyboard must:

- live under `projects/dictator/` rather than top-level `apps/`
- avoid checked-in build products
- call the migrated Dictator service on port `9003` by default
- keep endpoint configuration documented and testable
- preserve existing host app, keyboard extension, shared config, and notification
  behavior where still applicable
- keep Xcode project files only when they are source-of-truth project metadata
- keep build output ignored and out of source control

There is no follow-up migration quest for the iOS surface. Source, project
metadata, tests, docs, endpoint configuration, and build/test integration for the
iOS keyboard must be handled by this migration.

## Makefile Requirements

Makefile changes must comply with `structure/makefile.md`.

Add a project-local Makefile:

```text
projects/dictator/Makefile
```

It should expose predictable targets:

- `all`
- `build`
- `test`
- `run`
- `clean`

The root `Makefile` should be changed only to:

- add `dictator` to `PROJECTS`
- add thin forwarding targets such as `dictator-build`, `dictator-test`,
  `dictator-run`, and `dictator-clean`
- update help text if needed

The `dictator-run` root target must stay aligned with the `command` registered in
`config/services.json`.

The old external Makefile's realtime-agent targets must not be migrated into the
Dictator project.

## Documentation Requirements

Documentation must follow `structure/docs-structure.md`.

Update `projects/dictator/README.md` as the concise project entry point. Detailed
current-state documentation belongs under `projects/dictator/docs/`.

At minimum, the migrated project should provide:

```text
projects/dictator/docs/
  README.md
  reference/
    api.md
    config.md
    services.md
    data.md
    testing.md
  explanation/
    architecture.md
    dictation-pipeline.md
    web-ui.md
```

Only create documents that match the implemented migration. Avoid copying old
docs verbatim when they describe the old standalone repository layout. Preserve
useful product, architecture, Talon Lite, rendering, and decision content by
rewriting it into the new docs hierarchy.

Docs must clearly describe:

- the Dictator service
- API routes and contracts
- configuration files and API key shape
- logging and runtime data paths
- web UI capabilities
- iOS keyboard integration
- prompt catalog layout
- dictation pipeline behavior
- provider and model routing
- local runtime prerequisites such as Ollama and STT model files
- test and build commands
- what was intentionally not migrated

Docs should describe the migrated current state, not the old external repository
as the active system.

## Testing Requirements

Tests should be migrated or rewritten under `projects/dictator/tests/`.

Coverage must include:

- configuration loading from `config/dictator.json`
- API key loading from `config/api_keys.json`
- absence of environment-variable dependency for persistent configuration
- service registration lookup from `config/services.json`
- service binding to port `9003`
- standard `GET /health` response shape
- `POST /exit` clean shutdown behavior
- `POST /v1/dictate-audio` request validation
- absence of unused public `POST /v1/transcribe` and `POST /v1/refine` routes
- dictation pipeline success and failure paths
- prompt catalog listing and selected prompt updates
- runtime configuration listing and updates
- interaction history persistence under `data/dictator/`
- logging path behavior under `logs/dictator/`
- web UI data APIs
- web UI static shell smoke behavior
- iOS keyboard endpoint configuration or client contract behavior
- exclusion of realtime-agent code from Dictator migration
- exclusion of external quest artifacts from Dictator migration
- cleanup checks that generated build output and dependency directories were not
  migrated

Where existing Swift tests cover core Dictator behavior, migrate them and update
fixtures and path assumptions. Tests that only exercise AppKit UI rendering may
need to be replaced by web UI tests or lower-level behavior tests.

## Cleanup Requirements

This migration must leave `projects/dictator/` clean.

Do not carry over:

- `.build/`
- `.swiftpm-module-cache/`
- `build/`
- `node_modules/`
- `dist/`
- `.env`
- `.secrets.json`
- `secrets.json`
- `crash.log`
- runtime `data/` contents from the external repo
- quest execution artifacts
- temporary save files such as `(A Document Being Saved By swift-test)`
- duplicate README files that conflict with the new documentation hierarchy

If generated files are already tracked in the external repository, that is a
source-repo problem, not a reason to migrate them.

The final migrated project should have obvious source-of-truth files, a small
project Makefile, focused tests, and current-state docs. Any unavoidable
leftovers should be documented with a concrete reason.

## Acceptance Criteria

- `projects/dictator/` contains the migrated Dictator implementation, tests,
  docs, prompts, and contracts using the required Sheaf project layout.
- External Dictator quest artifacts are not migrated.
- Realtime-agent code is not migrated into `projects/dictator/`.
- VS Code extension code is not migrated into `projects/dictator/`.
- Generated build products, dependency directories, caches, crash logs, local
  secrets, and runtime debris are not migrated.
- `config/services.json` registers `dictator` on port `9003`.
- `make dictator-run` starts the registered Dictator service.
- `projects/dictator/Makefile` provides standard build, test, run, and clean
  targets.
- Root Makefile changes are limited to thin Dictator forwarding and aggregate
  registration.
- Dictator reads non-secret config from `config/dictator.json`.
- Dictator reads API keys and secrets from `config/api_keys.json`.
- Required API key shape is documented and test-covered without committing real
  secrets.
- Dictator service logs write under `logs/dictator/`.
- Dictator runtime data writes under `data/dictator/`.
- `GET /health` returns the standard Sheaf health shape.
- `POST /exit` exits the service cleanly.
- Dictation API behavior is preserved or deliberately updated with matching docs
  and client changes.
- The old native GUI is not directly migrated.
- The web UI provides equivalent configuration, prompt selection, interaction
  history, status, API-key status, and operational controls.
- iOS keyboard source, project metadata, tests, docs, endpoint configuration, and
  build/test integration are fully migrated in this quest.
- Automated tests cover the migrated service, config, key resolution, API,
  logging/data paths, web UI APIs, iOS client contract, and migration exclusions.
- `projects/dictator/docs/` describes the migrated current state using the Sheaf
  documentation structure.
