## ADDED Requirements

### Requirement: spm-56 — MIDI Launchpad: grid position mapping
WHEN Launchpad grid MIDI mapping is configured, THE synth parameter modulation system SHALL provide JUCE-free helpers and data types that represent Launchpad X, Launchpad Pro MK3, and Launchpad Mini MK3 controller identities, translate supported logical `(x,y)` positions to MIDI notes, translate incoming MIDI notes back to logical `(x,y)` positions, and reject positions outside the selected controller shape.

#### Scenario: Launchpad X position mapping follows Smart Grid
- **WHEN** Launchpad X position `(0, 7)` is translated to a note
- **THEN** the helper returns note `11`
- **WHEN** Launchpad X position `(0, -1)` is translated to a note
- **THEN** the helper returns note `91`
- **WHEN** Launchpad X note `11` is translated to a position
- **THEN** the helper returns `(0, 7)` for Launchpad X

#### Scenario: Launchpad Mini MK3 uses Launchpad X shape
- **WHEN** Launchpad Mini MK3 position `(8, 0)` is validated
- **THEN** the helper reports the position is supported
- **WHEN** Launchpad Mini MK3 position `(-1, 0)` is validated
- **THEN** the helper reports the position is unsupported

#### Scenario: Launchpad Pro MK3 supports Pro-only edge positions
- **WHEN** Launchpad Pro MK3 position `(-1, 0)` is validated
- **THEN** the helper reports the position is supported
- **WHEN** Launchpad Pro MK3 position `(0, 9)` is validated
- **THEN** the helper reports the position is supported

#### Scenario: Unsupported position is rejected
- **WHEN** a Launchpad X or Mini MK3 profile association contains position `(-1, 0)`
- **THEN** profile config loading rejects that association
- **AND** does not mutate the target profile config

### Requirement: spm-57 — MIDI input: Launchpad system-message address mapping
WHEN Launchpad grid MIDI input is processed, THE synth parameter modulation system SHALL extend the generic system-message input processor and config association model so Launchpad controller `(x,y)` positions can map to a press `MessageIn` and optional release `MessageIn`; the generic processor SHALL emit the press message for Launchpad Note On or Control Change messages with value greater than zero, SHALL emit the release message for Note Off or value-zero Note On or Control Change messages only when configured, SHALL stamp emitted messages with the configured bus-domain timestamp provider, and SHALL pass supported-but-unmapped messages to its thru processor.

#### Scenario: Grid note press emits configured message
- **WHEN** Launchpad X input config maps position `(0, 7)` to `MessageIn::SceneSelect(0)`
- **AND** the generic system-message input processor receives Note On note `11` with velocity `127`
- **THEN** it pushes a `SceneSelect` message for scene `0`
- **AND** the message timestamp comes from the timestamp provider

#### Scenario: Grid note release emits optional release
- **WHEN** Launchpad Pro MK3 input config maps position `(0, 0)` to `MessageIn::SetGestureSelect(0, true)` on press and `MessageIn::SetGestureSelect(0, false)` on release
- **AND** the generic system-message input processor receives Note Off for that position's note
- **THEN** it pushes a gesture select message whose boolean payload deselects gesture `0`

#### Scenario: Value-zero note on is release
- **WHEN** Launchpad Mini MK3 input config maps position `(1, 1)` to a press message and release message
- **AND** the generic system-message input processor receives Note On for that position with velocity `0`
- **THEN** it emits the release message

#### Scenario: Edge button CC maps to position
- **WHEN** Launchpad X input config maps an edge-button position that translates from a Control Change message
- **AND** the processor receives that CC with value greater than zero
- **THEN** it emits the configured press message for that `(x,y)` position

#### Scenario: Unmapped Launchpad event passes to thru
- **WHEN** the generic system-message input processor receives a supported Launchpad note or CC event whose translated position is not configured
- **AND** a thru processor is configured
- **THEN** it passes the original `BasicMidi` to thru exactly once
- **AND** it pushes no Launchpad message

### Requirement: spm-58 — MIDI output: Launchpad RGB feedback
WHEN Launchpad grid MIDI output feedback is processed, THE synth parameter modulation system SHALL provide a Launchpad output processor that owns or references `SystemMessageOutputInfo`, maps Launchpad controller `(x,y)` positions to feedback `MessageIn` values, evaluates those messages from UI state, debounces per association, and emits Novation-compatible RGB LED SysEx for Launchpad X, Launchpad Pro MK3, and Launchpad Mini MK3.

#### Scenario: Launchpad X output uses X product byte
- **WHEN** a Launchpad X output association maps position `(0, 7)` to a shift feedback message whose output info returns white
- **THEN** the processor emits SysEx bytes beginning `F0 00 20 29 02 0C 03`
- **AND** the color spec uses RGB lighting type `3`
- **AND** the LED index is the note translated from `(0, 7)`

#### Scenario: Launchpad Mini MK3 output uses Mini product byte
- **WHEN** a Launchpad Mini MK3 output association maps a supported position to a feedback message
- **THEN** the processor emits SysEx bytes beginning `F0 00 20 29 02 0D 03`

#### Scenario: Launchpad Pro MK3 output uses Pro product byte
- **WHEN** a Launchpad Pro MK3 output association maps a supported position to a feedback message
- **THEN** the processor emits SysEx bytes beginning `F0 00 20 29 02 0E 03`

#### Scenario: Launchpad RGB output converts synth colors to MIDI bytes
- **WHEN** the output info returns synth color `{r=255, g=128, b=0}`
- **THEN** the emitted RGB color data is `{127, 64, 0}`

