## ADDED Requirements

### Requirement: spm-63 — Modifiers: reset, random, and random-mod
WHEN the synth parameter modulation system tracks control modifiers, THE `ParameterManager` SHALL track independent reset-held, random-held, and random-mod-held state, expose a `GetCurrentModifier` API returning an enum value of none, reset, random, or random-mod, and resolve the effective modifier as random-mod before random before reset before none.

#### Scenario: No modifier held
- **WHEN** reset, random, and random-mod are not held
- **THEN** `GetCurrentModifier` returns none

#### Scenario: Reset modifier held
- **WHEN** reset is held
- **AND** random and random-mod are not held
- **THEN** `GetCurrentModifier` returns reset

#### Scenario: Random takes precedence over reset
- **WHEN** reset and random are both held
- **AND** random-mod is not held
- **THEN** `GetCurrentModifier` returns random

#### Scenario: Random-mod takes precedence
- **WHEN** random-mod is held
- **THEN** `GetCurrentModifier` returns random-mod regardless of reset-held or random-held state

#### Scenario: Random value edit leaves modulation routes
- **WHEN** a random modifier operation targets a visible top-level parameter
- **THEN** the system samples one normalized value and routes the delta from the parameter's current effective knob value to that sampled value through the same active scene and gesture distribution rules as direct knob edits
- **AND** leaves existing modulation-depth parameter assignments attached
- **AND** leaves modulation-depth parameter values unchanged

#### Scenario: Random-mod uses geometric modulation count
- **WHEN** a random-mod modifier operation targets a parameter with available modulator slots
- **THEN** the system repeats while the random coin sample is less than `0.5`
- **AND** each successful iteration chooses one random modulator slot with replacement
- **AND** randomizes the existing depth parameter in that slot when present
- **AND** otherwise materializes the slot's modulation-depth parameter through the normal capacity-checked path and randomizes that created depth parameter

#### Scenario: Random-mod stops when materialization is unavailable
- **WHEN** a random-mod modifier operation chooses an empty modulator slot
- **AND** that slot's modulation-depth parameter cannot be materialized because parameter storage capacity is unavailable
- **THEN** the operation stops without consuming further random-mod loop samples
- **AND** preserves all earlier random-mod edits from the same operation

#### Scenario: Random-mod can perform zero edits
- **WHEN** the first random-mod coin sample is greater than or equal to `0.5`
- **THEN** the operation performs no modulation edits
- **AND** leaves the target parameter value and modulation routes unchanged

#### Scenario: Random-mod with no modulators is a no-op
- **WHEN** a random-mod modifier operation targets a parameter in a group with zero modulators
- **THEN** the operation leaves the target parameter value and modulation routes unchanged

#### Scenario: Random source is reproducible in tests
- **WHEN** tests install or seed the random source used by modifier operations
- **THEN** random value samples, random-mod coin samples, and random-mod slot selections are reproducible for the same seed

## MODIFIED Requirements

### Requirement: spm-4 — Group config: dynamic shape and upfront allocation
WHEN a `ParameterGroup` is configured, THE group SHALL use runtime configuration for voice count, modulator count, scene count, maximum parameter count, process-lite alpha, and an optional voice indicator color palette; SHALL NOT accept an independent gesture count in group configuration; SHALL size parameter per-scene/per-gesture arrays from the owning manager's gesture count injected by `ParameterManager::CreateGroup`; SHALL allocate per-parameter subarrays upfront through a group-owned allocator; and SHALL perform no heap allocation during `Compute`, `ProcessLite`, `Get`, routed reset-modifier press, routed random-modifier press, routed tick handling, or routed unmodified press handling after any needed modulation-depth parameters for that view have already been materialized. Routed unmodified press and random-mod modifier operations MAY lazily materialize missing modulation-depth parameter objects from preconfigured group capacity.

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

### Requirement: spm-13 — Revert: defaults and modulation clearing
WHEN a parameter is reverted to default for the current scene selection, THE parameter SHALL clear all modulation-depth parameter assignments, zero current and target modulation depth arrays, set applicable scene center values to the default normalized value, set applicable scene gesture active flags to false, and update current/target center consistently with the owning group's slew and recursion-depth rules.

