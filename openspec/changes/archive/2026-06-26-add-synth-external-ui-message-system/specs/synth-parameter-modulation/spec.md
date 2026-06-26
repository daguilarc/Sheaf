## MODIFIED Requirements

### Requirement: spm-2 — Ownership: manager, groups, parameters, banks, and slots
WHEN constructing the synth parameter system, THE system SHALL use a single `ParameterManager` to own global scene state, global gesture state, page state, parameter groups, banks, slots, and the global parameter ID space; the manager's gesture count SHALL default to zero and MAY be changed only before any group is created; `ParameterManager::CreateGroup` SHALL inject the manager's fixed gesture count and a non-owning manager pointer into each `ParameterGroup`; each `ParameterGroup` SHALL own its config, `Modulators`, voice indicator color palette, injected gesture count for arena sizing, non-owning manager pointer, and allocator, but SHALL NOT own gesture values, gesture selection, or gesture metadata; each `Parameter` SHALL be allocated by exactly one group and read runtime gesture values, selection, and metadata through the owning manager context rather than through group-local gesture state; banks and slots SHALL hold non-owning parameter pointers only.

#### Scenario: Parameter receives globally unique ID
- **WHEN** parameters are created across multiple groups
- **THEN** the manager assigns each parameter a unique global ID

#### Scenario: Bank does not own parameter lifetime
- **WHEN** a bank is populated with parameters from one or more groups
- **THEN** destroying or deselecting the bank does not destroy those parameters

#### Scenario: Gestures are manager-owned across groups
- **WHEN** parameters from two groups are edited while gesture 1 is selected
- **THEN** both parameters observe the same manager-owned gesture 1 selected state and gesture value

#### Scenario: Gesture count is fixed before groups
- **WHEN** a manager is configured with two gestures before any group is created
- **THEN** every subsequently created group sizes parameter gesture arrays from that count
- **AND** changing gesture count after group creation is not supported

#### Scenario: Default manager gesture count is zero
- **WHEN** a manager is default constructed and no gesture count is configured before group creation
- **THEN** subsequently created groups size parameter gesture arrays for zero gestures

#### Scenario: Group cannot carry independent gesture count
- **WHEN** a group is created through a manager configured with two gestures
- **THEN** the group receives gesture count `2` from the manager
- **AND** no `ParameterGroupConfig` field can override that count

### Requirement: spm-4 — Group config: dynamic shape and upfront allocation
WHEN a `ParameterGroup` is configured, THE group SHALL use runtime configuration for voice count, modulator count, scene count, maximum parameter count, process-lite alpha, and an optional voice indicator color palette; SHALL NOT accept an independent gesture count in group configuration; SHALL size parameter per-scene/per-gesture arrays from the owning manager's gesture count injected by `ParameterManager::CreateGroup`; SHALL allocate per-parameter subarrays upfront through a group-owned allocator; and SHALL perform no heap allocation during `Compute`, `ProcessLite`, `Get`, routed shift-press, routed tick handling, or routed press handling after any needed modulation-depth parameters for that view have already been materialized. Routed press MAY lazily materialize missing modulation-depth parameter objects from preconfigured group capacity when opening a modulation view.

#### Scenario: Same-shaped group parameters
- **WHEN** two parameters are created in the same group
- **THEN** both parameters have subarrays sized from the same group shape and the owning manager's gesture count

#### Scenario: Allocation exhaustion
- **WHEN** creating a parameter would exceed the group allocator capacity
- **THEN** creation fails without registering a partial parameter in the manager or any bank

#### Scenario: Gesture count is not group-owned
- **WHEN** a manager is configured with two gestures and creates parameters in multiple groups
- **THEN** each parameter's per-scene/per-gesture arrays are sized for two gestures
- **AND** no group can diverge to a separate gesture count

#### Scenario: Voice indicator colors come from group palette
- **WHEN** a group is configured with two voices and explicit voice indicator colors
- **THEN** parameter UI state for parameters in that group uses those colors for voice 0 and voice 1 indicators

#### Scenario: Default voice indicator colors are deterministic
- **WHEN** a group is configured without explicit voice indicator colors
- **THEN** the group derives voice indicator colors from the ordered default palette `[Cyan, Orange, Green, Indigo, Yellow, Blue]`
- **AND** voices beyond that palette use deterministic evenly spaced HSV hues

