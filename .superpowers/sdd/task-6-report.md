# Task 6 Report: Absolute Encoder Invariant And Completion Verification

## Status

DONE — implemented, committed, locally verified, and accepted by external spec
and quality review. OpenSpec tasks 6.1–6.3 are checked.

## Commit

- `d9bc2f5c` — `test(synth): verify absolute encoder invariants`
- `daa421d1` — `fix(synth): make absolute edits audio-safe`

## Scope

- Added `handle_set_absolute_seeded_property_matches_independent_post_arming_model`.
  It runs 192 seed-`0xAB501` randomized cases plus forced left/right endpoints,
  aliased endpoints, zero/one gesture weights, saturation redistribution, and the
  proof's post-arming reweighting topology.
- The oracle independently simulates selected-inactive arming and derives the
  post-arming convex coefficients from the OpenSpec equations. It never calls
  `BuildAbsoluteEditLocations`, `ProjectAbsoluteTarget`, or reads production
  coefficient/projection output.
- The oracle solves the unique minimum-change projection with a separate
  monotone bisection implementation, then compares every contributing latent
  value to that result. Every case also checks same-message arming, all storage
  bounds, bitwise preservation of zero-coefficient unrelated storage,
  independently reconstructed raw-center error at most `1e-5`, the production
  alpha-1 raw-center observation, active flags, and bitwise deterministic output
  across two fresh identical executions.
- Updated coverage mappings for `spm-31`, `spm-52`, `spm-75`, `spm-76`, and
  `sru-26` with exact test names and the oracle's independence boundary.
- In `d9bc2f5c`, resolved the Task 2 minor cleanup by documenting the then-present
  post-arming invariant throw, removing the redundant post-throw `assert`, and
  renaming the focused bipolar handler test to state that handler storage is
  normalized while the pure helper's real `[-1, 1]` bipolar-range coverage
  remains intact. Final-review fix `daa421d1` then eliminated that throw path
  entirely through preflight, staged projection, and rollback.

## RED / Characterization Evidence

This task adds verification rather than new product behavior. The complete new
property test passed on its first behavioral run against the already-reviewed
Tasks 1–5 implementation. It exposed no production defect. I did not fabricate
a defect or an artificial missing test seam to create a RED result.

Initial command after adding the independent oracle:

```sh
make -C projects/synth build/parameter_modulation_tests && \
projects/synth/build/parameter_modulation_tests
```

Result: exit `0`; the new property test and the full parameter binary passed.

## GREEN Evidence

Required deterministic double run:

```sh
make -C projects/synth build/parameter_modulation_tests && \
projects/synth/build/parameter_modulation_tests && \
projects/synth/build/parameter_modulation_tests
```

Result: exit `0` twice, 261 cases each run. Timed confirmation was `1.04s` and
`1.03s` wall clock.

UI boundary:

```sh
make -C projects/synth check-ui-boundary
```

Result: exit `0` in `0.05s`.

Complete synth suite:

```sh
make -C projects/synth test
```

The first suite attempt reached `portable_ui_tests` and hit its pre-existing
shared-temp-path race:

```text
filesystem error: in remove_all: No such file or directory
[".../sheaf_portable_file_page_test"]
```

The portable binary immediately passed alone. A clean complete-suite rerun then
passed exit `0` in `7.50s` (`user 4.88s`, `sys 1.94s`). This failure did not
reproduce and was unrelated to the Task 6 files; no product or test workaround
was applied.

Strict OpenSpec validation:

```sh
openspec validate add-absolute-encoder-mode --strict
```

Result: exit `0`, `Change 'add-absolute-encoder-mode' is valid`.

Compatibility and hygiene:

```sh
rg -n 'EncoderRelativeMode|\.relativeMode' projects/synth --glob '!miniapp/**'
git diff --check
git status --short
```

Results: the compatibility search returned no matches (the expected `rg` exit
`1`) and therefore found no obsolete C++ identifiers. A separate
`rg relativeMode` inspection found only
the intentional legacy JSON parser and migration/invalid-input fixtures.
`git diff --check` had no output. Status preserved all orchestrator reports,
the untracked plan/proposal, and the user's untracked `projects/synth/miniapp/`.

## Files Changed

- `projects/synth/tests/parameter_modulation_tests.cpp`
- `projects/synth/include/synth/ParameterModulation.hpp`
- `projects/synth/src/ParameterModulation.cpp`
- `projects/synth/docs/coverage.md`

