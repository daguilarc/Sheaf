# Task 9 Integration Hardening And Production Inspection Report

Date: 2026-07-19

Base commit: `e2902ede`

Scope: Task 9 from `docs/superpowers/plans/2026-07-18-browser-app-catalog-launcher.md` and OpenSpec items 8.3–8.5. This report does not mark those OpenSpec items complete and does not modify `.superpowers/sdd/progress.md`.

## Worktree protection and final scope

The initial worktree had no tracked edits and exactly these protected untracked paths:

- `projects/synth/browser/package-lock.json`
- `projects/synth/miniapp/`

They remained unstaged and unmodified by Task 9. The final `git status --short --untracked-files=all` still lists the lockfile and the pre-existing Miniapp build tree only. Playwright changed the tracked desktop and narrow reference screenshots during browser runs; both were restored by exact path after the runs. No broad clean command was used.

Task 9 changes are limited to:

- `projects/synth/browser/Makefile`
- `projects/synth/browser/playwright.config.mjs`
- `projects/synth/browser/src/build-first-party-catalog.mjs`
- `projects/synth/browser/src/launcher.ts`
- `projects/synth/browser/src/main.ts`
- `projects/synth/browser/src/package-loader.ts`
- `projects/synth/browser/docs/catalog-schema-v1.md`
- `projects/synth/browser/tests/activation-lease.spec.ts`
- `projects/synth/browser/tests/launcher.spec.ts`
- `projects/synth/browser/tests/publish-site.test.mjs`
- `projects/synth/browser/tests/scaffold.test.mjs`
- `projects/synth/tests/browser_runtime_contract_tests.cpp`
- `.superpowers/sdd/task-9-report.md`

## Required command evidence

All Chromium commands below ran outside the sandbox because the host has the known macOS Mach-port denial. Every accepted browser result used Chromium; no browser sandbox bypass or substituted browser was used.

### Native and build gates

| Command | Working directory | Result |
|---|---|---|
| `make test` | `projects/synth` | exit 0; 24 invoked test executables, 968 `[PASS]` lines plus 14 `PASS` lines, with the remaining harnesses silent on success |
| `make browser-fake-app browser-miniapp` | `projects/synth` | exit 0 in the required fake-then-miniapp order |
| `npm run build` | `projects/synth/browser` | exit 0 |
| `npm run check:generic-runtime` | `projects/synth/browser` | exit 0 |
| `node --test projects/synth/browser/dist/tests/*.test.mjs` | repository root | 56 passed, 0 failed |
| `npm run test:unit` | `projects/synth/browser` | 56 passed, 0 failed |
| `make browser-unit-test` | `projects/synth` | exit 0; includes the direct incompatible runtime-config adapter assertion |

One initial command, `npm run build` from the repository root, exited 254 with `ENOENT` because the root has no `package.json`. No gate ran in that attempt. The command was rerun from `projects/synth/browser` as required and passed; this was an operator working-directory error, not a product defect.

### Ordered Playwright gates

| Gate and exact command | Result |
|---|---|
| `npx playwright test --workers=1 tests/launcher.spec.ts tests/package-loader.spec.ts tests/two-origin-package.spec.ts` | 18 passed |
| `npx playwright test --workers=1 tests/fake-app.e2e.spec.ts` | 3 passed |
| `SYNTH_BROWSER_FAKE_GATE_CONFIRMED=1 npx playwright test --workers=1 tests/miniapp-smoke.spec.ts` | 7 passed |
| `npx playwright test --workers=1 tests/activation-lease.spec.ts tests/audio-flow.spec.ts` | 15 passed |
| `npx playwright test --workers=1 tests/midi-flow.spec.ts` | 7 passed |
| `npx playwright test --workers=1 tests/persistence.spec.ts` | 5 passed |
| `npx playwright test --workers=1 tests/ui-backend.spec.ts` | 33 passed |
| `npx playwright test --workers=1 tests/static-site.spec.ts` | 6 passed |
| `SYNTH_BROWSER_REMOTE_CATALOG_URL=http://127.0.0.1:4174/dist/pages/catalogs/sheaf/catalog.json SYNTH_BROWSER_EXPECTED_BUILD_ID=db7b6e56b8fbffe20ef24d6b7347d712f0194eb62b152a0c6e2657256373e40a npx playwright test --workers=1 tests/two-origin-package.spec.ts tests/deployed-origin.spec.ts` | 2 passed |
| `npx playwright test --workers=1` | 101 passed, 1 skipped; the only skip was the opt-in live `deployed-origin.spec.ts` because no live URL was supplied |