#### Scenario: Reset modifier clears modulation
- **WHEN** a routed reset-modifier press resets a parameter
- **THEN** the parameter has no non-null modulation-depth parameter pointers
- **AND** `Get(voiceIx)` returns the default-centered value after compute/process settling with zero modulators

### Requirement: spm-15 — Banks and slots: press, shift-press, and tick routing
WHEN a bank handles a press on a mapped physical encoder, THE bank SHALL populate the pressed parameter's visible modulation-depth cells from parent-owned modulation-depth controls, SHALL materialize missing modulation-depth controls as local bipolar default-zero controls when group capacity allows, SHALL NOT append those modulation-depth controls to the manager global parameter list, SHALL initialize lazily materialized modulation-depth control short name and color from the corresponding modulator metadata, SHALL derive an effective depth control name from the target parameter name plus the modulator metadata name when the metadata name is non-empty, SHALL derive an effective fallback name from the target parameter name plus the one-based modulation index when the metadata name is empty, and SHALL place the selected top-level parameter in the final physical slot position as the return cell when the press is routed through a `BankSlot`; direct bank presses without a slot layout SHALL use the bank's compact top-level mapping order as the physical layout fallback. If a routed slot has `N` physical positions, THE system SHALL reserve position `N - 1` for the return cell, SHALL use positions `0..N-2` for modulation-depth cells, SHALL leave unused positions before the return cell disconnected, and SHALL treat `numModulators > N - 1` as a configuration error. Pressing a modulation cell with no effective modifier SHALL open that modulation control's modulation view; pressing the return cell with no effective modifier SHALL restore the top-level bank; tick SHALL route to the parameter or modulation-depth control visible in the cell; reset-modifier press SHALL revert the visible top-level parameter to default and neutralize its modulation-depth subtree without deleting those controls; random-modifier press SHALL randomize the visible knob value while leaving that target's modulation routes intact; random-mod modifier press SHALL apply geometric modulation randomization to the visible target; and routed manager/slot APIs SHALL dispatch press and tick/inc-dec events by physical encoder ID to the selected bank.

#### Scenario: Press opens modulation view
- **WHEN** a bank is showing top-level parameters and the user presses a parameter encoder through a slot with no effective modifier
- **THEN** the bank shows that parameter's modulation-depth cells in the first slot positions
- **AND** shows the selected parameter as the return cell in the final slot position

#### Scenario: Slot gap remains disconnected
- **WHEN** a slot has three physical positions
- **AND** the pressed parameter's group has one modulator
- **THEN** the modulation-depth cell occupies the first slot position
- **AND** the middle slot position is disconnected
- **AND** the return cell occupies the third slot position

#### Scenario: Too many modulators for slot layout is an error
- **WHEN** a slot has three physical positions
- **AND** the pressed parameter's group has three modulators
- **THEN** opening that parameter's modulation view fails as a configuration error because no final slot position remains reserved for return

#### Scenario: Lazy depth metadata follows modulator
- **WHEN** opening a modulation view materializes a missing depth control for target parameter `Carrier` and modulator `0`
- **AND** modulator `0` has name `Filter Env`, short name `Env`, and color `Cyan`
- **THEN** the created depth control has name `Carrier Filter Env`
- **AND** has short name `Env`
- **AND** has color `Cyan`

#### Scenario: Duplicate modulator names remain unique per parent
- **WHEN** two target parameters both materialize local depth controls for a modulator named `Filter Env`
- **THEN** each created depth control name includes its target parameter name
- **AND** manager global parameter registration is not involved

#### Scenario: Empty modulator name uses indexed fallback
- **WHEN** opening a modulation view materializes a missing depth control for target parameter `Carrier` and modulator `1`
- **AND** modulator `1` has no name
- **THEN** the created depth control has name `Carrier Mod Depth 2`

#### Scenario: Reset keeps depth controls attached
- **WHEN** a reset-modifier press resets a parameter that owns modulation-depth controls
- **THEN** the parameter returns to its default value
- **AND** its modulation-depth controls are reset to neutral zero values
- **AND** those controls remain attached to the parent parameter for future modulation-view routing

