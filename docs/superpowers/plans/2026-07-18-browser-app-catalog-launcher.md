# Browser App Catalog Launcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Replace the production browser miniapp auto-launch page with a trusted, federated SheafPatch catalog launcher that starts an independently packaged WASM application from one user selection gesture, while publishing this repository's miniapp as the first catalog package and providing a GitHub Pages publisher path.

**Architecture:** The Cloudflare Pages site remains the cross-origin-isolated host. It fetches only a checked-in source list and lightweight publisher catalogs at startup, merges compatible registrations, and fetches an immutable package only after selection. Each package includes its app and chosen Sheaf implementation behind browser ABI v1. The selection handler acquires host-owned audio and sysex MIDI resources before any await, then passes a package-materialization lease and app identity into the generic runtime. Cloudflare publishes the first-party launcher, catalog, and package; GitHub Pages is an additional CORS publisher, not the runtime host.

**Tech Stack:** TypeScript/ES modules, Node test runner, Playwright Chromium, Emscripten C++20/WASM, Make, Cloudflare Pages static artifacts, GitHub Actions and GitHub Pages.

**Source of truth:** `openspec/changes/add-browser-app-catalog-launcher/{proposal.md,design.md,tasks.md}` and both delta specs under `openspec/changes/add-browser-app-catalog-launcher/specs/`.

**Working rules:** Use strict TDD for each behavior change. Keep the current direct miniapp artifact until Task 6's launcher gates pass. Preserve the generic fake-app-first acceptance order. Never add concrete app branches to launcher/runtime code. Do not stage the pre-existing `projects/synth/browser/package-lock.json` or `projects/synth/miniapp/build/` artifacts. After a task passes its tests, update only its mapped OpenSpec checkboxes. Use one fresh native implementer per task, keep that implementer open for ordinary fixes, and use one persistent Claude reviewer session per task for spec review, quality review, and post-fix re-review. Escalate a large review finding into a separately briefed implementation task instead of smuggling it into a small fix loop.

**Baseline evidence:** Before plan creation, `make test` passed in `projects/synth`; after `make browser-fake-app browser-miniapp`, `npm test` passed 64/64 Playwright tests plus all TypeScript and Node tests in `projects/synth/browser`.

---

## Task 1: Catalog contract and registry

**OpenSpec mapping:** 1.1–1.4. **Class:** interface/contract. **Implementer:** native Codex Sol, high reasoning. **Reviewer:** persistent Claude Sonnet.

**Files:**

- Create `projects/synth/browser/src/catalog.ts`.
- Create `projects/synth/browser/tests/catalog.test.mjs`.
- Modify `projects/synth/browser/src/protocol.ts`.
- Modify `projects/synth/browser/src/worker.ts`.
- Modify `projects/synth/browser/cpp/BrowserRuntimeAbi.cpp`.
- Modify `projects/synth/tests/browser_runtime_contract_tests.cpp`.
- Modify `projects/synth/browser/Makefile`.
- Modify `projects/synth/browser/tests/scaffold.test.mjs`.
- Modify `projects/synth/browser/tests/runtime-core.spec.ts`.

**Interfaces:** Export schema/ABI/UI/runtime-config version constants; validated source, publisher, app, file, and catalog types; `parseCatalogSources(value)`, `parseCatalog(value, catalogUrl)`, and `mergeCatalogs(results)`. Global IDs are exactly `<publisher-id>/<app-id>`. Add pre-creation ABI exports/facade values and a negotiation function that rejects unsupported versions before `create` or persistence setup.

**TDD sequence:**

