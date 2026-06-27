## ADDED Requirements

### Requirement: spm-38 — Message bus: safe out-of-bounds application
WHEN `MessageInBus` applies externally produced messages, THE synth parameter modulation system SHALL treat slot, position, bank, gesture, and scene indices as untrusted and SHALL ignore out-of-bounds targets without mutating manager, bank, scene, gesture, parameter, or UI-state configuration.

#### Scenario: Invalid bank select is a no-op
- **WHEN** a `SelectParamBank` message targets a bank index that does not exist for the addressed slot
- **THEN** bus processing leaves the slot's selected bank unchanged
- **AND** no parameter, scene, shift, or gesture state changes

#### Scenario: Invalid gesture select is a no-op
- **WHEN** a gesture select or gesture value message targets a gesture index greater than or equal to the manager gesture count
- **THEN** bus processing leaves all gesture selected flags and values unchanged
- **AND** no parameter, bank, scene, or shift state changes

#### Scenario: Invalid scene select is a no-op
- **WHEN** a `SceneSelect` message targets a scene index that is invalid for any existing parameter group
- **THEN** bus processing leaves scene endpoints and scene blend unchanged
- **AND** no parameter, bank, gesture, or shift state changes

#### Scenario: Invalid slot position is a no-op
- **WHEN** a parameter push or inc/dec message targets a slot or slot position that does not exist
- **THEN** bus processing leaves all bank, parameter, modulation-view, scene, gesture, and shift state unchanged

### Requirement: spm-39 — UI State: bank colors and gesture-bank affectation
WHEN manager-level UI state is populated, THE synth parameter modulation system SHALL publish bank UI state containing each bank's configured color, connected flag, and selected state, and SHALL publish enough gesture-bank-affecting state for MIDI feedback to determine whether each gesture affects zero, one, or multiple banks in the active scene selection.

#### Scenario: Bank UI state reports configured color
- **WHEN** a bank is configured with color `C`
- **AND** manager UI state is populated
- **THEN** that bank's UI-state entry reports `connected=true`
- **AND** reports color `C`

#### Scenario: Selected bank state follows slots
- **WHEN** any bank slot selects bank `1`
- **AND** manager UI state is populated
- **THEN** bank `1` reports selected state true
- **AND** an existing unselected bank reports selected state false

#### Scenario: Missing bank is not readable as valid
- **WHEN** UI-state feedback asks about a bank index greater than or equal to the configured bank UI-state capacity
- **THEN** the bank is treated as disconnected
- **AND** feedback derived from that bank uses off color and `isOn=false`

#### Scenario: Gesture affecting one bank is recorded
- **WHEN** a gesture affects at least one visible parameter in exactly one bank for the active scene selection
- **AND** manager UI state is populated
- **THEN** gesture-bank-affecting state identifies that bank as affected by the gesture

#### Scenario: Gesture affecting multiple banks is recorded
- **WHEN** a gesture affects visible parameters in two or more banks for the active scene selection
- **AND** manager UI state is populated
- **THEN** gesture-bank-affecting state identifies multiple affected banks for that gesture

#### Scenario: Gesture affecting no banks is recorded
- **WHEN** a gesture affects no visible parameters in any bank for the active scene selection
- **AND** manager UI state is populated
- **THEN** gesture-bank-affecting state identifies zero affected banks for that gesture

### Requirement: spm-40 — MIDI input: analog mapping
WHEN analog MIDI input is processed, THE synth parameter modulation system SHALL provide an `AnalogMidiInProcessor` with an `AnalogMidiInConfig` that maps configured channel/CC pairs to gesture value or scene blend messages, normalizes CC values to `[0, 1]`, stamps created messages with the configured bus-domain timestamp provider, and passes supported-but-unmapped messages to its thru processor.

#### Scenario: Analog CC maps to gesture value
- **WHEN** analog input config maps channel `2` CC `3` to gesture `3`
- **AND** the processor receives a CC on channel `2` CC `3` with value `64`
- **THEN** it pushes `MessageIn::SetGestureValue` for gesture `3` with a normalized value near `64 / 127`

