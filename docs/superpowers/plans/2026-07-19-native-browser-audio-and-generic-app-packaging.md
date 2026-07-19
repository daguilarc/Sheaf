# Native Browser Audio and Generic App Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore callback-cadenced native Wasm audio under one-click catalog activation and make Mini App, Braid 4, and future `SynthApplication` types compile and publish through one declarative browser-app pipeline.

**Architecture:** The catalog click continues to acquire one host `AudioContext` and MIDI lease synchronously. After package materialization, the generic module facade registers that context in the selected module's Emscripten WebAudio registry and starts the existing C++ Wasm AudioWorklet; no JavaScript sample producer remains. A validated first-party app manifest supplies compile-time type identity and catalog metadata to a generic builder, which generates transient bindings and feeds one immutable multi-app packager.

**Tech Stack:** C++20, Emscripten Wasm Audio Worklets, TypeScript/ES modules, Node test runner, Playwright Chromium, Make, JSON manifests, Cloudflare Pages artifacts, GitHub Actions and GitHub Pages.

## Global Constraints

- The catalog selection is the only audio/MIDI activation gesture; package bytes are not fetched before selection.
- DSP runs only from the existing `ProcessAudioWorklet` → `Runtime<App>::Process` callback path.
- No timer, animation-frame, message-loop, ScriptProcessor, or JavaScript sample-ring fallback is permitted; missing native support fails closed.
- Application DSP, UI, lifecycle, persistence, and patch identity remain unchanged after startup.
- Mini App and Braid 4 contain no browser-specific application code and have no special build, package, publication, or deployment branches.
- Every first-party module uses `INITIAL_MEMORY=536870912`, `ALLOW_MEMORY_GROWTH=1`, and `MAXIMUM_MEMORY=2147483648`; initialization and required growth finish before audio starts.
- The browser package ABI is version 2. ABI v1 packages are rejected before runtime creation rather than being interpreted with the new start signature.
- The source of truth is `openspec/changes/fix-browser-native-audio-and-generic-app-packaging/` plus `docs/superpowers/specs/2026-07-19-native-browser-audio-and-generic-app-packaging-design.md`.
- Preserve the pre-existing untracked `projects/synth/browser/package-lock.json` and `projects/synth/miniapp/`; never stage or modify them.
- Use one native Codex implementer per task. Keep that implementer available for ordinary review fixes. Use one persistent Claude reviewer per task for spec review, quality review, and post-fix re-review; escalate only genuinely large findings into a newly briefed task.

---

### Task 1: Native host-context adoption and fallback removal

**OpenSpec mapping:** 1.1–1.4. **Class:** concurrency/real-time lifecycle. **Implementer:** native Codex Sol, xhigh reasoning. **Reviewer:** persistent Claude Opus.

**Files:**

- Delete: `projects/synth/browser/src/audio-worklet.ts`
- Modify: `projects/synth/include/synth/browser/BrowserRuntime.hpp`
- Modify: `projects/synth/browser/cpp/BrowserRuntimeAbi.cpp`
- Modify: `projects/synth/browser/src/audio.ts`
- Modify: `projects/synth/browser/src/main.ts`
- Modify: `projects/synth/browser/src/protocol.ts`
- Modify: `projects/synth/browser/src/worker.ts`
- Modify: `projects/synth/browser/Makefile`
- Modify: `projects/synth/browser/src/publish-site.mjs`
- Modify: `projects/synth/tests/browser_runtime_contract_tests.cpp`
- Modify: `projects/synth/browser/tests/audio-flow.spec.ts`
- Modify: `projects/synth/browser/tests/activation-lease.spec.ts`
- Modify: `projects/synth/browser/tests/runtime-core.spec.ts`
- Modify: `projects/synth/browser/tests/miniapp-smoke.spec.ts`
- Modify: `projects/synth/browser/tests/check-generic-runtime.mjs`

**Interfaces:**