#### Scenario: Launchpad output debounces unchanged state
- **WHEN** a Launchpad output processor processes the same derived color state twice
- **THEN** the second process call emits no duplicate SysEx for that association

#### Scenario: Launchpad output reset re-renders state
- **WHEN** a Launchpad output processor is reset
- **AND** it processes a mapped association with unchanged derived state
- **THEN** it emits the feedback required to restore hardware state

### Requirement: spm-59 — MIDI controller profiles: default Launchpad grid profiles
WHEN a default Launchpad MIDI controller profile is requested, THE synth parameter modulation system SHALL build Launchpad X, Launchpad Pro MK3, and Launchpad Mini MK3 profile configs from system-message associations only, SHALL map Launchpad `(x,y)` positions to existing `MessageIn` press, optional release, and feedback values, SHALL leave encoder and analog profile sections unset, and SHALL create profile processors without owning JUCE MIDI devices.

#### Scenario: Default Launchpad profile has no analogs or encoders
- **WHEN** a default Launchpad X, Launchpad Pro MK3, or Launchpad Mini MK3 profile config is created
- **THEN** `encoderInput`, `encoderOutput`, and `analogInput` are absent
- **AND** the profile has at least one Launchpad system-message association

#### Scenario: Default Launchpad profile maps scene buttons
- **WHEN** a default Launchpad profile is created with scene count `4`
- **THEN** it maps four supported Launchpad positions to `SceneSelect(0)` through `SceneSelect(3)` press and feedback messages

#### Scenario: Default Launchpad profile maps gesture buttons momentarily
- **WHEN** a default Launchpad profile is created with gesture selector count `2`
- **THEN** it maps two supported Launchpad positions to `SetGestureSelect(gesture, true)` press messages
- **AND** maps their releases to `SetGestureSelect(gesture, false)` messages

#### Scenario: Default Launchpad profile maps bank buttons
- **WHEN** a default Launchpad profile is created with bank button count `3`
- **THEN** it maps three supported Launchpad positions to `SelectParamBank` press and feedback messages for bank indices `0`, `1`, and `2`

#### Scenario: Profile factory builds Launchpad processors
- **WHEN** a profile config contains Launchpad system-message associations
- **THEN** the profile factory includes those associations in the generic system-message input processor in the input chain
- **AND** creates a Launchpad grid output processor for each Launchpad controller represented in the config
- **AND** callers can invoke each output processor independently without an output chain

## MODIFIED Requirements

### Requirement: spm-44 — MIDI controller profiles
WHEN a MIDI controller profile is created, THE synth parameter modulation system SHALL provide profile config and factory APIs that build a controller's input processor chain and output processors from shared encoder, analog, and system-message association config, including WRLD.Bldr and Launchpad grid positions, without owning JUCE MIDI devices.

#### Scenario: Profile builds chained input processors
- **WHEN** a profile config contains encoder mappings, analog mappings, system button mappings, and Launchpad grid mappings
- **THEN** the profile factory creates an input processor chain that gives each processor the configured message bus and timestamp provider
- **AND** chains processors through thru so unconsumed MIDI can reach later processors
- **AND** uses the same generic system-message input processor for channel/CC system buttons and Launchpad grid positions

#### Scenario: Profile builds independent output processors
- **WHEN** a profile config contains encoder output mappings, WRLD.Bldr system output mappings, and Launchpad system output mappings
- **THEN** the profile factory creates output processors for each configured output protocol
- **AND** callers can invoke each output processor independently without an output chain

#### Scenario: Profile shares system associations
- **WHEN** a profile config maps a controller button, WRLD.Bldr position, or Launchpad grid position to a `MessageIn`
- **THEN** the same association can be used to configure system button or Launchpad input and system output feedback
- **AND** the channel/CC, WRLD.Bldr position, or Launchpad `(x,y)` position data is not duplicated in separate unrelated input and output config entries

#### Scenario: Profile does not own device lifecycle
- **WHEN** a profile creates processors for a controller
- **THEN** JUCE input and output handlers remain responsible for opening, closing, and reporting MIDI device state

### Requirement: spm-52 — Persistence: MIDI profile config JSON
WHEN MIDI controller profile configuration is saved, THE synth parameter modulation system SHALL provide library JSON serialization and loading helpers for `MidiControllerProfileConfig` and nested encoder input, encoder output, analog input, and system-message association config structs, including WRLD.Bldr and Launchpad positions, so a profile's input and output processors can be rebuilt from config outside any specific app.

#### Scenario: Encoder mappings round trip
- **WHEN** a MIDI profile config contains encoder turn, push, and output mappings
- **THEN** serializing and loading that config preserves channel, CC, slot index, position, relative mode, turn step, and output color-budget fields

#### Scenario: System associations round trip
- **WHEN** a MIDI profile config contains system message associations with press, optional release, feedback, WRLD.Bldr positions, and Launchpad positions
- **THEN** serializing and loading that config preserves the messages, controller enum, coordinates, and controller addresses needed to rebuild equivalent input and output processors

#### Scenario: Profile factory uses loaded config
- **WHEN** a loaded MIDI profile config is passed to the profile factory
- **THEN** the factory builds the same processor categories as it would from the original config
- **AND** JUCE MIDI device handlers remain outside the profile factory

#### Scenario: Legacy WRLD.Bldr-only profile JSON remains valid
- **WHEN** MIDI profile JSON contains WRLD.Bldr system associations and no Launchpad positions
- **THEN** loading that JSON succeeds
- **AND** the loaded config preserves WRLD.Bldr behavior
