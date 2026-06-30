## ADDED Requirements

### Requirement: sdsp-19 — Scope: fractional top markers
WHEN oscillator top crossings are recorded for waveform scope alignment, THE synth DSP system SHALL preserve the fractional writer position of the crossing rather than rounding the marker to a whole sample index.

#### Scenario: Incrementer reports top offset
- **WHEN** an incrementer advances from phase `0.75` by frequency `0.5`
- **THEN** it reports a top crossing
- **AND** the top crossing offset is `0.5` within the processed sample

#### Scenario: Scope writer stores fractional start marker
- **WHEN** a scope writer records a start marker with offset `0.25` at writer index `10`
- **THEN** readers created from that marker align to writer position `10.25`

#### Scenario: VCO records fractional top marker
- **WHEN** a VCO processes a sample whose incrementer crosses top halfway between the previous sample and current post-increment sample
- **THEN** its scope writer records the start marker at the previous writer index plus `0.5`

#### Scenario: Reader alignment uses fractional marker history
- **WHEN** a scope reader aligns a partial latest cycle to previous marker history
- **THEN** its transfer boundary and source reads are computed from fractional marker positions without converting markers to integer sample indexes
