# Task 4: Braid4 Standard Modulators Report

## Status

Implemented Braid4 adoption of independent `StandardModulators<2>`, `<4>`, and `<1>` bundles, including fifteen-source topology, application sources at `4/5`, four-times-host lifecycle, portable underlays, and exact cadence checks. A narrowly authorized generic sparse-depth hot-path optimization was required to retain the existing 96 kHz callback budget.

## RED evidence

- Baseline before test changes:
  - `braid4_system_tests`: pass, 0.56 s.
  - `braid4_deadline_tests`: pass; averages at 44.1/48/96 kHz were 1.27407/1.27839/1.24401 ms and p99 values were 1.47246/1.90842/1.38821 ms.
  - `portable_ui_tests`: pass, <0.01 s.
- Focused adoption RED: `make -C projects/synth build/braid4_system_tests` exited 2 because `Braid4Core` had no retained standard-bundle accessors or standard lifecycle counters. After correcting one test-local scope error, all 15 remaining diagnostics were exclusively the missing Task 4 surface.
- Deadline RED after contract-correct adoption: 96 kHz failed the existing 60%-average budget at 2.21842 ms average (1.600 ms limit); 44.1/48 kHz averaged 2.28742/2.27385 ms.
- Root-cause diagnostics:
  - Temporarily omitting only the three standard `Process()` calls still failed 96 kHz at 2.0775 ms, showing the dominant cost was fifteen-wide parameter evaluation rather than standard DSP. Contract calls were immediately restored.
  - A source-unchanged `-O3` diagnostic still failed 96 kHz at 2.16822 ms.
  - The existing deadline failure was therefore the focused RED for the authorized sparse-depth optimization. New noncontiguous and clear/reassign behavioral characterization tests passed before the optimization and guarded equivalence during it.

## GREEN evidence

- `projects/synth/build/parameter_modulation_tests`: full binary passed, including `noncontiguous_materialized_depths_preserve_dense_modulation_behavior` and `cleared_and_reassigned_depths_keep_smoothing_the_ever_materialized_lane`; 0.35 s.
- `projects/synth/build/braid4_system_tests`: 20/20 passed; 0.68 s.
- `projects/synth/build/portable_ui_tests`: passed; 0.18 s.
- Fresh final `projects/synth/build/braid4_deadline_tests`: passed at every rate:
  - 44.1 kHz: average 1.42758 ms, p99 1.59471 ms, block 5.80499 ms.
  - 48 kHz: average 1.42593 ms, p99 1.67288 ms, block 5.33333 ms.
  - 96 kHz: average 1.38470 ms, p99 1.54258 ms, block 2.66667 ms.

## Files

- `.superpowers/sdd/task-4-standard-modulators-report.md`
- `projects/synth/Makefile`
- `projects/synth/apps/braid-4/Braid4Core.hpp`
- `projects/synth/include/synth/ParameterModulation.hpp`
- `projects/synth/src/ParameterModulation.cpp`
- `projects/synth/tests/braid4_deadline_tests.cpp`
- `projects/synth/tests/braid4_system_tests.cpp`
- `projects/synth/tests/parameter_modulation_tests.cpp`
- `projects/synth/tests/portable_ui_tests.cpp`

## Self-review

- All groups have exactly fifteen modulators and retain capacities 19/32/80, satisfying the minimum 19/23/63.
- Independent address-stable bundles are created after their groups and register standard sources before application sources.
- Standard metadata, source storage, processors, pointer rows, random state, and visualizers are exact and non-aliasing; mono 11 is disconnected.
- Application normalization and storage are unchanged at indexes 4/5; gaps remain disconnected and there are no compatibility aliases.
- Each bundle prepares at the internal sample rate, processes exactly once immediately before the update trio, and publishes exactly once per non-empty host block.
- Matrix/VCO application-source delay, parameter/DSP/scope ordering, output semantics, and deadline thresholds are unchanged.
- Sparse depth indexes are sorted, reserved to the complete modulator count during construction, and retained after clear, so `AssignModulationDepth()` cannot allocate and cleared current depths continue slewing toward zero. Dense `ComputeAtDepth()` remains unchanged.
- No OpenSpec checkbox, MiniApp source, final documentation, or unrelated dirty file was changed.

## Concerns

- One final-verification attempt observed a single 48 kHz scheduler outlier (p99 4.60787 ms) while average remained 1.50178 ms; an immediate source-unchanged rerun produced the clean final evidence above. The benchmark was not relaxed.
- The sparse-depth optimization adds one reserved index vector per parameter. Allocation occurs only during parameter construction; the audio-rate iteration and later assignments remain allocation-free.