- `RuntimeClient.startAudioWorklet(context?: AudioContext): Promise<AudioBridgeStart>`.
- `RuntimeModuleFacade.startAudioWorklet?(runtimeHandle: number, context?: AudioContext): number` calls the module-local exported `emscriptenRegisterAudioObject(context)` when a lease supplies a context and passes handle `0` for the unchanged direct runtime-owned path.
- `BrowserRuntimeWorker.startAudioWorklet(context?: AudioContext)` is a direct-realm method, not a serializable `RuntimeCommand`; `createWorkerRuntimeClient` remains without audio startup because `AudioContext` cannot be cloned into a worker.
- C ABI: `synth_browser_start_audio_worklet(synth_browser_runtime*, std::uint32_t audioContextHandle)`.
- C++: `Runtime<App>::StartAudioWorklet(EMSCRIPTEN_WEBAUDIO_T suppliedContext = 0)` delegates both supplied and newly created contexts to one unchanged worklet/callback setup.
- Browser ABI version advances from `1` to `2`; v1 catalogs/modules are rejected before creation.

- [ ] **Step 1: Write failing browser tests for the required branch**

In `audio-flow.spec.ts` and `activation-lease.spec.ts`, require a leased context to be passed to the runtime hook and prohibit all ring messages:

```ts
const calls: unknown[] = [];
const context = makeResumedContext();
const bridge = new AudioBridge({
  async startAudioWorklet(received?: AudioContext) {
    calls.push(received);
    return { started: true };
  },
}, { audioContext: context });
expect(await bridge.startFromUserActivation()).toEqual({ started: true });
expect(calls).toEqual([context]);
```

Assert the runtime rejects missing `registerAudioContext`/native start support, never emits `configure-audio` or `render-audio`, and does not construct another context.

- [ ] **Step 2: Run focused tests and confirm the regression is exposed**

Run from `projects/synth/browser`:

```bash
npm run build
npx playwright test tests/audio-flow.spec.ts tests/activation-lease.spec.ts tests/runtime-core.spec.ts
```

Expected: failures show the leased-context branch configures the JavaScript ring and calls `render-audio` instead of the native start hook.

- [ ] **Step 3: Add failing native/module-contract coverage**

Extend `browser_runtime_contract_tests.cpp` and runtime-core module fakes so the start export accepts a context handle, direct startup passes `0`, supplied startup preserves the supplied handle, browser ABI v2 is negotiated before creation, and the Emscripten module exposes `emscriptenRegisterAudioObject` before runtime creation. Add a source assertion that `ProcessAudioWorklet` still calls `runtime->Process(...)` and remains the sole callback implementation.

- [ ] **Step 4: Implement module-local context registration and shared native startup**

Add the documented module-local Emscripten helper to the common runtime export list:

```make
EXPORTED_RUNTIME_METHODS := '[...,"emscriptenRegisterAudioObject"]'
```

In `worker.ts`, register the exact leased object through that method and pass the returned handle to the v2 native export. In `BrowserRuntime.hpp`, use the supplied handle when nonzero; otherwise call `emscripten_create_audio_context`. In both cases read sample rate/quantum, call `Prepare`, initialize timestamp/deadline state, resume, and start the same Wasm AudioWorklet thread. Do not alter `ProcessAudioWorklet` DSP or metering.

- [ ] **Step 5: Remove the timer/ring audio transport completely**

Reduce `AudioBridge` to validation, native start delegation, and idempotent shutdown. Remove `renderTimer`, `AudioBridgeDescriptor`, `SharedRingBuffer`, audio ring state, the `configure-audio` and `render-audio` commands/handlers, `renderAudio` facade allocation/copy code, the launcher JavaScript worklet module, and its published runtime-file expectation. Keep the package's `audioWorklet` artifact role: the common Emscripten entry remains the native Wasm AudioWorklet bootstrap. Keep `_synth_browser_process` only where the generic ABI/native tests still require it; it must not be scheduled by browser JavaScript.

- [ ] **Step 6: Prove real native callback progress**

Update the Mini App real-Wasm smoke to use the production direct runtime client, select the catalog row once, poll `audio-worklet-stats`, and require `blocks` to increase across observations with finite deadline data and no second context. A resumed context without advancing block counts must fail the test. Native start must not resolve `audio:online` until callback progress is observed within a bounded timeout.