## Final Whole-Change Review Follow-up: Audio-Thread Safety

The final Opus review identified that the original absolute handler allocated
three solver vectors per incoming CC and threw after arming when malformed
persisted latent storage made projection reject the edit. The follow-up removes
both audio-thread hazards:

- `AbsoluteEditWorkspace` uses fixed `std::array` storage for all locations,
  projected doubles, saturation flags, and rounded floats. Its capacity is
  derived from the exact upper bound `2 + 2 * 64 = 130`: two base endpoints plus
  two endpoints for every bit representable by `GestureMask`; aliasing only
  lowers the distinct-location count.
- `TryBuildAbsoluteEditLocations` and the workspace projection overload are
  `noexcept`, reject capacity/finite/range/convexity failures, and perform no
  dynamic allocation. The vector-returning builder remains only as a convenient
  JUCE-free pure-test surface; `Parameter::HandleSetAbsolute` no longer calls it.
- `Parameter::HandleSetAbsolute` is `noexcept`. It preflights scene indices,
  backing-span invariants, finite normalized inputs, base and active latent
  ranges, and gesture weights before arming. It snapshots touched gesture state,
  stages all projection results before the solver commits storage, restores any
  arming if a later invariant rejects the edit, and catches unexpected failures
  at the boundary.

RED evidence was observed before production changes:

```text
[FAIL] handle_set_absolute_rejects_malformed_latent_storage_without_throwing_or_arming:
absolute parameter projection failed
```

The fixed-workspace contract test also failed to compile because
`AbsoluteEditWorkspace`, `TryBuildAbsoluteEditLocations`, and the workspace
projection overload did not yet exist. GREEN evidence after the change:

```sh
make -C projects/synth build/parameter_modulation_tests && \
projects/synth/build/parameter_modulation_tests
```

Result: exit `0`; 264 cases passed. New focused coverage proves the fixed
capacity equation and overflow rejection, statically checks the runtime helpers
and handler are `noexcept`, and verifies malformed out-of-range latent storage,
non-finite gesture control state, and invalid scenes are mutation-free no-ops.

Fresh follow-up verification also ran:

```sh
make -C projects/synth check-ui-boundary
make -C projects/synth test
git diff --check
```

All three exited `0`; the complete synth suite rebuilt the shared library and
all dependent test binaries before running them.

Focused xagent Claude Opus re-review of the final-review fix returned SPEC
COMPLIANCE PASS, CODE QUALITY PASS, and APPROVE with no Critical or Important
findings.

## Self-review

- Coefficient aliasing is keyed by the oracle's logical latent-storage index;
  left/right references to the same scene aggregate before projection.
- Inactive storage is considered unrelated only when it has zero post-arming
  coefficient and was not armed by the message. This avoids incorrectly calling
  an inactive endpoint unrelated when the opposite active endpoint makes its
  blended gesture value a real contributor.
- Forced cases prevent endpoint, alias, exact zero/one weight, saturation, and
  post-arming topology coverage from depending on PRNG luck.
- Random cases cover scene centers, per-scene gesture values and active masks,
  effective weights, selection masks, blends, targets, aliased scene endpoints,
  and both normalized unipolar/bipolar parameter configurations.
- The production raw-center observation uses `targetCenterAlpha = 1`, explicitly
  distinguishing it from ordinary slew; the independent weighted reconstruction
  is also asserted directly against the target.
- Neither implementation commit modified an OpenSpec checkbox. The orchestrator
  checked tasks 6.1–6.3 only after external approval. No file under
  `projects/synth/miniapp/` was read or changed.

## Concerns

No Task 6 correctness concern. The sole transient full-suite failure is the
existing fixed-temp-directory collision described above; the complete rerun is
green and no change was made outside task scope to mask it.

---

# Browser App Catalog Task 6: First-Party Production Deployment

## Status

DONE — OpenSpec 6.1–6.5 are implemented and locally verified. Per controller
instruction, the OpenSpec checkboxes and `.superpowers/sdd/progress.md` remain
unchanged pending external review. The planned commit message is
`feat(synth-browser): publish catalog launcher and miniapp package`.

## Contract Implemented

- Added the checked-in same-deployment source
  `catalogs/sheaf/catalog.json` and deterministic first-party metadata for
  `sheaf/miniapp`.
