# Task 5 Report: Absolute Encoder Mode Controllers Integration

## Status

DONE — implemented, committed, and locally verified.

## Commit

- `22c58e48` — `feat(synth): edit absolute encoder mode in controllers`

## Scope

- Added focused view-model coverage for an open encoder edit session that commits `EncoderMode::Absolute`, retains its non-default `turnStep`, survives `Rebuild()` without row replacement/reordering, reconstructs an absolute processor from the committed instrument config, and switches back to signed relative mode with the stored step restored.
- Added checked-index coverage proving a fractional encoder-mode catalog index is rejected without mutating the caller's output instrument.
- Added portable Controllers surface coverage for the exact three declaration-order choices, non-deletable mode/step rows, absolute selection and persistence, stable row identity/order and selected combo state after the live-edit rebuild, absolute processor reconstruction, and restored relative decoding.
- Labeled `turnStep` as `relative modes only` in both the view-model row label and the portable Controllers group header while keeping the row visible and editable in absolute mode.
- Corrected two stale public comments from “relative mode” to “encoder mode.”
- Did not add a second session or alter section coalescing.

## RED Evidence

Command:

```sh
make -C projects/synth build/viewmodel_tests build/controllers_page_ui_tests build/portable_ui_tests && \
projects/synth/build/viewmodel_tests && \
projects/synth/build/controllers_page_ui_tests && \
projects/synth/build/portable_ui_tests
```

Result: exit `1`, after all three binaries compiled. The new end-to-end view-model test reached the absolute commit/rebuild and processor path, then failed on the missing product behavior:

```text
[FAIL] AbsoluteEncoderModeCommitKeepsOpenRowsAndRestoresStoredRelativeStep:
tests/viewmodel_tests.cpp:1943 requirement failed:
after[stepRowIx].label.find("relative modes only") != std::string::npos
```

This was the intended RED: the existing three-entry catalog was truthful after the Task 1 review fix, but the required relative-only step cue was not yet present.

## GREEN Evidence

Command:

```sh
make -C projects/synth build/viewmodel_tests build/controllers_page_ui_tests \
  build/portable_ui_tests build/parameter_modulation_tests && \
projects/synth/build/viewmodel_tests && \
projects/synth/build/controllers_page_ui_tests && \
projects/synth/build/portable_ui_tests && \
projects/synth/build/parameter_modulation_tests
```

Result: exit `0`.

- `viewmodel_tests`: all cases passed, including:
  - `AbsoluteEncoderModeCommitKeepsOpenRowsAndRestoresStoredRelativeStep`
  - `EncoderModeIndexMustBeIntegralAndLeavesOutputUntouched`
- `controllers_page_ui_tests`: `controllers_page_ui_tests passed`.
- `portable_ui_tests`: exit `0`.
- `parameter_modulation_tests`: all 252 cases passed, including the absolute decoder and message/parameter routing suites.

Additional verification:

```sh
git diff --cached --check
```

Result before commit: exit `0`, no output. The staged scope contained exactly five Task 5 source/test files.

## Files Changed

- `projects/synth/include/synth/ControllersPageUI.hpp`
- `projects/synth/include/synth/MidiConfigViewModel.hpp`
- `projects/synth/src/MidiConfigViewModel.cpp`
- `projects/synth/tests/controllers_page_ui_tests.cpp`
- `projects/synth/tests/viewmodel_tests.cpp`

## Self-review

- The portable test drives the same `runtime.controllers.mapping_field_commit` action used by the real Controllers surface and inspects the committed `MidiInstrumentConfig`, rather than bypassing the edit path.
- Processor reconstruction uses `CreateMidiControllerProfile` on that committed config and verifies emitted `ParamSetAbsolute`; switching back reconstructs again and verifies `ParamIncDec` uses the retained `0.25` step.
- Open-session stability is asserted by row count, kind, group, index-derived node identity, and selected combo state before and after the surface refresh/Rebuild cycle.
- The mode and step rows remain present and non-deletable in absolute mode.
- Catalog conversion remains declaration-order and checked through the existing integral/range validator; malformed input leaves `out` untouched.
- No files under the user's untracked `projects/synth/miniapp/` were read or changed.