1. Add failing catalog tests for a valid multi-app catalog, every unsupported version, malformed IDs/build IDs/digests/media types, absolute or traversal-like file paths, empty/missing sidecar inventories, deterministic source precedence, duplicates, and display-name/global-ID sorting.
2. Run `npm run build && node --test dist/tests/catalog.test.mjs`; expect failures from missing exports.
3. Implement strict parsers with unknown-field/type rejection where the schema requires it, URL resolution only after relative-path validation, immutable record output, and deterministic merge diagnostics.
4. Add failing native assertions in `projects/synth/tests/browser_runtime_contract_tests.cpp` and facade assertions in `projects/synth/browser/tests/runtime-core.spec.ts`, showing version values are readable before runtime creation and incompatibility prevents lifecycle and persistence calls.
5. Implement the ABI exports, Emscripten export list, facade fields, and negotiation boundary.
6. From `projects/synth/browser`, run the focused Node/runtime-core tests and `npm run check:generic-runtime`; from `projects/synth`, run `make browser-unit-test`. Expect all green.
7. Commit as `feat(synth-browser): define catalog and browser ABI contracts` and mark OpenSpec 1.1–1.4 complete only after review acceptance.

## Task 2: Catalog discovery and launcher

**OpenSpec mapping:** 2.1–2.4. **Class:** interface/contract. **Implementer:** native Codex Sol, high reasoning. **Reviewer:** persistent Claude Sonnet.

**Files:**

- Create `projects/synth/browser/src/catalog-client.ts`.
- Create `projects/synth/browser/src/launcher.ts`.
- Create `projects/synth/browser/tests/catalog-client.test.mjs`.
- Create `projects/synth/browser/tests/launcher.spec.ts`.
- Modify `projects/synth/browser/src/main.ts`.
- Modify `projects/synth/browser/public/index.html`.
- Modify `projects/synth/browser/public/synth-browser.css`.
- Modify `projects/synth/browser/tests/static-site.spec.ts`.
- Modify `projects/synth/browser/playwright.config.mjs` only if discovery fixtures require configuration beyond the two origins already provided by `src/static-server.mjs`.

**Interfaces:** `CatalogClient.loadSources({cacheMode})` returns accepted apps plus per-source diagnostics without throwing away healthy sources. `SheafPatchLauncher` renders rows and exposes a single `select(app)` boundary supplied by later tasks. Startup fetches source/catalog JSON only. After one successful selection, further in-page selections are forbidden; returning to the launcher uses top-level navigation/reload.

**TDD sequence:**

1. Add failing unit tests for concurrent loads, partial network/version failures, stable-URL retry with revalidation, source diagnostics, and a newly added manifest entry appearing without launcher code changes.
2. Add failing Playwright assertions for app/publisher/author/category/compatibility state, loading/error/retry UI, no package requests during discovery, and a generic navigation-back control.
3. Run `npm run build && node --test dist/tests/catalog-client.test.mjs && npx playwright test tests/launcher.spec.ts`; expect missing-module/UI failures.
4. Implement the client and accessible launcher UI, retaining a dependency-injected selection callback and no miniapp names or package logic.
5. Change root bootstrap from direct auto-launch to launcher bootstrap, while leaving the old direct runtime API callable by existing tests until Task 6.
6. Run focused tests plus `npx playwright test tests/static-site.spec.ts tests/runtime-core.spec.ts`; expect all green.
7. Commit as `feat(synth-browser): discover catalogs in generic launcher` and mark OpenSpec 2.1–2.4 complete after review.

## Task 3: Immutable remote packages

**OpenSpec mapping:** 3.1–3.5. **Class:** concurrency/lifecycle. **Implementer:** native Codex Sol, xhigh reasoning. **Reviewer:** persistent Claude Opus.

**Files:**

- Create `projects/synth/browser/src/package-contract.mjs`.
- Create `projects/synth/browser/src/package-app.mjs`.
- Create `projects/synth/browser/src/package-loader.ts`.
- Create `projects/synth/browser/tests/package-contract.test.mjs`.
- Create `projects/synth/browser/tests/package-loader.spec.ts`.
- Create `projects/synth/browser/tests/two-origin-package.spec.ts`.
- Modify `projects/synth/browser/src/worker.ts`.
- Modify `projects/synth/browser/src/main.ts`.
- Modify `projects/synth/browser/src/static-server.mjs`.
- Modify `projects/synth/browser/playwright.config.mjs` only if the active server cannot express the needed package fixture behavior alone.
- Modify `projects/synth/browser/Makefile`.
- Modify `projects/synth/browser/package.json`.

