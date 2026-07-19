# Task 2 Report: Declarative App Manifest and Generic Compiler

## Status and Commit

Task 2 of `fix-browser-native-audio-and-generic-app-packaging` is implemented and
committed.

- Base: `3c66ba2b646c0fe86a6f5ce327b52e7200243987`
- Commit: `68ebefebf098f87530f4c659799594239b975390`
- Subject: `refactor(synth-browser): build apps from one manifest`
- OpenSpec checkboxes were not modified.
- The pre-existing untracked `projects/synth/browser/package-lock.json` and
  `projects/synth/miniapp/` tree were not modified or staged.

## Implementation

- Added the authoritative `first-party-apps.json` manifest with ordinary records
  for Braid 4 and Mini App. Mini App retains published category `Instrument`.
- Added a strict manifest reader that validates exact keys, schema/publisher types,
  app IDs, qualified C++ types, nonempty values, source-root containment, existing
  include directories/headers, duplicates, and path safety. It sorts by ASCII app
  ID, hashes canonical validated data, and deeply freezes the result.
- Added the transient binding generator. The exact Braid 4 output is:

  ```cpp
  #include "Braid4.hpp"
  #include "synth/browser/BrowserAppEntry.hpp"

  SYNTH_BROWSER_APP(synth_braid4::Braid4)
  ```

- Added one argument-vector Emscripten orchestrator used by production and the
  fixture manifest. It generates bindings under `dist/generated/browser-apps/`,
  builds into `dist/wasm/apps/<appId>/`, validates nonempty JS/Wasm artifacts, and
  atomically replaces `dist/wasm/apps/emissions.json` only after all configured
  apps compile.
- Preserved Task 1's browser ABI v2 native runtime contract, including
  `_synth_browser_start_audio_worklet` and module-local
  `emscriptenRegisterAudioObject`.
- Applied one linker policy to every record: pthreads, Wasm workers, native audio
  worklets, IDBFS, 512 MiB initial memory, growth enabled, and 2 GiB maximum.
- Removed `miniapp_entry.cpp` and `fake_app_entry.cpp`; moved the fake header under
  explicit test fixtures and added a fixture manifest that invokes the same builder.
- Replaced named Mini App/fake Make recipes and the `dist/wasm/app.js` alias with
  `browser-apps`, `browser-fixture-app`, `browser-apps-run`, and
  `browser-apps-smoke`, mirrored from `projects/synth/Makefile`.
- Migrated the Cloudflare build script and Pages workflow to those generic targets.
- Strengthened the static boundary check to derive app IDs, display names, headers,
  types, and namespace/type components from the validated authoritative manifest.

## TDD Evidence

### Initial manifest/compiler RED

After adding the two focused suites and before either production module existed:

```sh
npm --prefix projects/synth/browser run build && \
node --test \
  projects/synth/browser/dist/tests/app-build-manifest.test.mjs \
  projects/synth/browser/dist/tests/build-browser-apps.test.mjs
```

Result: exit `1`. TypeScript compilation succeeded, then both suites failed with
`ERR_MODULE_NOT_FOUND` for `dist/src/app-build-manifest.mjs` and
`dist/src/build-browser-apps.mjs`. This was the expected missing-feature RED.

### Initial parser/compiler GREEN

The same command exited `0`, 11/11 passed after implementing the strict parser,
generator, and injected argument-vector compiler. Coverage includes exact keys,
schema/publisher types, identifier syntax, duplicates, empty values, path safety,
deterministic sorting/digest, deep freezing, exact generated C++, invariant linker
policy, generic artifact roles, missing emissions, and atomic report preservation.

### Generic Make/scaffold RED/GREEN

After updating scaffold expectations but before replacing named recipes:

```sh
npm --prefix projects/synth/browser run build && \
node --test projects/synth/browser/dist/tests/scaffold.test.mjs
```

Result: exit `1`, 5/7 passed. The two expected failures named the missing generic
targets and still-present named recipes/rollback alias. After the Make/package
migration, the suite passed 7/7.

Self-review later added a concurrency regression requiring the fixture and production
builds to run sequentially, because sibling Make prerequisites could race the shared
emissions report under `make -j`. It failed against the parallel-prerequisite form and
passed after `browser-apps-smoke` invoked `browser-apps` only after the fixture target.

### Manifest-derived boundary RED/GREEN

After strengthening the checker and before migrating build consumers:

```sh
npm --prefix projects/synth/browser run check:generic-runtime
```

Result: exit `1`. It reported exactly the stale concrete target references in:

- `projects/synth/browser/scripts/cloudflare-pages-build.sh`
- `.github/workflows/synth-browser-pages.yml`

After both used `browser-fixture-app browser-apps`, the command exited `0`.

### Allowed-root containment regression RED/GREEN

The first real build exposed that syntactically rejecting every `..` component also
rejected the approved browser-relative `../apps/<app>` paths before canonical root
validation. A focused regression was added:

```sh
npm --prefix projects/synth/browser run build && \
node --test projects/synth/browser/dist/tests/app-build-manifest.test.mjs
```