#### Scenario: Random leaves depth controls attached
- **WHEN** a random-modifier press targets a parameter that owns modulation-depth controls
- **THEN** the parameter's active knob value changes to a generated normalized value
- **AND** its modulation-depth controls remain attached
- **AND** its modulation-depth control values remain unchanged

#### Scenario: Random-mod materializes depth controls
- **WHEN** a random-mod modifier press targets a top-level parameter with at least one empty modulator slot
- **AND** the random-mod loop chooses that empty slot
- **THEN** the system materializes that slot's modulation-depth control through the normal modulation-view capacity path
- **AND** randomizes the created depth control value

#### Scenario: Return cell closes modulation view
- **WHEN** a modulation-depth view is open
- **AND** the return cell in the final slot position is pressed with no effective modifier
- **THEN** the bank restores the top-level parameter view

#### Scenario: Tick routes to selected bank
- **WHEN** the manager receives a tick for a physical encoder ID owned by a slot's selected bank
- **THEN** the manager routes the delta through the slot and bank to the mapped parameter's `HandleIncDec`

### Requirement: spm-18 — Tests: deterministic randomized simulation oracle
WHEN automated tests cover the synth parameter modulation system, THE test suite SHALL include deterministic randomized simulation tests that repeatedly choose actions from encoder turns, encoder presses, reset/random/random-mod modifier presses and releases, manager-owned gesture select/deselect, manager-owned gesture value changes, page changes, bank selection, modified bank actions, scene changes, blend changes, modulator value changes, compute, and process-lite, and SHALL verify after each action against a separate deterministic oracle model maintained outside the production parameter classes.

#### Scenario: Random action loop checks invariants
- **WHEN** a randomized simulation test runs one seed
- **THEN** every action is followed by checks for expected page, bank, slot, scene, manager-owned gesture, modifier, parameter, modulation-route, target, current, and `Get(voiceIx)` state

#### Scenario: Cross-group gesture invariants are checked
- **WHEN** the randomized simulation includes parameters from multiple groups
- **THEN** the oracle checks that gesture selection and gesture values are manager-owned and observed consistently by all groups

#### Scenario: Modifier invariants are checked
- **WHEN** the randomized simulation chooses reset, random, random-mod, press, or bank-selection actions
- **THEN** the oracle checks the effective modifier precedence and the resulting single modifier behavior

#### Scenario: Failure is reproducible
- **WHEN** the randomized simulation detects a mismatch
- **THEN** the failure output includes seed, step number, action, affected parameter or physical encoder ID, random samples consumed for that action, and the mismatched expected and actual values

#### Scenario: Default and stress modes
- **WHEN** the normal synth test suite runs
- **THEN** randomized tests use a bounded fixed seed set suitable for routine automation
- **AND** the test binary provides an opt-in way to run larger seed and step counts locally

### Requirement: spm-21 — UI State: slot, bank, gesture, and manager snapshots
WHEN manager-level UI state is populated, THE synth parameter modulation system SHALL populate a parallel atomic UI-state tree for selected slot bank views, visible parameter cells, per-slot modulation-view active state, manager-owned gesture values and selected flags, scene selection, scene blend, reset-held state, random-held state, and random-mod-held state, while marking unused visible cells disconnected through each reserved visible cell's embedded `Parameter::UIState.connected` flag.

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

#### Scenario: Modifier UI state exposes held states
- **WHEN** reset, random, or random-mod held state changes
- **AND** manager UI state is populated
- **THEN** the UI state reports each modifier's held state independently
- **AND** UI consumers can derive the same effective modifier as `GetCurrentModifier`

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
WHEN external UI or MIDI code sends commands to the synth parameter system, THE system SHALL represent each command as a timestamped `MessageIn` with no route field and with typed support for `ParamIncDec`, `ParamPush`, `ToggleReset`, `SetReset`, `ToggleRandom`, `SetRandom`, `ToggleRandomMod`, `SetRandomMod`, `ToggleGestureSelect`, `SetGestureSelect`, `SelectParamBank`, `Start`, `Stop`, `Clock`, `SetGestureValue`, `SceneSelect`, and `SetSceneBlend`.

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

