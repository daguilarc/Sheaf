# synth-parameter-modulation Delta

Project: `projects/synth`. ID prefix: `spm`.

## MODIFIED Requirements

### Requirement: spm-37 — Miniapp: MIDI controller configuration
WHEN the synth miniapp runs, THE miniapp SHALL expose MIDI configuration exclusively through the library Controllers and Audio pages (sru-3, sru-4, sru-5) hosted by the runtime main pane: the configured controllers come from the instrument configuration, device selection is per controller, and connection is automatic through reconciliation (smi-3, smi-4) rather than manual open/close; the miniapp front page SHALL contain no MIDI or file configuration UI; the real synth MIDI processors SHALL be registered against a MIDI-specific `MessageInBus` and `ParameterManager::UIState` by the runtime, MIDI sender/device resources SHALL shut down cleanly, and disconnected slot positions SHALL render as empty space rather than inactive controller chrome.

#### Scenario: Miniapp instrument controls visible encoders
- **WHEN** the instrument configuration contains a twister or wrldbldr controller whose device is connected
- **AND** the hardware sends a mapped encoder turn CC for a visible miniapp slot position
- **THEN** the miniapp processes a scaled `ParamIncDec` through the MIDI input bus on the next runtime bus-processing pass
- **AND** the visible encoder value changes according to the selected bank and slot-position mapping

#### Scenario: Miniapp push opens modulation view
- **WHEN** a connected controller sends a mapped pushbutton CC for a top-level miniapp parameter
- **THEN** the miniapp processes a `ParamPush` through `MessageInBus`
- **AND** the visible encoder grid updates to the modulation view

#### Scenario: Miniapp output follows UI state
- **WHEN** a controller with an open output device is configured
- **AND** miniapp UI-state values or colors change
- **THEN** the registered MIDI output processor enqueues the corresponding hardware feedback messages through the MIDI sender

#### Scenario: Miniapp remains usable without MIDI hardware
- **WHEN** no mapped controller device is present
- **THEN** the existing on-screen miniapp controls continue to work through `MessageInBus`
- **AND** the Controllers page reports the controllers as offline rather than the app failing to start

#### Scenario: Miniapp keeps bus producers isolated
- **WHEN** the miniapp has both on-screen controls and MIDI input enabled
- **THEN** on-screen controls push only to the existing UI message bus
- **AND** MIDI callbacks push only to the MIDI input bus
- **AND** the runtime's audio-thread pump drains both buses into the same parameter manager

#### Scenario: Unassigned slot position leaves space
- **WHEN** a visible slot position has no assigned parameter
- **THEN** the miniapp leaves that encoder position visually empty
- **AND** does not draw the encoder controller body for that position

#### Scenario: Miniapp front page is config-free
- **WHEN** the miniapp front page is inspected
- **THEN** it contains no MIDI device, controller, patch, or file configuration controls

#### Scenario: Miniapp shuts MIDI down cleanly
- **WHEN** the miniapp closes
- **THEN** the MIDI sender stops and joins its worker thread
- **AND** open JUCE MIDI input and output devices are closed

### Requirement: spm-45 — MIDI controller profiles: default WRLD.Bldr and miniapp use
WHEN the default WRLD.Bldr MIDI controller profile is requested, THE synth parameter modulation system SHALL build Smart Grid-derived encoder, analog, system button, and system output defaults for the WRLD.Bldr controller; the synth miniapp's default instrument configuration SHALL contain one WRLD.Bldr controller seeded with that profile instead of constructing individual encoder processors directly.

#### Scenario: Default WRLD.Bldr profile maps encoders
- **WHEN** the default WRLD.Bldr profile is created for slot `0`
- **THEN** encoder turn input uses channel `0`
- **AND** encoder pushbutton input uses channel `1`
- **AND** CCs `0..15` map to slot positions `0..15` in row-major order
- **AND** encoder output maps the same positions for value and color feedback

#### Scenario: Default WRLD.Bldr profile maps analogs
- **WHEN** the default WRLD.Bldr profile is created
- **THEN** it maps logical analog index `0` to `SetSceneBlend`
- **AND** maps logical analog indices `1..16` to gesture value messages for gestures `0..15`
- **AND** treats WRLD.Bldr channel `2` CC `N` as logical analog index `N`
- **AND** treats WRLD.Bldr channel `14` CC `N` as logical analog index `N + 2`

#### Scenario: Default WRLD.Bldr profile maps system buttons
- **WHEN** the default WRLD.Bldr profile is created
- **THEN** it maps aux `(0,4)` to momentary shift
- **AND** maps aux row `6` to scene select messages
- **AND** maps Smart Grid-derived bank select positions to bank select messages
- **AND** maps configured gesture selector positions to momentary gesture select messages
- **AND** does not map aux focus `(0,5)`

#### Scenario: Default WRLD.Bldr bank buttons tolerate small apps
- **WHEN** the default WRLD.Bldr profile includes bank buttons for bank indices that a specific app has not created
- **AND** those buttons are pressed
- **THEN** bus processing ignores the missing-bank messages without changing current app state

#### Scenario: Miniapp default instrument carries WRLD.Bldr
- **WHEN** the synth miniapp initializes its default instrument configuration
- **THEN** it contains a named WRLD.Bldr controller whose profile is the default WRLD.Bldr profile for its manager, one gesture, and visible encoder count
- **AND** the runtime builds that controller's input chain and output processors from the instrument configuration

#### Scenario: Miniapp hardware controls exercise profile
- **WHEN** the miniapp runs with the WRLD.Bldr controller connected
- **THEN** the first gesture button can momentarily select gesture `0`
- **AND** the gesture analog CC can set gesture `0` value
- **AND** the scene blend analog CC can set scene blend
- **AND** scene select buttons can select valid scenes
- **AND** shift and encoder controls continue to operate through the profile-created processors

## REMOVED Requirements

### Requirement: spm-53 — Persistence: MIDI device selection
**Reason**: Superseded by the instrument model — endpoint identifiers are stored per controller slot inside the instrument configuration (smi-1) and persist through the instrument JSON section (smi-2); a separate global endpoint state no longer exists.
**Migration**: No data migration (pre-user). Code paths that read/wrote `MidiEndpointState` move to the controller slots' `input`/`output` `MidiEndpointRef` (identifier + device-name pairs), with best-effort restore and offline-when-absent behavior specified by smi-3 and smi-6.