### Requirement: spm-6 — Gestures: values, selection, metadata, and active flags
WHEN the synth parameter system owns gestures, THE `ParameterManager` SHALL own one `Gestures` state containing global gesture values, selected flags, and per-gesture metadata, while each parameter SHALL store per-scene/per-gesture gesture values and active flags; gesture values and active flags SHALL NOT be stored per voice, and gesture selection SHALL NOT be stored per group.

#### Scenario: Gesture selection is global to manager
- **WHEN** gesture 1 is selected on the manager
- **THEN** all parameters in every group observe gesture 1 as selected for edit routing

#### Scenario: Parameter gesture state is per scene
- **WHEN** a gesture is active for scene 0 on one parameter
- **THEN** the same gesture can remain inactive for scene 1 and for other parameters

#### Scenario: Gesture metadata is shared
- **WHEN** gesture 1 metadata is changed on the manager
- **THEN** every group and UI snapshot reads the same gesture 1 metadata

### Requirement: spm-8 — Compute: scene and gesture interpolation
WHEN `Parameter::Compute()` calculates a target center, THE parameter SHALL first compute the base scene value as `sceneCenter[leftScene] * (1 - blend) + sceneCenter[rightScene] * blend`; SHALL compute each gesture's blended gesture value from the parameter's scene gesture values; SHALL compute each gesture's effective weight from the manager-owned gesture value where that gesture is active in the blended scenes; SHALL use the base scene value when no effective gesture weight is active; and SHALL otherwise use the weighted average of `base * (1 - weight) + gestureValue * weight` across active gestures.

#### Scenario: Scene blend without active gestures
- **WHEN** left scene center is `0.2`, right scene center is `0.8`, blend is `0.25`, and no gesture has effective weight
- **THEN** the raw target center is `0.35`

#### Scenario: Active gesture blends from base to gesture value
- **WHEN** base is `0.4`, one gesture has blended gesture value `0.9`, and its manager-owned effective weight is `0.5`
- **THEN** the raw target center is `0.65`

#### Scenario: Cross-group parameters use the same gesture weight
- **WHEN** two parameters in different groups have gesture 1 active
- **AND** the manager-owned gesture 1 value is `0.5`
- **THEN** both parameters compute gesture 1's effective weight from the same manager-owned value

### Requirement: spm-9 — Compute: signed modulation normalization
WHEN `Parameter::Compute()` calculates per-voice modulation depths, THE parameter SHALL derive the normalization factor from `sum(abs(rawDepth[voice][modIx]))`; SHALL use each raw depth unchanged when the factor is less than or equal to `1`; SHALL divide every raw depth by the factor when the factor is greater than `1`; SHALL set the per-voice center scale to `max(0, 1 - normalizationFactor)`; SHALL derive a per-voice normalization offset from the effective normalized depths as `-sum(min(0, effectiveDepth[voice][modIx]))`; and SHALL include that offset in both target and current audio-rate reads before adding the modulator dot product. `ProcessLite` SHALL slew the normalization offset with the same control-rate smoothing model as center scale and modulation depths.

#### Scenario: Mixed positive and negative depths offset the unipolar modulator range
- **WHEN** a unipolar parameter has raw depths `+0.25` and `-0.5`
- **THEN** its center scale is `0.25`
- **AND** its normalization offset is `0.5`
- **AND** audio-rate reads use `center * 0.25 + 0.5 + mod0 * 0.25 + mod1 * -0.5`

#### Scenario: Overfull mixed depths derive offset after normalization
- **WHEN** a unipolar parameter has raw depths `+1.0` and `-1.0`
- **THEN** its effective depths are `+0.5` and `-0.5`
- **AND** its normalization offset is `0.5`
- **AND** the offset is not derived from the unnormalized negative raw depth