#### Scenario: Analog CC maps to scene blend
- **WHEN** analog input config maps channel `2` CC `16` to scene blend
- **AND** the processor receives a CC on channel `2` CC `16` with value `127`
- **THEN** it pushes `MessageIn::SetSceneBlend` with value `1.0`

#### Scenario: Analog zero maps to zero
- **WHEN** a mapped analog CC is received with value `0`
- **THEN** the created message carries value `0.0`

#### Scenario: Unmapped analog passes to thru
- **WHEN** the analog input processor receives a valid CC that is not configured
- **AND** a thru processor is configured
- **THEN** it passes the original `BasicMidi` to thru exactly once
- **AND** it pushes no analog message

### Requirement: spm-41 — MIDI input: system button mapping
WHEN system button MIDI input is processed, THE synth parameter modulation system SHALL provide a `SystemButtonMidiInProcessor` with a config struct that maps channel/CC pairs to a press `MessageIn` and an optional release `MessageIn`, emits the press message when the CC value is greater than zero, emits the release message only when configured and the CC value is zero, stamps emitted messages with the configured bus-domain timestamp provider, and passes supported-but-unmapped messages to its thru processor.

#### Scenario: Button press emits configured message
- **WHEN** system button config maps channel `5` CC `32` to `MessageIn::ToggleShift`
- **AND** the processor receives a CC on channel `5` CC `32` with value `127`
- **THEN** it pushes a `ToggleShift` message

#### Scenario: Button release emits optional configured message
- **WHEN** system button config maps channel `5` CC `32` to `MessageIn::SetShift(true)` on press and `MessageIn::SetShift(false)` on release
- **AND** the processor receives a CC on channel `5` CC `32` with value `0`
- **THEN** it pushes a shift message whose boolean payload clears shift

#### Scenario: Button release can clear gesture selection
- **WHEN** system button config maps channel `5` CC `0` to `MessageIn::SetGestureSelect(0, true)` on press and `MessageIn::SetGestureSelect(0, false)` on release
- **AND** the processor receives a CC on channel `5` CC `0` with value `0`
- **THEN** it pushes a gesture select message whose boolean payload deselects gesture `0`

#### Scenario: Button release without message is ignored
- **WHEN** system button config maps channel `5` CC `32` to a press message and no release message
- **AND** the processor receives a CC on channel `5` CC `32` with value `0`
- **THEN** it pushes no message
- **AND** it does not pass the mapped release to thru

#### Scenario: Unmapped button passes to thru
- **WHEN** the system button processor receives a CC that is not configured
- **AND** a thru processor is configured
- **THEN** it passes the original `BasicMidi` to thru exactly once

### Requirement: spm-42 — MIDI output: system message output info
WHEN MIDI output feedback needs to mirror system-message state, THE synth parameter modulation system SHALL provide a reusable system message output-info helper that owns or references `ParameterManager::UIState` and returns a synth color plus `isOn` flag for supported `MessageIn` values without reading the live manager tree.

#### Scenario: Bank select info follows selected bank
- **WHEN** the output-info helper evaluates a `SelectParamBank` message for an existing selected bank
- **THEN** it returns that bank's configured color
- **AND** returns `isOn=true`

#### Scenario: Bank select info dims unselected bank
- **WHEN** the output-info helper evaluates a `SelectParamBank` message for an existing unselected bank
- **THEN** it returns a dimmed version of that bank's configured color
- **AND** returns `isOn=false`

#### Scenario: Missing bank info is off
- **WHEN** the output-info helper evaluates a `SelectParamBank` message for a bank that does not exist
- **THEN** it returns off color
- **AND** returns `isOn=false`

#### Scenario: Shift info follows shift state
- **WHEN** the output-info helper evaluates a shift message while UI state reports shift held
- **THEN** it returns white
- **AND** returns `isOn=true`
- **WHEN** UI state reports shift not held
- **THEN** it returns grey
- **AND** returns `isOn=false`

