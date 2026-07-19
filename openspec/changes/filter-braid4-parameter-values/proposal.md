## Why

Braid 4 currently applies audio-rate parameter modulation directly to its cached knob values, including phase, which makes strong feedback modulation abrupt and provides no compile-time application seam between cache sampling and the downstream DSP/UI consumers. Parameter processing needs an explicit non-virtual two-phase contract so Braid 4 can low-pass selected cached values once and make the same modified values authoritative for both DSP mapping and UI state.

## What Changes

- Split parameter `ProcessLite` work into phase 1 (slew state and sample each voice's cached knob value) and phase 2 (derive UI display center/spread from the final cached value), while retaining `ProcessLite()` as the phase-1-then-phase-2 convenience path.
- Add an allocation-free way for compile-time-known application code to replace a phase-1 cached knob value before phase 2, without callbacks, virtual dispatch, or graph traversal.
- Extend the existing one-pole low-pass processor with a hot-path operation that accepts a caller-precomputed alpha, so one alpha can drive many independent filter states.
- In Braid 4, place one independent one-pole state on every top-level non-XY parameter voice owned by each of the four audible oscillators and four LFO oscillators, including the eight cutoff controls themselves and all 32 audible/LFO matrix entries; do not filter X/Y or recursively materialized modulation-depth parameters.
- Define oscillator ownership explicitly: voice `i` of Tune/Phase/Shape/Gain belongs to oscillator `i`; each monophonic Cutoff/Frequency parameter belongs to its numbered oscillator; and every matrix parameter in output row `i` belongs to oscillator `i`, regardless of input column, so each matrix entry uses its output oscillator's cutoff.
- **BREAKING** Replace each Braid VCO bank's four monophonic PM Index controls at positions `8..11` with per-oscillator modulation LPF Cutoff controls, exponentially mapped from `0.1 Hz` (100 mHz) to `20 kHz`, with the audible and LFO banks using the same natural range.
- Remove the separate PM-index multiplier from phase-offset calculation: each oscillator's phase input uses its filtered Phase value directly, while its cutoff control determines the shared alpha used by all filters owned by that oscillator.
- Preserve the normal parameter API behavior for all existing callers and preserve Braid 4's existing one-internal-sample matrix feedback timing.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `synth-parameter-modulation`: Define two-phase cached-knob processing, controlled cache replacement between phases, the unchanged convenience path, and top-level-only group phase traversal.
- `synth-dsp-classes`: Extend the existing one-pole low-pass contract with processing from a precomputed alpha.
- `synth-modules`: Replace Braid4VcoModule PM Index parameters with per-oscillator cutoff parameters and remove phase multiplication.
- `synth-braid-4`: Define Braid 4's per-oscillator filter ownership—including every matrix entry and the cutoff values themselves—excluded parameters, cutoff mapping, shared-alpha processing order, UI/DSP visibility, bank layout migration, and verification.

## Impact

- Public synth APIs: `Parameter`, `ParameterGroup`, `OnePoleLowPass`, and `Braid4VcoModule` parameter identifiers/input structures.
- Braid 4 audio hot path, parameter registration and labels, matrix parameter indexing, initialization/reset, persistence expectations, and headless/deadline coverage.
- Existing patches remain structurally loadable by parameter ID/order, but the four controls formerly interpreted as PM depth acquire cutoff semantics.
- No new dependency, allocation, runtime polymorphism, or dynamic per-sample ownership lookup is introduced.