Make teardown ownership-safe: runtime destruction/unregistration settles before the activation lease closes its JavaScript context and disposes the package, while repeated stop/pagehide remains idempotent.

- [ ] **Step 7: Run task verification**

```bash
make -C projects/synth build/browser_runtime_contract_tests
projects/synth/build/browser_runtime_contract_tests
npm --prefix projects/synth/browser run build
npm --prefix projects/synth/browser run check:generic-runtime
npx --prefix projects/synth/browser playwright test tests/audio-flow.spec.ts tests/activation-lease.spec.ts tests/runtime-core.spec.ts
```

Expected: all pass; `rg -n 'renderTimer|configure-audio|render-audio|SharedRingBuffer|synth-audio-ring-buffer' projects/synth/browser/src` returns no audio-production implementation.

- [ ] **Step 8: Commit and review**

Commit as `fix(synth-browser): restore native callback audio`. Mark OpenSpec 1.1–1.4 only after persistent Opus spec and quality review pass; reuse the implementer and reviewer for fixes/re-review.

### Task 2: Declarative app manifest and generic compiler

**OpenSpec mapping:** 2.1–2.4. **Class:** build/interface contract. **Implementer:** native Codex Sol, high reasoning. **Reviewer:** persistent Claude Opus.

**Files:**

- Create: `projects/synth/browser/first-party-apps.json`
- Create: `projects/synth/browser/src/app-build-manifest.mjs`
- Create: `projects/synth/browser/src/build-browser-apps.mjs`
- Create: `projects/synth/browser/tests/app-build-manifest.test.mjs`
- Create: `projects/synth/browser/tests/build-browser-apps.test.mjs`
- Move: `projects/synth/browser/cpp/FakeBrowserApp.hpp` to `projects/synth/browser/tests/fixtures/cpp/FakeBrowserApp.hpp`
- Delete: `projects/synth/browser/cpp/fake_app_entry.cpp`
- Delete: `projects/synth/browser/cpp/miniapp_entry.cpp`
- Modify: `projects/synth/browser/Makefile`
- Modify: `projects/synth/Makefile`
- Modify: `projects/synth/browser/package.json`
- Modify: `projects/synth/browser/tests/scaffold.test.mjs`
- Modify: `projects/synth/browser/tests/check-generic-runtime.mjs`

**Interfaces:**

- `readAppBuildManifest({browserRoot, manifestPath, allowedSourceRoots})` returns a deeply frozen `{schemaVersion, publisher, apps, digest}` sorted by `appId`.
- Each app record has exactly `appId`, `displayName`, `author`, `category`, `header`, `cppType`, and `includeDirs`.
- `generateBrowserBinding(app)` returns the complete transient C++ binding.
- `buildBrowserApps({browserRoot, manifestPath, runCommand})` writes bindings under `dist/generated/browser-apps/`, invokes the same `em++` argument builder once per app without a shell, stages `<appId>.js` and `<appId>.wasm` under `dist/wasm/apps/<appId>/`, and atomically writes a structured emission report containing the manifest digest and artifact roles.

- [ ] **Step 1: Write failing manifest contract tests**

Cover exact-key validation, schema/publisher types, app-ID syntax, duplicate IDs, qualified C++ type syntax, header/include traversal and absolute paths, empty arrays/strings, deterministic sorting, generated source contents, and frozen output. The positive generated source is exactly:

```cpp
#include "Braid4.hpp"
#include "synth/browser/BrowserAppEntry.hpp"

SYNTH_BROWSER_APP(synth_braid4::Braid4)
```

- [ ] **Step 2: Run the focused Node test and observe missing modules**

```bash
npm --prefix projects/synth/browser run build
node --test projects/synth/browser/dist/tests/app-build-manifest.test.mjs projects/synth/browser/dist/tests/build-browser-apps.test.mjs
```

Expected: fail because parser/generator/builder do not exist.

- [ ] **Step 3: Implement the strict parser and transient generator**