#### Scenario: Scene select info uses blend-weighted endpoint colors
- **WHEN** UI state reports left scene `0`, right scene `1`, and scene blend `0.25`
- **AND** the output-info helper evaluates `SceneSelect(0)`
- **THEN** it returns orange adjusted by brightness `0.5 + 0.5 * (1 - 0.25)`
- **AND** returns `isOn=true`
- **WHEN** it evaluates `SceneSelect(1)`
- **THEN** it returns green adjusted by brightness `0.5 + 0.5 * 0.25`
- **AND** returns `isOn=true`

#### Scenario: Scene select tie uses left endpoint precedence
- **WHEN** UI state reports the same scene ordinal on both scene endpoints
- **AND** the output-info helper evaluates that scene ordinal
- **THEN** it returns the left endpoint orange brightness rule
- **AND** returns `isOn=true`

#### Scenario: Missing scene info is off
- **WHEN** the output-info helper evaluates a `SceneSelect` message for a scene that does not exist
- **THEN** it returns off color
- **AND** returns `isOn=false`

#### Scenario: Gesture select info follows Smart Grid colors
- **WHEN** the output-info helper evaluates a gesture select message for a selected gesture
- **THEN** it returns white
- **AND** returns `isOn=true`
- **WHEN** the gesture is unselected and affects exactly one bank
- **THEN** it returns that bank's color
- **AND** returns `isOn=false`
- **WHEN** the gesture is unselected and affects multiple banks
- **THEN** it returns white
- **AND** returns `isOn=false`
- **WHEN** the gesture is unselected and affects no banks
- **THEN** it returns dimmed grey
- **AND** returns `isOn=false`

#### Scenario: Unsupported message info is off
- **WHEN** the output-info helper evaluates a message type without system feedback semantics
- **THEN** it returns off color
- **AND** returns `isOn=false`

### Requirement: spm-43 — MIDI output: system feedback processors
WHEN system-message MIDI output feedback is processed, THE synth parameter modulation system SHALL provide output processors that own a `SystemMessageOutputInfo`, store their associations in config structs, debounce per association, and emit feedback only when the derived output state changes or the processor is reset.

#### Scenario: CC system output sends on value
- **WHEN** a CC system output processor maps channel `5` CC `32` to a system message whose output info returns `isOn=true`
- **THEN** it emits a CC on channel `5` CC `32` with value `127`

#### Scenario: CC system output sends off value
- **WHEN** a CC system output processor maps channel `5` CC `32` to a system message whose output info returns `isOn=false`
- **THEN** it emits a CC on channel `5` CC `32` with value `0`

#### Scenario: WRLD.Bldr system output sends position color
- **WHEN** a WRLD.Bldr system output processor maps position channel `5`, x `0`, y `4` to a shift message
- **AND** the output info returns white
- **THEN** it emits WRLD.Bldr-compatible color feedback for that position using white

#### Scenario: System output debounces unchanged state
- **WHEN** a system output processor processes the same derived state twice
- **THEN** the second process call emits no duplicate feedback for that association

#### Scenario: System output reset re-renders state
- **WHEN** a system output processor is reset
- **AND** it processes a mapped association with unchanged derived state
- **THEN** it emits the feedback required to restore hardware state

### Requirement: spm-44 — MIDI controller profiles
WHEN a MIDI controller profile is created, THE synth parameter modulation system SHALL provide profile config and factory APIs that build a controller's input processor chain and output processors from shared encoder, analog, and system-message association config without owning JUCE MIDI devices.

#### Scenario: Profile builds chained input processors
- **WHEN** a profile config contains encoder mappings, analog mappings, and system button mappings
- **THEN** the profile factory creates an input processor chain that gives each processor the configured message bus and timestamp provider
- **AND** chains processors through thru so unconsumed MIDI can reach later processors

#### Scenario: Profile builds independent output processors
- **WHEN** a profile config contains encoder output mappings and system output mappings
- **THEN** the profile factory creates output processors for each configured output protocol
- **AND** callers can invoke each output processor independently without an output chain

