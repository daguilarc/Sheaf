## ADDED Requirements

### Requirement: sdsp-17 — Scope: floating-point reader sampling
WHEN waveform scope samples are read through a scope reader, THE synth DSP system SHALL accept floating-point x-sample positions, SHALL preserve those positions until the final interpolated scope-writer read, and SHALL not expose an integer x-sample sampling API as the reader contract.

#### Scenario: Floating-point reader sample interpolates within aligned span
- **WHEN** a scope reader receives a floating-point x-sample coordinate between two reader x samples
- **THEN** it reads the corresponding fractional source index from the scope writer
- **AND** the returned value is interpolated between adjacent stored scope samples rather than equal to the lower integer x sample

#### Scenario: Integer conversion is deferred to buffer interpolation
- **WHEN** a scope reader maps a floating-point x-sample coordinate to the captured scope buffer
- **THEN** integer indexes are derived only for the adjacent source samples used by linear interpolation
- **AND** the fractional component is used to blend those adjacent samples

#### Scenario: Floating-point sampling respects cycle stitch
- **WHEN** a scope reader stitches the latest partial cycle to previous marker history
- **THEN** floating-point x-sample coordinates before and after the transfer boundary are mapped using the same cycle segments as the continuous reader coordinate system
- **AND** the transfer boundary calculation does not force earlier integer truncation of the source read index

#### Scenario: Transfer boundary remains floating point
- **WHEN** UI code asks a scope reader for the transfer x-sample position
- **THEN** the reader returns the floating-point transfer boundary used by sampling
- **AND** any rounding for marker drawing happens outside the reader sampling contract

### Requirement: sdsp-18 — JUCE waveform rendering: fractional scope reads
WHEN JUCE waveform rendering draws a scope path from a scope reader, THE synth DSP system SHALL pass each render point's floating-point scope x-sample coordinate to the scope reader and SHALL avoid casting that coordinate to an integer before sampling.

#### Scenario: Path drawer preserves floating-point render sample
- **WHEN** `PathDrawer::DrawScopePath` computes a render point whose scope x-sample coordinate is fractional
- **THEN** it samples the scope reader with that floating-point coordinate
- **AND** the resulting path y value reflects interpolated scope data rather than the nearest lower integer sample
