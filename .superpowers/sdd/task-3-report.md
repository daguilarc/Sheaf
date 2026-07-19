# Task 3 Report — Absolute Message Serialization and Routing

## Status

DONE. Implemented OpenSpec tasks 3.1 and 3.2 in commit `a3de4ecc` (`feat(synth): route absolute parameter messages`). The OpenSpec checklist itself was intentionally not edited; the orchestrator will update it only after external spec and quality review.

## Scope Implemented

- Added `MessageIn::Type::ParamSetAbsolute` adjacent to `ParamIncDec`, with the static constructor payload `(timestamp, slotIx, position, normalizedValue)`.
- Added exact JSON name `paramSetAbsolute`, parsing, round-trip preservation, and controller system-association preservation.
- Added parallel `HandleSetAbsolute` routing through `ParameterManager`, `BankSlot`, and `Bank`, for both physical encoder IDs and `(slotIx, position)` addresses.
- Routed the selected bank's currently visible cell using the owning manager scene, including a visible modulation-depth parameter without changing its hidden parent.
- Added the same effective-modifier gate as `ParamIncDec` and preserved no-op behavior for absent slots, out-of-range positions, disconnected slots, and empty mapped cells.
- Updated declaration-order sort metadata, exhaustive switches, system-message output classification, the view-model system-message catalog, and its argument/edit handling.

## TDD Evidence

### RED

Command:

```bash
make -C projects/synth build/parameter_modulation_tests build/blocks_tests build/viewmodel_tests
```

Result: exit `2`, expected compile failure before production changes. Representative diagnostics:

```text
error: no member named 'ParamSetAbsolute' in 'synth::MessageIn'
error: no member named 'ParamSetAbsolute' in 'synth::MessageIn::Type'
error: no member named 'HandleSetAbsolute' in 'synth::ParameterManager'
13 errors generated.
make: *** [build/parameter_modulation_tests] Error 1
```

This RED directly proved the new message and routing APIs did not exist.

### GREEN

Command, rerun after the commit:

```bash
make -C projects/synth build/parameter_modulation_tests build/blocks_tests build/viewmodel_tests && \
projects/synth/build/parameter_modulation_tests && \
projects/synth/build/blocks_tests && \
projects/synth/build/viewmodel_tests
```

Result: exit `0`. All three binaries passed, including the new tests:

- `param_set_absolute_message_constructs_and_round_trips_exact_payload`
- `param_set_absolute_survives_controller_system_association_round_trip`
- `param_set_absolute_routes_by_selected_bank_slot_position_and_physical_encoder`
- `param_set_absolute_edits_visible_modulation_depth_not_hidden_parent`
- `param_set_absolute_is_blocked_by_every_effective_modifier`
- `param_set_absolute_unmapped_boundaries_are_no_ops`
- `SortKeyIncludesAbsolutePayloadAddressAdjacentToRelativeTurns`
- `UISystemMessageCatalogExpansionCoversPressAndReleaseSemantics`

`git diff --check` also exited `0` after the commit.

## Changed Files

- `projects/synth/include/synth/ParameterModulation.hpp`
- `projects/synth/src/ParameterModulation.cpp`
- `projects/synth/src/MidiController.cpp`
- `projects/synth/include/synth/MidiConfigBlocks.hpp`
- `projects/synth/src/MidiConfigBlocks.cpp`
- `projects/synth/include/synth/MidiConfigViewModel.hpp`
- `projects/synth/src/MidiConfigViewModel.cpp`
- `projects/synth/tests/parameter_modulation_tests.cpp`
- `projects/synth/tests/blocks_tests.cpp`
- `projects/synth/tests/viewmodel_tests.cpp`

## Self-Review

- The bus checks `GetCurrentModifier() == Modifier::None` before dispatch, exactly matching relative turns.
- The route resolves the slot position to a physical encoder, checks selected-bank ownership, then looks up the bank's visible cell; this makes modulation views authoritative and preserves every existing no-op boundary.
- The manager supplies its own `scene_`; callers cannot accidentally provide a foreign scene through the message path.
- Existing `ParamIncDec` logic and message payload behavior were not changed.
- Only task-scoped synth source/tests were committed. Existing report/progress/OpenSpec/plan changes and `projects/synth/miniapp/` remain uncommitted and untouched by this task.

## Concerns

None blocking. `ParamSetAbsolute` is intentionally exposed in the generic system-message catalog because Task 3 requires catalog/exhaustive handling; its feedback evaluation is intentionally empty, like other parameter-edit messages.

---

# Task 3 Report — Immutable Remote Packages

## Status

DONE. Implemented OpenSpec 3.1–3.5 in commit `d7de26d1` (`feat(synth-browser): verify and materialize immutable app packages`). The OpenSpec checklist and `.superpowers/sdd/progress.md` were intentionally not edited; the controller owns review and completion bookkeeping.

## Scope Implemented

