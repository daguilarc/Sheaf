## ADDED Requirements

### Requirement: spm-60 — UI State: encoder brightness snapshot
WHEN visible parameter-cell UI state is populated for MIDI hardware feedback, THE synth parameter modulation system SHALL publish a per-cell atomic brightness value in `Parameter::UIState`, set connected cells to full brightness `1.0` unless another producer explicitly supplies a different normalized brightness, set disconnected cells to `0.0`, and load that value through the same stable revision snapshot protocol used for value and color feedback.

#### Scenario: Connected cell defaults to full brightness
- **WHEN** a connected parameter cell is populated into UI state
- **THEN** its brightness snapshot value is `1.0`

#### Scenario: Disconnected cell blanks brightness
- **WHEN** a visible cell is disconnected or empty
- **THEN** its brightness snapshot value is `0.0`

#### Scenario: Output snapshot reads stable brightness
- **WHEN** a MIDI output processor reads a mapped cell snapshot
- **THEN** the snapshot includes the cell brightness read under the same bounded revision check as the cell value, color, and indicator color

### Requirement: spm-61 — MIDI input: MF Twister side-button mapping
WHEN the default MF Twister side-button MIDI input is configured, THE synth parameter modulation system SHALL map the six side buttons captured as user-facing MIDI channel 4 CCs 8 through 13 to configurable system-message press and optional release associations, using zero-based `MidiControlAddress.channel = 3` internally, and SHALL emit the press message for nonzero CC values and the release message for zero CC values when configured.

#### Scenario: First side button press emits configured message
- **WHEN** an MF Twister side-button profile maps side button `0` to `MessageIn::SetShift(true)` on press
- **AND** the input processor receives `BasicMidi::CC(..., 3, 8, 127)`
- **THEN** it pushes the configured shift press message

#### Scenario: First side button release emits configured release
- **WHEN** an MF Twister side-button profile maps side button `0` to `MessageIn::SetShift(true)` on press and `MessageIn::SetShift(false)` on release
- **AND** the input processor receives `BasicMidi::CC(..., 3, 8, 0)`
- **THEN** it pushes the configured shift release message

#### Scenario: All six side-button CCs are available
- **WHEN** an MF Twister default profile is created
- **THEN** side-button indices `0` through `5` are addressable as zero-based channel `3` CCs `8` through `13`

#### Scenario: Unconfigured side button does not emit
- **WHEN** an MF Twister side-button association is omitted or has no press message configured by the profile builder
- **AND** the corresponding side-button CC is received
- **THEN** no system message is pushed for that button

### Requirement: spm-62 — MIDI controller profiles: default MF Twister profile
WHEN the default MF Twister MIDI controller profile is requested, THE synth parameter modulation system SHALL build a profile config and profile-created processors for row-major encoder turns, encoder presses, encoder output feedback, and six configurable side-button system-message associations on user-facing channel 4 CCs 8-13, without owning JUCE MIDI devices.

#### Scenario: Default MF Twister profile maps encoders
- **WHEN** the default MF Twister profile is created for slot `0`
- **THEN** encoder turn input uses zero-based channel `0`
- **AND** encoder pushbutton input uses zero-based channel `1`
- **AND** CCs `0..15` map to slot positions `0..15` in row-major order
- **AND** encoder output maps the same positions for value, color, brightness, indicator position, and indicator color feedback

#### Scenario: Default MF Twister profile exposes six side-button slots
- **WHEN** the default MF Twister profile is created
- **THEN** it exposes exactly six configurable side-button system-message associations
- **AND** those associations use zero-based channel `3` CCs `8..13`

#### Scenario: Profile factory builds MF Twister processors
- **WHEN** a profile config contains MF Twister encoder mappings and side-button system-message associations
- **THEN** the profile factory includes encoder input and system-button input in the input chain
- **AND** creates Twister encoder output for encoder value, color, brightness, indicator position, and indicator color feedback
- **AND** creates no side-button output processor for MF Twister side-button associations
- **AND** callers can invoke each output processor independently without an output chain

#### Scenario: Profile does not require all side buttons to be assigned
- **WHEN** a caller creates an MF Twister profile with fewer than six configured side-button messages
- **THEN** the profile remains valid
- **AND** only configured side buttons emit input messages

## MODIFIED Requirements

### Requirement: spm-35 — MIDI output: Twister encoder feedback
WHEN Twister encoder MIDI output is processed, THE synth parameter modulation system SHALL provide a Twister output processor that maps configured slot positions to controller CCs and emits separate CC feedback for encoder value, parameter color, brightness, voice-0 indicator position, and voice-0 indicator color using the MIDI Fighter Twister manual and Smart Grid Twister channel conventions.

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
- **THEN** the Twister output processor emits brightness value `0` for that cell rather than applying the connected-cell brightness formula

#### Scenario: Twister indicator position uses voice-0 value
- **WHEN** a mapped connected cell has voice-0 normalized value `0.25`
- **THEN** the Twister output processor emits ring or indicator position feedback for that cell with a value near `32`

#### Scenario: Twister indicator color uses voice-0 indicator color
- **WHEN** a mapped connected cell's voice-0 indicator color changes
- **THEN** the Twister output processor emits indicator or ring color feedback for that cell using the Twister color code derived from the voice-0 indicator color