The first standalone Miniapp command was run without the confirmed-gate environment after the separately invoked fake-app command. It exited 1 before Miniapp behavior ran because the default handoff filename contains Playwright's parent PID, which differs across CLI processes. Root-cause inspection showed that the repository's ordered Make target intentionally sets `SYNTH_BROWSER_FAKE_GATE_CONFIRMED=1` only after its fake-app prerequisite succeeds. The already-green 3/3 fake-app result therefore authorized the supported handoff above; the rerun passed 7/7. No product change was made for this fixture-only command-boundary failure.

### Final-review focused evidence

Production ownership inspection established that `SynthBrowserApp.start()` claims the runtime root before the selection promise resolves. The launcher's `.finally` render therefore runs only after `ownsRoot()` becomes false, making its successful-selection `Back to launcher` branch unreachable in the production composition. A focused launcher test was changed first to require the supported state: both choices remain locked after success and no launcher-owned in-page return control is rendered. Before the production change it failed 1/6 because the button was still present; after removing that dead branch and its `navigateToLauncher` option, the suite passed 6/6. The catalog contract now states explicitly that return is by top-level navigation/reload after the runtime takes ownership of the root.

The first affected-suite run then passed 37/38; its sole failure was the lease-retry test's stale expectation for that same removed button. The test retained its lease/package/install counter assertions and now checks the successful locked-selection state with no in-page return control. Its focused suite passed 8/8, and the combined launcher, package-loader, activation-lease, runtime-core, and static-site run passed 38/38.

The package materializer also documents at `mainScriptUrlOrBlob` that the original verified entry blob is intentional even when `entryUrl` is rewritten: Emscripten pthread/worker sidecars resolve through the explicit `locateFile` map. This is an invariant comment only; package behavior is unchanged.

### Publication, workflow, and final gates

| Command | Result |
|---|---|
| `npm run publish:site` | exit 0; `dist/site` replaced atomically |
| `npm run publish:pages` | exit 0; `dist/pages` replaced atomically |
| workflow structural and deployed-validator fixtures in the full Node gate | passed, including repository-root workflow invocation, CORS/MIME/build-ID/reference/size/SHA rejection fixtures |
| `openspec validate add-browser-app-catalog-launcher --strict` | exit 0, `Change 'add-browser-app-catalog-launcher' is valid` |
| `git diff --check` | exit 0 |

No live deploy, Pages enablement, push, or external setting change was performed.

## Production browser and network inspection

### Launcher-only root and discovery

The exact `dist/site/index.html` root contains one empty launcher mount:

```html
<main id="synth-root" data-synth-launcher="true" data-synth-catalog-sources="/catalog-sources.json"></main>
<script type="module" src="../dist/src/main.js"></script>
```

It contains no app auto-start attribute, Miniapp markup, rollback reference, app controls, or package reference. Browser inspection observed this startup discovery sequence before selection:

1. `/catalog-sources.json`
2. `/catalogs/sheaf/catalog.json`

The filtered startup request list contained zero `/packages/` requests and zero `/rollback/` requests. The catalog produced the first and only row as `sheaf/miniapp` with a visible `Launch Mini App` button.

The remote exact-artifact smoke observed the equivalent explicit paths:

1. `/dist/site/catalog-sources.json`
2. `/dist/site/catalogs/sheaf/catalog.json`

Only after selection did it request the immutable package:

1. `/dist/site/catalogs/sheaf/packages/miniapp/db7b6e56b8fbffe20ef24d6b7347d712f0194eb62b152a0c6e2657256373e40a/miniapp.js`
2. `/dist/site/catalogs/sheaf/packages/miniapp/db7b6e56b8fbffe20ef24d6b7347d712f0194eb62b152a0c6e2657256373e40a/miniapp.wasm`

The generic package materializer created verified blob URLs for the rewritten entry/main-script mapping and WASM mapping. The runtime loaded that entry and main-script mapping, constructed the pthread worker from the verified main-script blob, fetched WASM through its verified blob mapping, registered `/dist/src/audio-worklet.js`, constructed and connected one `AudioWorkletNode`, and reached the running non-silent real Miniapp. No rollback request occurred.

The static normal-flow inspection observed no WebSocket and no dynamic HTTP/API path beyond `/catalog-sources.json`. Source inspection of `main.ts`, `launcher.ts`, `catalog-client.ts`, `package-loader.ts`, `worker.ts`, and `public/index.html` found no Miniapp or rollback branch. App-specific names remain only in first-party catalog assembly/publication code and the documented rollback builder, not the launcher/runtime path.

### First-party catalog and package contract

