# Physical Plan: Inventory Scaffold And Core Import

## Objective

Create the project-local Dictator Swift package foundation under `projects/dictator/`, migrate only source-of-truth Dictator source/prompts/contracts/tests/docs material from `/Users/joyo/dictator`, and leave external quest records, realtime-agent code, generated build output, local runtime data, caches, and secrets behind.

Expected outcome:

- `projects/dictator/` remains a Sheaf project with `README.md`, `Makefile`, `quests/`, `src/`, `tests/`, and `docs/`.
- The Swift package is rooted at `projects/dictator/Package.swift`, with target paths pointing into `src/Sources/**` and `tests/**`. This keeps implementation under `src/` and tests under `tests/` while letting SwiftPM see both directories from one package root.
- `DictatorCore`, `CWhisper`, prompt catalogs, and the migrated non-AppKit service/domain code needed by the sequential service slices are present in project-local paths.
- Initial core behavior tests run from `make -C projects/dictator test-core` or the initial `test` target without needing the final service, web UI, or iOS migration.
- A source-verified migration inventory is documented in this plan and preserved by focused exclusion checks.

## Source Inventory

Source inspection of `/Users/joyo/dictator` found these source-of-truth areas to migrate:

- Swift package metadata:
  - `apps/dictator-main/Package.swift`
  - `apps/dictator-main/Package.resolved`
- Core library:
  - `apps/dictator-main/Sources/DictatorCore/**`
  - `apps/dictator-main/Sources/CWhisper/module.modulemap`
  - `apps/dictator-main/Sources/CWhisper/shim.h`
- Service/domain code from `DictatorApp` that is not native UI:
  - `DictationHTTPServer.swift`
  - `InteractionHistory.swift`
  - `TraceLogger.swift`
  - `RecordingController.swift`
  - `AudioRecorder.swift`
  - `ActiveTargetContextProvider.swift`
  - `ClipboardInserter.swift`
  - `KeyboardInjector.swift`
  - `FocusedInputDetector.swift`
  - `OllamaBootstrapper.swift`
  - `APIClient.swift`
  - launchpad domain/rendering helpers that are useful as non-AppKit behavior references, especially `LaunchpadTypes.swift`, `LaunchpadAppCycleState.swift`, and parser/routing tests.
- Prompt and contract sources:
  - `prompts/refine_transcript.md`
  - `prompts/system-prompts/**`
  - `contracts/dictation_v1.yaml`, to rewrite into the project-local canonical API reference later rather than expose obsolete routes unchanged.
- Tests to migrate or split:
  - all `apps/dictator-main/Tests/DictatorCoreTests/**`
  - non-AppKit `apps/dictator-main/Tests/DictatorAppTests/InteractionHistoryTests.swift`
  - `OllamaBootstrapperTests.swift`
  - launchpad parser/domain tests where they can run without AppKit UI rendering
  - HTTP server tests to be added or rewritten in slice 3.
- Documentation source material to rewrite later:
  - `README.md`
  - `DECISIONS.md`
  - `Rendering_pipeline.md`
  - `Talon_lite_pipeline.md`
  - `talon_lite_grammar.md`
  - `docs/architecture/ARCHITECTURE.md`
  - `docs/product/PRD.md`
  - `docs/product/ROADMAP.md`
  - `docs/testing/TEST_STRATEGY.md`
  - useful portions of `apps/dictator-main/README.md`.

Source inspection also found these iOS source-of-truth areas, owned by slice 5:

- `apps/ios-keyboard/DictatorKeyboardHost/DictatorKeyboardHost.xcodeproj/**`
- host app, extension, shared config, plist, entitlements, assets, tests, and UI tests under `apps/ios-keyboard/DictatorKeyboardHost/**`
- shared code under `apps/ios-keyboard/Shared/**`
- `apps/ios-keyboard/README.md` and `XCODE_SETUP.md`.

Do not migrate these areas:

- `/Users/joyo/dictator/quests/**`
- `/Users/joyo/dictator/apps/realtime-agent/**`
- any VS Code extension code if present
- `/Users/joyo/dictator/apps/ios-keyboard/DictatorKeyboardHost/build/**`, even though `git ls-files` shows generated iOS build products are tracked in the external repo
- `.swiftpm-module-cache/**`
- `.git/**`, `.claude/**`, `skills/**`, `.github/**` unless a later docs/test decision needs a small reference
- `(A Document Being Saved By swift-test)*`
- `data/**`, including `data/initial-context.md`
- crash logs such as `apps/realtime-agent/crash.log`
- `.env`, `.env.example`, `.secrets.json`, `secrets.json`, and old app-local secret files except `secrets.example.json` as documentation source material
- external root Makefile realtime-agent targets.

## Key Files And Systems

Likely new or replaced files:

- `projects/dictator/Package.swift`
- `projects/dictator/Package.resolved`
- `projects/dictator/Makefile`
- `projects/dictator/src/Sources/DictatorCore/**`
- `projects/dictator/src/Sources/CWhisper/**`
- `projects/dictator/src/Sources/DictatorService/**`
- `projects/dictator/src/prompts/**`
- `projects/dictator/src/contracts/dictation_v1.yaml`
- `projects/dictator/tests/DictatorCoreTests/**`
- `projects/dictator/tests/DictatorServiceTests/**`
- `projects/dictator/tests/fixtures/**`
- `projects/dictator/docs/README.md`

Likely existing files to touch:

- `projects/dictator/README.md`, only as a concise migrated project entry point.
- Root `Makefile` and `config/services.json` are not owned by this slice; they are planned in slice 2.

## Existing APIs To Reuse As-Is

- `DictatorCore` pipeline contracts, provider routing, prompt builder, Talon Lite parser/recovery/correction logic, model availability checker, STT abstractions, OpenAI/Ollama refinement engines, and runtime configuration datatypes should be copied first with minimal import changes.
- `SystemPromptCatalog` should be reused, then adjusted in slice 2 so its default path is `projects/dictator/src/prompts/system-prompts`.
- `RuntimeConfigProvider`, `RuntimeConfigPatch`, `RuntimeConfigurationManager`, and the runtime configuration classes should be reused as the basis for web UI config APIs, with path and persistence changes in slice 2 and slice 4.
- `InteractionHistoryStore` and `DictationInteractionBuffer` should be reused as the persistence model, with path changes in slice 2 and API exposure in slice 4.
- `DictationHTTPServer` should be migrated as the NIO HTTP base, with route changes in slices 2 through 4.

## APIs To Extend Or Modify Later

- `RuntimeConfigStore.defaultFileURL` must stop searching `Config/runtime-config.json` and `apps/dictator-main/Config/runtime-config.json`; slice 2 changes it to repo-root `config/dictator.json`.
- `SecretsStore` must stop reading app-local `Config/secrets.json`; slice 2 replaces it with `config/api_keys.json` lookup.
- `TraceLogger` must default to `logs/dictator/trace.log`, not `/tmp/dictator-trace.log`.
- `DictationHTTPServer` must expose standard Sheaf `GET /health` and `POST /exit`, preserve `POST /v1/dictate-audio`, and later add web UI/static/data routes.
- The executable target should be renamed from `DictatorApp` to `DictatorService`. The native AppKit entry point in `main.swift` is not copied as the active product entry point.

## Implementation Notes

Use this project-local Swift package layout:

```text
projects/dictator/
  Package.swift
  Package.resolved
  Makefile
  src/
    Sources/
      CWhisper/
      DictatorCore/
      DictatorService/
    prompts/
    contracts/
  tests/
    DictatorCoreTests/
    DictatorServiceTests/
    fixtures/
```

`Package.swift` at the project root is intentional: SwiftPM packages are rooted where `Package.swift` lives, so this lets `testTarget` paths remain under `projects/dictator/tests/` while production source remains under `projects/dictator/src/`.

The initial `DictatorService` target should contain the migrated NIO server/domain files and a compileable executable entry point. It should compile without AppKit UI files. AppKit-only files such as `MenuBarController.swift`, `LaunchpadFullscreenOverlay.swift`, `LaunchpadOverlayConfigTab.swift`, `LaunchpadSystemPromptsOverlayTab.swift`, and `LaunchpadInteractionsOverlayTab.swift` should not be active product source; slice 4 replaces their capabilities with web UI APIs.

Keep CWhisper as a `systemLibrary` target. Do not vendor model binaries or whisper libraries. Keep linker settings from the external package only if needed for local compatibility, and isolate them in the project package so repository root files are not polluted.

Initial `Makefile` targets:

- `all`: build and test the initial Swift package subset
- `build`: `swift build`
- `test`: `swift test`
- `test-core`: focused core test alias for early migration
- `run`: invokes the `DictatorService` executable target once it exists in this slice; the endpoint/config behavior is completed in slice 2
- `clean`: remove `.build`, SwiftPM caches inside the project, and project-local test artifacts only.

## Validation

- `swift package --package-path projects/dictator describe`
- `make -C projects/dictator build`
- `make -C projects/dictator test-core`
- Focused migrated Swift tests for:
  - Talon Lite parser/recovery/rendering behavior
  - pipeline success/failure with fake STT/refinement engines
  - provider routing
  - prompt catalog traversal and path sanitization
  - model availability checks using injected sessions
  - runtime config decoding of old shapes
  - interaction history read/write using temporary directories.
- Static exclusion checks:
  - `rg "apps/realtime-agent|quests/main|DictatorKeyboardHost/build|\\.swiftpm-module-cache|node_modules|crash\\.log|secrets\\.json|A Document Being Saved" projects/dictator`
  - `find projects/dictator -path '*/build/*' -o -path '*/.build/*' -o -path '*/node_modules/*'`