Allow relative source paths only after resolving them beneath `projects/synth/apps` or an explicit test fixture root. Require referenced headers/directories to exist. Validate `cppType` with qualified C++ identifier components rather than interpolating arbitrary text. Reject unknown build-option fields so records cannot choose custom runtime sources or flags. Canonicalize the ordered validated data and expose its digest for the emission/catalog handshake.

- [ ] **Step 4: Add one generic compile recipe and common memory flags**

Implement one Node compiler orchestrator with an injected argument-vector `runCommand`. The common flags must contain:

```make
-sINITIAL_MEMORY=536870912 \
-sALLOW_MEMORY_GROWTH=1 \
-sMAXIMUM_MEMORY=2147483648
```

The orchestrator always uses the same core sources, `BrowserRuntimeAbi.cpp`, generated binding, ABI v2 exports, module-local Emscripten context-registration runtime method, pthread/Wasm-worker/audio-worklet settings, and filesystem settings. Only validated include directories and generated bindings vary. Make is a thin wrapper exposing `browser-apps`, `browser-fixture-app`, `browser-apps-run`, and `browser-apps-smoke`; mirror generic wrappers in `projects/synth/Makefile`.

- [ ] **Step 5: Migrate all configured apps to records and delete handwritten binding**

Populate `first-party-apps.json` with Mini App (`category: "test"`) and Braid 4 metadata/type records. Delete both checked-in entry translation units and move the fake header under test fixtures. The fake build uses a fixture manifest through the exact same builder. Remove `MINIAPP_HEADERS`, named compiler targets, the legacy `dist/wasm/app.js` alias, and app-specific include flags. Depending on all headers beneath validated app directories is acceptable; branching on an app ID is not.

- [ ] **Step 6: Strengthen generic-boundary tests**

Derive forbidden concrete tokens from the manifest. Allow them only in the manifest itself, application source, generated output, and explicit acceptance/test fixtures. Fail if generic Make, Node, TypeScript, C++, workflow, or publisher sources contain app-specific branches or filenames.

- [ ] **Step 7: Run task verification**

```bash
node --test projects/synth/browser/dist/tests/app-build-manifest.test.mjs projects/synth/browser/dist/tests/build-browser-apps.test.mjs projects/synth/browser/dist/tests/scaffold.test.mjs
npm --prefix projects/synth/browser run check:generic-runtime
make -C projects/synth/browser browser-apps
```

Expected: both real `.js/.wasm` pairs and one structured emissions file exist; no checked-in per-app entry source exists; both builds use identical linker policy.

- [ ] **Step 8: Commit and review**

Commit as `refactor(synth-browser): build apps from one manifest`. Mark OpenSpec 2.1–2.4 after persistent Opus spec/quality review and any same-context fix loop.

### Task 3: Deterministic multi-app packaging and Braid 4 publication

**OpenSpec mapping:** 3.1–4.2. **Class:** artifact/release contract. **Implementer:** native Codex Sol, xhigh reasoning. **Reviewer:** persistent Claude Opus.

**Files:**

- Delete: `projects/synth/browser/catalogs/sheaf/catalog.template.json`
- Modify: `projects/synth/browser/src/build-first-party-catalog.mjs`
- Modify: `projects/synth/browser/src/publish-site.mjs`
- Modify: `projects/synth/browser/src/package-contract.mjs`
- Modify: `projects/synth/browser/Makefile`
- Modify: `projects/synth/browser/package.json`
- Modify: `projects/synth/browser/tests/publish-site.test.mjs`
- Modify: `projects/synth/browser/tests/package-contract.test.mjs`
- Modify: `projects/synth/browser/tests/github-pages-workflow.test.mjs`

**Interfaces:**

- `buildFirstPartyCatalog({browserRoot, outputRoot})` consumes the validated manifest plus the exact matching structured emission report and returns `{catalog, packageRecords}`.
- Each emission record names generic entry/Wasm/worker/worklet roles; the assembler derives `packages/<appId>/<buildId>/...` and validates every file.
- `catalogVersion` is `first-party-` plus SHA-256 over canonical ordered `[{appId, buildId}]` JSON.

- [ ] **Step 1: Replace single-app fixtures with failing multi-app tests**