### Requirement: spm-10 — Compute: dynamic modulation min/max
WHEN `Parameter::Compute()` calculates per-voice modulation state, THE parameter SHALL also compute per-voice target minimum and maximum values representing the audio-rate range reachable from unipolar `[0, 1]` modulation sources; SHALL slew current minimum and maximum values in `ProcessLite`; and SHALL publish the current minimum and maximum values through `Parameter::UIState::minValues` and `Parameter::UIState::maxValues`. If `sum(abs(rawDepth[voice][modIx])) > 1`, the target min/max SHALL be the full parameter range (`0..1` for unipolar and `-1..1` for bipolar). Otherwise, min/max SHALL be computed from the current effective formula as `base + sum(min(0, effectiveDepth))` and `base + sum(max(0, effectiveDepth))`, clamped to the parameter range, where `base = center * centerScale + normalizationOffset`.

#### Scenario: UI state publishes dynamic underfull min/max
- **WHEN** a unipolar parameter with center `0.5` has raw depths `+0.25` and `-0.5`
- **THEN** its UI-state minimum is `0.125`
- **AND** its UI-state maximum is `0.875`

#### Scenario: UI state publishes full range for overfull depths
- **WHEN** a bipolar parameter has `sum(abs(rawDepths)) > 1`
- **THEN** its UI-state minimum is `-1.0`
- **AND** its UI-state maximum is `1.0`

### Requirement: spm-16 — Gesture API: external selection and values
WHEN external code controls gestures, THE parameter manager SHALL default to zero gestures, expose a non-replacing pre-group setup API to set gesture count before any group is created, reject or report failure for gesture-count changes after group creation, and expose runtime functions to select and deselect gestures, set gesture values, read gesture selected state, read gesture values, read and write gesture metadata, and clear a gesture's active flags across parameters for the active scene selection.

#### Scenario: External select gesture
- **WHEN** external code selects gesture 3 on the manager
- **THEN** subsequent parameter edits in every group treat gesture 3 as selected

#### Scenario: External change gesture value
- **WHEN** external code sets gesture 3 value to `0.75` on the manager
- **THEN** the next control-rate `Compute()` uses `0.75` as gesture 3's weight where that gesture is active

#### Scenario: External clear gesture active flags
- **WHEN** external code clears gesture 3 active flags for the active scene selection
- **THEN** matching gesture 3 active flags are cleared across parameters in every group owned by the manager

#### Scenario: Gesture count configuration precedes group creation
- **WHEN** a manager is constructed or configured with four gestures before groups are created
- **THEN** gesture APIs accept indices 0 through 3
- **AND** parameters created later allocate four per-scene gesture slots

#### Scenario: Gesture count cannot change after group creation
- **WHEN** a manager has created any group
- **THEN** attempting to change the manager gesture count fails or is rejected without resizing existing group arenas

### Requirement: spm-17 — Scene API: validated global scene endpoints
WHEN external or direct code changes manager scene endpoints, THE parameter manager SHALL expose a validated scene-endpoint setter used by tests, direct routing, and new external code; the setter SHALL accept endpoints only when both endpoint indices are valid for every existing group, SHALL leave existing scene state unchanged on rejection, and SHALL leave scene blend unchanged on endpoint changes. The parameter manager SHALL also expose a scene-selection API that accepts one scene ordinal, writes it to the less-selected endpoint of the current scene blend, writes the right endpoint when blend is exactly `0.5`, and rejects invalid ordinals without changing scene state.

#### Scenario: Direct scene setter accepts compatible endpoints
- **WHEN** all groups support scenes `0` through `2`
- **AND** direct code sets scene endpoints to left `1` and right `2` through the manager setter
- **THEN** the manager scene endpoints become `1` and `2`
- **AND** the previous scene blend is unchanged

#### Scenario: Direct scene setter rejects incompatible endpoints
- **WHEN** any existing group supports only scene `0`
- **AND** direct code tries to set scene endpoint `1` through the manager setter
- **THEN** the setter rejects the change
- **AND** the previous manager scene endpoints and blend remain unchanged

#### Scenario: Direct less-selected scene selection
- **WHEN** the manager scene endpoints are left `0` and right `2`
- **AND** the scene blend is `0.75`
- **AND** direct code selects scene `1` through the manager scene-selection API
- **THEN** the manager left scene endpoint becomes `1`
- **AND** the right scene endpoint remains `2`
- **AND** the previous scene blend is unchanged