**Interfaces:** The assembler inventories every emitted Emscripten entry/WASM/pthread worker/Wasm worker/AudioWorklet sidecar, computes lowercase SHA-256, derives a content-based build ID, copies to `packages/<app-id>/<build-id>/`, and returns catalog records. `materializePackage(app, fetcher)` fetches all declared files with CORS, verifies status/media type/length when available/hash, creates typed object URLs, and returns `{entryUrl, locateFile, mainScriptUrlOrBlob, dispose}`. Replace `RuntimeModuleLoader(moduleUrl?)` with a materialized-module input carrying those three loader values; thread it through `loadEmscriptenRuntime`, `createDirectRuntimeClient`, `createWorkerRuntimeClient`, runtime commands, and tests, and call the Emscripten factory with the explicit mappings. No import occurs before the entire package verifies.

**TDD sequence:**

1. Add failing deterministic assembler tests: identical input is byte-for-byte stable; changing any file changes build ID; sidecars cannot be omitted; paths never escape the package root.
2. Add failing loader tests for missing files/workers, wrong media type, stale/hash-mismatched WASM, hash mismatch before import, correct sidecar mappings, and idempotent URL revocation.
3. Run focused Node/Playwright tests and observe missing implementations.
4. Implement assembler and materializer, injecting fetch/import/object-URL primitives for deterministic tests. Pass explicit mappings into the modularized Emscripten factory; prohibit document-relative fallbacks.
5. Extend the active `src/static-server.mjs` package behavior on its existing isolated `:4174` origin, retaining `application/wasm`, `application/json`, CORS, COOP, and COEP responses, then prove the generic fake app starts remotely before any miniapp test. Do not use the unreferenced legacy `tests/static-server.mjs`; deleting that dead duplicate is allowed only if a focused repository search confirms it remains unused.
6. Run `npm run build && node --test dist/tests/package-contract.test.mjs && npx playwright test tests/package-loader.spec.ts tests/two-origin-package.spec.ts` plus the generic-runtime boundary check.
7. Commit as `feat(synth-browser): verify and materialize immutable app packages` and mark OpenSpec 3.1–3.5 complete after review.

## Task 4: Selection activation lease

**OpenSpec mapping:** 4.1–4.5. **Class:** concurrency/lifecycle. **Implementer:** native Codex Sol, xhigh reasoning. **Reviewer:** persistent Claude Opus.

**Files:**

- Create `projects/synth/browser/src/activation.ts`.
- Create `projects/synth/browser/tests/activation-lease.spec.ts`.
- Modify `projects/synth/browser/src/launcher.ts`.
- Modify `projects/synth/browser/src/main.ts`.
- Modify `projects/synth/browser/src/audio.ts`.
- Modify `projects/synth/browser/src/midi.ts`.
- Modify `projects/synth/browser/src/worker.ts`.
- Modify `projects/synth/browser/tests/audio-flow.spec.ts`.
- Modify `projects/synth/browser/tests/midi-flow.spec.ts`.
- Modify `projects/synth/browser/tests/fake-app.e2e.spec.ts`.
- Modify `projects/synth/browser/tests/miniapp-smoke.spec.ts`.

**Interfaces:** A synchronous selection handler calls `ActivationLease.acquire()` before its first await. The lease owns exactly one resumed `AudioContext` and one in-flight/resolved `{sysex:true}` MIDI access request, and can be consumed once by `installSynthBrowserApp`. Audio attaches the runtime-owned Wasm AudioWorklet to the leased context; MIDI reconciles leased access without a second permission call. `dispose()` is idempotent and closes/disconnects every acquired resource on failure or unload.

**Execution sizing:** Keep one persistent Task 4 implementer and reviewer, but execute two explicit internal phases. Phase A is lease ownership plus audio/MIDI resource injection and focused lease tests. Phase B is launcher wiring plus fake-app/miniapp acceptance conversion. Commit and run focused tests after Phase A before beginning Phase B. If Phase A reveals an architectural mismatch or either phase cannot be held in one implementer context, report `BLOCKED` and split the remaining phase into a newly briefed task rather than stretching the existing task.