- Publisher: `sheaf` / `Sheaf`
- Global application ID: `sheaf/miniapp`
- Build ID: `db7b6e56b8fbffe20ef24d6b7347d712f0194eb62b152a0c6e2657256373e40a`
- Browser ABI: 1
- UI protocol: 1
- Runtime-config version: 1
- Entry: `packages/miniapp/db7b6e56b8fbffe20ef24d6b7347d712f0194eb62b152a0c6e2657256373e40a/miniapp.js`
- Pthread worker, Wasm worker, and Emscripten AudioWorklet roles intentionally alias the inventoried `miniapp.js` emission; the host audio bridge itself loads `dist/src/audio-worklet.js`.

| Package file | MIME | Catalog size | Actual size | Catalog and actual SHA-256 |
|---|---:|---:|---:|---|
| `miniapp.js` | `text/javascript` | 98,297 | 98,297 | `64b162b9c4d894d0a3cfbc7e2fa5745bf0186ca863a0603062675887e3e9974c` |
| `miniapp.wasm` | `application/wasm` | 984,726 | 984,726 | `021072e87c12bc65c2f7bdca3d95b87286db7dff050ea6bf582850898af8ebbb` |

Every file reference resolves below `catalogs/sheaf/packages/miniapp/<build-id>/`; catalog size and SHA-256 equal the exact published bytes. The same package bytes and catalog are present in `dist/pages`.

### Rollback and Pages boundaries

The only published `app.js` under `dist/site` is `rollback/direct-miniapp/app.js`. It is byte-identical to the real `rollback/direct-miniapp/miniapp.js`. There is no `dist/site/dist/wasm/app.js`, and normal launcher/package requests never reference rollback. `dist/pages` has exactly one top-level `catalogs/` directory and contains only the catalog plus the two immutable package files; it has no HTML, source list, headers, runtime, or rollback files.

## Artifact size and digest inventory

### `dist/site`

| Relative path | Bytes | SHA-256 |
|---|---:|---|
| `_headers` | 382 | `dcb82686fcd3817aff223b63a8962c680d77ed6fc3c453765c68832a9f1f9680` |
| `catalog-sources.json` | 36 | `8769a98e552b4d87581e59100bffc1d912d7921820683a36c7209f03aa965060` |
| `catalogs/sheaf/catalog.json` | 1,282 | `a3537aefece115029ec0d89867141b1a8c1ca1b6f71a5f8b0a6015315f3869e7` |
| `catalogs/sheaf/packages/miniapp/<build-id>/miniapp.js` | 98,297 | `64b162b9c4d894d0a3cfbc7e2fa5745bf0186ca863a0603062675887e3e9974c` |
| `catalogs/sheaf/packages/miniapp/<build-id>/miniapp.wasm` | 984,726 | `021072e87c12bc65c2f7bdca3d95b87286db7dff050ea6bf582850898af8ebbb` |
| `dist/src/activation.js` | 2,580 | `4a9e23056882e038f07ced7182f17b2e2a5dbb63382ae201545d72ba1f16855c` |
| `dist/src/audio-worklet.js` | 1,689 | `062b67faed71c7dddedfb7537be5fafcf11655c2157cc95941ec793ede15e579` |
| `dist/src/audio.js` | 3,177 | `88bf6a8338ee1d5213bec95d6e43bc3fa485c4cb040ecee3100f3f40f39c63f6` |
| `dist/src/catalog-client.js` | 2,519 | `f6ba9c5cfa45337cd3f0b4dc3fd95d62497daf093169dec6d4544472ba6a3584` |
| `dist/src/catalog.js` | 10,747 | `1c4ac155d2bf28e7c4c591ff54560559fc92c7c9c5917fecf2c9f039d9132b40` |
| `dist/src/launcher.js` | 7,164 | `63def6b62897f68bbac37d576fd46186c88b54161f78be204037c74bd35138c0` |
| `dist/src/main.js` | 13,805 | `ff736fe5cc2d63827e02a91a558764d7a41eeea17108318467bfd6e74153306e` |
| `dist/src/midi.js` | 7,446 | `3c363ec55cc69c64c25691151138cbbac45695e58950c2fada65af66e570f9db` |
| `dist/src/package-loader.js` | 7,264 | `ddbb9564c14264b89a420cd5b14a6a752108de0d008e4bbb3c1ea5906bbef9fa` |
| `dist/src/persistence.js` | 4,031 | `b3d460427662fab2d24665ce8d26191c1be0fe439ddcbcb92b2fafd5d0ac3159` |
| `dist/src/protocol.js` | 13,471 | `19db10800104194f4bf63bf2f6d77225db12e5fb7b560fa3a6a7c5b255780b68` |
| `dist/src/ui.js` | 28,471 | `dd952d87349da651442a83be2a96b2cc84c3917cb61dc07000eea5c01d224af0` |
| `dist/src/worker.js` | 21,542 | `df55f02aef36a5e8d1b04d9104f413ee22396f3704a6a55fd7f9047aac5d41b7` |
| `index.html` | 439 | `1103512328236091acb9dbbf156e58ec79e6e0e7b1ebab0a896f10406f1e7d99` |
| `rollback/direct-miniapp/app.js` | 98,297 | `64b162b9c4d894d0a3cfbc7e2fa5745bf0186ca863a0603062675887e3e9974c` |
| `rollback/direct-miniapp/index.html` | 1,116 | `9d5e946e4acf47f6b6477838673f33e84df9d0f656a04269617b34a69506a617` |
| `rollback/direct-miniapp/miniapp.js` | 98,297 | `64b162b9c4d894d0a3cfbc7e2fa5745bf0186ca863a0603062675887e3e9974c` |
| `rollback/direct-miniapp/miniapp.wasm` | 984,726 | `021072e87c12bc65c2f7bdca3d95b87286db7dff050ea6bf582850898af8ebbb` |
| `synth-browser.css` | 3,214 | `2dced06f344602e4ad9329e7da5d133fc705354ea9f8926cec1a594d3571d193` |