### Requirement: spm-24 — Message bus: manager application
WHEN `MessageInBus` applies supported parameter, bank, gesture, scene, or modifier messages, THE system SHALL mutate the attached `ParameterManager` through manager-owned APIs so message-driven behavior matches direct manager, slot, bank, manager gesture, scene, and modifier calls.

#### Scenario: Inc/dec through bus edits visible parameter
- **WHEN** a `ParamIncDec` message targets slot 0 position 1 with delta `0.2`
- **AND** slot 0 position 1 is connected to a parameter in the selected bank
- **AND** the current modifier is none
- **THEN** bus processing applies the same parameter edit as the corresponding direct routed tick

#### Scenario: Modified inc/dec is ignored
- **WHEN** a `ParamIncDec` message targets a connected visible parameter
- **AND** the current modifier is reset, random, or random-mod
- **THEN** bus processing leaves the visible parameter value and modulation routes unchanged

#### Scenario: Push through bus opens modulation
- **WHEN** a `ParamPush` message targets a visible top-level parameter cell
- **AND** the current modifier is none
- **THEN** bus processing opens that parameter's modulation-depth view using the same rules as direct bank press handling

#### Scenario: Reset-held state affects reset routing
- **WHEN** reset is held through a reset message
- **AND** a `ParamPush` message targets a connected non-return parameter cell
- **THEN** bus processing routes that action through the same reset behavior as direct reset-modified press

#### Scenario: Random-held state affects random routing
- **WHEN** random is held through a random message
- **AND** a `ParamPush` message targets a connected parameter cell
- **THEN** bus processing randomizes that visible knob value
- **AND** leaves existing modulation-depth assignments and values unchanged

#### Scenario: Random-mod-held state affects modulation randomization
- **WHEN** random-mod is held through a random-mod message
- **AND** a `ParamPush` message targets a connected parameter cell
- **THEN** bus processing applies geometric modulation randomization to that visible target

#### Scenario: Bank select through bus deselects old bank view
- **WHEN** a `SelectParamBank` message selects bank 1 for a slot whose previous bank is showing a modulation view
- **AND** the current modifier is none
- **THEN** bus processing deselects the previous bank view
- **AND** selects bank 1 for subsequent slot-position messages

#### Scenario: Modified bank select resets target bank
- **WHEN** reset is the current modifier
- **AND** a `SelectParamBank` message targets bank 1
- **THEN** bus processing resets every top-level parameter mapped by bank 1
- **AND** leaves the slot's previously selected bank unchanged

#### Scenario: Modified bank select randomizes target bank values
- **WHEN** random is the current modifier
- **AND** a `SelectParamBank` message targets bank 1
- **THEN** bus processing randomizes every top-level parameter value mapped by bank 1
- **AND** leaves those parameters' modulation-depth assignments and values unchanged
- **AND** leaves the slot's previously selected bank unchanged

#### Scenario: Modified bank select randomizes target bank modulation
- **WHEN** random-mod is the current modifier
- **AND** a `SelectParamBank` message targets bank 1
- **THEN** bus processing applies geometric modulation randomization to every top-level parameter mapped by bank 1
- **AND** leaves the slot's previously selected bank unchanged

#### Scenario: Explicit reset set is idempotent
- **WHEN** a `SetReset` message carries `true`
- **THEN** bus processing sets manager reset-held state to true
- **WHEN** a later `SetReset` message carries `false`
- **THEN** bus processing sets manager reset-held state to false
- **AND** applying either message when the manager already has that reset-held state leaves other manager state unchanged

#### Scenario: Explicit random set is idempotent
- **WHEN** a `SetRandom` message carries `true`
- **THEN** bus processing sets manager random-held state to true
- **WHEN** a later `SetRandom` message carries `false`
- **THEN** bus processing sets manager random-held state to false
- **AND** applying either message when the manager already has that random-held state leaves other manager state unchanged

