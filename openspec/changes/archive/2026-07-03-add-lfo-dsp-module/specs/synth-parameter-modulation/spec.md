## ADDED Requirements

### Requirement: spm-64 — Parameters: centered bipolar exponential mapping
WHEN modules map signed bipolar parameter values into positive multiplicative natural units around a center, THE synth parameter modulation system SHALL provide a manager-level helper that reads a parameter by voice ID and parameter ID and returns a positive exponential value where signed `-1` maps to the supplied left value, signed `0` maps to the supplied center value, and signed `1` maps to the supplied right value.

#### Scenario: Centered bipolar exponential reaches left endpoint
- **WHEN** a signed bipolar parameter value is `-1`
- **AND** code calls the centered bipolar exponential helper with left `0.2`, center `1`, and right `5`
- **THEN** the helper returns `0.2` within numeric tolerance

#### Scenario: Centered bipolar exponential maps center
- **WHEN** a signed bipolar parameter value is `0`
- **AND** code calls the centered bipolar exponential helper with left `0.2`, center `1`, and right `5`
- **THEN** the helper returns `1` within numeric tolerance

#### Scenario: Centered bipolar exponential reaches right endpoint
- **WHEN** a signed bipolar parameter value is `1`
- **AND** code calls the centered bipolar exponential helper with left `0.2`, center `1`, and right `5`
- **THEN** the helper returns `5` within numeric tolerance

#### Scenario: Centered bipolar exponential interpolates geometrically on each side
- **WHEN** a signed bipolar parameter value is `-0.5`
- **AND** code calls the centered bipolar exponential helper with left `0.25`, center `2`, and right `32`
- **THEN** the helper returns `2 * sqrt(0.25 / 2)` within numeric tolerance
- **WHEN** a signed bipolar parameter value is `0.5`
- **THEN** the helper returns `2 * sqrt(32 / 2)` within numeric tolerance

#### Scenario: Centered bipolar exponential uses parameter Get
- **WHEN** a mapped parameter has current modulation applied for a voice
- **THEN** the centered bipolar exponential helper maps the parameter's audio-rate `Get(voiceIx)` value rather than only the scene center value

#### Scenario: Invalid centered values are rejected
- **WHEN** code calls the centered bipolar exponential helper with a left, center, or right value less than or equal to `0`
- **THEN** the helper raises a coding error rather than returning an invalid mapping

### Requirement: spm-65 — Parameters: signed bipolar zero-based exponential mapping
WHEN modules map signed bipolar parameter values into signed zero-centered natural units with exponential magnitude, THE synth parameter modulation system SHALL provide a manager-level helper that reads a parameter by voice ID and parameter ID and returns `sign(knob) * ZeroBasedExponential(abs(knob), maxAbsValue, midpointAbsValue)` for signed knob values in `[-1, 1]`.

#### Scenario: Signed zero-based bipolar exponential reaches endpoints
- **WHEN** a signed bipolar parameter value is `-1`
- **AND** code calls the signed zero-based bipolar exponential helper with max absolute value `1` and midpoint absolute value `0.1`
- **THEN** the helper returns `-1` within numeric tolerance
- **WHEN** the signed bipolar parameter value is `1`
- **THEN** the helper returns `1` within numeric tolerance

#### Scenario: Signed zero-based bipolar exponential reaches midpoints
- **WHEN** a signed bipolar parameter value is `-0.5`
- **AND** code calls the signed zero-based bipolar exponential helper with max absolute value `1` and midpoint absolute value `0.1`
- **THEN** the helper returns `-0.1` within numeric tolerance
- **WHEN** the signed bipolar parameter value is `0.5`
- **THEN** the helper returns `0.1` within numeric tolerance

#### Scenario: Signed zero-based bipolar exponential maps center to zero
- **WHEN** a signed bipolar parameter value is `0`
- **AND** code calls the signed zero-based bipolar exponential helper
- **THEN** the helper returns `0` within numeric tolerance