### `dist/pages`

| Relative path | Bytes | SHA-256 |
|---|---:|---|
| `catalogs/sheaf/catalog.json` | 1,282 | `a3537aefece115029ec0d89867141b1a8c1ca1b6f71a5f8b0a6015315f3869e7` |
| `catalogs/sheaf/packages/miniapp/<build-id>/miniapp.js` | 98,297 | `64b162b9c4d894d0a3cfbc7e2fa5745bf0186ca863a0603062675887e3e9974c` |
| `catalogs/sheaf/packages/miniapp/<build-id>/miniapp.wasm` | 984,726 | `021072e87c12bc65c2f7bdca3d95b87286db7dff050ea6bf582850898af8ebbb` |

## Accumulated cleanup ledger

1. **Playwright discovery — fixed with focused red/green evidence.** A new structural test failed because the config had no `testMatch`. Adding `testMatch: "**/*.spec.ts"` made the focused scaffold gate pass 6/6 at that point (7/7 after cleanup item 3). The canonical Playwright run now discovers 102 browser specs rather than importing Node `*.test.mjs` files.
2. **Direct native runtime-config rejection — assertion added.** `RuntimeAbiAdapter<ValidApp>::Initialize("sheaf", "miniapp", 2)` is asserted to return `-1`; `make browser-unit-test` exits 0. This was coverage of existing correct behavior, so no production change or artificial red was needed.
3. **Fake/Miniapp build ordering — fixed with focused red/green evidence.** The structural red showed both targets copied different bytes to `dist/wasm/app.js`. The fake target no longer writes that rollback alias; Miniapp is its sole writer. Required, reversed, and parallel `-j2` invocations all exit 0 and `cmp dist/wasm/app.js dist/wasm/miniapp.js` succeeds, so fake completion cannot overwrite rollback bytes.
4. **Unexpected Emscripten sidecars — fixed with focused red/green evidence.** The red test added `miniapp.worker.js` and demonstrated publication silently succeeded. The builder now rejects any unreviewed `miniapp.*` emission other than the current `miniapp.js` and `miniapp.wasm` before destination replacement. Focused publish tests pass 7/7 and confirm the previous destination remains intact on rejection. Current aliased JS roles are unchanged.
5. **Nested cleanup catches — retained unchanged.** Package and activation disposers are required and tested to be idempotent. The outer cleanup remains defense-in-depth for failures before and after ownership transfer; refactoring stable lifecycle code offered no concrete release benefit. Activation/audio passed 15/15 and package-loader passed 11/11 within the final suite.
6. **Identifier cap — retained.** The 200-character bound remains intentional resource bounding on top of the normative identifier grammar. Catalog parser tests covering bounded metadata and malformed identifiers pass in the 56/56 Node gate.

## Live evidence boundary

There is no authorized live GitHub Pages deployment in Task 9. Local fixtures prove workflow structure, deployment-chain wiring, validator success and failure behavior, exact artifact bytes, local CORS-readable two-origin materialization, cross-origin isolation, real package activation, and audio readiness. They do not prove live GitHub Pages response CORS, live JavaScript/WASM MIME delivery, or post-deploy validation against a newly deployed URL. Those remain CI-owned and locally unproven. Live Cloudflare header behavior is likewise not claimed; only the exact generated `_headers` artifact and the canonical local server behavior were inspected.