### Requirement: spm-18 — Tests: deterministic randomized simulation oracle
WHEN automated tests cover the synth parameter modulation system, THE test suite SHALL include deterministic randomized simulation tests that repeatedly choose actions from encoder turns, encoder presses, shift presses, manager-owned gesture select/deselect, manager-owned gesture value changes, page changes, bank selection, scene changes, blend changes, modulator value changes, compute, and process-lite, and SHALL verify after each action against a separate deterministic oracle model maintained outside the production parameter classes.

#### Scenario: Random action loop checks invariants
- **WHEN** a randomized simulation test runs one seed
- **THEN** every action is followed by checks for expected page, bank, slot, scene, manager-owned gesture, parameter, modulation-route, target, current, and `Get(voiceIx)` state

#### Scenario: Cross-group gesture invariants are checked
- **WHEN** the randomized simulation includes parameters from multiple groups
- **THEN** the oracle checks that gesture selection and gesture values are manager-owned and observed consistently by all groups

#### Scenario: Failure is reproducible
- **WHEN** the randomized simulation detects a mismatch
- **THEN** the failure output includes seed, step number, action, affected parameter or physical encoder ID, and the mismatched expected and actual values

#### Scenario: Default and stress modes
- **WHEN** the normal synth test suite runs
- **THEN** randomized tests use a bounded fixed seed set suitable for routine automation
- **AND** the test binary provides an opt-in way to run larger seed and step counts locally

## ADDED Requirements

### Requirement: spm-19 — Color: UI-safe RGB and HSV helpers
WHEN external UI state or message-thread rendering needs colors from the synth parameter system, THE synth parameter modulation system SHALL provide a small trivially copyable 32-bit RGB color type with equality, brightness adjustment, named basic colors, `ToHSV`, and `FromHSV` helpers, without requiring JUCE or Smart Grid headers, and SHALL make color UI-state storage lock-free by storing colors as one atomic 32-bit value or an equivalently lock-free representation.

#### Scenario: Convert color through HSV
- **WHEN** a synth color is converted to HSV and back to RGB
- **THEN** the resulting color matches the original within one 8-bit channel step

#### Scenario: Core color has no JUCE dependency
- **WHEN** the synth library is built without the miniapp target
- **THEN** public synth headers expose synth color types only
- **AND** do not include JUCE headers or expose `juce::Colour`

#### Scenario: Color atomics are lock-free
- **WHEN** color UI state is compiled on the supported build target
- **THEN** color storage is represented as a lock-free atomic 32-bit value or equivalent

### Requirement: spm-20 — UI State: parameter and visible-cell snapshots
WHEN a parameter or visible-cell UI snapshot is populated, THE synth parameter modulation system SHALL write a `Parameter::UIState` whose scalar fields are individually atomic and which contains the parameter color from `ParameterConfig`, connected state, bipolar flag, short name pointer or stable short name view, per-voice current values, per-voice minimum values, per-voice maximum values, per-voice switch bucket values, switch cardinality, synth-native modulator/gesture affecting bitmasks, and per-voice indicator colors from the owning group's voice indicator palette for every configured voice; disconnected visible cells SHALL use `connected=false` with neutral values and off colors instead of a separate page/navigation role; bipolar parameter UI values and min/max values SHALL be reported in `[-1, 1]`, while unipolar parameter UI values and min/max values SHALL be reported in `[0, 1]`.

#### Scenario: Parameter UI state reports current per-voice values
- **WHEN** a parameter has two voices with different current modulator values
- **AND** `Parameter::PopulateUIState` is called after compute/process work
- **THEN** the UI state exposes the same per-voice values that `Parameter::Get(voiceIx)` returns

#### Scenario: Parameter UI state reports configured color
- **WHEN** a parameter is configured with color `C`
- **AND** `Parameter::PopulateUIState` is called
- **THEN** the UI state reports parameter color `C`

#### Scenario: Parameter UI state reports group voice indicator colors
- **WHEN** a parameter belongs to a group whose voice indicator palette contains colors `A` and `B`
- **AND** `Parameter::PopulateUIState` is called
- **THEN** voice 0 indicator color is `A`
- **AND** voice 1 indicator color is `B`

