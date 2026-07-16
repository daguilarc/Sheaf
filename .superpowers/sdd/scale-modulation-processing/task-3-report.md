# Task 3 Report: Stable-Identity Active Modulation Route Prefixes

## Scope completed

- Added fixed-capacity route-source and source-route permutation arenas to both initial group storage and reinforced storage batches.
- Added a per-parameter across-voice active prefix with activation swaps, inverse-map maintenance, backward neutral swap-removal, and debug bijection assertions.
- Added `Modulators::ApplyActive` and migrated `GetRaw`, `TargetValue`, and `ProcessLite` to the compact route/source spans. No production caller uses the full-width `Modulators::Apply` path.
- Kept indexed topology, modulation-depth pointers, metadata/colors, affecting masks, and JSON source keys stable while current/target depth storage moves by route slot.
- Kept returning-to-zero routes active during one-pole settling and pruned them only at compute boundaries after every voice's current and target depth is within `1e-6`.
- Renamed slot-ordered spans to `CurrentDepthSlots`/`TargetDepthSlots` and added read-only source-indexed accessors so inspection cannot activate a route.
- Extended the existing deterministic randomized oracle to assert the full permutation bijection, active-prefix membership/count, source-indexed current/target depths, normalized output, cached state, and masks after every action.
- Added module-level exact work-count assertions for a three-source group with one active route.

## RED evidence

After adding the independent source-indexed `FullScanApply` oracle and wished-for active APIs/tests, this command failed as expected:

```text
make -C projects/synth build/parameter_modulation_tests build/module_tests
```

The clean failure was the missing Task 3 surface:

```text
error: no member named 'ActiveRouteSourceIndices' in 'synth::Parameter'
error: no member named 'ActiveRouteCount' in 'synth::Parameter'
error: no member named 'RoutePositionForSource' in 'synth::Parameter'
error: no member named 'CurrentDepthForSource' in 'synth::Parameter'
error: no member named 'ApplyActive' in 'synth::Modulators'
```

## GREEN evidence

Final command:

```text
make -C projects/synth build/parameter_modulation_tests build/module_tests
projects/synth/build/parameter_modulation_tests
projects/synth/build/module_tests
```

Results:

- Both test binaries compiled with `-std=c++20 -Wall -Wextra -Wpedantic -O2` and no warnings.
- `parameter_modulation_tests`: exit 0; all cases passed, including the existing randomized parameter, message-bus, patch-lifecycle, recursive persistence, normalization, nested modulation, scene, UI-mask, and JSON suites plus the new sparse-route cases.
- `module_tests`: exit 0; all cases passed, including exact sparse route visits in `demo_modulation_process_parameters_applies_direct_vco_modulation`.
- `git diff --check`: exit 0.
- Production full-scan caller search: no `GetModulators().Apply(...)` or other production `.Apply(...)` caller remains under `projects/synth/src` or `projects/synth/include`.

## Cases pinned

- zero allocated-active routes despite four materialized neutral depth nodes;
- sparse sources and dense/all-source activation;
- incremental activation order `3, 0, 2`;
- backward removal of source 0 with moved-source identity preserved;
- route union where voice 0 is neutral and only voice 1 is non-neutral;
- nested modulation-depth route computation;
- scene/blend edits and return-to-zero settling;
- source names, source colors, modulation-depth pointers, and exact JSON keys after route swaps;
- sample-by-sample full-scan output equivalence and exact `activeRouteCount * voiceCount` work;
- active permutation/inverse-map invariants inside the pre-existing randomized state-machine oracle.

## Implementation decisions

- Current and target depths remain voice-major, but the second dimension is explicitly a route slot. Stable source access is always mediated by the inverse map.
- Mutable slot spans remain available for low-level state tests and are named as slot-ordered. Source-indexed accessors are read-only to avoid an inspection side effect.
- The active prefix is maintained at recursive target-compute boundaries using preallocated storage; per-sample processing performs no allocation, locking, graph traversal, or removal.
- The legacy full-width `Modulators::Apply` API remains for existing direct unit coverage, but it is not called by production parameter processing. The independent Task 3 oracle uses `Modulators::Value` directly and does not depend on either production apply implementation.