#### Scenario: Explicit random-mod set is idempotent
- **WHEN** a `SetRandomMod` message carries `true`
- **THEN** bus processing sets manager random-mod-held state to true
- **WHEN** a later `SetRandomMod` message carries `false`
- **THEN** bus processing sets manager random-mod-held state to false
- **AND** applying either message when the manager already has that random-mod-held state leaves other manager state unchanged

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
- **THEN** the bus accepts and drains them without changing parameter, bank, gesture, scene, or modifier state

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

### Requirement: spm-25 — Tests: message-driven randomized UI-state simulation
WHEN automated tests cover the external synth parameter control surface, THE test suite SHALL include a deterministic randomized simulation that drives the existing operation set and reset/random/random-mod modifier operations through `MessageInBus`, includes unmodified and modified bank selection as message-driven operations, periodically populates UI state, and verifies UI-state atomics against the separate deterministic oracle model.

#### Scenario: Bus random test matches model
- **WHEN** the message-driven randomized simulation runs one seed
- **THEN** every applied visible message leaves manager, parameter, bank, slot, gesture, scene, modifier, and modulation state matching the oracle

#### Scenario: UI state checks match oracle
- **WHEN** the randomized simulation calls `PopulateUIState`
- **THEN** every connected visible parameter UI cell matches the oracle's expected visible parameter, per-voice values, per-voice switch buckets when switch metadata is configured, bipolar flag, signed bipolar or unipolar min/max values, color, indicator colors, modulator/gesture affecting masks for the first 32 visible indices, manager-owned gesture values, selected flags, scene selection, scene blend, reset-held state, random-held state, and random-mod-held state

#### Scenario: Modifier random samples are modeled
- **WHEN** the message-driven randomized simulation applies random or random-mod modifier behavior
- **THEN** the oracle consumes the same random value, coin, and slot-selection samples as production behavior

#### Scenario: Existing randomized oracle is migrated to manager-owned gestures
- **WHEN** the randomized simulation creates parameters in multiple groups
- **THEN** its oracle stores gesture values and selection at manager scope rather than group scope

#### Scenario: Cross-group randomized scenes are compatible
- **WHEN** the randomized simulation includes auxiliary-group parameters in cross-group checks
- **THEN** the auxiliary group has scene capacity compatible with the manager scene endpoint range used by the simulation
- **AND** scene endpoint changes go through the manager's validated setter

#### Scenario: Failure output is reproducible
- **WHEN** the message-driven randomized simulation detects a mismatch
- **THEN** the failure output includes seed, step number, message/action, random samples consumed for that action, and the mismatched expected and actual UI or model field

### Requirement: spm-26 — Miniapp: JUCE external control probe
WHEN the synth external UI/message layer, DSP miniapp integration, and module-backed VCO patch are implemented, THE repository SHALL contain a `projects/synth/apps/miniapp` JUCE application, hosted by the synth application runtime, that demonstrates the parameter system, MIDI message routing, DSP-backed module parameters, scope UI-state snapshots, and reusable JUCE components while keeping JUCE code outside core synth library headers and sources.

#### Scenario: Miniapp shows current feature set
- **WHEN** the miniapp runs
- **THEN** it displays reusable synth JUCE encoder components, buttons, sliders, one parameter group with two voices, module-backed page-bank controls for Tune, Phase, Shape, Volume, and LFO Speed, three scene selection buttons, scene blend, visible left/right scene endpoint state, gesture selection, gesture value, latching reset state, random and random-mod modifier state, three modulation sources, and one waveform pane containing both VCO traces

#### Scenario: Miniapp uses local JUCE checkout
- **WHEN** the miniapp target is built in this repository layout
- **THEN** it uses the developer-local `~/JUCE` checkout by default or documents the missing local dependency precisely

#### Scenario: Miniapp double-click creates modulation view
- **WHEN** the user double-clicks an encoder representing a top-level parameter
- **THEN** the miniapp sends a parameter push message through `MessageInBus`
- **AND** the visible UI updates to show modulation-depth controls for that parameter and the target parameter at the final visible position

