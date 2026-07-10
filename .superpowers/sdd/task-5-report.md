# Task 5 Report: Dresden 4 Core Graph

## Status

Implemented and locally verified.

## Summary

- Added the JUCE-free Dresden 4 app core under `projects/synth/apps/dresden-4`.
- Added `Dresden4Core` and the minimal `Dresden4` wrapper satisfying the synth application core concept.
- Built the core graph from:
  - `synth::Dresden4VcoModule`,
  - `synth::BipolarMatrixMixerModule<4>`,
  - `synth::FirDecimator<4, 2, synth::kDresden4DecimatorTaps>`,
  - `synth::OversampledOutputStage<4, 2, Decimator>`.
- Initialized exactly three parameter groups:
  - stereo, two voices, two scenes,
  - quad, four voices, one modulator, two scenes,
  - mono, one voice, two scenes, 24 params shared by Dresden oscillator-detail params and the matrix.
- Created two banks and one 16-encoder slot:
  - Dresden bank maps positions `0`, `1`, and `4..15`, leaving `2` and `3` blank,
  - matrix bank maps all 16 row-major cells.
- Wired matrix raw outputs through the app-level clamp/normalize adapter into quad modulator 0 for all four voices.
- Implemented 4× host-rate preparation and processing:
  - positive finite host-rate validation,
  - internal rate = `4 * hostRate`,
  - parameter timing conversion from 48 kHz defaults to the internal rate,
  - Dresden VCO sample rate set to the internal rate,
  - four internal subframes per host frame,
  - one-internal-sample delayed matrix feedback,
  - final 4:1 FIR decimation at the stereo output boundary.
- Implemented the output channel policy:
  - zero channels: no writes,
  - mono: `0.5 * (left + right)`,
  - stereo: left/right,
  - channels above stereo: silenced.
- Added app-local README documenting the current core-only state and 4× oversampled/downsampled signal path.
- Updated the reusable bipolar matrix mixer parameter color to red so Dresden’s matrix bank satisfies the all-red parameter requirement.
- Adjusted the RED system tests for current engine API names:
  - `Engine::Application()` rather than `App()`,
  - `Engine::ProcessBlock(...)` with timestamp rather than `Process(...)`,
  - `Parameter::ParamColor()` rather than `GetColor()`.

## Files changed

- `projects/synth/apps/dresden-4/Dresden4Core.hpp`
- `projects/synth/apps/dresden-4/Dresden4.hpp`
- `projects/synth/apps/dresden-4/README.md`
- `projects/synth/include/synth/Modules.hpp`
- `projects/synth/tests/dresden4_system_tests.cpp`

## Commit hashes

- RED tests: `1bd2ca0cb660f375a39f35409e7401acf59c62c5` (`test: add Dresden 4 core red tests`)
- RED report: `cf12956e` (`docs: record Dresden 4 core red test report`)
- Implementation: `97b50982ecdad61a1b033ad1aa96bd77720e1a8b` (`feat: add Dresden 4 core graph`)

## RED command/result

- Command:
  - `make -C projects/synth build/dresden4_system_tests && projects/synth/build/dresden4_system_tests`
- Result: failed as expected before app files existed.
- Relevant output:
  - `tests/dresden4_system_tests.cpp:1:10: fatal error: 'Dresden4.hpp' file not found`

## GREEN commands/results

- Command:
  - `make -C projects/synth build/dresden4_system_tests && projects/synth/build/dresden4_system_tests`
- Result: pass.
- Final output:
  - `Dresden 4 system tests passed`

- Command:
  - `make -C projects/synth build/module_tests build/dsp_tests && projects/synth/build/module_tests && projects/synth/build/dsp_tests`
- Result: pass.
- Final sections included all module and DSP tests passing, including the Dresden VCO, bipolar matrix, FIR decimator, and oversampled output-stage coverage.

- Command:
  - `git diff --check -- projects/synth/apps/dresden-4/Dresden4Core.hpp projects/synth/apps/dresden-4/Dresden4.hpp projects/synth/apps/dresden-4/README.md projects/synth/tests/dresden4_system_tests.cpp projects/synth/Makefile projects/synth/include/synth/Modules.hpp`
- Result: pass; no output.

- Command:
  - `rg -n "TODO|FIXME|NEEDS_CONTEXT|BLOCKED" projects/synth/apps/dresden-4 projects/synth/tests/dresden4_system_tests.cpp`
- Result: no matches.

## Self-review

- Scope stayed limited to Task 5 core graph work: no portable UI, Sheaf Patch launcher integration, runtime registration, or standalone entry point was added.
- The core is app-local and JUCE-free.
- Matrix-to-quad modulation uses the specified app-level clamp/normalize adapter while preserving the matrix module’s raw unclamped outputs for inspection and later tests.
- The matrix feedback path intentionally consumes the previous internal subframe’s post-gain oscillator outputs by writing matrix inputs before updating `delayedOscillatorOutputs_` from the current Dresden VCO process.
- Parameter timing uses the new reusable timing helpers against the 4× internal rate, so the one-sample modulation delay is in the oversampled clock.
- The final downsampling filter is explicit through the shared Dresden 4 Kaiser FIR coefficients and `OversampledOutputStage`.
- The current system tests exercise initialization, bank topology, matrix source normalization, 4× timing counters, and finite/non-silent decimated stereo output.

## Concerns

- The Task 5 RED tests do not yet cover every brief item, especially output policy variants, decimator continuity across split app blocks, patch round-trip persistence, and an explicit matrix feedback-delay assertion. The implementation includes those paths where practical, but later review or follow-up tests should harden them.
- Updating the reusable matrix module’s default parameter color from grey to red is intentionally broad enough to satisfy Dresden’s all-red requirement. Existing module tests do not assert the previous grey color, and DSP behavior is unchanged.
