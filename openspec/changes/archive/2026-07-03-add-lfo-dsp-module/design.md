## Context

The synth code already has a useful split between DSP processors and modules. `WavetableVco` owns oscillator state and accepts natural inputs, while the current `DualWavetableVcoModule` owns parameter registration, parameter ID storage, bank registration, input mapping, modulation-source publication, and module UI state. That module pattern is useful, but the type is incorrectly fixed to two voices. The miniapp also still has an exception: its third modulation source is generated in `projects/synth/apps/miniapp/DemoModulation.hpp` from app-local sine/cosine helpers and only exposes one LFO Speed parameter.

This change first generalizes the VCO module into `WavetableVcoModule<Polyphony>`, then brings the LFO path up to that standard with `BasicLfoModule<Polyphony>`. The miniapp should instantiate both modules at polyphony two.

## Goals / Non-Goals

**Goals:**

- Provide `LFOShape` as a pure DSP processor whose output is determined only by phase, shape, phase offset, skew/phase distortion, and exponent inputs.
- Provide `BasicLFOProcessor` as the stateful incrementer-backed DSP processor that advances phase from frequency in cycles per sample, wraps with `x - floor(x)`, calls `LFOShape`, and publishes scope/UI state.
- Rename `DualWavetableVcoModule` to `WavetableVcoModule<Polyphony>` and remove the hard-coded two-voice module assumption.
- Provide a polyphony-templated `BasicLfoModule<Polyphony>` that follows the same lifecycle and owns five visible controls: Frequency, Shape, Phase Offset, Skew, and Exponent.
- Add the parameter mapping needed for multiplicative exponent values centered at one.
- Replace the miniapp's ad hoc LFO source with the module and expose all five LFO parameters in the slot.

**Non-Goals:**

- No audio-rate anti-aliasing or BLEP behavior for LFO output.
- No separate envelope, sample-and-hold, tempo sync, or clocked LFO feature.
- No generalized module graph framework beyond the established module registration/input/process/UI-state pattern.
- No change to the VCO module's oscillator math or parameter meanings except for the module type/name and polyphony generalization.

## Decisions

1. Keep LFO shape math in DSP processors, not in the miniapp.

   `LFOShape` is a reusable stateless processor with an `Input` struct. It performs the pure shape computation:
   `Pow(Shape(shape, Tri(PD(skew, wrap(inPhase + phaseOffset)))), exponent)`.
   `PD` runs before `Tri` so skew is a phase-domain timing distortion rather than a symmetric amplitude distortion.
   This makes the math testable without parameters, banks, pages, JUCE, or the miniapp.

   Alternative considered: leave `Tri`, `Shape`, and `PD` as free helpers in the miniapp. That would preserve the current leak between demo app and DSP behavior and would not give modules a reusable processor.

2. Use the existing incrementer contract for `BasicLFOProcessor`.

   The processor owns an `Incrementer`, receives frequency in cycles per sample, processes one sample by advancing the incrementer, and passes the wrapped phase to `LFOShape`. It records scope output and top markers using the same holder pattern as `WavetableVco`, but its UI state type is LFO-specific.

   Alternative considered: embed phase advancement inside the module. That would make the LFO module less reusable and repeat the pre-module VCO pattern.

3. Generalize module polyphony at the type level.

   The existing VCO module should become `WavetableVcoModule<Polyphony>`, with `Polyphony` driving array sizes, input/UI-state shapes, output/source float counts, scope holder assignment, color assignment, and modulation-source pointer registration. `BasicLfoModule<Polyphony>` should follow the same pattern. The miniapp's duophonic patch then uses `WavetableVcoModule<2>` and `BasicLfoModule<2>` rather than special-purpose duophonic module types.

   Alternative considered: keep the VCO module fixed to two voices and make only the LFO module polyphonic. That creates two module patterns immediately and encourages future fixed-polyphony modules. The better pattern is to generalize the existing VCO module and copy that improved shape.

4. Publish one LFO modulation source from the miniapp's two-voice LFO instance.

   `BasicLfoModule<Polyphony>` owns one `BasicLFOProcessor` per voice. It adds a deterministic per-voice phase stagger of `voiceIx / (2 * Polyphony)` cycles to the mapped Phase Offset parameter before calling each processor, so `BasicLfoModule<2>` preserves the old miniapp's quarter-cycle voice 1 separation while still scaling predictably to higher polyphony. In the miniapp, `BasicLfoModule<2>` publishes one pointer-backed modulation source whose per-voice values are already unipolar `[0, 1]`.

   Alternative considered: publish two LFO modulation sources, direct and swapped, like the VCO. The current patch only has one LFO modulator slot; preserving that topology avoids broad modulation-view and patch-migration churn.

5. Add a centered bipolar exponential parameter helper.

   Existing two-endpoint `GetBipolarExponential` returns signed values and maps the center to zero. The LFO exponent needs positive multiplicative behavior from a signed bipolar knob: `-1 -> 0.2`, `0 -> 1`, `1 -> 5`, with geometric interpolation from left to center and center to right. The parameter layer should expose this as a reusable left/center/right helper that reads `Parameter::Get(voiceIx)`. The exponent parameter itself should be bipolar for UI/editing behavior, but the module should receive the positive natural exponent.

   Alternative considered: compute `pow(5, manager.GetBipolarLinear(1, voice, id))` directly in the module. That would work, but the user specifically asked for the parameter class/manager to expose this mapping if it does not already exist, and the helper is reusable for future multiplicative controls.

6. Use `x - floor(x)` for phase wrapping in the LFO path.

   The LFO formula and processor should use explicit modulo-one wrapping. This matches the existing `Incrementer::WrappedPhase` behavior and avoids `fmod` edge cases for negative values.

## Risks / Trade-offs

- Patch compatibility: existing patches save `LFO Speed`; the new module registers `LFO Frequency` plus four new controls. Value-only patch load ignores missing saved parameters, so old LFO speed values may not map automatically. Mitigation: choose stable names and defaults intentionally, and optionally add a follow-up migration if preserving old speed patches matters.
- Bank capacity: the current miniapp slot has four physical encoders while the requested LFO page has five parameters. Mitigation: expand the miniapp slot/profile visible encoder count to five and add tests that both VCO and LFO banks route correctly.
- Scope ownership: VCO and LFO traces can share one `ScopeWriter` only if channels are reserved consistently. Mitigation: expand the miniapp scope writer to four channels for the two VCO and two LFO traces, reserve explicit LFO channels during miniapp init, and keep the LFO component reading only `BasicLFOProcessor::UIState`.
- Formula boundaries: `Shape` and `PD` have singular endpoints if implemented naively at exact skew/shape extremes. Mitigation: clamp denominators or branch exact endpoints so outputs remain finite and in `[0, 1]`.
- Template placement: `WavetableVcoModule<Polyphony>` and `BasicLfoModule<Polyphony>` cannot remain ordinary out-of-line definitions in `Modules.cpp` without explicit instantiations for every supported polyphony. Mitigation: move template definitions into the public module header or keep only non-template helpers in `Modules.cpp`, and test at polyphony values other than two.
