# Task 2 Report: Exact Absolute Parameter Editing

## Result

- Status: `DONE`
- Commit: `0ad708aa` (`feat(synth): add exact absolute parameter projection`)
- OpenSpec mapping implemented: 2.1, 2.2, 2.3, 2.4, 2.5.
- OpenSpec checkboxes, plan, proposal, progress ledger, prior task reports, and `projects/synth/miniapp/` were not committed or modified by this task.

## Scope Implemented

- Added JUCE-free `synth::detail` contracts for gesture contributions, distinct latent edit locations, coefficient construction, and pure target projection.
- Added post-aggregation validation for non-null distinct storage, finite positive coefficients, unit coefficient sum, finite in-range storage, finite ordered bounds, and finite in-range targets.
- Added the double-intermediate active-set solve `z_i = clamp(x_i + lambda * a_i)`, fixing every contributor that crosses the approached bound and recomputing over the remaining free set. Float writes happen only after the complete candidate passes range and `1e-5` effective-target validation.
- Added `Parameter::HandleSetAbsolute`, preserving the existing relative handler unchanged. At the Task 2 commit, the absolute handler clamped normalized input, armed selected inactive gestures using the existing endpoint rules, rebuilt contributors after arming, included every positive-weight active gesture independent of selection, projected, and verified production `ComputeRawCenter(scene)` before target-center slew within `1e-5`. The final-review follow-up in `daa421d1` retained those observable semantics while replacing the runtime verification path with staged rounded-weight validation and independent `ComputeRawCenter` tests.

## TDD Evidence

### Cycle 1 RED: coefficient builder and projection

Command:

```text
make -C projects/synth build/parameter_modulation_tests
```

Result: exit code `2` as expected. Compilation failed because the wished-for pure API did not exist, beginning with:

```text
tests/parameter_modulation_tests.cpp:185:16: error: no member named 'detail' in namespace 'synth'
tests/parameter_modulation_tests.cpp:190:16: error: no member named 'detail' in namespace 'synth'
```

The failing tests already covered independently calculated scene/gesture coefficients, endpoints, aliased storage, hand-calculated minimum change, upward/downward saturation redistribution, bipolar bounds, endpoint/no-op behavior, exactness, and invalid-contract no-mutation behavior.

### Cycle 1 GREEN

Command:

```text
make -C projects/synth build/parameter_modulation_tests && projects/synth/build/parameter_modulation_tests
```

Result: exit code `0`. The new pure tests and the complete existing parameter binary passed.

### Cycle 2 RED: `Parameter::HandleSetAbsolute`

Command:

```text
make -C projects/synth build/parameter_modulation_tests
```

Result: exit code `2` as expected. All nine call sites failed on the missing behavior, beginning with:

```text
tests/parameter_modulation_tests.cpp:310:15: error: no member named 'HandleSetAbsolute' in 'synth::Parameter'
tests/parameter_modulation_tests.cpp:319:15: error: no member named 'HandleSetAbsolute' in 'synth::Parameter'
```

The parameter tests were present before production implementation and covered endpoint/mid-blend/aliased scenes, same-call arming, the proof's reweighting counterexample, active deselected participation, saturation redistribution, unrelated storage, bipolar normalized storage, normalized clamping, and non-finite no-mutation behavior.

During the first post-implementation run, production reached the requested `0.9` target but exposed one incorrect hand calculation in the test: for inputs `(0.2, 0.8)` and coefficients `(0.75, 0.25)`, minimum-change projection saturates the right contributor and returns `(13/15, 1)`, not `(1, 0.6)`. The independent expected value was corrected; production was unchanged.

### Final GREEN, repeated twice

Command:

```text
make -C projects/synth build/parameter_modulation_tests && projects/synth/build/parameter_modulation_tests && projects/synth/build/parameter_modulation_tests
```

Result: exit code `0` after the final invariant/include cleanup. Both consecutive executions passed all 252 registered cases (244 pre-existing plus 8 new). The focused new cases were:

```text
[PASS] absolute_edit_locations_form_the_independently_computed_convex_system
[PASS] absolute_edit_locations_cover_endpoints_no_gestures_and_aliased_storage
[PASS] absolute_projection_is_exact_minimum_change_and_redistributes_saturation
[PASS] absolute_projection_handles_noop_endpoints_bipolar_ranges_and_rejects_invalid_contracts
[PASS] handle_set_absolute_reaches_endpoint_mid_blend_and_aliased_scene_targets
[PASS] handle_set_absolute_arms_then_rebuilds_the_proof_counterexample
[PASS] handle_set_absolute_arms_both_touched_endpoints_and_preserves_unrelated_storage
[PASS] handle_set_absolute_clamps_normalized_input_maps_bipolar_storage_and_rejects_nonfinite
```

## Independent Oracle

The coefficient test does not call the production builder to obtain expected coefficients. It independently computes:

```text
W = w_a + w_b
p_0 = [w_a(1-w_a) + w_b(1-w_b)] / W
p_a = w_a^2 / W
p_b = w_b^2 / W
a_(k,L) = p_k(1-b)
a_(k,R) = p_k b
```

The second gesture's effective weight is independently derived from a right-only active scene endpoint. The test then looks up each production location by storage identity and compares every accumulated coefficient plus the unit sum. A separate shared-endpoint case proves alias aggregation into one coefficient-1 location.

## Proof-to-Code Mapping

- **Lemma 1 (convex coefficients):** `BuildAbsoluteEditLocations` computes `p_0`, `p_j`, multiplies by `1-b,b`, omits zero terms, aggregates identical addresses, and rejects any result that is not finite, positive, and unit-sum within `1e-10`.
- **Post-arming topology:** `HandleSetAbsolute` completes the selected-inactive arming pass first. Only afterward does it scan the active mask, recompute `EffectiveGestureWeight`, build distinct locations, and project. The explicit base-0 / active-gesture-1 / newly-armed-gesture-0 counterexample reaches `0.75` in the same call with the predicted `(base, old gesture, new gesture) = (0.8, 1, 0.4)`.
- **Theorem 1 (existence):** the builder supplies positive unit-sum coefficients over bounded storage; endpoint targets are handled directly and interior targets use the continuous clamped weighted family.
- **Theorem 2 (termination/exactness):** each nonterminal active-set iteration fixes at least one newly saturated free contributor, so at most the contributor count can be removed. The solver algebraically recomputes lambda from fixed contribution, free base contribution, and `sum(a_i^2)`, then validates the rounded float effective value within `1e-5` before writing.
- **Theorem 3 (minimum change):** unsaturated candidates use the KKT form `x_i + lambda*a_i`; saturated candidates are fixed only at the approached bound. Hand-calculated unconstrained and upper/lower saturation cases assert the unique expected solution.
- **Production exactness before slew:** handler tests use `targetCenterAlpha = 1` and call `Compute(scene)` only as the narrow test seam exposing `ComputeRawCenter`. At the original Task 2 commit the handler also recomputed the private raw center; final-review fix `daa421d1` instead validates the equivalent staged rounded weighted center before commit, while the focused and property tests continue to verify production `ComputeRawCenter(scene)` before any target-center smoothing.

## Files in Commit

- `projects/synth/include/synth/ParameterModulation.hpp`
- `projects/synth/src/ParameterModulation.cpp`
- `projects/synth/tests/parameter_modulation_tests.cpp`

## Self-Review

- `git diff --check` passed before commit.
- `HandleIncDec` has no task diff and retains its swallowed first relative turn.
- Projection validates the full candidate before any storage write, so rejected pure-helper contracts do not partially mutate storage.
- All arithmetic used to derive coefficients, lambda, candidates, and rounded effective value is double; only the final boundary write is float.
- Endpoint/shared-scene aliasing is aggregated by storage address, preventing duplicate writes.
- At the original Task 2 commit, the control-message path still allocated small JUCE-free vectors. Final-review fix `daa421d1` removed those runtime allocations, made the handler `noexcept`, and added fixed-capacity staging plus rollback so rejected internal invariants are mutation-free no-ops; the vector-returning adapter now remains only for pure helper tests.
- No known correctness concerns remain. Randomized model/property breadth is deliberately reserved for plan Task 6.
