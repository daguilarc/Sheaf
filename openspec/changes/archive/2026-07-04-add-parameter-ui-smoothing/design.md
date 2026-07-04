## Context

The synth parameter system currently stores the smoothed ingredients of a normalized parameter value: center, per-voice center scale, normalization offset, and per-voice modulation depths. `Parameter::Get(voiceIx)` evaluates those ingredients with the group's current modulator row on demand. Manager mapping helpers then map that instantaneous normalized value into natural DSP units.

That is compact, but it makes UI publication chase audio-rate modulation directly. Encoder components repaint far below the audio sample rate, so fast modulation aliases visually as unstable indicator positions. The change also clarifies a modular timing model: module outputs may modulate other module inputs, including cycles such as VCO-to-LFO style routing, so modulation should be sampled once per sample with a clean one-sample delay rather than trying to impose a global "compute all modulators first" order.

## Goals / Non-Goals

**Goals:**

- Split instantaneous raw normalized evaluation from the cached value used by DSP mapping helpers.
- Make `ProcessLite` the per-sample sampling point for normalized knob values.
- Formalize one-sample modulation delay when modulators are updated after a module consumes mapped parameter values.
- Add cheap per-sample UI smoothing state so UI renderers can display stable centers and modulation spread.
- Preserve the existing no-allocation/no-graph-traversal audio-rate constraints.

**Non-Goals:**

- Do not redesign module scheduling or attempt feedback-free topological modulation ordering.
- Do not move module-owned DSP processing into the parameter manager.
- Do not add new third-party DSP, UI, or statistics dependencies.
- Do not remove min/max modulation range arcs; the smoothed display values augment the existing UI range data.

## Decisions

1. Rename `Parameter::Get` to `Parameter::GetRaw` for internal raw evaluation.

   The current `Get(voiceIx)` expression becomes `GetRaw(voiceIx)`. Recursive modulation-depth computation continues to use that raw path because it is computing target depths from the current parameter graph state, not consuming the cached DSP input value.

   Alternative considered: make all readers use only the cache. That risks stale values during `ComputeAtDepth` unless target computation learns about cache refresh ordering.

2. Cache per-voice knob values in `ProcessLite`.

   After `ProcessLite` slews center, center scale, normalization offset, min/max, and depths, it evaluates the raw normalized value for each voice and stores it in a per-voice `currentKnobValues` arena. Mapping helpers read those cached values. Construction and snap-to-target paths seed the cache from the raw value so mapped helpers are defined before the first steady-state `ProcessLite`. This keeps mapped DSP reads cheap and makes the per-sample sampling instant explicit.

   Alternative considered: leave mapping helpers as raw expression readers and only add UI smoothing. That would reduce implementation churn but keep the ambiguous `Get` meaning and leave no single sampled value for UI smoothing to track.

3. Accept and specify one-sample modulation delay.

   The runtime and miniapp already expect app code to call `ProcessLite` per sample before mapped parameter reads. In modular routing, some module outputs become later modulator table values, so updates performed after module processing are intentionally consumed by the next sample's `ProcessLite` cache refresh.

   Alternative considered: require all modulation sources to be updated before every mapped read. That does not compose cleanly with feedback-like modular patches.

4. Track UI center and spread with per-group EMA alphas.

   Each parameter stores per-voice `uiCenterValue` and `uiSpreadSquared` values. Every `ProcessLite` call updates `uiCenterValue` from the cached knob value using a group-owned visual smoothing alpha, then updates `uiSpreadSquared` from the squared residual between the cached knob value and the updated UI center using a second group-owned alpha. UI state publishes the smoothed center and `sqrt(uiSpreadSquared)` as spread. Switch/discrete parameters publish zero spread so renderer blur stays reserved for continuous modulation.

   Alternative considered: compute UI smoothing on the message thread from sparse UI snapshots. That aliases before smoothing sees the signal, so it cannot represent audio-rate modulation energy accurately.

5. Keep encoder blur rendering as a UI consumer of parameter UI state.

   Core synth state publishes center and spread without depending on JUCE. The JUCE encoder component can render the spread as a blur/cloud width around the center while continuing to use existing min/max arcs, colors, switch metadata, and connected/off state.

## Risks / Trade-offs

- Extra per-sample work for every processed parameter - Mitigation: the added work is one raw knob evaluation and two scalar EMA updates per voice, using preallocated arenas and no traversal; tests should cover expected per-frame call order.
- UI spread tuning may feel too narrow or too broad - Mitigation: publish RMS-style spread from core and leave visual width scaling to the encoder renderer.
- Cached mapping helpers can read stale values if callers skip `ProcessLite` - Mitigation: document and test that steady-state DSP mapping requires per-sample `ProcessLite` before mapped reads; construction and snap/load paths seed caches from raw values.
- API rename churn around `Get` - Mitigation: choose names that separate raw evaluation from cached DSP consumption, and update tests/modules in one pass.

## Migration Plan

1. Add storage and configuration fields behind the existing parameter/group allocation model.
2. Introduce explicit raw and cached read helpers, then update mapping helpers and recursive computation.
3. Update UI state and encoder renderer to consume smoothed center and spread.
4. Update tests for raw evaluation, cached mapping, one-sample delay, UI smoothing, and encoder rendering geometry.
5. Rollback is a straight revert of the parameter/UI state additions because no persistent patch format changes are introduced.

## Open Questions

None. The proposal intentionally accepts one-sample modulation delay for modular feedback-style routing.
