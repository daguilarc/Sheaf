## Why

The synth currently has oscillator and LFO module building blocks, but no reusable two-pole multimode filter module for shaping the miniapp's VCO output. Adding a classic state-variable filter gives the DSP/module layer a standard subtractive-synthesis processor and exposes it through the existing parameter page workflow.

## What Changes

- Add a JUCE-free classic two-pole state-variable filter processor with cutoff, resonance, continuous low/band/high blend inputs, UI state publication, and transfer-function visualization support.
- Add a templated `ClassicSvfModule<Polyphony>` that owns one filter processor per voice, registers Cutoff, Resonance, and Blend parameters, maps them to natural units, and exposes per-voice outputs and filter UI state.
- Update the miniapp VCO page to include the filter's Cutoff, Resonance, and Blend controls alongside the existing VCO controls.
- Route the miniapp VCO audio through the filter module before writing to audio outputs.
- Add DSP, module, and miniapp/system tests for the new filter behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `synth-dsp-classes`: add a reusable classic two-pole SVF processor contract, blend computation behavior, UI state publication, and transfer-function behavior.
- `synth-modules`: add a reusable polyphonic classic SVF module with parameter registration, bank mapping, input mapping, per-voice processing behavior, and UI state publication.
- `synth-app-runtime`: update the runtime-hosted miniapp contract so the VCO page exposes filter controls and the audio path includes the filter.

## Impact

- Affected code: `projects/synth/include/synth/DspFilters.hpp`, `projects/synth/include/synth/Modules.hpp`, miniapp sources under `projects/synth/apps/miniapp`, and synth tests under `projects/synth/tests`.
- APIs: new processor and module types; no breaking changes to existing VCO, LFO, parameter, or runtime APIs.
- Dependencies: no new third-party dependencies; implementation remains C++20/JUCE-free in core DSP/module code.