#### Scenario: Miniapp modulator uses module and LFO sources
- **WHEN** the miniapp processing step advances modulation sources
- **THEN** modulator 0 receives the dual VCO module's direct normalized source floats for the two voices
- **AND** modulator 1 receives the dual VCO module's swapped normalized source floats for the two voices
- **AND** modulator 2 receives the existing sine/cosine LFO values for the two voices

#### Scenario: Miniapp converts colors at JUCE boundary
- **WHEN** the miniapp paints synth UI state
- **THEN** it converts `synth::Color` to `juce::Colour` in miniapp code
- **AND** core synth files remain free of JUCE includes

### Requirement: spm-38 — Message bus: safe out-of-bounds application
WHEN `MessageInBus` applies externally produced messages, THE synth parameter modulation system SHALL treat slot, position, bank, gesture, and scene indices as untrusted and SHALL ignore out-of-bounds targets without mutating manager, bank, scene, gesture, parameter, modifier, or UI-state configuration.

#### Scenario: Invalid bank select is a no-op
- **WHEN** a `SelectParamBank` message targets a bank index that does not exist for the addressed slot
- **THEN** bus processing leaves the slot's selected bank unchanged
- **AND** no parameter, scene, modifier, or gesture state changes

#### Scenario: Invalid gesture select is a no-op
- **WHEN** a gesture select or gesture value message targets a gesture index greater than or equal to the manager gesture count
- **THEN** bus processing leaves all gesture selected flags and values unchanged
- **AND** no parameter, bank, scene, or modifier state changes

#### Scenario: Invalid scene select is a no-op
- **WHEN** a `SceneSelect` message targets a scene index that is invalid for any existing parameter group
- **THEN** bus processing leaves scene endpoints and scene blend unchanged
- **AND** no parameter, bank, gesture, or modifier state changes

#### Scenario: Invalid slot position is a no-op
- **WHEN** a parameter push or inc/dec message targets a slot or slot position that does not exist
- **THEN** bus processing leaves all bank, parameter, modulation-view, scene, gesture, and modifier state unchanged

### Requirement: spm-41 — MIDI input: system button mapping
WHEN system button MIDI input is processed, THE synth parameter modulation system SHALL provide a `SystemButtonMidiInProcessor` with a config struct that maps channel/CC pairs to a press `MessageIn` and an optional release `MessageIn`, emits the press message when the CC value is greater than zero, emits the release message only when configured and the CC value is zero, stamps emitted messages with the configured bus-domain timestamp provider, and passes supported-but-unmapped messages to its thru processor.

#### Scenario: Button press emits configured message
- **WHEN** system button config maps channel `5` CC `32` to `MessageIn::ToggleReset`
- **AND** the processor receives a CC on channel `5` CC `32` with value `127`
- **THEN** it pushes a `ToggleReset` message

#### Scenario: Button release emits optional configured message
- **WHEN** system button config maps channel `5` CC `32` to `MessageIn::SetReset(true)` on press and `MessageIn::SetReset(false)` on release
- **AND** the processor receives a CC on channel `5` CC `32` with value `0`
- **THEN** it pushes a reset message whose boolean payload clears reset

#### Scenario: Button release can clear random modifier
- **WHEN** system button config maps channel `5` CC `33` to `MessageIn::SetRandom(true)` on press and `MessageIn::SetRandom(false)` on release
- **AND** the processor receives a CC on channel `5` CC `33` with value `0`
- **THEN** it pushes a random message whose boolean payload clears random

#### Scenario: Button release can clear random-mod modifier
- **WHEN** system button config maps channel `5` CC `34` to `MessageIn::SetRandomMod(true)` on press and `MessageIn::SetRandomMod(false)` on release
- **AND** the processor receives a CC on channel `5` CC `34` with value `0`
- **THEN** it pushes a random-mod message whose boolean payload clears random-mod

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

#### Scenario: Reset info follows reset state
- **WHEN** the output-info helper evaluates a reset message while UI state reports reset held
- **THEN** it returns white
- **AND** returns `isOn=true`
- **WHEN** UI state reports reset not held
- **THEN** it returns grey
- **AND** returns `isOn=false`