- Added a first-party generator that copies the real two-file Emscripten
  emission into a dedicated temporary emission directory, invokes the generic
  package assembler, and writes an immutable content-addressed package under
  `catalogs/sheaf/packages/miniapp/<build-id>/`.
- Declared and validated entry, WASM, pthread worker, Wasm-worker, and
  AudioWorklet roles. The actual emission contains `miniapp.js` and
  `miniapp.wasm`; all three worker/worklet roles deliberately alias the hashed
  JavaScript bootstrap, matching the current Emscripten output.
- Extended the trusted source parser to resolve reviewed relative entries only
  against an explicit source-list URL. Resolved production URLs must remain
  HTTPS; loopback HTTP is accepted only for local browser tests. Existing
  absolute HTTPS publisher sources remain unchanged.
- Made publication transactional: it assembles a sibling staging tree,
  validates launcher/source/catalog/package/rollback references and every
  package digest, then swaps the destination with restoration of the prior tree
  on replacement failure.
- Published only the 13 generic browser modules used at runtime, rather than
  leaking Node build/publish modules into the production artifact.
- Kept the production root launcher-only. Startup loads source/catalog JSON but
  no package bytes; selection fetches the immutable first-party package through
  the generic loader. Generic rows expose their global identity as
  `data-synth-app-id` for observable acceptance without an app branch.
- Removed the runtime fallback to `/dist/wasm/app.js`. Direct installation now
  requires a materialized module or explicit `moduleUrl`, so normal production
  code has no direct-artifact dependency.
- Added the temporary complete rollback bundle under
  `rollback/direct-miniapp/`: direct index, `app.js`, real `miniapp.js`
  worker/worklet bootstrap, and `miniapp.wasm`. Its direct bootstrap supplies
  an explicit locator map for the differently named `app.js` entry and
  `miniapp.*` sidecars. README instructions describe previous-artifact
  republish as preferred and a copy-based direct fallback; no normal HTML,
  catalog, or runtime module references the rollback directory.
- Updated Cloudflare headers for global COOP/COEP/MIDI plus explicit
  `text/javascript` and `application/wasm` rules across canonical immutable
  package and rollback paths. The Cloudflare build creates fake and miniapp
  emissions, leaves miniapp as the direct rollback input, and publishes only
  after validation.
- Corrected OpenSpec design D8 to place package files beside the nested catalog.
  This follows schema v1's normalized catalog-relative path contract without a
  root alias or duplicate package copy.

## Strict TDD Evidence

### RED — publication/validation boundary

```sh
cd projects/synth/browser
npm run build && node --test dist/tests/publish-site.test.mjs
```

Exit `1`: the requested `validatePublishedSite` export did not exist. The new
suite already specified complete deployment/rollback layouts, same-deployment
resolution, byte-identical rebuilds, digest failures, bad references, and
destination preservation.

### RED — same-deployment trusted sources

```sh
npm run build && node --test dist/tests/catalog.test.mjs \
  dist/tests/catalog-client.test.mjs
```

Exit `1`, 19 passed / 2 failed. Relative
`catalogs/sheaf/catalog.json` was rejected as not absolute HTTPS by both the
catalog contract and live client path.

### RED — exact published browser root

```sh
npx playwright test tests/static-site.spec.ts
```

Exit `1`, 4 passed / 1 failed: the exact `dist/site` server origin did not yet
exist. After adding that production-tree server, the next focused RED reached
the launcher but had no generic global-ID attribute. A further real page run
found relative source parsing still received `/catalog-sources.json` instead of
an absolute browser URL; `CatalogClient` now canonicalizes it against
`location.href` before trust validation.

### RED — no production direct fallback

```sh
npm run build && \
  npx playwright test tests/static-site.spec.ts -g application-generic
```

Exit `1`: `src/main.ts` still named `/dist/wasm/app.js`. The fallback was
removed, and the existing direct-owner test now supplies an explicit
materialized module.

### RED — Cloudflare/smoke wiring

```sh
npm run build && node --test dist/tests/scaffold.test.mjs
```

Exit `1`, 4 passed / 1 failed because the Cloudflare script had not yet built
the generic fake emission before miniapp, and the miniapp smoke target had not
yet published the catalog artifact.

### RED — production runtime-module allowlist

```sh
npm run build && node --test dist/tests/publish-site.test.mjs
```

Exit `1`: `browserRuntimeModules` did not exist. Publication now copies an
explicit generic runtime allowlist; exact inspection shows no build-only `.mjs`
files in deployed `dist/src`.