Use neutral fixture IDs such as `alpha` and `beta`. Require deterministic app ordering, independent content build IDs, a catalog version that changes if either package changes, exact hash/size/media types, rejection of missing/extra files, and byte-identical repeated output.

- [ ] **Step 2: Add atomic failure coverage**

Seed a known-good destination, fail the second app's validation/assembly, and assert the destination bytes remain unchanged. Repeat for Cloudflare `dist/site` and publisher-only `dist/pages` staging.

- [ ] **Step 3: Run focused tests and confirm Mini App assumptions fail them**

```bash
npm --prefix projects/synth/browser run build
node --test projects/synth/browser/dist/tests/package-contract.test.mjs projects/synth/browser/dist/tests/publish-site.test.mjs
```

Expected: failures identify the one-`app` template, `miniapp.*` filename checks, singular `packageRecord`, and single-package catalog version.

- [ ] **Step 4: Generalize catalog/package assembly**

Iterate the manifest/emissions in validated order, stage every package, collect records, compute the complete catalog version, run `parseCatalog`, and only then replace the destination. Delete the old template and all concrete filename checks. Package roles remain schema-driven and may alias the generated Emscripten entry where the common toolchain emits one bootstrap.

- [ ] **Step 5: Prove Braid 4 is only data**

Build and package Braid 4 from its existing `Braid4.hpp` type record. Assert its source tree has no changes relative to the Task 2 parent commit and generic sources contain no Braid conditional. Validate the unchanged app initializes under the common memory settings rather than a reduced-scope variant.

- [ ] **Step 6: Update publication artifacts generically**

`publish:site` must contain launcher/runtime/header material plus the complete catalog/packages and one generated `rollback/apps/<appId>/` page for every app, all from the same generic template. `publish:pages` must contain only that complete catalog/packages. Headers and validation globs remain generic for `packages/*/*/*.js` and `*.wasm`. There is no privileged `rollback/direct-miniapp` path.

- [ ] **Step 7: Run task verification**

```bash
make -C projects/synth/browser browser-apps
npm --prefix projects/synth/browser run publish:site
npm --prefix projects/synth/browser run publish:pages
node --test projects/synth/browser/dist/tests/package-contract.test.mjs projects/synth/browser/dist/tests/publish-site.test.mjs projects/synth/browser/dist/tests/github-pages-workflow.test.mjs
```

Expected: the Sheaf catalog contains exactly Mini App and Braid 4, each immutable package validates, and repeated publication is byte-identical.

- [ ] **Step 8: Commit and review**

Commit as `feat(synth-browser): publish ordinary apps generically`. Mark OpenSpec 3.1–3.4 and 4.1–4.2 only after persistent Opus approval.

### Task 4: Two-app one-click browser and deployment acceptance

**OpenSpec mapping:** 4.3, 5.1–5.3. **Class:** integration/release. **Implementer:** native Codex Sol, xhigh reasoning. **Reviewer:** persistent Claude Opus.

**Files:**

- Create: `projects/synth/browser/tests/first-party-apps-smoke.spec.ts`
- Delete: `projects/synth/browser/tests/miniapp-smoke.spec.ts`
- Modify: `projects/synth/browser/tests/launcher.spec.ts`
- Modify: `projects/synth/browser/tests/deployed-origin.spec.ts`
- Modify: `projects/synth/browser/tests/persistence.spec.ts`
- Modify: `projects/synth/browser/tests/static-site.spec.ts`
- Modify: `projects/synth/browser/tests/two-origin-package.spec.ts`
- Modify: `projects/synth/browser/src/validate-deployed-catalog.mjs`
- Modify: `.github/workflows/synth-browser-pages.yml`
- Modify: `projects/synth/browser/scripts/cloudflare-pages-build.sh`

**Interfaces:** A table-driven real-app smoke launches each catalog row in a fresh page session, records the one acquired context/MIDI request/runtime/package, observes native callback stats, checks app-specific root visibility only in test data, and verifies `/data/patches/sheaf/<appId>` isolation.

- [ ] **Step 1: Add failing table-driven real-app acceptance**

Test data may name concrete apps because it verifies them:

```ts
const firstPartyApps = [
  { appId: "miniapp", button: /launch mini app/i, root: "miniapp.root" },
  { appId: "braid-4", button: /launch braid 4/i, root: "braid4.root" },
];
```

For each, use a fresh browser context/page, click once, require its root, poll two increasing native `blocks` observations, require finite deadline data and nonzero peak after interaction, and prove one context, one runtime, and no fallback messages.

- [ ] **Step 2: Add Braid 4 persistence and memory assertions**

Verify its initialization succeeds without modifying Braid 4 source or scope size, and its patch operations resolve under `/data/patches/sheaf/braid-4` while Mini App remains `/data/patches/sheaf/miniapp`.

- [ ] **Step 3: Update launcher/static/two-origin tests**

Discovery must fetch only source/catalog metadata and render both deterministic rows. Each selected row fetches only its package. Cross-origin materialization, compatibility checks, teardown, MIDI, UI, and page ownership remain one generic path.

- [ ] **Step 4: Generalize deployed validation and workflow**

The validator must verify every catalog app/file and compare the whole `catalogVersion`, not accept one expected build ID as sufficient. Use `SYNTH_BROWSER_EXPECTED_CATALOG_VERSION` and `--expected-catalog-version`. The workflow runs `browser-apps`, assembles both artifacts, deploys the publisher-only tree, validates the complete live catalog, and drives the isolated launcher against the deployed origin. Preserve pinned actions, minimum permissions, default-branch/environment deployment, concurrency, CORS, JavaScript/Wasm MIME, and opt-in local skip semantics.

- [ ] **Step 5: Run focused browser acceptance**

```bash
make -C projects/synth/browser browser-apps
npm --prefix projects/synth/browser run publish:site
npx --prefix projects/synth/browser playwright test tests/first-party-apps-smoke.spec.ts tests/launcher.spec.ts tests/persistence.spec.ts tests/static-site.spec.ts tests/two-origin-package.spec.ts tests/deployed-origin.spec.ts
```

Expected: Mini App and Braid 4 pass independently; the only allowed deployed-origin skip is the documented live-URL-only case when its environment variable is unset.

- [ ] **Step 6: Run workflow/publication verification**

```bash
node --test projects/synth/browser/dist/tests/github-pages-workflow.test.mjs projects/synth/browser/dist/tests/publish-site.test.mjs
npm --prefix projects/synth/browser run publish:pages
```

Inspect both trees and require the same complete catalog/package set with host-appropriate extra files only.

- [ ] **Step 7: Commit and review**

Commit as `test(synth-browser): prove two-app native browser launch`. Mark OpenSpec 4.3 and 5.1–5.3 only after persistent Opus review and same-context re-review.

### Task 5: Documentation and contract coverage

**OpenSpec mapping:** 6.1. **Class:** mechanical/documentation. **Implementer:** native Codex Terra, medium reasoning. **Reviewer:** persistent Claude Sonnet.

**Files:**

- Modify: `projects/synth/browser/README.md`
- Modify: `projects/synth/browser/docs/catalog-schema-v1.md`
- Modify: `projects/synth/browser/docs/publisher-guide.md`
- Modify: `projects/synth/docs/coverage.md`
- Modify only if required by actual behavior: `openspec/changes/add-browser-app-catalog-launcher/design.md`

- [ ] **Step 1: Build a documentation checklist from the final interfaces**

Cover host-context registration, native callback-only failure semantics, removal of the timer transport, declarative app fields/validation, the one-record onboarding procedure, generated bindings, common memory flags, complete-catalog atomic publication, Mini App/Braid 4 examples, local commands, Cloudflare versus Pages roles, and rollback.

- [ ] **Step 2: Update docs using actual command and field names**

The publisher guide must show that adding a conforming app is one manifest record followed by:

```bash
make -C projects/synth/browser browser-apps
npm --prefix projects/synth/browser run publish:site
```

It must not instruct publishers to add an entry `.cpp`, Make target, package branch, or custom audio integration.

- [ ] **Step 3: Update coverage mapping**

Map `sbap-1`–`sbap-4` and modified `sprs-8` to named C++/Node/Playwright/publication/workflow tests. Record local versus CI-owned live deployment evidence precisely.