#### Scenario: Random info follows random state
- **WHEN** the output-info helper evaluates a random message while UI state reports random held
- **THEN** it returns white
- **AND** returns `isOn=true`
- **WHEN** UI state reports random not held
- **THEN** it returns grey
- **AND** returns `isOn=false`

#### Scenario: Random-mod info follows random-mod state
- **WHEN** the output-info helper evaluates a random-mod message while UI state reports random-mod held
- **THEN** it returns white
- **AND** returns `isOn=true`
- **WHEN** UI state reports random-mod not held
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
- **WHEN** a WRLD.Bldr system output processor maps position channel `5`, x `0`, y `4` to a reset message
- **AND** the output info returns white
- **THEN** it emits WRLD.Bldr-compatible color feedback for that position using white

#### Scenario: System output debounces unchanged state
- **WHEN** a system output processor processes the same derived state twice
- **THEN** the second process call emits no duplicate feedback for that association

#### Scenario: System output reset re-renders state
- **WHEN** a system output processor is reset
- **AND** it processes a mapped association with unchanged derived state
- **THEN** it emits the feedback required to restore hardware state

### Requirement: spm-45 — MIDI controller profiles: default WRLD.Bldr and miniapp use
WHEN the default WRLD.Bldr MIDI controller profile is requested, THE synth parameter modulation system SHALL build Smart Grid-derived encoder, analog, reset, random, random-mod, system button, and system output defaults for the WRLD.Bldr controller; the synth miniapp SHALL use that profile instead of constructing individual encoder processors directly.

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
- **THEN** it maps aux `(0,4)` to momentary reset
- **AND** maps aux `(1,4)` to momentary random
- **AND** maps aux `(2,4)` to momentary random-mod
- **AND** maps aux row `6` to scene select messages
- **AND** maps Smart Grid-derived bank select positions to bank select messages
- **AND** maps configured gesture selector positions to momentary gesture select messages
- **AND** does not map aux focus `(0,5)`

#### Scenario: Default WRLD.Bldr bank buttons tolerate small apps
- **WHEN** the default WRLD.Bldr profile includes bank buttons for bank indices that a specific app has not created
- **AND** those buttons are pressed without an effective modifier
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
- **AND** reset, random, random-mod, and encoder controls continue to operate through the profile-created processors

### Requirement: spm-48 — Banks: module slot registration safety
WHEN module-level code registers visible parameters into a bank, THE synth parameter modulation system SHALL provide bank APIs, or equivalent safe registration helpers, in which a bank is durably associated with exactly one `BankSlot`, a bank slot owns the physical layout and MAY be associated with multiple page banks while selecting only one bank for runtime routing, and registration validates duplicate physical slots, duplicate visible parameter names within the registration operation, and the number of available physical positions before mutating the bank's visible mapping.

#### Scenario: Duplicate slot rejected
- **WHEN** module registration attempts to map two parameters to the same bank slot or physical encoder position
- **THEN** bank registration raises a coding error
- **AND** the bank mapping remains unchanged by that failed operation

#### Scenario: Duplicate visible name rejected
- **WHEN** module registration attempts to map two parameters with the same effective visible name in one bank registration operation
- **THEN** bank registration raises a coding error

#### Scenario: Capacity overrun rejected
- **WHEN** module registration requests more visible positions than the bank layout can provide after the requested offset
- **THEN** bank registration raises a coding error rather than silently truncating the mapping

#### Scenario: Bank uses slot layout for capacity
- **WHEN** a bank is associated with a bank slot with four physical encoders
- **AND** module registration asks that bank for available capacity
- **THEN** the bank reports capacity from the associated bank slot's physical layout

#### Scenario: Multiple page banks share one slot
- **WHEN** two banks are associated with the same bank slot during initialization
- **THEN** both banks can validate visible registration against that slot's physical layout
- **AND** the bank slot selects only one associated bank at a time for routed press, modifier press, tick, and UI-state behavior

#### Scenario: Missing slot layout rejected
- **WHEN** module registration requests capacity from a bank that is not associated with a bank slot
- **THEN** bank registration raises a coding error
- **AND** does not guess a capacity from existing top-level mappings

