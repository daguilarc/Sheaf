## MODIFIED Requirements

### Requirement: sdsp-6 — Filters and tanh: one-pole DSP utilities
WHEN basic filter and saturation DSP is implemented, THE synth DSP system SHALL provide one-pole low-pass and high-pass filters with normalized-frequency alpha helpers and static transfer-function helpers; SHALL let the low-pass process either a cutoff-bearing input or a scalar value with a caller-precomputed alpha in `[0,1]`; SHALL let the low-pass reset its output state deterministically; and SHALL provide a tanh saturator using the Smart Grid cubic rational approximation clamped to `[-1, 1]`.

#### Scenario: Low-pass converges toward input
- **WHEN** a one-pole low-pass filter processes repeated constant input with a valid cutoff
- **THEN** its output monotonically approaches that input within numeric tolerance

#### Scenario: Precomputed alpha matches cutoff path
- **WHEN** one low-pass instance processes `(value, cutoff)` and another processes the same value with `AlphaFromNatFreq(cutoff)`
- **THEN** both produce the same output within numeric tolerance
- **AND** the precomputed-alpha path performs no exponential or cutoff-to-alpha conversion

#### Scenario: One alpha drives independent states
- **WHEN** a caller computes one valid alpha and supplies it to multiple low-pass instances
- **THEN** every instance advances its own output state with `output += alpha * (value - output)`
- **AND** no output state is shared between instances

#### Scenario: Low-pass reset seeds output
- **WHEN** a caller resets a low-pass to scalar value `v`
- **THEN** the next processing step begins from output state `v`

#### Scenario: High-pass rejects constant input
- **WHEN** a one-pole high-pass filter processes repeated constant input with a valid cutoff
- **THEN** its output approaches zero within numeric tolerance

#### Scenario: Tanh approximation clamps
- **WHEN** the tanh saturator processes large positive or negative inputs
- **THEN** its output remains in `[-1, 1]`

#### Scenario: Tanh approximation matches cubic rational form
- **WHEN** the tanh saturator processes an unclipped input `x`
- **THEN** the raw approximation is computed as `x * (27 + x * x) / (27 + 9 * x * x)` before clamping or optional normalization
