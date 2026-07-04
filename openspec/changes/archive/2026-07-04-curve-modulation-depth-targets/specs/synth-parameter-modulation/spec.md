## ADDED Requirements

### Requirement: spm-67 — Compute: curved modulation-depth target mapping
WHEN `Parameter::Compute()` calculates per-voice modulation depths from recursively computed modulation-depth parameters, THE synth parameter modulation system SHALL convert each existing depth parameter's signed bipolar knob value into a raw depth target with a bipolar zero-based exponential curve before applying signed depth normalization, using maximum absolute depth `1.0`, halfpoint absolute depth `0.125` at absolute knob travel `0.5`, and a precomputed mapping base derived from that maximum and halfpoint.

#### Scenario: Half-turn depth maps to one-eighth
- **WHEN** a modulation-depth parameter's recursively computed signed knob value is `0.5`
- **THEN** the parent parameter's raw target depth for that modulator is `0.125` within numeric tolerance
- **WHEN** the modulation-depth parameter's recursively computed signed knob value is `-0.5`
- **THEN** the parent parameter's raw target depth for that modulator is `-0.125` within numeric tolerance

#### Scenario: Center and extremes remain anchored
- **WHEN** a modulation-depth parameter's recursively computed signed knob value is `0`
- **THEN** the parent parameter's raw target depth for that modulator is `0` within numeric tolerance
- **WHEN** the modulation-depth parameter's recursively computed signed knob value is `1`
- **THEN** the parent parameter's raw target depth for that modulator is `1` within numeric tolerance
- **WHEN** the modulation-depth parameter's recursively computed signed knob value is `-1`
- **THEN** the parent parameter's raw target depth for that modulator is `-1` within numeric tolerance

#### Scenario: Curved depth participates in existing normalization
- **WHEN** two modulation-depth parameters on a unipolar parent have recursively computed signed knob values `1.0` and `-1.0`
- **THEN** their curved raw depth targets are `1.0` and `-1.0`
- **AND** the parent parameter normalizes those effective depths to `0.5` and `-0.5`
- **AND** derives the normalization offset from the normalized negative effective depth

#### Scenario: Audio-rate modulation remains a linear dot product
- **WHEN** a modulation-depth parameter's recursively computed signed knob value is `0.5`
- **AND** the modulator value for the same voice is `0.8`
- **THEN** the modulation contribution from that route is `0.8 * 0.125` before final range clamping
- **AND** no exponential mapping is applied to the modulator value itself
