## ADDED Requirements

### Requirement: sdsp-23 — Filters: classic two-pole state-variable filter
WHEN classic multimode filtering is needed, THE synth DSP system SHALL provide a JUCE-free stateful two-pole state-variable filter processor that accepts runtime input value, cutoff in cycles per sample, resonance, and blend, computes low-pass, band-pass, and high-pass outputs, publishes the final output as `low * max(-blend, 0) + high * max(blend, 0) + band * sqrt(1 - blend * blend)` with blend clamped to `[-1, 1]`, and provides UI-state publication through a transfer-function-capable UI state representing the current blended response.

#### Scenario: Blend selects low pass at negative endpoint
- **WHEN** the processor input blend is `-1`
- **THEN** the processor's final output equals its low-pass output within numeric tolerance
- **AND** the high-pass and band-pass blend amounts are zero

#### Scenario: Blend selects high pass at positive endpoint
- **WHEN** the processor input blend is `1`
- **THEN** the processor's final output equals its high-pass output within numeric tolerance
- **AND** the low-pass and band-pass blend amounts are zero

#### Scenario: Blend selects band pass at center
- **WHEN** the processor input blend is `0`
- **THEN** the processor's final output equals its band-pass output within numeric tolerance
- **AND** the low-pass and high-pass blend amounts are zero

#### Scenario: Filter behaves as a two-pole low pass
- **WHEN** the processor repeatedly processes a constant positive input with a valid cutoff, finite resonance, and blend `-1`
- **THEN** its final output converges toward that input within numeric tolerance

#### Scenario: Filter rejects invalid output under high resonance
- **WHEN** the processor processes finite input with cutoff in the supported audio range and high finite resonance such as `5.5`
- **THEN** its low-pass, band-pass, high-pass, and final outputs remain finite

#### Scenario: UI state publishes filter response inputs
- **WHEN** the processor populates its UI state after processing
- **THEN** the UI state contains UI-safe snapshots of the current filter coefficient or cutoff, resonance or damping, and blend values
- **AND** the UI does not need to mutate processor state to inspect them

#### Scenario: UI state implements blended transfer function
- **WHEN** a caller asks the filter UI state for `FrequencyResponse` or `TransferFunctionValue` at a normalized frequency
- **THEN** the returned response represents the same low/band/high blend law used for audio output
- **AND** the response is finite for valid normalized frequencies
