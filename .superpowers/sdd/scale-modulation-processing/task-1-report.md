# Task 1 Implementation Report

## Revisions

- Base SHA: `2a5a51f187fcc1bdc2995eb6172e7b6abb128b74`
- Task commit SHA: `cc52c4c9384484a562d968d5a3d155ca977d7567`
- Commit: `perf(synth): process only top-level parameters per sample`

## Files Changed

- `projects/synth/include/synth/ParameterModulation.hpp`
  - Added `ParameterProcessingObserver` with the four plan-defined counters.
  - Added the observer installation hook, private root registration method, dense root list, and observer pointer to `ParameterGroup`.
- `projects/synth/src/ParameterModulation.cpp`
  - Reserved root-list capacity with the group's initial parameter capacity.
  - Registered manager-created parameters as top-level roots only after manager ID/name registration succeeded.
  - Changed `ParameterGroup::ProcessSample` to visit only the dense root list and count those visits.
  - Counted recursive local computes at `recursionDepth > 0`, while retaining the existing child-first target derivation and local cached/UI seeding.
- `projects/synth/tests/parameter_modulation_tests.cpp`
  - Added a two-root/child/grandchild structural work-count test.
  - Added a recursive local display regression asserting center seeding from `GetRaw(0)` and zero spread at compute cadence.
- `projects/synth/tests/braid4_system_tests.cpp`
  - Added a Braid4 structural test that materializes a neutral local depth in each group and proves one parameter-processing step visits exactly the manager's 60 registered roots.

## RED Evidence

Tests were added before production changes. Command:

```text
make -C projects/synth build/parameter_modulation_tests build/braid4_system_tests
```

Result: exit code 2, as expected. Compilation failed because the wished-for API did not exist:

```text
error: no type named 'ParameterProcessingObserver' in namespace 'synth'
error: no member named 'SetProcessingObserverForTests' in 'synth::ParameterGroup'
```

The failure was caused by the missing Task 1 observability/root-processing contract, not a test typo.

## GREEN Evidence

Focused build and execution:

```text
make -C projects/synth build/parameter_modulation_tests build/braid4_system_tests
projects/synth/build/parameter_modulation_tests
projects/synth/build/braid4_system_tests
```

Result: exit code 0. Both new parameter tests passed, the new Braid4 test passed, the complete parameter-modulation binary passed, and Braid4 reported `Braid 4 system tests passed`.

Surrounding build and execution:

```text
make -C projects/synth build/module_tests build/engine_tests build/rig_tests
projects/synth/build/module_tests
projects/synth/build/engine_tests
projects/synth/build/rig_tests
```

Result: exit code 0. All module, engine, and rig tests passed.

Additional hygiene:

```text
git diff --check
```

Result: exit code 0 with no whitespace errors before commit.

## Design Notes

- The root list is populated only by `ParameterManager::RegisterParameter`; neither `CreateLocalParameter` nor `EnsureModulationDepth` registers a root.
- `ParameterGroup::ProcessSample` no longer indexes high-water local storage, so its hot-loop cost is independent of materialized local depth nodes.
- Recursive local computation remains rooted in a top-level parameter on compute-cadence samples. A local node still copies targets to currents and calls `SeedCachedKnobAndUiDisplayState`, preserving recursive audio derivation while intentionally resetting local display spread at that cadence.
- Observer counters are passive diagnostics. A null observer leaves the production hot path with only the null checks associated with enabled counter sites.

## Deviations

- The plan describes the Braid4 assertion as running one internal subframe. `Braid4Core::ProcessInternalSubframe` is private, so the test invokes `ProcessSample(1)` once on each of Braid4's three parameter groups. This is exactly the parameter-processing portion of one internal subframe and avoids adding a new Braid4 test-only production hook or processing DSP that is unrelated to the assertion.
- No OpenSpec task checkboxes or progress-ledger verdicts were updated; those remain controller-owned until Claude review approval, as required by the task brief.