- [ ] **Step 4: Verify documentation consistency**

```bash
rg -n 'render-audio|configure-audio|ring producer|miniapp_entry|browser-miniapp' projects/synth/browser/README.md projects/synth/browser/docs projects/synth/docs/coverage.md
rg -n 'sbap-[1-4]|sprs-8' projects/synth/docs/coverage.md
```

Expected: the first search has no obsolete instructions except explicitly historical removal notes; every requirement appears in coverage.

- [ ] **Step 5: Commit and review**

Commit as `docs(synth-browser): document generic native app hosting`. Mark OpenSpec 6.1 after persistent Sonnet review.

### Task 6: Integration hardening and release-risk review

**OpenSpec mapping:** 6.2–6.4. **Class:** verification/release. **Implementer:** native Codex Sol, xhigh reasoning. **Reviewer:** persistent Claude Opus, then a fresh whole-change Opus context.

**Files:** Modify only files required to fix verified integration defects; update `openspec/changes/fix-browser-native-audio-and-generic-app-packaging/tasks.md` only as each mapped gate is evidenced.

- [ ] **Step 1: Run focused native and browser contracts**

```bash
make -C projects/synth build/browser_runtime_contract_tests
projects/synth/build/browser_runtime_contract_tests
npm --prefix projects/synth/browser run build
npm --prefix projects/synth/browser run check:generic-runtime
node --test projects/synth/browser/dist/tests/*.test.mjs
```

Expected: all pass with no app-specific generic-boundary or timer-audio violations.

- [ ] **Step 2: Run real build and Playwright gates**

```bash
make -C projects/synth/browser browser-apps
npm --prefix projects/synth/browser test
```

Expected: every Node and local Chromium test passes; only an explicitly live-deployment-only test may skip when no remote URL is provided.

- [ ] **Step 3: Run the complete synth suite**

```bash
make -C projects/synth test
```

Expected: every native synth target passes, including Braid 4 system/deadline coverage and browser runtime contracts.

- [ ] **Step 4: Rebuild and inspect exact publication artifacts**

```bash
npm --prefix projects/synth/browser run publish:site
npm --prefix projects/synth/browser run publish:pages
```

Verify root discovery downloads no package bytes; the catalog contains the configured two apps; every hash/size/MIME matches; both select through the same native path; Cloudflare alone has launcher/runtime/rollback/headers; Pages has only catalog/packages.

- [ ] **Step 5: Run specification and repository hygiene gates**

```bash
openspec validate fix-browser-native-audio-and-generic-app-packaging --strict
git diff --check
git status --short
```

Expected: strict validation succeeds and only the protected pre-existing untracked package lock/miniapp build paths remain outside committed work.

- [ ] **Step 6: Persistent task review and fix loop**

Give the Task 6 Opus reviewer the OpenSpec artifacts, this plan, full implementation diff, test evidence, generated artifact inventory, and explicit questions about real-time safety, Emscripten context ownership, shared-memory growth, generic boundaries, atomic publication, and false-positive tests. Reuse the Task 6 implementer for ordinary findings and the same reviewer for every post-fix review until clean.

- [ ] **Step 7: Fresh whole-change release review**

Start a new Opus context with no task-review history. Require findings first, ordered by severity with file/line references, and a final merge-readiness judgment. Resolve every actionable finding through the Task 6 implementer and re-review in the same fresh context.

- [ ] **Step 8: Complete bookkeeping**

Check OpenSpec 6.2–6.4 only after all gates and reviews pass. Commit integration fixes/evidence as `test(synth-browser): harden generic native app hosting`. Do not push, deploy, enable Pages, or archive changes without separate authorization.

## Completion Criteria

All 22 OpenSpec checkboxes are evidenced and checked; strict validation passes; the timer/ring producer and per-app browser builds are absent; Mini App and unchanged Braid 4 compile from one manifest and publish as immutable packages; one catalog click starts each app's native callback; both publication artifacts validate; full synth/browser suites pass; persistent task reviews and fresh whole-change Opus review have no unresolved actionable findings; only the protected pre-existing untracked paths remain.
