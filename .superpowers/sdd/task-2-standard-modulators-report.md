# Task 2 Standard Modulators Report

## Summary

Implemented the separated `StandardModulators<VoiceCount>` lifecycle:

- `Prepare(double)` requires successful registration and a finite positive rate, prepares all four random processors, supports re-prepare, and records prepared state.
- `Process()` requires preparation, advances each of the four random processors once with its retained input, copies outputs into stable rows in voice order, and advances noise once.
- `PublishUiState()` publishes each of the four random snapshots once, independently of processing and caller-owned `ParameterGroup::UpdateModValues()`.
- Added `IsPrepared()` and retained the existing bounded inspection surface.

The hot path has only fixed `kRandomCount` and `VoiceCount` loops. It does not call constant work, group update, UI publication, allocation APIs, locks, or entropy APIs.

## TDD Evidence

### RED

Command:

```text
make -C projects/synth build/dsp_tests
```

Result: exit `2`. Compilation failed specifically because `StandardModulators` had no `IsPrepared`, `Prepare`, `Process`, or `PublishUiState` members. The first diagnostics were at `dsp_tests.cpp:700` through `dsp_tests.cpp:829` and named those missing Task 2 methods.

### GREEN

Command:

```text
make -C projects/synth build/dsp_tests && projects/synth/build/dsp_tests
```

Result: exit `0`; the focused binary compiled without warnings and all DSP tests passed. One initial GREEN attempt exposed a test-side use of mutable `RandomInput()` after registration; the test was corrected to use the intended const inspection surface, then the complete command passed.

## Coverage Added

- Registration-before-prepare, finite-positive rates, process-before-prepare, exact rates, re-prepare, and failed re-prepare preservation.
- Exactly one observable random advancement for all four processors, stable voice-order copies, one noise advancement, and unchanged constant values/pointers.
- Explicit caller-owned group refresh, all quad constant values, and mono index `11` remaining disconnected with a null visualizer and unchanged cached value.
- Snapshot immutability during processing and all-four publication only at `PublishUiState()`.
- Stable random/noise/constant output, pointer, and visualizer addresses across processing/publication.
- Const and mutable bounds checks for every random-index inspection accessor.

## Files Changed

- `projects/synth/include/synth/StandardModulators.hpp`
- `projects/synth/tests/dsp_tests.cpp`
- `projects/synth/include/synth/NoiseWaveformVisualizer.hpp`
- `projects/synth/include/synth/ConstantBarVisualizer.hpp`
- `projects/synth/Makefile`
- `.superpowers/sdd/task-2-standard-modulators-report.md`

## Self-Review

- Lifecycle ordering and exception types match the design and `ssm-5` scenarios.
- `Process()` contains no constant processing/copy, no `UpdateModValues()`, and no UI publication.
- Random and voice loops are statically bounded; wrapper storage remains direct and address-stable.
- Tests observe deterministic random advancement through existing processor state/progress inspection; no processor redesign or test-only production hook was introduced.
- Noise has no existing seed/count control on the bundle-owned processor, so its wrapper advancement is verified through its strict-open output surface rather than adding instrumentation.
- No OpenSpec task checkbox, MiniApp build output, or historical progress file was modified.

## Task 1 Cleanup Disposition

- Removed the unused `<span>` include from `StandardModulators.hpp`.
- Added `ParameterModulation.hpp` to the direct standard-modulator Make dependency set.
- Added small `SetColor` operations to the two generic visualizers and applies frozen constant/noise metadata colors during registration. A draw-command test proves pre-registration metadata color overrides reach the retained visualizers without reconstruction.
