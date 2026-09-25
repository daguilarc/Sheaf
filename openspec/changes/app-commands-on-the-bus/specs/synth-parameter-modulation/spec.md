# Delta — `synth-parameter-modulation`

The low watermark for depth storage is a fixed multiple of the modulator
count, sized for one encoder press; an app whose one press adds many depths
needs a larger number, not a new mechanism. The command model gains the
app command. The modified requirement restates its promoted text whole.

## MODIFIED Requirements

### Requirement: spm-22 — Message input: command model
WHEN external UI or MIDI code sends commands to the synth parameter system, THE system SHALL represent each command as a timestamped `MessageIn` with no route field and with typed support for `ParamIncDec`, `ParamPush`, `ToggleReset`, `SetReset`, `ToggleRandom`, `SetRandom`, `ToggleRandomMod`, `SetRandomMod`, `ToggleGestureSelect`, `SetGestureSelect`, `SelectParamBank`, `Start`, `Stop`, `Clock`, `SetGestureValue`, `SceneSelect`, `SetSceneBlend`, `AppAction` (dispatched to the app's surface on the message thread), and `AppCommand` (an app-defined command number and a float value, applied by the app on the audio thread and never interpreted by the system), with every new type appended after the last so existing ordinals are unchanged.

#### Scenario: Parameter messages carry slot and position
- **WHEN** a parameter inc/dec or push message is created
- **THEN** the message carries the target slot index and visible position
- **AND** does not require a physical encoder ID from the sender

#### Scenario: Slot position maps through slot encoder order
- **WHEN** a parameter message targets slot position `i`
- **THEN** the manager resolves position `i` to the physical encoder at index `i` in that slot's `AddPhysicalEncoder` order
- **AND** routes the resolved physical encoder ID through the selected bank's visible cells

#### Scenario: Reset messages can toggle or set explicit state
- **WHEN** a reset toggle message is created
- **THEN** the message carries no required boolean payload
- **WHEN** an explicit reset set message is created
- **THEN** the message carries a boolean payload indicating the desired reset-held state

#### Scenario: Random messages can toggle or set explicit state
- **WHEN** a random toggle message is created
- **THEN** the message carries no required boolean payload
- **WHEN** an explicit random set message is created
- **THEN** the message carries a boolean payload indicating the desired random-held state

#### Scenario: Random-mod messages can toggle or set explicit state
- **WHEN** a random-mod toggle message is created
- **THEN** the message carries no required boolean payload
- **WHEN** an explicit random-mod set message is created
- **THEN** the message carries a boolean payload indicating the desired random-mod-held state

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

#### Scenario: An app command carries the app's number and a value
- **WHEN** `MessageIn::AppCommand(timestamp, command, value)` is created
- **THEN** the message carries that number and value and no string
- **AND** no controller profile can address it
- **AND** its sort key is greater than every enumerator declared before it

## ADDED Requirements

### Requirement: spm-95 — Storage: the low watermark is a group setting
THE parameter group SHALL let an app set the available-slot count below which an allocation requests a storage batch (`SetStorageLowWatermark`), SHALL default it to twice the modulator count, and SHALL use it in the existing low-water request at every local allocation and as the request-size floor.

#### Scenario: A raised watermark requests earlier
- **WHEN** the watermark is set to 100 and an allocation leaves 89 available slots
- **THEN** a batch request for 100 is pushed (the floor is the watermark); at the default watermark on the same group, none is
