## MODIFIED Requirements

### Requirement: spm-31 — MIDI input: encoder mapping
WHEN encoder MIDI input is processed, THE synth parameter modulation system SHALL map configured turn and pushbutton channel/CC pairs to `MessageIn` commands addressed by `(slotIx, position)`, SHALL decode signed-7-bit and direction-only modes as relative ticks scaled by the configured normalized `turnStep`, SHALL decode absolute mode as a `ParamSetAbsolute` normalized target equal to the raw 7-bit CC value divided by `127` without applying `turnStep`, and SHALL allow one controller to map multiple slots or leave some physical controls unmapped.

#### Scenario: Relative turn CC maps to parameter inc/dec
- **WHEN** an encoder input config maps channel `0` CC `5` to slot `1` position `2` in signed-7-bit mode
- **AND** the processor receives a CC on channel `0` CC `5` with value `65`
- **THEN** it pushes `MessageIn::ParamIncDec` for slot `1` position `2`

#### Scenario: Signed relative mode uses value minus 64
- **WHEN** a mapped turn CC is configured for signed-7-bit relative mode
- **AND** the turn step is `0.01`
- **AND** the processor receives values `63` and `66`
- **THEN** it sends normalized deltas `-0.01` and `0.02` respectively

#### Scenario: Direction-only mode ignores magnitude
- **WHEN** a mapped turn CC is configured for direction-only relative mode
- **AND** the turn step is `0.01`
- **AND** the processor receives values `1`, `64`, and `127`
- **THEN** it sends normalized deltas `-0.01`, no message, and `0.01` respectively

#### Scenario: Absolute mode emits the represented position
- **WHEN** a mapped turn CC is configured for absolute mode
- **AND** the processor receives raw values `0`, `64`, and `127`
- **THEN** it pushes `MessageIn::ParamSetAbsolute` values `0`, `64 / 127`, and `1` respectively for the mapped slot and position
- **AND** changing `turnStep` does not change those values

#### Scenario: Default turn step is small
- **WHEN** an encoder input config is created without an explicit turn step
- **THEN** it uses a default turn step of `1 / 128`

#### Scenario: Pushbutton nonzero value maps to push
- **WHEN** an encoder input config maps pushbutton channel `1` CC `5` to slot `1` position `2`
- **AND** the processor receives a CC on channel `1` CC `5` with value `127`
- **THEN** it pushes `MessageIn::ParamPush` for slot `1` position `2`

#### Scenario: Pushbutton zero value is not consumed as a parameter command
- **WHEN** an encoder input config maps pushbutton channel `1` CC `5`
- **AND** the processor receives a CC on channel `1` CC `5` with value `0`
- **THEN** it does not push a parameter command

### Requirement: spm-52 — Persistence: MIDI profile config JSON
WHEN MIDI controller profile configuration is saved, THE synth parameter modulation system SHALL provide library JSON serialization and loading helpers for `MidiControllerProfileConfig` and nested encoder input, encoder output, analog input, and system-message association config structs, including WRLD.Bldr positions, Launchpad positions, and MF Twister side-button addresses; SHALL persist encoder input mode under `mode` with values `signed7Bit`, `directionOnly`, or `absolute`; SHALL accept the legacy `relativeMode` field when `mode` is absent; and SHALL preserve every message type and payload needed to rebuild equivalent processors outside any specific app.

#### Scenario: Encoder mappings round trip
- **WHEN** a MIDI profile config contains encoder turn, push, and output mappings
- **THEN** serializing and loading that config preserves channel, CC, slot index, position, encoder mode, turn step, and output color-budget fields

#### Scenario: Absolute encoder mode round trips
- **WHEN** a MIDI profile config contains an encoder input whose mode is absolute
- **THEN** serialization writes `"mode": "absolute"`
- **AND** loading the serialized profile reconstructs absolute mode and the same turn and push mappings

#### Scenario: Legacy relative-mode field remains loadable
- **WHEN** MIDI profile JSON omits `mode` and contains `"relativeMode": "signed7Bit"` or `"relativeMode": "directionOnly"`
- **THEN** loading succeeds with the equivalent `EncoderMode`
- **AND** saving the loaded profile writes the corresponding `mode` field

#### Scenario: New mode field is authoritative
- **WHEN** MIDI profile JSON contains both `mode` and legacy `relativeMode`
- **THEN** loading uses the value in `mode`

#### Scenario: Absolute parameter message round trips
- **WHEN** a serialized message association contains `ParamSetAbsolute` with a slot, position, and normalized value
- **THEN** loading reconstructs the same message type and payload

#### Scenario: System associations round trip
- **WHEN** a MIDI profile config contains system-message associations with press, optional release, feedback for feedback-capable controllers, WRLD.Bldr positions, Launchpad positions, and MF Twister side-button control addresses
- **THEN** serializing and loading that config preserves the messages, controller enum, coordinates, and controller addresses needed to rebuild equivalent input and output processors

#### Scenario: Legacy shift action strings load as reset
- **WHEN** MIDI profile JSON contains legacy shift action strings for toggle, set-true, or set-false system messages
- **THEN** loading that JSON succeeds
- **AND** the loaded messages use the equivalent reset message type and boolean payload

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

## ADDED Requirements