#### Scenario: Bipolar UI state reports signed values
- **WHEN** a bipolar parameter has current voice values `-0.5` and `0.75`
- **AND** `Parameter::PopulateUIState` is called
- **THEN** the UI state reports the bipolar flag as true
- **AND** reports per-voice values `-0.5` and `0.75`
- **AND** reports minimum value `-1` and maximum value `1`

#### Scenario: Unipolar UI state reports unipolar values
- **WHEN** a unipolar parameter UI state is populated
- **THEN** the UI state reports the bipolar flag as false
- **AND** reports minimum value `0` and maximum value `1`

#### Scenario: Parameter UI state reports switch metadata
- **WHEN** a switch/discrete parameter UI state is populated
- **THEN** the UI state reports the parameter's switch cardinality
- **AND** reports each voice's precomputed switch bucket value using the same helper as `Parameter::GetSwitchVal(voiceIx)`

#### Scenario: Parameter UI state reports affecting masks
- **WHEN** a parameter has active or assigned modulation/gesture relationships that should be visible to the external encoder renderer
- **THEN** the UI state reports synth-native modulator and gesture affecting bitmasks
- **AND** those masks do not use Smart Grid `BitSet16` or Smart Grid enum types
- **AND** the masks cover the first 32 modulator and gesture indices only, omitting higher indices from badge rendering without constraining the underlying synth topology
- **AND** a modulator bit is set when the parameter has an assigned modulation-depth parameter for that modulator
- **AND** a gesture bit is set when the parameter has that gesture active in the manager's active scene selection: left scene only at blend 0, right scene only at blend 1, and both endpoint scenes for intermediate blends

#### Scenario: Unused UI state voices are disconnected or neutral
- **WHEN** a UI state has capacity for more voices than the parameter group uses
- **THEN** populated voice entries beyond the configured voice count are neutral and do not report stale values as connected

#### Scenario: Modulation target cell stays parameter-owned
- **WHEN** a visible bank cell is the target encoder in an open modulation view
- **AND** slot UI state is populated
- **THEN** that reserved `Parameter::UIState` reports `connected=true`
- **AND** it reports the target parameter's switch cardinality, per-voice switch buckets, affecting masks, color, short name, bipolar flag, and values exactly as the target parameter would outside the modulation view
- **AND** renderers do not distinguish this cell from normal parameter cells through parameter UI-state page/navigation data

#### Scenario: Short name lifetime is stable
- **WHEN** a parameter UI state exposes a short name pointer or stable view
- **THEN** that reference remains valid for the lifetime of the owning manager topology
- **AND** UI state consumers do not retain it after the manager or parameter is destroyed

### Requirement: spm-21 — UI State: slot, bank, gesture, and manager snapshots
WHEN manager-level UI state is populated, THE synth parameter modulation system SHALL populate a parallel atomic UI-state tree for selected slot bank views, visible parameter cells, per-slot modulation-view active state, manager-owned gesture values and selected flags, scene selection, scene blend, and shift-held state, while marking unused visible cells disconnected through each reserved visible cell's embedded `Parameter::UIState.connected` flag.

#### Scenario: Manager creates pre-sized UI state
- **WHEN** external code requests a manager UI state after the parameter topology is configured
- **THEN** the manager provides a setup or factory API that returns or initializes a non-copyable UI-state tree sized from current manager topology, including slots, slot physical-encoder counts, group voice counts, and manager gesture count
- **AND** `PopulateUIState` performs no UI-state array allocation

#### Scenario: UI state is not copyable or resizable during population
- **WHEN** UI state contains atomic scalar fields
- **THEN** UI-state arrays are allocated to final capacity during setup
- **AND** the implementation does not rely on copying, moving, or resizing atomic UI-state elements during population

#### Scenario: Slot UI state follows selected bank
- **WHEN** a slot changes from bank 0 to bank 1
- **AND** manager UI state is populated
- **THEN** the slot UI state contains bank 1's visible parameter cells
- **AND** no visible cells from bank 0 remain connected unless they are also visible in bank 1

#### Scenario: Modulation view appears in slot UI state
- **WHEN** a parameter push opens that parameter's modulation-depth view
- **AND** manager UI state is populated
- **THEN** the selected slot UI state contains the visible modulation-depth parameters and the target parameter at the final visible position for that bank view
- **AND** reports that the slot is showing a modulation view