#### Scenario: Profile shares system associations
- **WHEN** a profile config maps a controller button or WRLD.Bldr position to a `MessageIn`
- **THEN** the same association can be used to configure system button input and system output feedback
- **AND** the channel/CC or position data is not duplicated in separate unrelated input and output config entries

#### Scenario: Profile does not own device lifecycle
- **WHEN** a profile creates processors for a controller
- **THEN** JUCE input and output handlers remain responsible for opening, closing, and reporting MIDI device state

### Requirement: spm-45 — MIDI controller profiles: default WRLD.Bldr and miniapp use
WHEN the default WRLD.Bldr MIDI controller profile is requested, THE synth parameter modulation system SHALL build Smart Grid-derived encoder, analog, system button, and system output defaults for the WRLD.Bldr controller; the synth miniapp SHALL use that profile instead of constructing individual encoder processors directly.

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

#### Scenario: Miniapp creates WRLD.Bldr profile
- **WHEN** the synth miniapp configures MIDI processors
- **THEN** it creates the default WRLD.Bldr profile for its manager, MIDI bus, UI state, sender, one gesture, and visible encoder count
- **AND** installs the profile-created input chain into the MIDI input handler
- **AND** invokes each profile-created output processor after `PopulateUIState`

#### Scenario: Miniapp hardware controls exercise profile
- **WHEN** the miniapp runs with the WRLD.Bldr profile and a matching controller is opened
- **THEN** the first gesture button can momentarily select gesture `0`
- **AND** the gesture analog CC can set gesture `0` value
- **AND** the scene blend analog CC can set scene blend
- **AND** scene select buttons can select valid scenes
- **AND** shift and encoder controls continue to operate through the profile-created processors

## MODIFIED Requirements

### Requirement: spm-22 — Message input: command model
WHEN external UI or MIDI code sends commands to the synth parameter system, THE system SHALL represent each command as a timestamped `MessageIn` with no route field and with typed support for `ParamIncDec`, `ParamPush`, `ToggleShift`, `SetShift`, `ToggleGestureSelect`, `SetGestureSelect`, `SelectParamBank`, `Start`, `Stop`, `Clock`, `SetGestureValue`, `SceneSelect`, and `SetSceneBlend`.

#### Scenario: Parameter messages carry slot and position
- **WHEN** a parameter inc/dec or push message is created
- **THEN** the message carries the target slot index and visible position
- **AND** does not require a physical encoder ID from the sender

#### Scenario: Slot position maps through slot encoder order
- **WHEN** a parameter message targets slot position `i`
- **THEN** the manager resolves position `i` to the physical encoder at index `i` in that slot's `AddPhysicalEncoder` order
- **AND** routes the resolved physical encoder ID through the selected bank's visible cells

#### Scenario: Shift messages can toggle or set explicit state
- **WHEN** a shift toggle message is created
- **THEN** the message carries no required boolean payload
- **WHEN** an explicit shift set message is created
- **THEN** the message carries a boolean payload indicating the desired shift-held state

#### Scenario: Gesture messages carry gesture index and optional explicit selection state
- **WHEN** a gesture select toggle or gesture value message is created
- **THEN** the message carries the gesture index
- **AND** the value-setting message also carries the normalized gesture value
- **WHEN** an explicit gesture select message is created
- **THEN** the message carries the gesture index
- **AND** carries a boolean payload indicating the desired selected state

#### Scenario: Bank selection carries slot and bank
- **WHEN** a parameter bank selection message is created
- **THEN** the message carries which slot to set and which bank index to select
- **AND** the bank index refers to the manager's global bank list

#### Scenario: Scene selection carries one ordinal
- **WHEN** a scene selection message is created
- **THEN** the message carries one scene ordinal
- **AND** does not change scene blend unless a scene blend message is also processed

### Requirement: spm-24 — Message bus: manager application
WHEN `MessageInBus` applies supported parameter, bank, gesture, scene, or shift messages, THE system SHALL mutate the attached `ParameterManager` through manager-owned APIs so message-driven behavior matches direct manager, slot, bank, manager gesture, and scene calls.