- Added a deterministic package assembler and CLI that recursively inventory a dedicated Emscripten emission directory, reject symlinks/non-regular files/traversal/ambiguous basenames, require entry/WASM/pthread/Wasm-worker/AudioWorklet roles (with deliberate aliasing allowed), compute lowercase SHA-256 digests and a content-derived build ID, and copy every artifact under `packages/<app-id>/<build-id>/`.
- Added CORS materialization that fetches every declared file with `mode: "cors"` and `credentials: "omit"`, then validates status, declared media type, response length when present, and SHA-256 before creating or importing anything.
- Added typed object URLs, a serializable `Readonly<Record<string, string>>` `locateFile` map, `mainScriptUrlOrBlob`, strict unmapped-path rejection, deterministic rewriting of Emscripten's `new URL("sidecar", import.meta.url)` pthread bootstrap, and idempotent cleanup.
- Replaced the Task 1 `RuntimeModuleLoader(moduleUrl?)` boundary with a materialized-module input and threaded it through runtime commands, direct clients, real worker clients, app startup, and existing runtime/audio/MIDI/persistence tests.
- Extended the active `src/static-server.mjs` with CORS while retaining JSON/WASM MIME and COOP/COEP/Permissions-Policy headers, and added a second-origin generic WASM package fixture that starts inside the isolated launcher.
- Added generic Make/package scripts for assembling a dedicated emission directory without introducing first-party publication work from Task 6.

## TDD Evidence

### RED — deterministic assembler

Command:

```bash
cd projects/synth/browser
npm run build && node --test dist/tests/package-contract.test.mjs
```