#### Scenario: Gesture UI state exposes values and selection
- **WHEN** gesture 1 is selected and has value `0.75`
- **AND** manager UI state is populated
- **THEN** the gesture UI state reports gesture 1 as selected with value `0.75`

#### Scenario: Gesture UI state is manager-wide
- **WHEN** a manager owns parameters in multiple groups
- **AND** manager UI state is populated
- **THEN** the gesture UI state appears once for the manager
- **AND** does not expose separate group-local gesture selections

#### Scenario: Slot UI positions follow slot encoder order
- **WHEN** a slot has physical encoders added in the order `[10, 12, 11]`
- **AND** the selected bank has visible cells for those encoders
- **THEN** slot UI position 0 reports the visible cell for encoder 10
- **AND** slot UI position 1 reports the visible cell for encoder 12
- **AND** slot UI position 2 reports the visible cell for encoder 11

#### Scenario: Empty visible cell uses embedded parameter connection flag
- **WHEN** a selected bank has no visible cell for a slot UI position
- **THEN** the reserved parameter UI state at that position has `connected` set to false
- **AND** no separate slot-level connected flag contradicts it

#### Scenario: Bank exposes visible parameter for slot population
- **WHEN** a bank slot populates UI state for a physical encoder
- **THEN** it uses a bank accessor that returns the visible parameter pointer for that encoder
- **AND** target cells in an open modulation view populate through the same parameter UI-state path as any other connected parameter cell
- **AND** modulation-return behavior is handled by bank press routing, not by parameter UI-state data

### Requirement: spm-22 — Message input: command model
WHEN external UI or MIDI code sends commands to the synth parameter system, THE system SHALL represent each command as a timestamped `MessageIn` with no route field and with typed support for `ParamIncDec`, `ParamPush`, `ToggleShift`, `ToggleGestureSelect`, `SelectParamBank`, `Start`, `Stop`, `Clock`, `SetGestureValue`, `SceneSelect`, and `SetSceneBlend`.

#### Scenario: Parameter messages carry slot and position
- **WHEN** a parameter inc/dec or push message is created
- **THEN** the message carries the target slot index and visible position
- **AND** does not require a physical encoder ID from the sender

#### Scenario: Slot position maps through slot encoder order
- **WHEN** a parameter message targets slot position `i`
- **THEN** the manager resolves position `i` to the physical encoder at index `i` in that slot's `AddPhysicalEncoder` order
- **AND** routes the resolved physical encoder ID through the selected bank's visible cells

#### Scenario: Gesture messages carry gesture index
- **WHEN** a gesture select toggle or gesture value message is created
- **THEN** the message carries the gesture index
- **AND** the value-setting message also carries the normalized gesture value

#### Scenario: Bank selection carries slot and bank
- **WHEN** a parameter bank selection message is created
- **THEN** the message carries which slot to set and which bank index to select
- **AND** the bank index refers to the manager's global bank list

#### Scenario: Scene selection carries one ordinal
- **WHEN** a scene selection message is created
- **THEN** the message carries one scene ordinal
- **AND** does not change scene blend unless a scene blend message is also processed

### Requirement: spm-23 — Message bus: queued timestamp processing
WHEN a `MessageInBus` processes messages, THE synth parameter modulation system SHALL use a bounded single-producer/single-consumer queue that accepts `MessageIn` values, assumes producers push messages in nondecreasing timestamp order, pops only messages whose timestamp is visible at the supplied process timestamp from the queue head, and applies visible messages in FIFO order to the attached `ParameterManager`; callers that need multiple producers SHALL serialize externally before calling `Push`.

#### Scenario: Future message waits
- **WHEN** the bus contains a message timestamped after the current process timestamp
- **THEN** `Process(currentTimestamp)` leaves that message queued
- **AND** does not apply it to the manager

#### Scenario: Visible messages apply in order
- **WHEN** the bus contains multiple messages with timestamps at or before the current process timestamp
- **THEN** `Process(currentTimestamp)` applies them to the manager in insertion order

#### Scenario: Queue overflow is reported
- **WHEN** the queue is full
- **THEN** pushing another message fails without corrupting already queued messages