### Requirement: spm-52 — Persistence: MIDI profile config JSON
WHEN MIDI controller profile configuration is saved, THE synth parameter modulation system SHALL provide library JSON serialization and loading helpers for `MidiControllerProfileConfig` and nested encoder input, encoder output, analog input, and system-message association config structs, including WRLD.Bldr positions, Launchpad positions, and MF Twister side-button addresses, so a profile's input and output processors can be rebuilt from config outside any specific app.

#### Scenario: Encoder mappings round trip
- **WHEN** a MIDI profile config contains encoder turn, push, and output mappings
- **THEN** serializing and loading that config preserves channel, CC, slot index, position, relative mode, turn step, and output color-budget fields

#### Scenario: System associations round trip
- **WHEN** a MIDI profile config contains system message associations with press, optional release, feedback for feedback-capable controllers, WRLD.Bldr positions, Launchpad positions, and MF Twister side-button control addresses
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

### Requirement: spm-54 — Persistence: manager-wide value reset
WHEN patch lifecycle code requests a full value reset, THE synth parameter modulation system SHALL reset every initialized top-level parameter and every existing modulation-depth parameter to its code-defined default value state without creating, deleting, renaming, recoloring, rerouting, or reconfiguring any parameter topology.

#### Scenario: Full reset clears top-level values
- **WHEN** initialized parameters have edited scene centers, gesture values, gesture active flags, modifier state, gesture selections, and scene blend
- **THEN** a full value reset restores parameter values to each parameter config's default value
- **AND** clears gesture-active flags and gesture selections
- **AND** restores scene selection/blend and modifier state to a captured manager default control state, or the manager's constructor defaults if no app default has been captured

#### Scenario: Full reset clears existing modulation depths
- **WHEN** a parameter has existing modulation-depth parameters with non-default values
- **THEN** a full value reset restores those existing depth parameter values to their neutral defaults
- **AND** does not create missing modulation-depth parameters
- **AND** does not change modulation source metadata or assignments

### Requirement: spm-58 — MIDI output: Launchpad RGB feedback
WHEN Launchpad grid MIDI output feedback is processed, THE synth parameter modulation system SHALL provide a Launchpad output processor that owns or references `SystemMessageOutputInfo`, maps Launchpad controller `(x,y)` positions to feedback `MessageIn` values, evaluates those messages from UI state, debounces per association, and emits Novation-compatible RGB LED SysEx for Launchpad X, Launchpad Pro MK3, and Launchpad Mini MK3.

#### Scenario: Launchpad X output uses X product byte
- **WHEN** a Launchpad X output association maps position `(0, 7)` to a reset feedback message whose output info returns white
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

### Requirement: spm-61 — MIDI input: MF Twister side-button mapping
WHEN the default MF Twister side-button MIDI input is configured, THE synth parameter modulation system SHALL map the six side buttons captured as user-facing MIDI channel 4 CCs 8 through 13 to configurable system-message press and optional release associations, using zero-based `MidiControlAddress.channel = 3` internally, and SHALL emit the press message for nonzero CC values and the release message for zero CC values when configured.

#### Scenario: First side button press emits configured message
- **WHEN** an MF Twister side-button profile maps side button `0` to `MessageIn::SetReset(true)` on press
- **AND** the input processor receives `BasicMidi::CC(..., 3, 8, 127)`
- **THEN** it pushes the configured reset press message

#### Scenario: First side button release emits configured release
- **WHEN** an MF Twister side-button profile maps side button `0` to `MessageIn::SetReset(true)` on press and `MessageIn::SetReset(false)` on release
- **AND** the input processor receives `BasicMidi::CC(..., 3, 8, 0)`
- **THEN** it pushes the configured reset release message

#### Scenario: All six side-button CCs are available
- **WHEN** an MF Twister default profile is created
- **THEN** side-button indices `0` through `5` are addressable as zero-based channel `3` CCs `8` through `13`

#### Scenario: Unconfigured side button does not emit
- **WHEN** an MF Twister side-button association is omitted or has no press message configured by the profile builder
- **AND** the corresponding side-button CC is received
- **THEN** no system message is pushed for that button
