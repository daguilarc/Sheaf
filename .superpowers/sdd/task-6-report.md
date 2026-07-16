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