#### Scenario: Future head message blocks later messages
- **WHEN** the queue head has a timestamp after the current process timestamp
- **THEN** `Process(currentTimestamp)` leaves that message and all later messages queued

#### Scenario: Single producer and single consumer can operate concurrently
- **WHEN** one producer thread pushes timestamp-ordered messages
- **AND** one consumer thread processes visible messages
- **THEN** the bus preserves message integrity and FIFO order within the supported single-producer/single-consumer contract

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

#### Scenario: Gesture value through bus is manager-owned
- **WHEN** a `SetGestureValue` message sets gesture 1 to `0.75`
- **THEN** bus processing updates the manager-owned gesture 1 value
- **AND** parameters in every group observe `0.75` on the next compute where gesture 1 is active

### Requirement: spm-25 — Tests: message-driven randomized UI-state simulation
WHEN automated tests cover the external synth parameter control surface, THE test suite SHALL include a deterministic randomized simulation that drives the existing operation set through `MessageInBus`, includes bank selection as a message-driven operation, periodically populates UI state, and verifies UI-state atomics against the separate deterministic oracle model.

#### Scenario: Bus random test matches model
- **WHEN** the message-driven randomized simulation runs one seed
- **THEN** every applied visible message leaves manager, parameter, bank, slot, gesture, scene, and modulation state matching the oracle

#### Scenario: UI state checks match oracle
- **WHEN** the randomized simulation calls `PopulateUIState`
- **THEN** every connected visible parameter UI cell matches the oracle's expected visible parameter, per-voice values, per-voice switch buckets when switch metadata is configured, bipolar flag, signed bipolar or unipolar min/max values, color, indicator colors, modulator/gesture affecting masks for the first 32 visible indices, manager-owned gesture values, selected flags, scene selection, scene blend, and shift-held state

#### Scenario: Existing randomized oracle is migrated to manager-owned gestures
- **WHEN** the randomized simulation creates parameters in multiple groups
- **THEN** its oracle stores gesture values and selection at manager scope rather than group scope

#### Scenario: Cross-group randomized scenes are compatible
- **WHEN** the randomized simulation includes auxiliary-group parameters in cross-group checks
- **THEN** the auxiliary group has scene capacity compatible with the manager scene endpoint range used by the simulation
- **AND** scene endpoint changes go through the manager's validated setter

#### Scenario: Failure output is reproducible
- **WHEN** the message-driven randomized simulation detects a mismatch
- **THEN** the failure output includes seed, step number, message/action, and the mismatched expected and actual UI or model field

### Requirement: spm-26 — Miniapp: JUCE external control probe
WHEN the synth external UI/message layer is implemented, THE repository SHALL contain a `projects/synth/miniapp` JUCE application that demonstrates the parameter system through `MessageInBus` and UI-state snapshots while keeping JUCE code outside core synth library headers and sources.

#### Scenario: Miniapp shows current feature set
- **WHEN** the miniapp runs
- **THEN** it displays reusable synth JUCE encoder components, buttons, and sliders for at least two voices, at least two parameter banks, three scene selection buttons, scene blend, visible left/right scene endpoint state, gesture selection, gesture value, latching shift state, and one modulation source

#### Scenario: Miniapp uses local JUCE checkout
- **WHEN** the miniapp target is built in this repository layout
- **THEN** it uses the developer-local `~/JUCE` checkout by default or documents the missing local dependency precisely

#### Scenario: Miniapp double-click creates modulation view
- **WHEN** the user double-clicks an encoder representing a top-level parameter
- **THEN** the miniapp sends a parameter push message through `MessageInBus`
- **AND** the visible UI updates to show modulation-depth controls for that parameter and the target parameter at the final visible position

#### Scenario: Miniapp modulator uses two voice sine offsets
- **WHEN** the miniapp timer advances the demo modulation source
- **THEN** voice 0 receives a sine-wave modulation value
- **AND** voice 1 receives the same sine wave offset by 90 degrees

#### Scenario: Miniapp converts colors at JUCE boundary
- **WHEN** the miniapp paints synth UI state
- **THEN** it converts `synth::Color` to `juce::Colour` in miniapp code
- **AND** core synth files remain free of JUCE includes