**TDD sequence:**

1. Phase A: add failing delayed-download tests that record call order and prove audio construction/resume and MIDI request begin in the selection event task, before package fetch/compile resolves.
2. Phase A: add failing denial/retry tests and cleanup counters for rejected audio/MIDI acquisition, then refactor audio and MIDI to accept leased resources while preserving lower-level direct APIs needed by focused tests. Commit the Phase A boundary only after activation/audio/MIDI focused tests pass.
3. Phase B: add failing cleanup/integration assertions for package failure, runtime-init failure, unload, and double-click.
4. Phase B: wire launcher selection: acquire lease, materialize package, negotiate versions, install one runtime, replace launcher DOM, and navigate on back.
5. Phase B: convert generic fake-app gate and real miniapp audio/MIDI smoke paths to select catalog rows; assert no second context, permission request, runtime, port binding, or package import.
6. Run activation, audio, MIDI, fake-app, and miniapp specs in that order; expect all green across both Task 4 commits.
7. Commit as `feat(synth-browser): launch packages from one activation gesture` and mark OpenSpec 4.1–4.5 complete after review.

## Task 5: Persistence contract

**OpenSpec mapping:** 5.1–5.3. **Class:** concurrency/lifecycle. **Implementer:** native Codex Sol, high reasoning. **Reviewer:** persistent Claude Opus.

**Files:**

- Modify `projects/synth/browser/src/catalog.ts`.
- Modify `projects/synth/browser/src/main.ts`.
- Modify `projects/synth/browser/src/worker.ts`.
- Modify `projects/synth/browser/src/persistence.ts`.
- Modify `projects/synth/browser/cpp/BrowserRuntimeAbi.cpp`.
- Modify `projects/synth/include/synth/browser/BrowserRuntime.hpp`.
- Modify `projects/synth/browser/tests/persistence.spec.ts`.
- Modify `projects/synth/tests/browser_runtime_contract_tests.cpp`.

**Interfaces:** Pass validated `{publisherId, appId, runtimeConfigVersion}` across initialization. Mount shared IDBFS at `/data`; expose shared config/log roots and app patch root `/data/patches/<publisher>/<app>`. Build ID never appears in paths. Negotiation rejects unsupported runtime-config versions before mounting or writing.

**TDD sequence:**

1. Add failing TypeScript and native tests for identity validation/path derivation, same app across build IDs, same app ID across publishers, shared compatible config, and incompatible config version causing zero filesystem writes.
2. Run the focused Playwright and native contract binaries; expect failures at missing identity boundary.
3. Implement structured initialization, namespace derivation, mount ordering, and ABI propagation. Keep path normalization centralized and reject unvalidated strings.
4. Verify initial IDBFS population occurs before runtime init and scheduled writes remain debounced/app-isolated.
5. Run `make browser-unit-test` and `npx playwright test tests/persistence.spec.ts`.
6. Commit as `feat(synth-browser): isolate app patches by publisher identity` and mark OpenSpec 5.1–5.3 complete after review.

## Task 6: First-party production deployment

**OpenSpec mapping:** 6.1–6.5. **Class:** concurrency/lifecycle. **Implementer:** native Codex Sol, xhigh reasoning. **Reviewer:** persistent Claude Opus.

**Files:**

- Create `projects/synth/browser/catalog-sources.json`.
- Create `projects/synth/browser/catalogs/sheaf/catalog.template.json` or a deterministic generator input of equivalent scope.
- Create `projects/synth/browser/src/build-first-party-catalog.mjs`.
- Modify `projects/synth/browser/src/package-app.mjs`.
- Modify `projects/synth/browser/src/publish-site.mjs`.
- Modify `projects/synth/browser/scripts/cloudflare-pages-build.sh`.
- Modify `projects/synth/browser/public/index.html`.
- Modify `projects/synth/browser/Makefile`.
- Modify `projects/synth/browser/package.json`.
- Modify `projects/synth/browser/tests/publish-site.test.mjs`.
- Modify `projects/synth/browser/tests/static-site.spec.ts`.
- Modify `projects/synth/browser/tests/miniapp-smoke.spec.ts`.
- Modify `projects/synth/browser/README.md`.