### Requirement: spm-75 — Edits: exact absolute scene and gesture distribution
WHEN `Parameter::HandleSetAbsolute(scene, normalizedTarget)` is called with a finite normalized target, THE parameter SHALL clamp the target to `[0, 1]`, map it to the parameter range, arm every selected inactive gesture for the touched scene endpoints by copying the matching parent scene values, rebuild the contribution coefficients after arming, include those newly armed gestures and every already-active gesture with positive effective weight regardless of current selection, and apply a range-constrained minimum-change weighted projection to the distinct contributing scene-center and gesture-value storage locations such that production `ComputeRawCenter(scene)` before target-center slew yields the mapped target within absolute tolerance `1e-5`, every changed latent value remains in range, and unrelated storage remains unchanged. The routed production handler SHALL be `noexcept`, SHALL use no dynamic allocation, SHALL use a fixed-capacity workspace supporting the exact maximum `2 + 2 * 64 = 130` latent locations, and SHALL leave scene centers, gesture values, and gesture-active masks unchanged when internal scene, topology, storage, weight, capacity, or projection invariants reject the edit.

#### Scenario: Endpoint absolute edit
- **WHEN** a parameter has no active positive-weight gesture contribution and scene blend is at the left endpoint
- **AND** `HandleSetAbsolute(scene, 0.75)` is called on a unipolar parameter
- **THEN** the left scene center becomes `0.75` within tolerance `1e-5`
- **AND** the raw scene/gesture center before target-center slew is `0.75` within tolerance `1e-5`
- **AND** the right scene center is unchanged

#### Scenario: Intermediate scene blend reaches the target
- **WHEN** distinct left and right scene centers contribute at an intermediate scene blend
- **AND** `HandleSetAbsolute` receives an in-range target different from the current effective value
- **THEN** it moves the two scene centers in proportion to their effective contribution coefficients with saturation redistribution where required
- **AND** `ComputeRawCenter(scene)` before target-center slew equals the mapped target within tolerance `1e-5`

#### Scenario: First absolute message arms and applies
- **WHEN** a selected gesture is inactive for a parameter at the touched scene endpoints
- **AND** one absolute message targets a value different from the current effective value
- **THEN** that same message activates the gesture and initially copies the applicable parent scene values
- **AND** rebuilds all contribution coefficients after arming because arming may reweight other active gestures and change the pre-solve value
- **AND** includes the newly active gesture in the exact-target projection without swallowing the target
- **AND** `ComputeRawCenter(scene)` before target-center slew equals the mapped target within tolerance `1e-5`

#### Scenario: Active deselected gestures participate
- **WHEN** one or more positive-weight gestures are active for the current scene selection but are not currently selected
- **AND** `HandleSetAbsolute` receives a new target
- **THEN** their gesture values participate according to the existing effective gesture weights
- **AND** `ComputeRawCenter(scene)` before target-center slew equals the mapped target within tolerance `1e-5`

#### Scenario: Saturated contributors redistribute residual
- **WHEN** the unconstrained weighted update would move any contributing latent value outside the parameter range
- **THEN** the handler fixes that value at the approached range endpoint
- **AND** redistributes the remaining residual over unsaturated contributors
- **AND** leaves every latent value in range and reaches the mapped target within tolerance `1e-5`

#### Scenario: Shared scene endpoint is updated once
- **WHEN** the left and right scene endpoints refer to the same scene storage
- **THEN** the solver combines their coefficients before applying the projection
- **AND** does not apply two writes to the same latent location

#### Scenario: Randomized exactness invariant
- **WHEN** deterministic model tests generate valid scene blends, scene centers, gesture activation masks, gesture weights, latent gesture values, parameter ranges, and absolute targets
- **THEN** every production edit's `ComputeRawCenter(scene)` before target-center slew matches an independently computed target within tolerance `1e-5`
- **AND** every latent value remains in range
- **AND** inactive unrelated storage is unchanged

#### Scenario: Invalid internal state is a mutation-free no-op
- **WHEN** the routed absolute handler encounters an invalid scene, backing-storage topology, non-finite or out-of-range relevant latent state, invalid relevant gesture weight, workspace-capacity failure, or rejected projection
- **THEN** it returns without throwing or dynamically allocating
- **AND** scene centers, gesture values, and gesture-active masks are unchanged

### Requirement: spm-76 — Messaging: absolute parameter routing
WHEN a `MessageIn::ParamSetAbsolute(timestamp, slotIx, position, normalizedValue)` reaches `MessageInBus`, THE synth parameter modulation system SHALL route it by slot and position through `ParameterManager`, `BankSlot`, and the selected `Bank` to the parameter or modulation-depth control currently visible in that cell's `HandleSetAbsolute`, SHALL use that parameter's owning scene and gesture context, SHALL ignore the edit while any effective modifier is active in the same manner as `ParamIncDec`, and SHALL leave state unchanged when the slot, position, cell, or parameter is not mapped.

#### Scenario: Absolute message reaches visible parameter
- **WHEN** a selected bank maps slot `0` position `2` to a visible parameter
- **AND** the bus applies `ParamSetAbsolute(..., 0, 2, 0.5)` with no modifier active
- **THEN** the mapped parameter handles absolute target `0.5`
- **AND** its `ComputeRawCenter(scene)` before target-center slew equals the mapped target within tolerance `1e-5`

#### Scenario: Modulation-depth view receives absolute edit
- **WHEN** a bank's modulation-depth view maps a slot position to a materialized modulation-depth parameter
- **AND** an absolute message addresses that position with no modifier active
- **THEN** the visible modulation-depth parameter receives `HandleSetAbsolute`
- **AND** the hidden top-level parameter is not edited by that message

#### Scenario: Modifier blocks absolute edit
- **WHEN** any effective modifier is active
- **AND** the bus applies a mapped `ParamSetAbsolute` message
- **THEN** it does not perform an absolute edit

#### Scenario: Unmapped absolute address is a no-op
- **WHEN** `ParamSetAbsolute` addresses an absent slot, out-of-range position, disconnected cell, or cell without a parameter
- **THEN** parameter state remains unchanged
