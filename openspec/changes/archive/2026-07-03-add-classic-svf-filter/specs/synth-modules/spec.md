## ADDED Requirements

### Requirement: smod-8 — Classic SVF module
WHEN two-pole filter behavior is needed in a reusable synth module, THE synth module system SHALL provide a `ClassicSvfModule<Polyphony>` module containing one classic state-variable filter processor per voice, registering Cutoff, Resonance, and Blend parameters in that visible order, registering Blend as a bipolar-range parameter, mapping Cutoff exponentially from `20` Hz to `20000` Hz before converting to cycles per sample, mapping Resonance exponentially from `0.5` to `5.5`, mapping Blend as a bipolar linear value from `-1` to `1`, accepting a live audio input sample per voice through an explicit voice-input API separate from parameter mapping, and publishing per-voice filtered outputs plus filter UI state for every internal processor.

#### Scenario: Classic SVF registers three parameters
- **WHEN** the classic SVF module registers parameters with prefix `Filter`
- **THEN** the manager contains effective parameters for `Filter Cutoff`, `Filter Resonance`, and `Filter Blend`
- **AND** the module stores all three parameter IDs

#### Scenario: Cutoff maps to normalized filter frequency
- **WHEN** the Cutoff parameter is at normalized `0`
- **THEN** the module maps it to `20` Hz before converting to cycles per sample
- **WHEN** the Cutoff parameter is at normalized `1`
- **THEN** the module maps it to `20000` Hz before converting to cycles per sample

#### Scenario: Resonance maps exponentially
- **WHEN** the Resonance parameter is at normalized `0`
- **THEN** the module maps it to `0.5`
- **WHEN** the Resonance parameter is at normalized `1`
- **THEN** the module maps it to `5.5`

#### Scenario: Blend maps to bipolar filter mode control
- **WHEN** the Blend parameter is at bipolar value `-1`
- **THEN** the module maps it to `-1`
- **AND** the Blend parameter is registered with bipolar range metadata
- **WHEN** the Blend parameter is at bipolar value `0`
- **THEN** the module maps it to `0`
- **WHEN** the Blend parameter is at bipolar value `1`
- **THEN** the module maps it to `1`

#### Scenario: Voice input API supplies live audio samples
- **WHEN** a caller provides sample `A` to voice `0` and sample `B` to voice `1` through `SetVoiceInput` or an equivalent explicit voice-input API
- **THEN** the module writes those samples into the corresponding filter processor inputs
- **AND** `SetInput(ParameterManager&)` remains responsible for parameter-derived cutoff, resonance, and blend values rather than live audio samples

#### Scenario: Module processes each voice independently
- **WHEN** `ClassicSvfModule<Polyphony>` processes its voices
- **THEN** every voice index from `0` through `Polyphony - 1` receives that voice's input sample
- **AND** every voice index has a separate filtered output available

#### Scenario: UI state contains filter responses for every voice
- **WHEN** the module populates UI state after processing
- **THEN** the UI state exposes transfer-function-capable filter UI state for every internal filter processor

#### Scenario: Module lifecycle follows reusable pattern
- **WHEN** the classic SVF module is registered, bank-mapped, given input, and processed
- **THEN** it follows the same registration-once, stored-parameter-ID, bank-capacity validation, natural-input mapping, arbitrary-polyphony array sizing, and UI-state publication pattern as the existing VCO and LFO modules