### Requirement: spm-27 — Reusable JUCE encoder component
WHEN the synth external UI/message layer provides a JUCE encoder renderer, THE repository SHALL provide a reusable synth JUCE encoder component outside core synth headers and sources, mechanically modeled on Smart Grid's encoder component while binding to synth UI-state and `MessageInBus` types.

#### Scenario: Encoder component is reusable outside the miniapp
- **WHEN** a JUCE surface needs to render one visible parameter cell
- **THEN** it can instantiate the reusable synth encoder component from the segregated JUCE layer
- **AND** bind it to a `synth::Parameter::UIState`, optional `synth::MessageInBus`, slot index, and slot position
- **AND** does not need to copy renderer code from the miniapp

#### Scenario: Encoder sends message bus interactions
- **WHEN** the user drags the reusable encoder
- **THEN** it sends a parameter inc/dec message through `MessageInBus` for the configured slot and position
- **WHEN** the user double-clicks the reusable encoder
- **THEN** it sends a parameter push message through `MessageInBus` for the configured slot and position

#### Scenario: Encoder renders Smart Grid geometry
- **WHEN** the reusable encoder paints a connected cell with multiple voices
- **THEN** it renders Smart Grid-style encoder geometry, including concentric per-voice rings, min/max arcs, indicator dots, color conversion at the JUCE boundary, and connected/off state handling from synth UI-state atomics

#### Scenario: Encoder renders bipolar values
- **WHEN** the reusable encoder paints a cell whose UI state has `bipolar=true`
- **THEN** raw values and min/max ranges remain exposed as `[-1, 1]` in UI state
- **AND** the renderer maps those values into `[0, 1]` arc space only for drawing

#### Scenario: Encoder renders switch parameters
- **WHEN** a connected cell's UI state has `switchValues > 1`
- **THEN** the reusable encoder draws visible switch gaps on base and min/max arcs
- **AND** draws each voice's precomputed UI-state switch bucket as a visually separated highlighted segment

#### Scenario: Encoder renders affecting badges
- **WHEN** a connected cell's UI state reports modulator or gesture affecting bitmasks
- **THEN** the reusable encoder draws Smart Grid-style badge geometry from those masks
- **AND** uses synth-owned modulator/gesture metadata colors or neutral fallback colors
- **AND** does not depend on Smart Grid bitmap glyph assets

#### Scenario: Encoder shows 14-segment display
- **WHEN** the reusable encoder paints a connected parameter cell
- **THEN** it uses the ported 14-segment display component in the lower gap
- **AND** the display is hardcoded on rather than replaced by Smart Grid's rounded color-pill fallback
- **AND** it shows the short name from UI state
- **AND** it does not derive navigation labels from parameter UI-state data

### Requirement: spm-28 — Switch/discrete parameter UI state
WHEN synth parameters represent discrete or switch-like values, THE synth parameter modulation system SHALL expose the switch cardinality and per-voice switch bucket in parameter config, parameter API, and atomic UI state without introducing a separate discrete parameter type in this change.

#### Scenario: Parameter exposes switch value
- **WHEN** a parameter has `switchValues <= 1`
- **THEN** `Parameter::IsSwitch()` is false
- **AND** `Parameter::GetSwitchVal(voiceIx)` returns 0
- **WHEN** a parameter has `switchValues > 1`
- **THEN** `Parameter::IsSwitch()` is true
- **AND** `Parameter::GetSwitchVal(voiceIx)` rounds the display-normalized unslewed value to `[0, switchValues - 1]`

#### Scenario: UI state carries switch values
- **WHEN** `Parameter::PopulateUIState` populates a connected parameter cell
- **THEN** `Parameter::UIState::switchValues` stores that parameter's switch cardinality
- **AND** per-voice switch bucket atomics store the values returned by `Parameter::GetSwitchVal(voiceIx)`
- **WHEN** a cell is disconnected or empty
- **THEN** `switchValues` and per-voice switch bucket atomics are reset to 0

#### Scenario: Switch values remain JUCE-free
- **WHEN** switch metadata is added to the synth core
- **THEN** it is represented only by core C++ parameter config/API/UI-state fields
- **AND** no JUCE headers or types are introduced into core synth headers or sources
