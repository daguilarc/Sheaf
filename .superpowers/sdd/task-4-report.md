# Task 4 Report — Two-app one-click browser and deployment acceptance

## Status

Complete. Task 4 was implemented from base
`83331f69e88ad604775330b1f183091cf511b30a` in implementation commit
`e3cfc420` (`test(synth-browser): prove two-app native browser launch`). OpenSpec
artifacts were not modified.

## Delivered behavior

- Replaced the Mini App-only real-Wasm smoke with a table-driven Mini App and
  Braid 4 acceptance. Each row opens an explicit fresh browser context/page and
  proves one launcher click, one acquired `AudioContext`, one Web MIDI request,
  one runtime, and one materialized package.
- Each real app renders its application-specific root using test data only,
  advances two observed native AudioWorklet block counts, reports finite
  deadline stats, produces a nonzero peak after a MIDI interaction, and retains
  the exact module-memory byte length recorded at native callback startup.
- Each real app saves a patch below `/data/patches/sheaf/<appId>` and proves the
  other app's patch root is absent in its fresh session.
- Both local and deployed-origin acceptance reject evidence of the removed
  `configure-audio`/`render-audio` transport and `synth-audio-ring-buffer`
  fallback while requiring the native `sheaf-synth-audio` node.
- Launcher and published-site tests render the two deterministic catalog rows,
  fetch only source/catalog metadata during discovery, and fetch only the
  selected row's immutable package.
- The generic two-origin fixture now preserves browser ABI v2 and exposes only
  the native context-registration/start/stats surface required by that ABI.
- The deployed validator compares the exact whole `catalogVersion` and fetches,
  validates CORS/MIME, sizes, and hashes for every file of every catalog app.
  A second-app CORS rejection test proves validation does not stop after the
  first app.
- The GitHub Pages workflow now carries
  `SYNTH_BROWSER_EXPECTED_CATALOG_VERSION` / `--expected-catalog-version`
  through build, local smoke, post-deploy validation, and deployed smoke. It
  builds `browser-apps`, assembles both Cloudflare and publisher-only artifacts,
  and retains pinned actions, minimum permissions, default-branch deployment,
  environment, concurrency, CORS, and MIME gates.
- The Cloudflare build compiles all manifest apps through `browser-apps` and
  installs dependencies without creating or changing the protected lockfile.

## Strict TDD record

### RED — whole-catalog deployment validation

After adding the two-app validator/workflow expectations, this command failed
as intended against the build-ID-only implementation:

```sh
npm --prefix projects/synth/browser run build
node --test projects/synth/browser/dist/tests/github-pages-workflow.test.mjs
```

Result: 5 passed, 10 failed. The failures specifically showed the old
`browser-fixture-app browser-apps` CI command, old
`SYNTH_BROWSER_EXPECTED_BUILD_ID` / `--expected-build-id` interface, and the
validator rejecting the new `expectedCatalogVersion` input before validating
the two-app fixture.

### GREEN — whole-catalog deployment validation

After the minimal validator, workflow, and Cloudflare changes, the same focused
workflow test passed 15/15. The final expanded workflow/publication run passed
24/24, including the second-app response gate.

### RED — ABI-v2 two-origin fixture

After changing the two-origin acceptance to require ABI v2, its focused run
failed 1/1 with:

```text
runtime module does not expose AudioContext registration
```

### GREEN — ABI-v2 two-origin fixture

Adding the generic native context registration, native start, and stats
functions to the fixture made the same focused test pass 1/1.

### Real-app acceptance baseline

The newly table-driven Mini App/Braid 4 acceptance passed 2/2 against the Task
1–3 base once the canonical three-port server was running. This confirmed the
earlier implementation already satisfied the real-app behavior and that Task
4's work here is the release-grade acceptance and deployment generalization.
An initial sandboxed Chromium launch and a run without the explicit canonical
server were environment failures and are not counted as RED evidence.

## Verification

All required commands were run from the Task 4 worktree.

- `make -C projects/synth/browser browser-apps` — passed; built Mini App and
  Braid 4 under the common ABI/memory/runtime recipe. Emscripten emitted its
  existing pthread + growable-memory and deprecated `USE_PTHREADS` warnings.
- `npm --prefix projects/synth/browser run publish:site` — passed.
- `npm --prefix projects/synth/browser run publish:pages` — passed.
- `npm --prefix projects/synth/browser run build` — passed.
- `npm --prefix projects/synth/browser run check:generic-runtime` — passed.
- `node --test projects/synth/browser/dist/tests/github-pages-workflow.test.mjs projects/synth/browser/dist/tests/publish-site.test.mjs`
  — 24 passed, 0 failed.
- `npx --prefix projects/synth/browser playwright test tests/first-party-apps-smoke.spec.ts tests/launcher.spec.ts tests/persistence.spec.ts tests/static-site.spec.ts tests/two-origin-package.spec.ts tests/deployed-origin.spec.ts`
  — 22 passed, 2 skipped. Both skips are the documented live-URL-only cases
  because `SYNTH_BROWSER_REMOTE_CATALOG_URL` was unset.
- The same deployed-origin test with the local Pages catalog URL and
  `SYNTH_BROWSER_EXPECTED_CATALOG_VERSION` — 2 passed, 0 failed (Mini App and
  Braid 4).
- Standalone `validate-deployed-catalog.mjs` against the local Pages catalog —
  validated 2 apps and 4 package files at
  `first-party-c9081639f5c39389244c2817308d4b7890269dc149793c6afec5da0f6089895d`.
- A SHA-256 tree comparison proved `dist/site/catalogs` and
  `dist/pages/catalogs` byte-identical: one catalog plus two JS/Wasm files per
  app. Only the Cloudflare tree contains the launcher, runtime modules,
  rollback pages, source list, styles, and `_headers`.
- `git diff --check` — passed.
- Generated `test-results/` was moved to `/tmp` before staging. The pre-existing
  untracked `projects/synth/browser/package-lock.json` and
  `projects/synth/miniapp/` remain unmodified and unstaged.

## Persistent Opus review

- Harness/model: Claude Code / Opus through packaged xagent.
- Run ID: `xrun_20260719190323122_31275be7`.
- Reviewed range: exact
  `83331f69e88ad604775330b1f183091cf511b30a..e3cfc420`.
- Verdict: **APPROVED**.
- Actionable findings: none; no fix/re-review loop was required.
- The reviewer explicitly confirmed the two-app native callback, stable-memory,
  persistence, package-fetch, ABI-v2, `catalogVersion`, all-file validation,
  workflow security/hosting, protected-path, and unchanged-OpenSpec contracts.

The reviewer recorded three low-severity observations rather than defects:

1. `npm install --no-package-lock` consciously trades lockfile-pinned builder
   dependencies for preserving the repository's intentionally untracked
   lockfile; content-addressed output and deterministic catalog tests remain.
2. Generic rollback pages intentionally reuse immutable catalog package paths;
   the underlying generic rollback-tree implementation came from Task 3, while
   Task 4 now accepts both real rows through it.
3. `src/static-server.mjs` and `tests/github-pages-workflow.test.mjs` are two
   justified companion files beyond the brief's primary list: the former keeps
   the cross-origin fixture on ABI v2, and the latter verifies the required
   workflow interface change.

## Concerns

No blocking concerns. The two reviewer observations involving dependency
pinning and rollback structure are intentional existing project trade-offs.
Documentation still using the former build-ID terminology belongs to the
change's later documentation task and was deliberately not changed in this
Task 4 scope.
