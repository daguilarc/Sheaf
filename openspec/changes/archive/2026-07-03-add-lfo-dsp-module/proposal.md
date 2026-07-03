## Why

The miniapp still publishes its third modulator from ad hoc sine/cosine helper math, while the VCO path has moved to reusable DSP processors and module-owned parameter mapping. Adding a proper LFO DSP processor and module should also fix the remaining module-pattern gap: the current VCO module is fixed to two voices, while both VCO and LFO modules should be reusable at arbitrary polyphony.

## What Changes

- Add reusable LFO DSP processors:
  - `LFOShape` as a pure natural-unit processor for triangle, phase distortion/skew, shape morph, phase offset, and exponent shaping.
  - `BasicLFOProcessor` as a stateful incrementer-backed processor that advances phase from frequency in cycles per sample and calls `LFOShape`.
- Rename `DualWavetableVcoModule` to `WavetableVcoModule<Polyphony>` and templatize the module on voice count so it is no longer intrinsically duophonic.
- Add scope/UI-state support for LFO waveform capture and a JUCE component that draws from `BasicLFOProcessor::UIState`, parallel to the current VCO waveform component but not coupled to VCO state.
- Add a `BasicLfoModule<Polyphony>` that registers Frequency, Shape, Phase Offset, Skew, and Exponent parameters in that visible order, maps those parameters to natural LFO processor inputs, registers to a bank, processes polyphonic LFO voices, and publishes pointer-backed normalized modulation-source floats.
- Add a centered bipolar exponential helper so a signed bipolar parameter can map `-1 -> left`, `0 -> center`, and `1 -> right` with geometric interpolation on each side, used as `0.2 -> 1 -> 5` for the LFO exponent parameter.
- Replace the miniapp's ad hoc sine/cosine LFO with the new module, make the LFO page/bank expose five parameters, keep the VCO module page behavior, and draw the LFO waveform from LFO module UI state.
- Use explicit modulo-one wrapping as `x - floor(x)` in the LFO DSP path rather than `fmod`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `synth-dsp-classes`: Add LFO shape and basic LFO DSP processors, scope/UI-state publication, and LFO waveform rendering behavior.
- `synth-modules`: Generalize the wavetable VCO module to `WavetableVcoModule<Polyphony>` and add a matching polyphony-templated basic LFO module following the reusable module lifecycle, parameter registration, bank mapping, input mapping, processing, UI-state, and modulation-source publication pattern.
- `synth-parameter-modulation`: Add centered bipolar exponential mapping for parameters whose natural value is multiplicative around a nonzero center.
- `synth-app-runtime`: Update the runtime-hosted miniapp contract so its LFO setup is module-backed, five-parameter, and drawn from LFO UI state.

## Impact

- Affected synth library files include `projects/synth/include/synth/DspOscillators.hpp`, `projects/synth/include/synth/Modules.hpp`, `projects/synth/src/Modules.cpp`, `projects/synth/include/synth/ParameterModulation.hpp`, and `projects/synth/src/ParameterModulation.cpp`.
- Because the VCO and LFO modules become templates, module definitions will need to move into `Modules.hpp` or use explicit instantiations; `Modules.cpp` should only retain non-template helpers or supported explicit instantiations.
- Affected JUCE UI files include `projects/synth/juce/WaveformComponents.hpp` and miniapp UI wiring under `projects/synth/apps/miniapp`.
- Affected tests include DSP, module, parameter mapping, miniapp system, and any waveform component coverage.
- Public API impact: `DualWavetableVcoModule` is replaced by `WavetableVcoModule<Polyphony>`; the miniapp should instantiate `WavetableVcoModule<2>` and `BasicLfoModule<2>`.
- No new third-party dependencies are required.
