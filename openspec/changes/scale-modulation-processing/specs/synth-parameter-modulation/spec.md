## ADDED Requirements

### Requirement: spm-72 — Processing: sparse top-level and modulation-route traversal
WHEN a parameter group performs per-sample processing, THE synth parameter modulation system SHALL run `ProcessLite()` only for manager-registered top-level parameters, SHALL update materialized local modulation-depth parameters only through the recursive control-rate compute rooted at those top-level parameters, and SHALL maintain a stable-source active-route permutation whose contiguous active prefix contains every route with non-zero target depth or non-zero current depth still settling toward zero so per-sample depth slew and modulation application do not visit inactive routes.

#### Scenario: Materialized local depth does not add ProcessLite work
- **WHEN** a group contains `N` registered top-level parameters
- **AND** any number of local modulation-depth parameters have been materialized beneath them
- **THEN** one group per-sample processing step invokes top-level `ProcessLite()` exactly `N` times
- **AND** invokes `ProcessLite()` zero times on local modulation-depth parameters

#### Scenario: Recursive compute still refreshes local depth state
- **WHEN** a top-level parameter has a materialized modulation-depth subtree
- **AND** the configured target-compute sample arrives
- **THEN** recursive compute evaluates that subtree before deriving the top-level target depths
- **AND** seeds local cached/UI state without adding local nodes to the per-sample processing set
- **AND** local display center is seeded from the recursively computed value and local display spread is reset to zero at compute cadence rather than filtered per sample

#### Scenario: Inactive routes are outside the active prefix
- **WHEN** a parameter has allocated modulation sources whose current and target depths are zero
- **THEN** those source identities remain available for editing and persistence
- **AND** their routes are outside the active prefix
- **AND** per-sample depth slew and modulation application do not visit them

#### Scenario: Route returning to zero remains active while settling
- **WHEN** an active route's target depth becomes zero while its current depth remains non-zero
- **THEN** the route remains in the active prefix while its one-pole state settles
- **AND** it leaves the active prefix only after current and target depth are zero within the system's modulation-neutral tolerance

#### Scenario: Active permutation preserves source identity
- **WHEN** active routes are reordered or swap-removed inside the active prefix
- **THEN** each route continues to read the modulation source, metadata, UI color, and persisted JSON key belonging to its original modulator index

### Requirement: spm-73 — Gestures: 64-bit sparse selection and activation
WHEN gesture topology is configured or evaluated, THE synth parameter modulation system SHALL support manager gesture counts from zero through 64, SHALL reject counts above 64 before any group is created, SHALL represent manager gesture selection and each parameter scene's active gestures with 64-bit selectors, and SHALL iterate selected or active gestures by set bits rather than scanning configured inactive gesture slots.

#### Scenario: Gesture index boundaries are supported
- **WHEN** a manager is configured with 64 gestures
- **THEN** selection, value, metadata, activation, compute, editing, messaging, persistence, and UI operations accept gesture indices `0`, `31`, `32`, and `63`

#### Scenario: High gesture badges remain distinguishable
- **WHEN** encoder badges render affecting gestures 16 through 63
- **THEN** each badge identifies its original gesture with the distinct one-based numeric label `17` through `64`
- **AND** gesture 63 renders as `64` rather than collapsing to another gesture's label

#### Scenario: More than 64 gestures is rejected
- **WHEN** code attempts to configure a manager with 65 gestures before group creation
- **THEN** configuration fails without changing the previous gesture topology

#### Scenario: Inactive gesture capacity does not add gesture evaluation
- **WHEN** a parameter belongs to a manager configured with 64 gestures
- **AND** none are active for either scene endpoint
- **THEN** parameter compute evaluates zero gesture contributions

#### Scenario: Scene blend iterates the active union
- **WHEN** different gestures are active in the left and right scene endpoints
- **AND** scene blend is between the endpoints
- **THEN** compute and edit distribution iterate the union of the two 64-bit active selectors
- **AND** each effective gesture weight retains the existing endpoint/blend semantics

#### Scenario: Selection and activation remain distinct
- **WHEN** a gesture is selected globally but inactive for a parameter's current scenes
- **THEN** the selection bit participates in gesture arming during an edit
- **AND** the gesture contributes nothing to parameter compute until its per-scene active bit is set

### Requirement: spm-74 — Ownership: neutral local modulation-depth reclamation
WHEN local modulation-depth storage is maintained at a safe control boundary, THE synth parameter modulation system SHALL recursively detach and recycle a local modulation-depth parameter that is a neutral leaf, is not pinned by a live modulation view, and has no non-default state that would affect future editing or persistence; SHALL preserve manager-registered top-level parameter objects and addresses; and SHALL reuse recycled local slots before requesting additional parameter storage.

