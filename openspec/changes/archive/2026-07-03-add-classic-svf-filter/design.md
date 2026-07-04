## Context

The synth project already has JUCE-free DSP primitives, reusable polyphonic modules, and a runtime-hosted miniapp that demonstrates a duophonic VCO/LFO patch. Filters currently stop at one-pole utilities; there is no reusable two-pole multimode filter processor or parameter-backed filter module. The new filter must fit the existing header-only module style, use `ParameterManager` mapping helpers, remain JUCE-free in core code, and add three visible VCO-page controls without disturbing runtime ownership boundaries.

## Goals / Non-Goals

**Goals:**

- Provide a classic two-pole state-variable filter processor that computes low, band, and high outputs and exposes the requested blend law:
  - `low_amt = max(-blend, 0)`
  - `high_amt = max(blend, 0)`
  - `band_amt = sqrt(1 - blend * blend)`
  - `output = low * low_amt + high * high_amt + band * band_amt`
- Provide filter `UIState` publication and transfer-function methods so the UI can visualize the current blended filter response from audio-thread snapshots.
- Provide `ClassicSvfModule<Polyphony>` with Cutoff, Resonance, and Blend parameters.
- Map Cutoff exponentially from 20 Hz to 20 kHz, Resonance exponentially from 0.5 to 5.5, and Blend linearly from -1 to 1.
- Wire the miniapp so the VCO page includes the three filter controls and the audible output is filtered per voice.
- Cover the processor, module, and miniapp behavior in the synth test suite.

**Non-Goals:**

- No new UI widgets, runtime shell behavior, MIDI profile model, patch format migration, or visual filter-response component.
- No stereo filter topology; the requested module is polyphonic by voice, matching the existing VCO/LFO modules.
- No change to existing VCO/LFO parameter semantics beyond adding filter controls to the VCO page.

## Decisions

1. Use a topology-preserving transform state-variable filter core.

   The processor will keep a stateful two-integrator SVF and compute low, band, and high outputs every sample. A TPT formulation is preferable to the older explicit Chamberlin update because it behaves better near high cutoff values and high resonance while preserving the classic state-variable low/band/high outputs. Cutoff input will be cycles per sample and clamped below Nyquist before coefficient calculation. Resonance will be interpreted as Q, with damping derived from `1 / resonance`.

   Alternative considered: a direct Chamberlin SVF using `2 * sin(pi * cutoff)` for the integrator coefficient. It is simpler, but less robust near the top of the requested frequency range and more sensitive to resonance.

2. Keep the requested blend law in the processor, not the module.

   The processor will own low/band/high state and final output calculation so standalone DSP tests can validate the blend behavior without parameter infrastructure. The module only maps normalized parameters into natural inputs and runs one processor per voice.

   Alternative considered: expose only low/band/high from the processor and do blend in `ClassicSvfModule`. That would make the module less reusable and duplicate blend behavior in future callers.

3. Publish UI state through the existing `TransferFunction` pattern.

   The SVF processor will include a nested `UIState` derived from `TransferFunction`, with atomics for the effective cutoff/coefficient, resonance/damping, and blend values needed to compute `FrequencyResponse` and `TransferFunctionValue`. `PopulateUIState` will copy audio-thread state into those atomics without handing the UI mutable DSP state. The transfer function should represent the same blended low/band/high mode that the audio output uses.

   Alternative considered: defer response visualization until a later UI feature. The existing filter contract already expects filter-like UI states to implement `TransferFunction`, and adding the snapshot now avoids a processor API churn later.

4. Register the filter as an ordinary module on the VCO page.

   `ClassicSvfModule<2>` will register after the VCO module in `MiniAppCore`, and `RegisterToBank(vcoBank, 4)` will map Cutoff, Resonance, and Blend to positions after Tune, Phase, Shape, and Volume. Blend will register as `RangeKind::Bipolar` so encoder display and detent behavior match its signed mode-control semantics. The miniapp's shared bank slot layout will expand from five to at least seven visible encoder positions so all VCO and filter controls are reachable. Because the VCO and LFO banks share that slot layout, the LFO page will still expose its five module-backed controls in positions 0 through 4, with any additional slot cells left unbound rather than changing LFO semantics. The `parameters_` vector and page metadata will include the filter parameters so patching, UI state, and control slewing follow existing paths.

   Alternative considered: replace existing VCO controls or create a separate filter page. The request explicitly asks for three new VCO-page parameters, so adding them after the current four VCO controls is the clearest fit.

5. Process the filter per voice before final output mix.

   Each sample, the miniapp will process VCO voices, call `ClassicSvfModule<2>::SetInput(manager)` to map filter parameters, call `SetVoiceInput(voiceIx, vcoModule.Output(voiceIx))` for each voice, process the filter module, then mix the filtered voice outputs to the device outputs. `SetInput(manager)` remains responsible only for parameter-derived natural units; it will map Blend with `GetBipolarLinear(1.0f)` because Blend is a signed bipolar parameter rather than a unipolar normalized control. `SetVoiceInput` supplies the live audio sample because this module is an audio processor rather than a pure source. VCO direct/swapped modulation sources remain based on raw VCO outputs unless a later change explicitly requests filter-derived modulators.

   Alternative considered: mix VCO voices first and run one mono filter. That would not match the requested polyphony-templated module and would collapse per-voice modulation behavior before filtering.

## Risks / Trade-offs

- High resonance can produce large peaks -> clamp invalid cutoff inputs, keep the TPT denominator bounded, and add finite-output tests for representative high-resonance settings.
- Expanding the VCO bank past four encoders may expose assumptions in UI or MIDI profiles -> update miniapp system tests to assert the VCO page exposes seven parameters and that existing VCO positions remain stable.
- The filter changes miniapp audio character at default settings -> choose defaults that are audible and stable, with Cutoff high enough to preserve current VCO output reasonably while still proving the filter path is active.
- Processor math choices affect exact response -> tests should assert contracts that matter to users (blend endpoints/center, DC rejection for high-pass, low-pass settling, finite high-resonance output) rather than brittle full transfer-function curves.
