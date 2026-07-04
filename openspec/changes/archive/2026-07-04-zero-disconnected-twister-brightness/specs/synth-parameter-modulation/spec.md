## ADDED Requirements

### Requirement: spm-68 — MIDI output: Twister unbacked encoder brightness
WHEN MF Twister encoder MIDI output is processed, THE synth parameter modulation system SHALL process only configured Twister output mappings, SHALL emit live feedback for mapped encoders whose target slot/position has a connected visible UI cell, SHALL emit MF Twister brightness-off animation values plus blank value, color, and indicator position feedback for mapped encoders whose target slot/position has no connected visible UI cell, and SHALL ignore physical encoders that have no configured output mapping.

#### Scenario: Unused slot position blanks Twister brightness
- **WHEN** a Twister output mapping targets a realized slot position whose visible cell is disconnected or empty
- **THEN** the Twister output processor emits channel `2` RGB brightness-off value `17` for that encoder
- **AND** it emits channel `5` indicator brightness-off value `65` for that encoder
- **AND** it emits the controller-specific blank value, color, and indicator position feedback for that encoder

#### Scenario: Mapping beyond visible-cell capacity blanks Twister brightness
- **WHEN** a Twister output mapping targets a slot or position outside the current `ParameterManager::UIState` slot/cell capacity
- **THEN** the Twister output processor treats that mapped hardware encoder as having blank feedback state instead of skipping it as an unstable UI-state read
- **AND** it emits channel `2` RGB brightness-off value `17` for that encoder
- **AND** it emits channel `5` indicator brightness-off value `65` for that encoder
- **AND** it emits the controller-specific blank value, color, and indicator position feedback for that encoder

#### Scenario: Unmapped Twister encoder is ignored
- **WHEN** a Twister physical encoder has no configured output mapping
- **THEN** the Twister output processor emits no feedback for that physical encoder
- **AND** no blank feedback is required for that physical encoder

#### Scenario: Disconnected Twister brightness remains debounced
- **WHEN** a mapped Twister encoder is processed as disconnected and no relevant UI state or output cache reset occurs before the next process call
- **THEN** the Twister output processor does not emit duplicate brightness-off feedback on the next process call

## MODIFIED Requirements

### Requirement: spm-35 — MIDI output: Twister encoder feedback
WHEN Twister encoder MIDI output is processed, THE synth parameter modulation system SHALL provide a Twister output processor that maps configured slot positions to controller CCs and emits separate CC feedback for encoder value, parameter color, RGB brightness, voice-0 indicator position, and indicator brightness using the MIDI Fighter Twister manual and Smart Grid Twister channel conventions.

#### Scenario: Twister value feedback uses channel 0
- **WHEN** a mapped connected cell has voice-0 normalized value `0.5`
- **THEN** the Twister output processor emits a channel `0` CC for that cell with a value near `64`

#### Scenario: Twister color feedback uses channel 1
- **WHEN** a mapped connected cell's parameter-level color changes
- **THEN** the Twister output processor emits a channel `1` CC for that cell using the Twister color code derived from synth color

#### Scenario: Twister brightness feedback uses channel 2
- **WHEN** a mapped connected cell has UI-state brightness `1.0`
- **THEN** the Twister output processor emits a channel `2` CC for that cell using the Smart Grid full-brightness animation value

#### Scenario: Twister brightness feedback follows UI state
- **WHEN** a mapped connected cell has UI-state brightness `0.5`
- **THEN** the Twister output processor emits a brightness animation value derived from `17 + 0.5 * 30`

#### Scenario: Twister disconnected cell blanks brightness
- **WHEN** a mapped cell is disconnected
- **THEN** the Twister output processor emits RGB brightness-off value `17` and indicator brightness-off value `65` for that cell rather than applying visible brightness

#### Scenario: Twister indicator position uses voice-0 value
- **WHEN** a mapped connected cell has voice-0 normalized value `0.25`
- **THEN** the Twister output processor emits ring or indicator position feedback for that cell with a value near `32`

#### Scenario: Twister indicator brightness follows UI state
- **WHEN** a mapped connected cell has UI-state brightness `0.5`
- **THEN** the Twister output processor emits indicator brightness value derived from `65 + 0.5 * 30`

#### Scenario: Twister color helper uses full hue range
- **WHEN** a saturated synth color is converted to an MF Twister color code
- **THEN** the result is a deterministic nonzero value in the manual hue range `1..126`
- **AND** the mapping is verified against the Smart Grid `RGB2MFTHue` shape before implementation completion