#### Scenario: Neutral leaf is reclaimed
- **WHEN** a local modulation-depth parameter has neutral/default depth state in every scene
- **AND** it has no child modulation routes, active gestures, non-default latent gesture values, or live modulation-view pin
- **THEN** garbage collection clears the parent's source-index assignment
- **AND** returns the local slot to its group's reusable pool

#### Scenario: Non-neutral state prevents reclamation
- **WHEN** a local modulation-depth parameter is non-neutral in any scene or gesture state preserved by patch JSON
- **THEN** garbage collection retains the parameter and its parent assignment

#### Scenario: Child route prevents reclamation
- **WHEN** a neutral local modulation-depth parameter still owns a child modulation route that cannot itself be reclaimed
- **THEN** garbage collection retains the parent local parameter

#### Scenario: Recursive collection collapses a neutral subtree
- **WHEN** every node in a modulation-depth subtree is a reclaimable neutral leaf after its children are visited
- **THEN** bottom-up garbage collection recycles the complete subtree

#### Scenario: Visible modulation control is pinned
- **WHEN** a local modulation-depth parameter is visible in an open bank modulation view
- **THEN** garbage collection does not detach or recycle it
- **AND** collection may reconsider it after the view closes

#### Scenario: Recycled slot avoids capacity growth
- **WHEN** a neutral local slot has been reclaimed
- **AND** a later edit materializes another local modulation-depth parameter with the same group shape
- **THEN** the group reuses the reclaimed slot before requesting a new storage batch
- **AND** the recycled parameter begins with fully reset default state and resolved metadata for its new parent and source index
- **AND** capacity checks count the recycled slot before requesting new backing storage
- **AND** high-water storage count and storage-local index inspection remain stable while live-local and free-slot counts describe current topology

#### Scenario: Collection preserves patch representation
- **WHEN** a parameter graph is serialized before and after reclaiming only eligible neutral local nodes
- **THEN** both value JSON documents are semantically identical
- **AND** loading either document reconstructs the same non-default modulation graph and parameter outputs

## MODIFIED Requirements

### Requirement: spm-20 — UI State: parameter and visible-cell snapshots
WHEN a parameter or visible-cell UI snapshot is populated, THE synth parameter modulation system SHALL write a `Parameter::UIState` whose scalar fields are individually atomic and which contains the parameter base color and resolved per-voice indicator colors from `ParameterConfig`, connected state, bipolar flag, short name pointer or stable short name view, per-voice display center values, per-voice display spread values, per-voice minimum values, per-voice maximum values, per-voice switch bucket values, switch cardinality, a synth-native modulator affecting bitmask, a 64-bit synth-native gesture affecting bitmask, source colors for the parameter's owning-group modulators, and manager-owned gesture colors; every color and count SHALL be inside the existing snapshot revision transaction; disconnected visible cells SHALL use `connected=false` with neutral values, zero spread, zero color counts, and off colors instead of a separate page/navigation role; bipolar parameter UI values and min/max values SHALL be reported in `[-1, 1]`, while unipolar parameter UI values and min/max values SHALL be reported in `[0, 1]`.

#### Scenario: Parameter UI state reports smoothed per-voice display values
- **WHEN** a parameter has two voices with different cached knob values
- **AND** `Parameter::PopulateUIState` is called after compute/process work
- **THEN** the UI state exposes the parameter's per-voice smoothed display center values
- **AND** it does not expose unsmoothed audio-rate cached knob values as the encoder indicator center

#### Scenario: Parameter UI state reports display spread
- **WHEN** audio-rate modulation causes a voice's cached knob value to vary around its smoothed display center
- **AND** `Parameter::PopulateUIState` is called after process work
- **THEN** the UI state exposes a non-negative per-voice display spread derived from the smoothed residual energy

#### Scenario: Parameter UI state reports configured base color
- **WHEN** a parameter is configured with base color `C`
- **AND** `Parameter::PopulateUIState` is called
- **THEN** the UI state reports parameter base color `C`

#### Scenario: Parameter UI state reports parameter indicator colors
- **WHEN** a two-voice parameter resolves indicator colors `A` and `B`
- **AND** `Parameter::PopulateUIState` is called
- **THEN** voice 0 indicator color is `A`
- **AND** voice 1 indicator color is `B`
- **AND** another parameter in the same group may report different colors