#### Scenario: Inc/dec through bus edits visible parameter
- **WHEN** a `ParamIncDec` message targets slot 0 position 1 with delta `0.2`
- **AND** slot 0 position 1 is connected to a parameter in the selected bank
- **THEN** bus processing applies the same parameter edit as the corresponding direct routed tick

#### Scenario: Push through bus opens modulation
- **WHEN** a `ParamPush` message targets a visible top-level parameter cell
- **THEN** bus processing opens that parameter's modulation-depth view using the same rules as direct bank press handling

#### Scenario: Bank select through bus deselects old bank view
- **WHEN** a `SelectParamBank` message selects bank 1 for a slot whose previous bank is showing a modulation view
- **THEN** bus processing deselects the previous bank view
- **AND** selects bank 1 for subsequent slot-position messages

#### Scenario: Shift-held state affects reset routing
- **WHEN** shift is held through a shift message
- **AND** a `ParamPush` message targets a connected non-return parameter cell
- **THEN** bus processing routes that action through the same reset behavior as direct shift-press
- **AND** shifted `ParamIncDec` messages are ignored unless a later change defines shifted turn behavior

#### Scenario: Explicit shift set is idempotent
- **WHEN** a `SetShift` message carries `true`
- **THEN** bus processing sets manager shift-held state to true
- **WHEN** a later `SetShift` message carries `false`
- **THEN** bus processing sets manager shift-held state to false
- **AND** applying either message when the manager already has that shift-held state leaves other manager state unchanged

#### Scenario: Scene selection through bus sets less-selected endpoint
- **WHEN** the manager scene blend is less than or equal to `0.5`
- **AND** a `SceneSelect` message carries scene `2`
- **THEN** bus processing uses the manager's validated scene API to set the right endpoint to `2`
- **AND** leaves the existing left endpoint unchanged
- **AND** leaves the existing scene blend unchanged

#### Scenario: Scene selection through bus sets left endpoint when right is dominant
- **WHEN** the manager scene blend is greater than `0.5`
- **AND** a `SceneSelect` message carries scene `1`
- **THEN** bus processing uses the manager's validated scene API to set the left endpoint to `1`
- **AND** leaves the existing right endpoint unchanged
- **AND** leaves the existing scene blend unchanged

#### Scenario: Scene selection rejects invalid ordinals
- **WHEN** a `SceneSelect` message carries a scene ordinal that is out of range for any existing parameter group
- **THEN** bus processing rejects the scene endpoint change
- **AND** leaves the manager's previous scene endpoints and blend unchanged

#### Scenario: Scene blend through bus sets blend only
- **WHEN** a `SetSceneBlend` message carries blend `0.25`
- **THEN** bus processing sets the manager scene blend to `0.25`
- **AND** leaves the manager scene endpoints unchanged

#### Scenario: Clock and transport are safely accepted
- **WHEN** `Clock`, `Start`, or `Stop` messages are processed in this change
- **THEN** the bus accepts and drains them without changing parameter, bank, gesture, or scene state

#### Scenario: Gesture selection through bus is manager-owned
- **WHEN** a `ToggleGestureSelect` message toggles gesture 1
- **THEN** bus processing updates the manager-owned gesture 1 selected state
- **AND** parameters in every group observe the updated selection for subsequent edits

#### Scenario: Explicit gesture selection through bus is manager-owned
- **WHEN** a `SetGestureSelect` message sets gesture 1 selected state to true
- **THEN** bus processing selects manager-owned gesture 1
- **WHEN** a later `SetGestureSelect` message sets gesture 1 selected state to false
- **THEN** bus processing deselects manager-owned gesture 1
- **AND** parameters in every group observe the updated selection for subsequent edits

#### Scenario: Gesture value through bus is manager-owned
- **WHEN** a `SetGestureValue` message sets gesture 1 to `0.75`
- **THEN** bus processing updates the manager-owned gesture 1 value
- **AND** parameters in every group observe `0.75` on the next compute where gesture 1 is active