**Interfaces:** The deterministic publish build emits `catalog-sources.json`, `catalogs/sheaf/catalog.json`, immutable miniapp package files, launcher/runtime modules, `_headers`, and a temporary rollback direct artifact. Catalog/package references and digests are checked before replacing the destination. Production root contains launcher markup only and reaches miniapp solely through the first-party catalog.

**TDD sequence:**

1. Replace publish fixtures with failing tests for complete layout, same-deployment relative source/catalog/package resolution, digest consistency, missing/inconsistent references, deterministic rebuilds, and atomic destination replacement.
2. Add failing browser assertions that root discovery requests only source/catalog bytes, the first row is `sheaf/miniapp`, selection requests its immutable package, and no launcher code names miniapp.
3. Implement first-party catalog/package generation and Cloudflare copying. Update `_headers` so `Content-Type: application/wasm` covers immutable `packages/<app-id>/<build-id>/*.wasm` paths rather than only `/dist/wasm/*.wasm`; preserve correct JavaScript types for entry, pthread/Wasm-worker, and AudioWorklet sidecars plus existing COOP, COEP, and MIDI policies.
4. Keep `dist/wasm/app.js` only as documented rollback input until all launcher acceptance gates pass; remove every production HTML/code dependency on it.
5. Run `make browser-fake-app browser-miniapp`, `npm run publish:site`, publish tests, static-site tests, and miniapp smoke; inspect `dist/site` paths and references.
6. Commit as `feat(synth-browser): publish catalog launcher and miniapp package` and mark OpenSpec 6.1–6.5 complete after review.

## Task 7: GitHub Pages publisher path

**OpenSpec mapping:** 7.1–7.5. **Class:** concurrency/lifecycle. **Implementer:** native Codex Sol, xhigh reasoning. **Reviewer:** persistent Claude Opus.

**Files:**

- Create `.github/workflows/synth-browser-pages.yml`.
- Create `projects/synth/browser/src/validate-deployed-catalog.mjs`.
- Create `projects/synth/browser/tests/github-pages-workflow.test.mjs`.
- Create `projects/synth/browser/tests/deployed-origin.spec.ts`.
- Modify `projects/synth/browser/package.json`.
- Modify `projects/synth/browser/playwright.config.mjs` only if the deployed-origin project/fixture needs configuration.
- Modify `projects/synth/browser/README.md`.

**Interfaces:** A pinned workflow has separate build, deploy, post-deploy validation, and cross-origin smoke jobs; minimum permissions are declared per job; deploy is default-branch/environment gated with concurrency and `workflow_dispatch`. The Pages artifact contains only catalogs/packages. Validation accepts an explicit deployed catalog URL/build ID, checks CORS and `application/wasm`, verifies every hash/reference, then drives the isolated launcher against the remote publisher.

**TDD sequence:**

1. Add failing structural tests that parse the workflow and assert pinned action SHAs, Node/Emscripten setup, tests/build, official Pages actions, permissions, artifact path, environment/default-branch gates, concurrency, dispatch, validation, and smoke dependency ordering.
2. Add failing deployed validator fixture tests for missing CORS, bad MIME, inconsistent build ID/hash/path, and success.
3. Implement workflow and validator without depending on GitHub API discovery or making Pages the top-level host.
4. Add an opt-in `SYNTH_BROWSER_REMOTE_CATALOG_URL` Playwright spec that fails readiness for entry/WASM/worker/AudioWorklet/audio issues and is skipped locally when unset; workflow must always set it.
5. Document one-time Pages source configuration, stable URL, publisher limits, and Cloudflare host rationale.
6. Run the structural/validator tests and local two-origin equivalent. Do not claim a live deployment until CI runs against the actual Pages URL.
7. Commit as `ci(synth-browser): publish catalogs through GitHub Pages` and mark OpenSpec 7.1–7.5 complete after review.

## Task 8: Publisher and coverage documentation

