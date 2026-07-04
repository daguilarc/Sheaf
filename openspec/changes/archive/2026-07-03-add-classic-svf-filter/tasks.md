## 1. DSP Processor

- [x] 1.1 Add failing DSP tests in `projects/synth/tests/dsp_tests.cpp` for SVF blend endpoints, band center, low-pass convergence, finite high-resonance output, UI-state snapshots, and finite blended transfer-function responses.
- [x] 1.2 Implement the classic two-pole SVF processor in `projects/synth/include/synth/DspFilters.hpp` with input value, cutoff, resonance, blend, low/band/high state outputs, final blended output, `UIState`, `PopulateUIState`, and `TransferFunction` support.
- [x] 1.3 Run the DSP test target and confirm the new processor tests pass.

## 2. Reusable Module

- [x] 2.1 Add failing module tests in `projects/synth/tests/module_tests.cpp` for `ClassicSvfModule<Polyphony>` registration, duplicate/capacity errors, bank mapping, bipolar Blend metadata, parameter-to-natural-unit mapping, explicit per-voice sample input, independent per-voice processing, and per-voice UI-state publication.
- [x] 2.2 Implement `ClassicSvfModule<Polyphony>` in `projects/synth/include/synth/Modules.hpp`, following the existing VCO/LFO module lifecycle, validation, and UI-state publication patterns.
- [x] 2.3 Run the module test target and confirm the new module tests pass.

## 3. Miniapp Integration

- [x] 3.1 Add failing miniapp system tests for VCO page visibility of Tune, Phase, Shape, Volume, Cutoff, Resonance, and Blend, plus audible output changes from filter controls.
- [x] 3.2 Wire `ClassicSvfModule<2>` into `projects/synth/apps/miniapp/MiniAppCore.hpp`, including registration, page assignment, app `parameters_` slewing inclusion, VCO bank offset mapping, sample-rate updates, per-sample voice input assignment from VCO outputs, per-voice filter processing, and filtered output mixing.
- [x] 3.3 Expand the shared miniapp bank-slot encoder layout as needed so the VCO page exposes all seven controls while preserving existing VCO and LFO control positions and leaving extra LFO-page cells unbound.
- [x] 3.4 Run the miniapp system test target and confirm the new miniapp tests pass.

## 4. Verification

- [x] 4.1 Run `make -C projects/synth test` and confirm the full synth test suite passes.
- [x] 4.2 Review the OpenSpec delta against implementation behavior and update any task/spec wording if the implementation reveals a mismatch.
