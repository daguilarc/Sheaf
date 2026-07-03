## RENAMED Requirements

- FROM: `### Requirement: smod-5 — Dual wavetable VCO module`
- TO: `### Requirement: smod-5 — Wavetable VCO module`

## MODIFIED Requirements

### Requirement: smod-5 — Wavetable VCO module
WHEN the wavetable VCO module is implemented, THE synth module system SHALL provide a `WavetableVcoModule<Polyphony>` module containing one default wavetable VCO processor per voice, registering Tune, Phase, Shape, and Volume parameters in that visible order, mapping Tune exponentially from 32 Hz to 3000 Hz, mapping Phase unipolar-linearly from `0` to `1` cycle of phase offset, mapping Shape linearly to wavetable position, mapping Volume unipolar-linearly from `0` to `1` gain, and publishing per-voice raw audio outputs, normalized direct/swapped modulation-source floats, and VCO waveform UI state.

#### Scenario: Wavetable VCO registers four parameters
- **WHEN** the wavetable VCO module registers parameters with prefix `Osc`
- **THEN** the manager contains effective parameters for `Osc Tune`, `Osc Phase`, `Osc Shape`, and `Osc Volume`
- **AND** the module stores all four parameter IDs

#### Scenario: Tune maps to oscillator frequency
- **WHEN** the Tune parameter is at normalized `0`
- **THEN** the module maps it to 32 Hz before converting to cycles per sample
- **WHEN** the Tune parameter is at normalized `1`
- **THEN** the module maps it to 3000 Hz before converting to cycles per sample

#### Scenario: Shape controls wavetable morph
- **WHEN** the Shape parameter changes
- **THEN** the module updates each VCO input's wavetable position from that parameter

#### Scenario: Phase maps to unipolar cycle offset
- **WHEN** the Phase parameter is at normalized `0`
- **THEN** the module maps it to `0` cycles of phase offset
- **WHEN** the Phase parameter is at normalized `1`
- **THEN** the module maps it to `1` cycle of phase offset

#### Scenario: Volume scales output
- **WHEN** the VCO processors produce raw bipolar samples
- **THEN** the module multiplies each voice output by the mapped Volume value

#### Scenario: Volume maps to unit gain
- **WHEN** the Volume parameter is at normalized `0`
- **THEN** the module maps it to zero gain
- **WHEN** the Volume parameter is at normalized `1`
- **THEN** the module maps it to unity gain

#### Scenario: Outputs are per voice
- **WHEN** `WavetableVcoModule<Polyphony>` processes its voices
- **THEN** every voice index from `0` through `Polyphony - 1` has a separate output available
- **AND** no mixed-output API is required for this module version

#### Scenario: Modulation source floats are normalized
- **WHEN** voice outputs are raw bipolar samples
- **THEN** the module's direct modulation-source floats contain `(output + 1) * 0.5` for each corresponding voice, clamped to `[0, 1]`
- **AND** the module's swapped modulation-source floats contain values from the reversed voice order, clamped to `[0, 1]`

#### Scenario: UI state contains VCO traces for every voice
- **WHEN** the module populates UI state after processing
- **THEN** the UI state exposes the waveform render data for every internal VCO processor

#### Scenario: Miniapp uses two-voice VCO instance
- **WHEN** the miniapp initializes its VCO module
- **THEN** it instantiates `WavetableVcoModule<2>`
- **AND** it preserves the existing two-voice direct and swapped VCO modulation-source behavior

### Requirement: smod-6 — Miniapp: module-backed VCO patch
WHEN the synth miniapp demonstrates the module-backed VCO and LFO patch, THE miniapp SHALL instantiate `WavetableVcoModule<2>` and `BasicLfoModule<2>`, register their parameters through the modules, register their visible controls to the VCO and LFO page banks through the modules, process both modules each sample, update modulation values through the group/manager modulation-source update system, and keep app-level code focused on page selection, MIDI/control routing, scene/gesture controls, and rendering.

#### Scenario: Miniapp no longer hand-registers VCO parameters
- **WHEN** the miniapp initializes the VCO page
- **THEN** Tune, Phase, Shape, and Volume are registered by `WavetableVcoModule<2>` rather than by ad hoc miniapp parameter creation code

#### Scenario: Miniapp bank uses VCO module registration
- **WHEN** the miniapp initializes the VCO bank
- **THEN** the VCO bank receives Tune, Phase, Shape, and Volume from `WavetableVcoModule<2>`'s bank registration function

#### Scenario: Miniapp bank uses LFO module registration
- **WHEN** the miniapp initializes the LFO bank
- **THEN** the LFO bank receives Frequency, Shape, Phase Offset, Skew, and Exponent from `BasicLfoModule<2>`'s bank registration function

#### Scenario: Miniapp updates modulators every sample
- **WHEN** the miniapp processes an audio sample
- **THEN** it calls the parameter manager or group update-mod-values API so pointer-backed VCO and LFO modulation sources are current for that sample

