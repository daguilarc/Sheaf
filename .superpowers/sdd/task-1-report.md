# Task 1 Report: Catalog Contract and Registry

## Result

- Status: `DONE`
- OpenSpec mapping: `1.1`–`1.4`
- Commit message: `feat(synth-browser): define catalog and browser ABI contracts` (hash returned to the controller)
- Required catalog, facade/runtime-core, generic-boundary, and native contract gates pass.
- OpenSpec checkboxes were not modified; controller review owns acceptance and checkbox updates.
- The pre-existing `.superpowers/sdd/progress.md` edit, `projects/synth/browser/package-lock.json`, and `projects/synth/miniapp/` artifacts were preserved and excluded from staging.

## Implementation

### Strict catalog/source contract

- Added supported schema/browser ABI/UI protocol/runtime-config constants, all version `1`.
- Added readonly validated source, publisher, package-file, browser-package, app, catalog, duplicate-diagnostic, and registry types.
- Added `parseCatalogSources(value)` for a nonempty, unique list of absolute HTTPS catalog URLs without credentials or fragments.
- Added `parseCatalog(value, catalogUrl)` with strict schema-owned keys and required fields at every v1 object level.
- Enforced the agreed minimal v1 contract:
  - `catalogVersion`: trimmed, nonempty string, maximum 128 characters.
  - publisher/app/build IDs: `[a-z0-9]+(?:-[a-z0-9]+)*`.
  - publisher name and app display name/author/category: trimmed, nonempty strings, maximum 200 characters.
  - package media types: `text/javascript`, `application/wasm`, or `application/octet-stream`.
  - SHA-256: exactly 64 lowercase hexadecimal characters.
  - normalized relative package paths only; absolute, backslash, percent-encoded, query/fragment, empty-segment, dot-segment, and traversal-like forms are rejected before URL resolution.
  - nonempty app/file inventories, unique local app IDs and file paths, and an entry path naming a declared `text/javascript` file.
- Resolved validated entry/file URLs only after path validation and against the catalog response URL.
- Returned recursively frozen records/arrays without mutating input values.

### Deterministic registry merge

- Added `mergeCatalogs(results)` returning readonly `{ apps, diagnostics }`.
- Preserved configured-source input order as precedence.
- Retained the first `<publisher-id>/<app-id>` registration and emitted a frozen `duplicate-app` diagnostic for every later duplicate with accepted/rejected catalog URLs.
- Sorted final accepted apps by display name and then global ID using deterministic JavaScript code-unit ordering rather than locale collation.

### Pre-creation browser ABI negotiation

- Added native C exports:
  - `synth_browser_abi_version()`
  - `synth_browser_ui_protocol_version()`
  - `synth_browser_runtime_config_version()`
- Declared the exports in the browser runtime header and added them to the Emscripten export list.
- Added corresponding required numeric values to `RuntimeModuleFacade`; `emscriptenRuntimeFacade` reads all three before `create` is called.
- Added `RuntimeVersions`, frozen `SUPPORTED_RUNTIME_VERSIONS`, and `negotiateRuntimeVersions(actual, required)`.
- Moved worker load assignment and persistence-factory creation behind successful negotiation. A mismatch leaves the worker without a loaded module, so subsequent creation cannot run.
- Added optional declared versions to the load command; when omitted, the module's reported requirements must still equal all host-supported versions.
- Updated existing injected facade fixtures to explicitly implement ABI v1.
- Linked the real C adapter into the native contract binary so the pre-creation export assertions exercise production definitions.

## TDD RED Evidence

### Catalog RED

Command from `projects/synth/browser` after adding `tests/catalog.test.mjs` and before creating production `src/catalog.ts`:

```text
npm run build && node --test dist/tests/catalog.test.mjs
```

Observed: TypeScript build exited successfully; Node exited nonzero with the expected missing-feature error:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../dist/src/catalog.js'
✖ dist/tests/catalog.test.mjs
tests 1; pass 0; fail 1
```

### Native ABI RED

Command from `projects/synth` after adding native assertions and linking the production adapter, before adding the exports:

```text
make browser-unit-test
```

Observed: compilation failed at the three expected missing declarations:

```text
error: use of undeclared identifier 'synth_browser_abi_version'
error: use of undeclared identifier 'synth_browser_ui_protocol_version'
error: use of undeclared identifier 'synth_browser_runtime_config_version'
make: *** [build/browser_runtime_contract_tests] Error 1
```

### Browser facade/negotiation RED

The first sandboxed Playwright attempt failed solely because macOS denied Chromium's Mach-port bootstrap. Per repository policy, the unchanged test was rerun with Chromium outside the sandbox.

Meaningful RED command from `projects/synth/browser`:

```text
npx playwright test tests/runtime-core.spec.ts
```

Observed: 4 existing tests passed and exactly the 2 new tests failed:

```text
reads Emscripten browser contract versions without creating a runtime:
  expected version 1 values, received undefined