**OpenSpec mapping:** 8.1–8.2. **Class:** mechanical/documentation. **Implementer:** native Codex Terra, medium reasoning. **Reviewer:** persistent Claude Sonnet.

**Files:**

- Create `projects/synth/browser/docs/catalog-schema-v1.md`.
- Create `projects/synth/browser/docs/publisher-guide.md`.
- Modify `projects/synth/browser/README.md`.
- Modify the existing synth browser coverage/architecture document located by `rg -n "sprs-12|browser.*coverage|Browser.*WASM" projects/synth docs` (if no such document exists, create `projects/synth/browser/docs/coverage.md` and record that decision in the task brief).

**Content contract:** Fully specify schema v1, source-list trust, multi-app catalogs, immutable layout and hashing, ABI/UI/runtime-config policy, cache/update semantics, CORS/MIME/sidecar requirements, Cloudflare versus Pages roles, local validation commands, and a copyable second-repository multi-app publishing example. Map `sbac-1`–`sbac-12` and modified `sprs-12` to named unit/native/Playwright/publish/deployed-origin gates.

**Verification sequence:**

1. Create a checklist from every requirement and decision; draft docs against actual exported names/scripts, not prospective names.
2. Run every documented local command or its non-deploying validation form.
3. Use `rg` to verify each requirement ID appears exactly in the coverage map and no obsolete direct-auto-launch instructions remain.
4. Commit as `docs(synth-browser): define catalog publisher contract` and mark OpenSpec 8.1–8.2 complete after review.

## Task 9: Integration hardening and production inspection

**OpenSpec mapping:** 8.3–8.5. **Class:** verification/release. **Implementer:** native Codex Sol, xhigh reasoning. **Reviewer:** persistent Claude Opus, followed by a fresh whole-branch Opus review.

**Files:** Modify only files required to fix verified integration defects. Update `openspec/changes/add-browser-app-catalog-launcher/tasks.md` after every gate is evidenced. Add no new feature scope.

**Verification sequence:**

1. From a clean generated-artifact state, run `make test` in `projects/synth`.
2. Run `make browser-fake-app browser-miniapp`; then `npm run build`, `npm run check:generic-runtime`, and all Node tests in `projects/synth/browser`.
3. Run Playwright in required order: catalog/package unit browser tests; generic fake-app two-origin acceptance; real miniapp launcher smoke; audio deadline/non-silence; bidirectional sysex MIDI; persistence; desktop/narrow UI; static/Cloudflare publish tests. Any Chromium sandbox permission must be granted rather than bypassed.
4. Run `npm run publish:site`, serve the exact output, and inspect network/DOM/artifacts: root is launcher only; startup has source/catalog requests but zero package bytes; first entry resolves to this repo's immutable miniapp; package hashes match; selection uses the generic path; no app-specific launcher branch; direct `app.js` is rollback-only.
5. Run workflow structural tests and the local two-origin equivalent of the deployed Pages smoke. If a real Pages URL is available, run the opt-in deployed-origin validation; otherwise report that live post-deploy gate as CI-owned, not locally proven.
6. Run `openspec validate add-browser-app-catalog-launcher --strict` and mark 8.3–8.5 only after all locally applicable gates pass.
7. Give a fresh Claude Opus reviewer the OpenSpec artifacts, this plan, full diff, test evidence, and production artifact inventory. Resolve each actionable finding with the Task 9 implementer; re-use the same reviewer session for re-review until clean.
8. Run `git diff --check`, confirm the pre-existing package lock and miniapp build artifacts are unstaged, and commit as `test(synth-browser): harden catalog launcher integration` if fixes/evidence changes exist.

## Completion criteria

All 36 OpenSpec checkboxes are checked with evidence, strict OpenSpec validation passes, all native/browser/publish tests pass, the generated Cloudflare root is a catalog-only launcher, the first-party miniapp runs through the same package contract as external publishers, the GitHub Pages workflow is structurally and locally validated, and final Opus review has no unresolved actionable findings. Then use `superpowers:finishing-a-development-branch` to present the integration options; do not push, deploy, or enable repository Pages settings without explicit authority.