#### Scenario: Twister color helper uses full hue range
- **WHEN** a saturated synth color is converted to an MF Twister color code
- **THEN** the result is a deterministic nonzero value in the manual hue range `1..126`
- **AND** the mapping is verified against the Smart Grid `RGB2MFTHue` shape before implementation completion

### Requirement: spm-36 — MIDI output: Wrld.Bldr encoder feedback
WHEN Wrld.Bldr encoder MIDI output is processed, THE synth parameter modulation system SHALL provide a Wrld.Bldr output processor that maps configured slot positions to controller CCs, emits voice-0 encoder value feedback as CC messages, emits parameter-level button color adjusted by UI-state brightness and voice-0 indicator color through Yaeltex-compatible SysEx color packets, and verifies those packet bytes against Smart Grid source-derived golden data.

#### Scenario: WrldBldr value feedback uses encoder CC channel
- **WHEN** a mapped connected cell has voice-0 normalized value `0.25`
- **THEN** the Wrld.Bldr output processor emits an encoder value CC for that cell with a value near `32`

#### Scenario: WrldBldr encoder colors use SysEx packets
- **WHEN** a mapped connected cell's parameter-level button color or voice-0 indicator color changes
- **THEN** the Wrld.Bldr output processor emits a Yaeltex-compatible SysEx color packet for that cell

#### Scenario: WrldBldr button color uses UI-state brightness
- **WHEN** a mapped connected cell's parameter-level button color is full red
- **AND** the cell's UI-state brightness is `0.5`
- **THEN** the Wrld.Bldr output processor emits the button color packet using dimmed red

#### Scenario: WrldBldr output applies cooldown budget
- **WHEN** many mapped cell colors change at once
- **THEN** the Wrld.Bldr output processor respects its per-process output budget and cooldown state
- **AND** continues emitting remaining changed cells on later process calls

### Requirement: spm-44 — MIDI controller profiles
WHEN a MIDI controller profile is created, THE synth parameter modulation system SHALL provide profile config and factory APIs that build a controller's input processor chain and output processors from shared encoder, analog, and system-message association config, including WRLD.Bldr positions, Launchpad grid positions, and MF Twister side-button addresses, without owning JUCE MIDI devices.

#### Scenario: Profile builds chained input processors
- **WHEN** a profile config contains encoder mappings, analog mappings, system button mappings, MF Twister side-button mappings, and Launchpad grid mappings
- **THEN** the profile factory creates an input processor chain that gives each processor the configured message bus and timestamp provider
- **AND** chains processors through thru so unconsumed MIDI can reach later processors
- **AND** uses the same generic system-message input processor for channel/CC system buttons, MF Twister side buttons, and Launchpad grid positions

#### Scenario: Profile builds independent output processors
- **WHEN** a profile config contains encoder output mappings, WRLD.Bldr system output mappings, and Launchpad system output mappings
- **THEN** the profile factory creates output processors for each configured output protocol
- **AND** callers can invoke each output processor independently without an output chain

#### Scenario: Profile shares system associations
- **WHEN** a profile config maps a controller button, MF Twister side-button address, WRLD.Bldr position, or Launchpad grid position to a `MessageIn`
- **THEN** the same association can be used to configure system button or Launchpad input and controller-specific system output feedback where that controller has feedback LEDs
- **AND** the channel/CC, MF Twister side-button address, WRLD.Bldr position, or Launchpad `(x,y)` position data is not duplicated in separate unrelated input and output config entries

#### Scenario: Profile does not own device lifecycle
- **WHEN** a profile creates processors for a controller
- **THEN** JUCE input and output handlers remain responsible for opening, closing, and reporting MIDI device state

### Requirement: spm-52 — Persistence: MIDI profile config JSON
WHEN MIDI controller profile configuration is saved, THE synth parameter modulation system SHALL provide library JSON serialization and loading helpers for `MidiControllerProfileConfig` and nested encoder input, encoder output, analog input, and system-message association config structs, including WRLD.Bldr positions, Launchpad positions, and MF Twister side-button addresses, so a profile's input and output processors can be rebuilt from config outside any specific app.

#### Scenario: Encoder mappings round trip
- **WHEN** a MIDI profile config contains encoder turn, push, and output mappings
- **THEN** serializing and loading that config preserves channel, CC, slot index, position, relative mode, turn step, and output color-budget fields

#### Scenario: System associations round trip
- **WHEN** a MIDI profile config contains system message associations with press, optional release, feedback for feedback-capable controllers, WRLD.Bldr positions, Launchpad positions, and MF Twister side-button control addresses
- **THEN** serializing and loading that config preserves the messages, controller enum, coordinates, and controller addresses needed to rebuild equivalent input and output processors

#### Scenario: MF Twister side-button profile round trips
- **WHEN** a MIDI profile config contains six MF Twister side-button associations on zero-based channel `3` CCs `8..13`
- **THEN** serializing and loading that config preserves each side-button control address, press message, and optional release message

#### Scenario: Profile factory uses loaded config
- **WHEN** a loaded MIDI profile config is passed to the profile factory
- **THEN** the factory builds the same processor categories as it would from the original config
- **AND** JUCE MIDI device handlers remain outside the profile factory

#### Scenario: Legacy WRLD.Bldr-only profile JSON remains valid
- **WHEN** MIDI profile JSON contains WRLD.Bldr system associations and no Launchpad positions or MF Twister-specific associations
- **THEN** loading that JSON succeeds
- **AND** the loaded config preserves WRLD.Bldr behavior