Before the fix: exit `1`, 8/9 passed; the new allowed parent-relative case failed.
After the fix: exit `0`, 9/9 passed. Include directories may now contain parent
components only when their real path is inside an explicit allowed root. Header
traversal remains rejected, and `../outside` remains rejected by containment.

## Final Verification

### Required focused tests

```sh
npm --prefix projects/synth/browser run build && \
node --test \
  projects/synth/browser/dist/tests/app-build-manifest.test.mjs \
  projects/synth/browser/dist/tests/build-browser-apps.test.mjs \
  projects/synth/browser/dist/tests/scaffold.test.mjs
```

Result: exit `0`, 19/19 passed, 0 failed.

### Required generic-boundary check

```sh
npm --prefix projects/synth/browser run check:generic-runtime
```

Result: exit `0`.

### Real fixture build

```sh
make -C projects/synth/browser browser-fixture-app
```

Result: exit `0`; the fake app compiled through the same builder and uniform linker
policy. Emscripten printed its expected pthread/growable-memory performance warning
and `USE_PTHREADS` deprecation warning.

### Required real first-party build

```sh
make -C projects/synth/browser browser-apps
```

Result: exit `0`; both Braid 4 and Mini App emitted nonempty JS/Wasm pairs. The final
report has manifest digest
`a8f51da00809706924e1c20cc937852caabaf2b53e57a73438acfa60ee64885d`, publisher
`sheaf`, sorted apps `["braid-4", "miniapp"]`, and entry/Wasm/pthread-worker/
Wasm-worker/audio-worklet roles for each app.

### Additional checks

- `git diff --check`: exit `0` before commit.
- Both handwritten entry paths do not exist.
- Staged-path guard confirmed neither protected untracked path was staged.
- Broader `npm --prefix projects/synth/browser run test:unit`: 67/68 passed. The sole
  failure is the pre-existing Task 1 mismatch described under Concerns.

## Changed Files

- `.github/workflows/synth-browser-pages.yml`
- `projects/synth/Makefile`
- `projects/synth/browser/Makefile`
- `projects/synth/browser/cpp/FakeBrowserApp.hpp` (moved)
- `projects/synth/browser/cpp/fake_app_entry.cpp` (deleted)
- `projects/synth/browser/cpp/miniapp_entry.cpp` (deleted)
- `projects/synth/browser/first-party-apps.json`
- `projects/synth/browser/package.json`
- `projects/synth/browser/scripts/cloudflare-pages-build.sh`
- `projects/synth/browser/src/app-build-manifest.mjs`
- `projects/synth/browser/src/build-browser-apps.mjs`
- `projects/synth/browser/tests/app-build-manifest.test.mjs`
- `projects/synth/browser/tests/build-browser-apps.test.mjs`
- `projects/synth/browser/tests/check-generic-runtime.mjs`
- `projects/synth/browser/tests/fixtures/cpp/FakeBrowserApp.hpp` (move destination)
- `projects/synth/browser/tests/fixtures/fake-browser-apps.json`
- `projects/synth/browser/tests/github-pages-workflow.test.mjs`
- `projects/synth/browser/tests/scaffold.test.mjs`

## Self-Review

- Re-read the Task 2 brief, OpenSpec proposal/design/tasks, both change specs, approved
  design, repository AGENTS instructions, and relevant TDD/debugging/verification
  guidance.
- Confirmed every app record has exactly the seven required fields and that the
  returned manifest has exactly `schemaVersion`, `publisher`, `apps`, and `digest`.
- Confirmed canonical data does not contain checkout-absolute paths, preserving a
  stable digest across worktrees.
- Confirmed source roots and resolved headers use `realpath`, preventing symlink escape.
- Confirmed all command execution uses an executable plus argv array with `shell: false`.
- Confirmed only validated include directories, generated binding, and output paths vary
  between calls; runtime sources, exports, workers, filesystem, and memory flags match.
- Confirmed the report is replaced atomically only after all configured compiles and
  artifact validation succeed.
- Confirmed fixture then production smoke-wrapper order cannot race the final report.
- Confirmed the authoritative final report references production records, not the
  fixture manifest.
- Confirmed no app-specific entry translation units or legacy app alias remain.
- Confirmed no OpenSpec checkbox changed.

## Concerns

1. The base commit already has one browser unit mismatch outside Task 2:
   `package-contract.test.mjs` expects `{ abiVersion: 1 }`, while Task 1 changed
   `package-contract.mjs` to emit supported browser ABI v2. The same expectation exists
   in base `3c66ba2...`, and neither file was modified here. The broad unit result is
   therefore 67/68, while every Task 2 required gate passes.
2. Per the written task split, `build-first-party-catalog.mjs` and `publish-site.mjs`
   remain transitional exclusions from the concrete-token scan. They still consume the
   legacy single-app layout and are explicitly converted to the manifest/emission report
   in Task 3. Publication is not expected to complete between Task 2 and Task 3.
3. Emscripten warns that pthreads plus memory growth may execute non-Wasm code slowly
   and that `USE_PTHREADS` is deprecated. Both settings are required by the approved
   common Task 2 policy; the real builds still exit successfully.