#### Scenario: Parameter UI state reports local source and global gesture colors
- **WHEN** a parameter's group has source colors `M0` and `M1` and its manager has gesture color `G0`
- **AND** `Parameter::PopulateUIState` is called
- **THEN** the snapshot reports `M0`, `M1`, and `G0` in their indexed color arrays

#### Scenario: Bipolar UI state reports signed values
- **WHEN** a bipolar parameter has smoothed display center values `-0.5` and `0.75`
- **AND** `Parameter::PopulateUIState` is called
- **THEN** the UI state reports the bipolar flag as true
- **AND** reports per-voice display center values `-0.5` and `0.75`
- **AND** reports minimum value `-1` and maximum value `1`

#### Scenario: Unipolar UI state reports unipolar values
- **WHEN** a unipolar parameter UI state is populated
- **THEN** the UI state reports the bipolar flag as false
- **AND** reports minimum value `0` and maximum value `1`

#### Scenario: Parameter UI state reports switch metadata
- **WHEN** a switch/discrete parameter UI state is populated
- **THEN** the UI state reports the parameter's switch cardinality
- **AND** reports each voice's precomputed switch bucket value using the same helper as `Parameter::GetSwitchVal(voiceIx)`
- **AND** reports display spread `0` for each voice

#### Scenario: Parameter UI state reports affecting masks
- **WHEN** a parameter has active or assigned modulation/gesture relationships that should be visible to the external encoder renderer
- **THEN** the UI state reports synth-native modulator and gesture affecting bitmasks
- **AND** those masks do not use Smart Grid `BitSet16` or Smart Grid enum types
- **AND** the gesture mask is 64 bits and covers gesture indices `0..63`
- **AND** a modulator bit is set when the parameter has a non-neutral assigned modulation-depth parameter for that modulator
- **AND** a gesture bit is set when the parameter has that gesture active in the manager's active scene selection: left scene only at blend 0, right scene only at blend 1, and both endpoint scenes for intermediate blends

#### Scenario: Unused UI state voices are disconnected or neutral
- **WHEN** a UI state has capacity for more voices than the parameter group uses
- **THEN** populated voice entries beyond the configured voice count are neutral and do not report stale values as connected
- **AND** their display spread values and indicator colors are zero/off

#### Scenario: Modulation target cell stays parameter-owned
- **WHEN** a visible bank cell is the target encoder in an open modulation view
- **AND** slot UI state is populated
- **THEN** that reserved `Parameter::UIState` reports `connected=true`
- **AND** it reports the target parameter's switch cardinality, per-voice switch buckets, affecting masks, base color, indicator colors, source colors, gesture colors, short name, bipolar flag, display center values, display spread values, and min/max values exactly as the target parameter would outside the modulation view
- **AND** renderers do not distinguish this cell from normal parameter cells through parameter UI-state page/navigation data

#### Scenario: Short name lifetime is stable
- **WHEN** a parameter UI state exposes a short name pointer or stable view
- **THEN** that reference remains valid for the lifetime of the owning manager topology
- **AND** UI state consumers do not retain it after the manager or parameter is destroyed

### Requirement: spm-25 — Tests: message-driven randomized UI-state simulation
WHEN automated tests cover the external synth parameter control surface, THE test suite SHALL include a deterministic randomized simulation that drives the existing operation set and reset/random/random-mod modifier operations through `MessageInBus`, includes unmodified and modified bank selection as message-driven operations, periodically populates UI state, and verifies UI-state atomics against the separate deterministic oracle model.

#### Scenario: Bus random test matches model
- **WHEN** the message-driven randomized simulation runs one seed
- **THEN** every applied visible message leaves manager, parameter, bank, slot, gesture, scene, modifier, and modulation state matching the oracle

#### Scenario: UI state checks match oracle
- **WHEN** the randomized simulation calls `PopulateUIState`
- **THEN** every connected visible parameter UI cell matches the oracle's expected visible parameter, per-voice display center values, per-voice display spread values, per-voice switch buckets when switch metadata is configured, bipolar flag, signed bipolar or unipolar min/max values, color, indicator colors, modulator affecting masks for all visible source indices, 64-bit gesture affecting masks for indices `0..63`, manager-owned gesture values, selected flags, scene selection, scene blend, reset-held state, random-held state, and random-mod-held state

#### Scenario: Modifier random samples are modeled
- **WHEN** a random or random-mod modifier action consumes random samples
- **THEN** the randomized simulation oracle consumes the same number of samples in the same order

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