rejects incompatible modules before creation or persistence setup:
  expected incompatibility, received "persistence must not be created"

2 failed; 4 passed
```

This proved both missing facade exposure and the incorrect pre-fix ordering where persistence setup occurred before negotiation.

## GREEN Evidence

### Catalog GREEN

Command from `projects/synth/browser`:

```text
npm run build && node --test dist/tests/catalog.test.mjs
```

Observed: exit `0`; all 15 catalog tests passed.

### ABI GREEN

Commands:

```text
npx playwright test tests/runtime-core.spec.ts
make browser-unit-test
```

Observed: runtime-core exited `0` with 6/6 tests passed. Native build linked `browser/cpp/BrowserRuntimeAbi.cpp`, then `build/browser_runtime_contract_tests` exited `0`.

### Collateral facade-fixture GREEN

Command from `projects/synth/browser`:

```text
npm run build && npx playwright test tests/static-site.spec.ts tests/persistence.spec.ts tests/midi-flow.spec.ts --grep-invert "real miniapp WASM"
```

Observed: exit `0`; 11/11 existing static, persistence, and generic MIDI tests passed with their v1 facade fixtures. The generated real-miniapp artifact test was deliberately excluded because the task instructions require preserving pre-existing build artifacts; a newly generated package will carry the new exports through the changed Emscripten export list.

### Final Required Gate (Fresh, Before Commit)

From `projects/synth/browser`:

```text
npm run build && node --test dist/tests/catalog.test.mjs dist/tests/scaffold.test.mjs && npm run check:generic-runtime && npx playwright test tests/runtime-core.spec.ts
```

Observed: exit `0`.

- TypeScript build: passed.
- Node catalog/scaffold tests: 20/20 passed, 0 failed.
- Generic runtime boundary check: passed.
- Runtime-core Playwright: 6/6 passed, 0 failed.

From `projects/synth`:

```text
make browser-unit-test
```

Observed: exit `0`; `build/browser_runtime_contract_tests` ran successfully.

Additional final hygiene:

```text
git diff --check
```

Observed: exit `0`, no whitespace errors.

## Files Changed

- `.superpowers/sdd/task-1-report.md`
- `projects/synth/Makefile`
- `projects/synth/browser/Makefile`
- `projects/synth/browser/cpp/BrowserRuntimeAbi.cpp`
- `projects/synth/browser/src/catalog.ts`
- `projects/synth/browser/src/protocol.ts`
- `projects/synth/browser/src/worker.ts`
- `projects/synth/browser/tests/catalog.test.mjs`
- `projects/synth/browser/tests/midi-flow.spec.ts`
- `projects/synth/browser/tests/persistence.spec.ts`
- `projects/synth/browser/tests/runtime-core.spec.ts`
- `projects/synth/browser/tests/scaffold.test.mjs`
- `projects/synth/browser/tests/static-site.spec.ts`
- `projects/synth/include/synth/browser/BrowserRuntime.hpp`
- `projects/synth/tests/browser_runtime_contract_tests.cpp`

## Self-Review

- Re-read Task 1, OpenSpec `sbac-2`, `sbac-3`, `sbac-5`, and `sbac-9`, plus design decisions D2/D3.
- Confirmed all compatibility values are exactly `1` in TypeScript and native exports.
- Confirmed validation is performed before URL resolution and no input object/array is modified.
- Confirmed the parser rejects unknown schema-owned keys rather than silently carrying extension data into v1.
- Confirmed source precedence is independent of display sorting and a later duplicate cannot replace the accepted object.
- Confirmed incompatible module load does not assign the module, call `create`, or construct persistence.
- Confirmed direct/runtime worker fixtures explicitly declare v1 rather than weakening production negotiation for legacy mocks.
- Confirmed no application-specific names or branches were introduced into runtime code.
- Confirmed `git diff --check` passes.
- Confirmed the pre-existing progress edit, package lock, and miniapp artifacts remain unstaged.

## Concerns

None for the source contract. Any already-generated browser WASM artifact predating this commit must be rebuilt before a real-package browser test can observe the new version exports; the Makefile now exports them for both fake and miniapp builds. No generated artifact was modified or staged in this task.