Result: exit `1`, expected missing implementation:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../dist/src/package-contract.mjs'
```

### RED — loader and two-origin contracts

Command (Chromium required the expected macOS sandbox escalation):

```bash
cd projects/synth/browser
npx playwright test tests/package-loader.spec.ts tests/two-origin-package.spec.ts
```

Result: exit `1`, 8/8 expected failures. Seven loader tests could not import the missing `package-loader.js`; the explicit loader-mapping test exercised the old URL-only signature; the two-origin test also failed on the missing materializer.

### RED — package CLI

Command:

```bash
cd projects/synth/browser
npm run build && node --test dist/tests/package-contract.test.mjs
```

Result: exit `1`, 4 passed / 1 failed because `dist/src/package-app.mjs` did not exist.

### RED — Emscripten import-meta worker bootstrap

Command:

```bash
cd projects/synth/browser
npm run build && npx playwright test tests/package-loader.spec.ts -g "rewrites verified"
```

Result: exit `1`; expected transformed entry URL `blob:verified/3`, received the original `blob:verified/1`.

### GREEN — prescribed final gate

Command:

```bash
cd projects/synth/browser
npm run build && \
node --test dist/tests/package-contract.test.mjs && \
npx playwright test tests/package-loader.spec.ts tests/two-origin-package.spec.ts && \
npm run check:generic-runtime
```

Result: exit `0`; assembler/CLI 5/5 passed, package-loader/two-origin 9/9 passed, TypeScript build passed, and the generic-runtime boundary check passed.

### GREEN — adjacent regression gates

- `npm run build && node --test dist/tests/*.test.mjs && npx playwright test tests/audio-flow.spec.ts tests/midi-flow.spec.ts tests/persistence.spec.ts`: exit `0`; 31/31 Node and 15/15 Playwright tests passed.
- `npm run build && npx playwright test tests/runtime-core.spec.ts tests/static-site.spec.ts tests/fake-app.e2e.spec.ts`: exit `0`; 13/13 tests passed.
- `git diff --cached --check`: exit `0` before commit.

Chromium emitted only the existing `NO_COLOR`/`FORCE_COLOR` warning; there were no test failures or browser console errors in the final gates.

## Changed Files

- `projects/synth/browser/src/package-contract.mjs`
- `projects/synth/browser/src/package-app.mjs`
- `projects/synth/browser/src/package-loader.ts`
- `projects/synth/browser/src/worker.ts`
- `projects/synth/browser/src/main.ts`
- `projects/synth/browser/src/static-server.mjs`
- `projects/synth/browser/Makefile`
- `projects/synth/browser/package.json`
- `projects/synth/browser/tests/package-contract.test.mjs`
- `projects/synth/browser/tests/package-loader.spec.ts`
- `projects/synth/browser/tests/two-origin-package.spec.ts`
- `projects/synth/browser/tests/audio-flow.spec.ts`
- `projects/synth/browser/tests/fake-app.e2e.spec.ts`
- `projects/synth/browser/tests/midi-flow.spec.ts`
- `projects/synth/browser/tests/miniapp-smoke.spec.ts`
- `projects/synth/browser/tests/persistence.spec.ts`
- `projects/synth/browser/tests/runtime-core.spec.ts`
- `projects/synth/browser/tests/static-site.spec.ts`

## Self-Review

- Every declared response completes status/media/length/hash validation before any object URL is created; therefore no entry import can occur while another declared file remains unchecked.
- Object URLs are created only from verified bytes with the declared Blob type. Creation failures revoke earlier URLs, and repeated `dispose()` calls revoke each URL exactly once.
- The serializable `locateFile` field is explicitly documented as a mapping. Only `loadEmscriptenRuntime` converts it to Emscripten's callback, ignores the supplied document prefix, normalizes the requested package path, and throws on an unmapped path.
- Current Emscripten reuses its entry for pthread, Wasm-worker, and AudioWorklet roles. The assembler permits those role aliases but still proves each role resolves to an inventoried hashed record.
- The verified entry rewrite addresses this toolchain's import-meta pthread form without altering the verified remote bytes in place: the original typed entry URL remains the worker/main-script sidecar, while a second typed URL contains only the deterministic bootstrap substitution.
- The runtime loader and runtime command no longer accept `moduleUrl?`. `SynthBrowserAppOptions.moduleUrl` remains solely as a transitional local/direct compatibility input that is immediately converted to an explicit entry/WASM map; it cannot trigger document-relative loader fallback.
- The generic fake package test runs before any miniapp test in the prescribed Task 3 command and proves cross-origin CORS fetch, hash verification, typed entry/WASM URLs, isolation, factory creation, and generic runtime startup.
- No Task 4 activation-lease, Task 5 persistence-identity, Task 6 first-party publication, or later deployment scope was started.

## Assumptions and Decisions

- Per controller decision, `MaterializedRuntimeModule.locateFile` is a serializable immutable filename-to-object-URL record because it must cross `postMessage`; the Emscripten callback is built only at the import boundary.
- The assembler's source directory is a dedicated emission directory, so every recursively discovered regular file belongs to the package. Ambiguous basenames are rejected because Emscripten can request sidecars by basename.
- Required Emscripten roles are declarations validated against the complete inventory; multiple roles may intentionally name one file.
- Response `Content-Length`, when present, is syntactically validated but advisory; decoded-byte SHA-256 is authoritative because catalog schema v1 has no decoded-size field. See the Opus review fix below.

## Concerns

None blocking. The pre-existing untracked `projects/synth/browser/package-lock.json` and `projects/synth/miniapp/` remain unstaged and unchanged. The existing report content above this appended section belongs to an unrelated earlier task and was preserved rather than overwritten.

## Opus Review Fix — Advisory Transfer Length

Commit: `a0a07670` (`fix(synth-browser): treat package content length as advisory`).

### Finding Resolution

- A valid `Content-Length` is now parsed and range-validated but is advisory. Fetch may expose a compressed transfer length while `arrayBuffer()` returns decoded bytes, and catalog schema v1 has no decoded-size field.
- SHA-256 over decoded response bytes remains authoritative. The existing stale/hash-mismatched WASM regression still proves that a wrong digest prevents object-URL creation and entry import.
- Consolidated package-loader and worker sidecar normalization into exported `normalizeMaterializedPath`, with one strict catalog-compatible segment grammar. `worker.ts` imports the helper without a cycle because `package-loader.ts` has no runtime dependency on the worker.

### Review-Fix TDD Evidence

RED command:

```bash
cd projects/synth/browser
npm run build && npx playwright test tests/package-loader.spec.ts -g "advisory transfer"
```

Result: exit `1`; expected `accepted`, received `package file ... length 33; response declared 17`.

GREEN command covering advisory length plus authoritative digest:

```bash
cd projects/synth/browser
npm run build && npx playwright test tests/package-loader.spec.ts -g "advisory transfer|stale or hash-mismatched"
```

Result: exit `0`; 2/2 passed.

Normalizer RED command:

```bash
cd projects/synth/browser
npm run build && npx playwright test tests/package-loader.spec.ts -g "one strict package grammar"
```

Result: exit `1`; `normalizeMaterializedPath is not a function` before the shared helper existed.

Final prescribed gate:

```bash
cd projects/synth/browser
npm run build && \
node --test dist/tests/package-contract.test.mjs && \
npx playwright test tests/package-loader.spec.ts tests/two-origin-package.spec.ts && \
npm run check:generic-runtime
```

Result: exit `0`; assembler/CLI 5/5, package-loader/two-origin 11/11, build and generic-runtime check passed.

Adjacent focused gates rerun:

- All Node tests: 31/31 passed.
- Audio/MIDI/persistence: 15/15 passed.
- Runtime/static-server/real fake-app: 13/13 passed.
- `git diff --cached --check`: exit `0` before commit.

### Remaining Coverage Note

The current Task 3 suite proves the Emscripten import-meta worker rewrite deterministically and proves remote typed entry/WASM startup through the isolated two-origin fixture. It does not yet execute a real remotely materialized pthread and AudioWorklet end to end. Per controller classification, that live integration coverage belongs to Task 6/9 and is not a Task 3 blocker.
