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
  - current-subframe VCO outputs into the matrix,
  - one-internal-sample delayed matrix modulator consumption,
  - final 4:1 FIR decimation at the stereo output boundary.
- Implemented the output channel policy:
  - zero channels: no writes,
  - mono: `0.5 * (left + right)`,
  - stereo: left/right,
  - channels above stereo: silenced.
- Added app-local README documenting the current core-only state and 4× oversampled/downsampled signal path.
- Restored the reusable bipolar matrix mixer default color to grey and added a pre-registration color override so Dresden’s matrix bank can be red without globally recoloring the generic module.
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
- `projects/synth/tests/module_tests.cpp`

## Commit hashes

- RED tests: `1bd2ca0c9fc416e6666f46a2018ba86fdcac45cd` (`test: add Dresden 4 core red tests`)
- RED report: `cf12956e` (`docs: record Dresden 4 core red test report`)
- Implementation: `97b509828e3b606fb9e92d90d41856c84510d7f2` (`feat: add Dresden 4 core graph`)
- Review fix: `b90fe556c97dca68f1b5226ab8077fd62142b006` (`fix: tighten Dresden core graph contracts`)

## Review findings and fixes

- Review verdict: `REVISE`.
- Critical finding: matrix feedback delay was effectively two internal samples. The initial implementation fed the matrix from a delayed oscillator-output buffer and then published matrix-derived modulators for the next frame.
  - Fix: each internal subframe now processes parameters/consumes the previous normalized matrix publication, processes the Dresden VCOs, feeds the matrix with the current subframe’s post-gain oscillator outputs, processes the matrix, then publishes clamped/normalized matrix outputs for the next internal subframe.
  - Test: `matrix_feedback_uses_current_vco_outputs_and_delays_only_modulator_consumption_one_internal_sample` verifies through the real `ProcessBlock` path that the last matrix inputs came from the current internal sample and the consumed matrix publication came from exactly `lastInternalSampleIndex - 1`.
- Important finding: the generic `BipolarMatrixMixerModule` default color was changed globally from grey to red.
  - Fix: restored grey as the generic default, added `SetColor(Color)` before registration, and uses that override from Dresden 4 before registering matrix parameters.
  - Tests: module tests assert the generic default remains grey and a pre-registration override makes all matrix params red; Dresden system tests assert matrix bank params are red.
- Important finding: system-test coverage was missing required Task 5 contracts.
  - Fix: added focused coverage for zero/mono/stereo/extra-channel output policy, split-block decimator continuity at the Dresden app level, and representative patch save/perturb/load round-trip across stereo, quad, mono oscillator-detail, and matrix params.
  - Cleanup: removed the misleading `.startSample = 100` assignment from the Engine-driven timing test because `Engine::ProcessBlock` owns `block.startSample`.

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
- Fix-pass coverage now includes:
  - exact one-internal-sample matrix modulator delay,
  - current-subframe VCO-to-matrix input,
  - zero/mono/stereo/extra-channel output policy,
  - split-block decimator continuity,
  - patch save/perturb/load round-trip.

- Command:
  - `make -C projects/synth build/module_tests build/dsp_tests && projects/synth/build/module_tests && projects/synth/build/dsp_tests`
- Result: pass.
- Final sections included all module and DSP tests passing, including the Dresden VCO, bipolar matrix, FIR decimator, and oversampled output-stage coverage.

- Command:
  - `git diff --check -- projects/synth/apps/dresden-4/Dresden4Core.hpp projects/synth/apps/dresden-4/Dresden4.hpp projects/synth/apps/dresden-4/README.md projects/synth/tests/dresden4_system_tests.cpp projects/synth/Makefile projects/synth/include/synth/Modules.hpp projects/synth/tests/module_tests.cpp`
- Result: pass; no output.

- Command:
  - `rg -n "TODO|FIXME|NEEDS_CONTEXT|BLOCKED" projects/synth/apps/dresden-4 projects/synth/tests/dresden4_system_tests.cpp`
- Result: no matches.

## Self-review

- Scope stayed limited to Task 5 core graph work: no portable UI, Sheaf Patch launcher integration, runtime registration, or standalone entry point was added.
- The core is app-local and JUCE-free.
- Matrix-to-quad modulation uses the specified app-level clamp/normalize adapter while preserving the matrix module’s raw unclamped outputs for inspection and tests.
- The matrix path now feeds the matrix from current-subframe post-gain oscillator outputs and delays only the normalized modulator publication until the next internal subframe’s parameter/modulator update.
- Parameter timing uses the new reusable timing helpers against the 4× internal rate, so the one-sample modulation delay is in the oversampled clock.
- The final downsampling filter is explicit through the shared Dresden 4 Kaiser FIR coefficients and `OversampledOutputStage`.
- The current system tests exercise initialization, bank topology, matrix source normalization, 4× timing counters, exact matrix delay ordering, output-channel policy, split-block decimator continuity, patch round-trip persistence, and finite/non-silent decimated stereo output.

## Concerns

- Patch round-trip coverage writes representative scene-center values directly through the parameter manager rather than exercising physical encoder gesture paths. That is intentional for persistence coverage, but UI/controller edit paths will be covered by later app integration tasks.