## Concerns

None. Task 1 already supplied the underlying three-entry catalog and enum conversion; this task intentionally builds on it and adds the missing presentation cue plus end-to-end edit-session/runtime proof.

# Browser App Catalog Task 5: Persistence Contract

## Status

DONE — OpenSpec 5.1–5.3 implemented and locally verified. OpenSpec task checkboxes were intentionally left unchanged for review.

## Contract Implemented

- Added one exact browser runtime identity record: `{publisherId, appId, runtimeConfigVersion}`.
- Catalog identity extraction and every worker initialization command validate that record before it can be used as a persistence namespace.
- Removed the free-form `dataRoot` initialization argument from the TypeScript worker facade and native browser ABI.
- Mounted one shared IDBFS at `/data` and retained shared `/data/config.json` and `/data/logs` paths.
- Derived app patches only as `/data/patches/<publisher>/<app>`, creating the publisher/app directories under the shared mount.
- Excluded build ID from the initialization and persistence APIs, so immutable build updates retain one app patch root while publishers using the same app ID remain isolated.
- Revalidated identity and runtime-config version in native code before setting `RuntimeDataPaths` or starting the runtime.
- Deferred persistence construction until the validated initialize command, preserving populate sync before native initialization and existing debounced dirty writes.

## RED Evidence

Native command:

```sh
make -C projects/synth browser-unit-test
```

Result: exit `2`. The new native contract assertions failed compilation because `BrowserPersistentDataPaths` had no identity-aware overload and accepted only the old zero-argument shared path API.

Browser command (unchanged test command rerun outside the macOS Chromium sandbox after the sandboxed launch was denied):

```sh
cd projects/synth/browser
npx playwright test tests/persistence.spec.ts
```

Result: exit `1`, five behavioral failures. The meaningful failures included the missing `runtimeIdentityForCatalogApp`, missing app-isolated roots, the old persistence constructor/initialization boundary, and failure to reject runtime-config version 2 before persistence setup. The first sandboxed attempt failed before test execution with the macOS `MachPortRendezvousServer` permission denial and is not counted as behavioral RED evidence.

## GREEN Evidence

```sh
make -C projects/synth browser-unit-test
```

Result: exit `0`; `build/browser_runtime_contract_tests` passed.

```sh
cd projects/synth/browser
npm run test:unit
npm run check:generic-runtime
npx playwright test tests/persistence.spec.ts
```

Results: 31/31 Node tests passed, generic-runtime boundary check passed, and 5/5 focused persistence tests passed.

Additional browser verification:

```sh
npx playwright test tests/runtime-core.spec.ts tests/audio-flow.spec.ts \
  tests/midi-flow.spec.ts tests/static-site.spec.ts tests/persistence.spec.ts
npx playwright test
```

Results: 29/29 affected browser tests passed and the complete Playwright gate passed 96/96.

The first complete run found the real-WASM restart test using a miniapp artifact older than the changed native ABI. `make -n browser-miniapp` and file timestamps confirmed the artifact was stale: its old initializer treated the publisher string as a free-form root and wrote outside mounted `/data`. Rebuilding the fake app and miniapp with the new ABI made the focused restart gate and complete browser gate pass without an additional source fix.

## Files Changed

- Browser identity, initialization, persistence, and ABI code under `projects/synth/browser/src`, `projects/synth/browser/cpp`, and `projects/synth/include/synth/browser`.
- Persistence/native contract tests plus existing audio, MIDI, runtime-core, and static-site fixtures updated to use the structured initialization record.
- No OpenSpec checkbox or `.superpowers/sdd/progress.md` changes.
- The pre-existing untracked `projects/synth/browser/package-lock.json` and `projects/synth/miniapp/` were not staged.

## Concerns

Plain Playwright discovery also imports the repository's Node `*.test.mjs` files and can print a non-gating parallel `package-app` failure marker even when Playwright exits successfully. The canonical serial Node gate (`npm run test:unit`) passes 31/31, and all 96 Playwright tests pass. This appears to be pre-existing runner-discovery noise, not a Task 5 persistence failure.