#### Scenario: Miniapp remains simple
- **WHEN** the miniapp processing loop runs
- **THEN** app-level code delegates VCO input mapping and processing to `WavetableVcoModule<2>`
- **AND** delegates LFO input mapping and processing to `BasicLfoModule<2>`
- **AND** does not duplicate those modules' parameter mapping formulas

## ADDED Requirements

### Requirement: smod-7 — Basic LFO module
WHEN the basic LFO module is implemented, THE synth module system SHALL provide a `BasicLfoModule<Polyphony>` module containing one `BasicLFOProcessor` per voice, registering Frequency, Shape, Phase Offset, Skew, and Exponent parameters in that visible order, mapping Frequency exponentially from `0.1` Hz to `1000` Hz before converting to cycles per sample, mapping Shape and Skew unipolar-linearly from `0` to `1`, mapping Phase Offset unipolar-linearly from `0` to `1` and adding a deterministic per-voice phase stagger of `voiceIx / (2 * Polyphony)` cycles, mapping Exponent from signed bipolar `-1 -> 0.2`, `0 -> 1`, and `1 -> 5` through the centered bipolar exponential helper, and publishing per-voice unipolar output values and LFO waveform UI state.

#### Scenario: Basic LFO registers five parameters
- **WHEN** the basic LFO module registers parameters with prefix `LFO`
- **THEN** the manager contains effective parameters for `LFO Frequency`, `LFO Shape`, `LFO Phase Offset`, `LFO Skew`, and `LFO Exponent`
- **AND** the module stores all five parameter IDs

#### Scenario: Frequency maps to LFO cycles per sample
- **WHEN** the Frequency parameter is at normalized `0`
- **THEN** the module maps it to `0.1` Hz before converting to cycles per sample
- **WHEN** the Frequency parameter is at normalized `1`
- **THEN** the module maps it to `1000` Hz before converting to cycles per sample

#### Scenario: Shape maps to shape processor input
- **WHEN** the Shape parameter changes
- **THEN** the module updates each LFO processor input's shape value from that parameter

#### Scenario: Phase offset maps to cycle offset
- **WHEN** the Phase Offset parameter is at normalized `0`
- **THEN** the module maps it to `0` cycles of phase offset
- **WHEN** the Phase Offset parameter is at normalized `1`
- **THEN** the module maps it to `1` cycle of phase offset

#### Scenario: Per-voice phase stagger preserves two-voice separation
- **WHEN** `BasicLfoModule<2>` maps inputs for voice `0` and voice `1`
- **THEN** voice `0` receives the mapped Phase Offset parameter plus `0` cycles
- **AND** voice `1` receives the mapped Phase Offset parameter plus `0.25` cycles

#### Scenario: Skew maps to phase distortion input
- **WHEN** the Skew parameter is at normalized `0.5`
- **THEN** the module maps it to the phase-distortion identity breakpoint
- **WHEN** the Skew parameter changes
- **THEN** the module updates each LFO processor input's phase-distortion skew value from that parameter

#### Scenario: Exponent maps geometrically around one
- **WHEN** the Exponent parameter is at signed bipolar `-1`
- **THEN** the module maps it to `0.2`
- **WHEN** the Exponent parameter is at signed bipolar `0`
- **THEN** the module maps it to `1`
- **WHEN** the Exponent parameter is at signed bipolar `1`
- **THEN** the module maps it to `5`

#### Scenario: Outputs are per voice
- **WHEN** `BasicLfoModule<Polyphony>` processes its voices
- **THEN** every voice index from `0` through `Polyphony - 1` has a separate unipolar `[0, 1]` output available
- **AND** no mixed-output API is required for this module version

#### Scenario: Modulation source floats are address-stable
- **WHEN** the module registers its LFO modulation source with a parameter group
- **THEN** the group stores pointers to the module's per-voice output source floats
- **AND** manager or group modulation updates copy those floats into the flat modulator values

#### Scenario: LFO modulation source label is shape-neutral
- **WHEN** the module registers its LFO modulation source with a parameter group
- **THEN** the source metadata name does not describe the source as sine-only
- **AND** the source remains identifiable as an LFO modulation source

#### Scenario: UI state contains LFO traces
- **WHEN** the module populates UI state after processing
- **THEN** the UI state exposes the waveform render data for each internal LFO processor

#### Scenario: Module lifecycle follows reusable pattern
- **WHEN** the basic LFO module is registered, bank-mapped, given input, processed, and asked for UI state
- **THEN** it follows the same registration-once, stored-parameter-ID, bank-capacity validation, natural-input mapping, arbitrary-polyphony array sizing, and UI-state publication pattern as `WavetableVcoModule<Polyphony>`

#### Scenario: Miniapp uses two-voice LFO instance
- **WHEN** the miniapp initializes its LFO module
- **THEN** it instantiates `BasicLfoModule<2>`
- **AND** it registers that module's per-voice output floats as the miniapp's third modulator