### RED — complete direct rollback mapping

The first generated rollback browser smoke reached `app.js` but failed because
the generic filename-derived locator would map that entry to nonexistent
`app.wasm`, while the copied Emscripten sidecar is named `miniapp.wasm`. The
rollback bootstrap now provides a complete explicit map for `app.js`,
`miniapp.js`, and `miniapp.wasm`; the regression exercises the generated page,
not a source-string approximation.

The first remote-miniapp instrumentation run successfully discovered,
materialized, selected, and rendered the app, then errored only because the test
captured its runtime-client property before selection. Correcting that test
harness reference produced the intended behavioral evidence without a product
change.

## GREEN Evidence

Required build and deterministic publication:

```sh
make browser-fake-app browser-miniapp
npm run publish:site
node --test dist/tests/publish-site.test.mjs
```

All exited `0`; publish tests passed 5/5.

Focused contract/unit gates:

```sh
npm run test:unit
npm run check:generic-runtime
```

All exited `0`; Node tests passed 36/36 and the generic runtime scan passed
with only the exact native entry and first-party build/publish metadata excluded.

Published static root:

```sh
npx playwright test tests/static-site.spec.ts
```

Exit `0`, 5/5. The production-root test proves discovery requests exactly the
source list and canonical catalog before selection, the first row is
`sheaf/miniapp`, selection requests its immutable JS/WASM files, and no rollback
path is requested. After adding the direct rollback regression, the complete
static-site suite was rerun and passed 6/6; the sixth test loads the generated
rollback page and verifies its explicit entry, worker, worklet, and WASM map.

Prescribed fake-first real miniapp gate:

```sh
make browser-miniapp-smoke
```

Exit `0`: fake app 3/3, then miniapp 7/7. The added real remote test selects
`sheaf/miniapp` from the generated catalog on the second origin, proves the
verified Emscripten `new URL("miniapp.js", import.meta.url)` bootstrap is
rewritten to a distinct blob `entryUrl`, proves the original verified entry blob
is passed as `mainScriptUrlOrBlob`, observes the real pthread worker start from
that blob, observes WASM fetched from its verified blob mapping, loads the
generic AudioWorklet module, creates its node, renders the real miniapp, and
delivers MIDI. No fake package stands in for this path.

Complete browser regression:

```sh
npm test
```

Exit `0`: 36/36 serialized Node tests and 99/99 Playwright-discovered tests
passed before the final rollback regression was added. As previously documented
in Task 5, Playwright's discovery imports the Node `*.test.mjs` files and prints
a non-gating parallel `package-app` failure marker; the canonical serial Node
gate passes that test, Playwright reports all 99 tests passed, and the command
exits successfully. The subsequent rollback change passed publish tests 5/5,
its focused browser regression 1/1, and the complete static-site suite 6/6.

OpenSpec and hygiene:

```sh
openspec validate add-browser-app-catalog-launcher --strict
git diff --check
```

Both exited `0`.

## Exact Production Artifact Inspection

The final generated content build is
`db7b6e56b8fbffe20ef24d6b7347d712f0194eb62b152a0c6e2657256373e40a`.

- `miniapp.js`: SHA-256
  `64b162b9c4d894d0a3cfbc7e2fa5745bf0186ca863a0603062675887e3e9974c`
- `miniapp.wasm`: SHA-256
  `021072e87c12bc65c2f7bdca3d95b87286db7dff050ea6bf582850898af8ebbb`
- Both catalog digests matched fresh `shasum -a 256` output.
- `dist/site` contains root launcher/CSS/source list, canonical nested catalog
  and immutable package, exactly 13 generic runtime modules, `_headers`, and the
  four-file rollback bundle.
- It contains no production `dist/wasm/app.js` and no root catalog/package alias.
- `rg` found no `miniapp`, rollback path, or `/dist/wasm/app.js` reference in
  production `index.html` or deployed runtime modules.

## Files and Bookkeeping

The pre-existing untracked `projects/synth/browser/package-lock.json` and
`projects/synth/miniapp/` remain unstaged. Smoke-test screenshot rewrites were
restored and are not part of Task 6. No Task 7 workflow was created. No OpenSpec
checkbox or SDD progress entry was edited.

## Concerns

No blocking Task 6 concern. Live Cloudflare response behavior is not claimed;
this task validates the generated `_headers` and exact static artifact locally.
