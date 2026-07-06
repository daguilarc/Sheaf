# Task 1 Report: Parameter Group Cadence API

## Scope

Implemented Task 1 only for OpenSpec change `decouple-encoder-block-rate`.

Modified files:
- `projects/synth/include/synth/ParameterModulation.hpp`
- `projects/synth/src/ParameterModulation.cpp`
- `projects/synth/tests/parameter_modulation_tests.cpp`
- `openspec/changes/decouple-encoder-block-rate/tasks.md`

Ignored as requested:
- `projects/synth/miniapp/`

## Implementation

- Added `synth::kDefaultTargetComputeIntervalSamples = 16`.
- Added `ParameterGroupConfig::targetComputeIntervalSamples`, defaulting to 16.
- Extended `ParameterGroupConfig::IsValid()` to reject zero target compute intervals.
- Added `Parameter::ProcessSample(std::uint64_t sampleIndex)`.
  - Recomputes targets from the owning manager scene when `sampleIndex % targetComputeIntervalSamples == 0`.
  - Always runs `ProcessLite()` afterward.
- Added `ParameterGroup::ProcessSample(std::uint64_t sampleIndex)`.
  - Iterates all top-level parameters through `ParameterByLocalIndex()` so both initial and reinforced storage batches are covered.
- Left `ProcessLite()` as the slew-only helper.

## Tests Added

- Extended `group_config_validation` to cover:
  - default target compute interval is 16,
  - positive configured values remain valid,
  - zero target compute interval is invalid.
- Added `parameter_process_sample_recomputes_on_configured_interval`.
- Added `parameter_group_process_sample_covers_top_level_and_modulation_depth_targets`.

## Red/Green Evidence

Red run:

```bash
make -C projects/synth build/parameter_modulation_tests && projects/synth/build/parameter_modulation_tests
```

Result: failed to compile as expected before implementation because `ParameterGroupConfig::targetComputeIntervalSamples` was missing.

Green run:

```bash
make -C projects/synth build/parameter_modulation_tests && projects/synth/build/parameter_modulation_tests
```

Result: passed with exit code 0.

## Notes

- The brief's group-level test snippet expected `carrier.CurrentDepths(0)[0] == 0.5f` after setting the modulation-depth child scene center to `0.5f`.
- Existing parameter modulation behavior maps modulation-depth knob values through `ModulationDepthTargetFromKnob`; existing tests assert a half-turn depth knob produces raw depth `0.125f`.
- I preserved the new test's intent and asserted:
  - the child depth target center refreshes to `0.5f`, and
  - the carrier's raw current depth refreshes to the established mapped value `0.125f`.

## OpenSpec Tasks

Marked only tasks 1.1 through 1.5 complete in `openspec/changes/decouple-encoder-block-rate/tasks.md`.

## Concerns

None blocking. The only deviation from the literal brief snippet is the raw modulation-depth assertion described above, made to preserve the existing modulation-depth curve contract.
