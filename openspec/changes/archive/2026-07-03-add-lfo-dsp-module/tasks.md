## 1. Parameter Mapping

- [x] 1.1 Add a centered bipolar exponential mapping helper to `ParameterManager` that maps signed bipolar `-1 -> left`, `0 -> center`, and `1 -> right` using `Parameter::Get(voiceIx)`.
- [x] 1.2 Add parameter-modulation tests covering left endpoint, center, right endpoint, geometric half-turn interpolation, modulated voice reads, invalid mapping values, and signed zero-based bipolar exponential behavior.

## 2. LFO DSP Processors

- [x] 2.1 Implement `LFOShape` with `Input { inPhase, shape, phaseOffset, skew, exponent }`, `PD` before `Tri`, `Shape`, `x - floor(x)` wrapping, endpoint clamping, and pure process output in `[0, 1]`.
- [x] 2.2 Implement `BasicLFOProcessor` with an owned `Incrementer`, input containing `LFOShape::Input` plus frequency in cycles per sample, output state, scope writer holder support, top-marker recording, color, and `UIState` publication.
- [x] 2.3 Add JUCE-free DSP tests for triangle landmarks, shape landmarks, phase distortion identity/skew behavior, exponent shaping, no-`fmod` wrapping semantics, incrementer advancement, natural-unit processor inputs, scope writes, top markers, and UI-state publication.

## 3. Polyphonic Module Pattern

- [x] 3.1 Rename `DualWavetableVcoModule` to `WavetableVcoModule<Polyphony>` and templatize voice-count-dependent input, UI-state, processor, output, modulation-source, scope-holder, and color storage.
- [x] 3.2 Preserve the existing miniapp VCO behavior by instantiating and testing `WavetableVcoModule<2>` for Tune, Phase, Shape, Volume, direct source, swapped source, output, bank registration, and UI-state behavior.
- [x] 3.3 Add `BasicLfoModule<Polyphony>` API and implementation following `WavetableVcoModule<Polyphony>` registration, duplicate-name validation, capacity validation, stored parameter IDs, bank registration, sample-rate validation, scope holder, color, arbitrary-polyphony sizing, and UI-state patterns.
- [x] 3.4 Register LFO module parameters in visible order: Frequency, Shape, Phase Offset, Skew, Exponent, using defaults that produce a useful visible LFO without extra setup.
- [x] 3.5 Map LFO module input per voice: Frequency exponentially from `0.1` Hz to `1000` Hz and then to cycles per sample; Shape and Skew linearly to `[0, 1]`; Phase Offset linearly to `[0, 1]` plus deterministic per-voice phase stagger `voiceIx / (2 * Polyphony)`; Exponent through the centered bipolar exponential helper from `0.2` through `1` to `5`.
- [x] 3.6 Process one LFO processor per voice, expose per-voice output values, publish address-stable unipolar modulation-source floats, and register those floats as one pointer-backed shape-neutral LFO modulation source.
- [x] 3.7 Add module tests for VCO rename/template behavior and LFO registration order and names, repeated registration rejection, capacity/name errors without partial registration, bank offset mapping, input mapping endpoints and sample-rate behavior, per-voice phase staggering, arbitrary-polyphony processing, modulation-source pointer updates, scope holder/color bounds checks, and UI-state publication.

## 4. Waveform UI

- [x] 4.1 Add an LFO waveform component in `projects/synth/juce/WaveformComponents.hpp` that draws from `BasicLFOProcessor::UIState` pointers and uses the existing scope drawing helper with a unipolar y range.
- [x] 4.2 Keep the existing VCO waveform component behavior unchanged while sharing only generic drawing helpers, not VCO-specific UI state.

## 5. Miniapp Integration

- [x] 5.1 Replace the miniapp's `DualWavetableVcoModule` usage with `WavetableVcoModule<2>`.
- [x] 5.2 Replace miniapp-owned `lfoSpeed_`, `phase_`, `lfoModulators_`, and sine/cosine helper use with `BasicLfoModule<2>`, module input/UI state, module scope channels, and module-owned modulation-source pointers.
- [x] 5.3 Expand the miniapp bank slot/profile visible encoder count to five and register the LFO page bank through `BasicLfoModule<2>::RegisterToBank`.
- [x] 5.4 Keep the VCO page registered through `WavetableVcoModule<2>`, with the first four slot positions occupied by Tune, Phase, Shape, and Volume and the fifth disconnected or harmless on the VCO page.
- [x] 5.5 Update miniapp per-frame processing so parameters are slewed, VCO and LFO module inputs are mapped, both modules are processed, modulation values are updated once per sample, scope indexes advance/publish, and VCO/LFO UI states are populated through modules.
- [x] 5.6 Expand the miniapp scope writer from two channels to four channels and reserve two VCO channels plus two LFO channels.
- [x] 5.7 Update the miniapp UI wrapper to draw the LFO waveform from `BasicLfoModule<2>::UIState` rather than VCO UI state or ad hoc helper state.
- [x] 5.8 Remove or shrink obsolete app-local LFO helper coverage once equivalent DSP/module tests cover the behavior.

## 6. Verification

- [x] 6.1 Update miniapp system tests to select the LFO page, verify all five LFO parameter cells are present, turn each through the production slot path, and confirm their values route to the module.
- [x] 6.2 Update miniapp system tests or module tests to prove the LFO modulation source changes from module processing and remains finite during extended rig runs.
- [x] 6.3 Run `make -C projects/synth test`.
- [x] 6.4 Run `openspec validate add-lfo-dsp-module --strict` and `openspec status --change add-lfo-dsp-module` and confirm all proposal artifacts are valid and apply-ready.
