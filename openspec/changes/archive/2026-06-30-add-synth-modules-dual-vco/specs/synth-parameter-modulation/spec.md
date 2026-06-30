## MODIFIED Requirements

### Requirement: spm-15 — Banks and slots: press, shift-press, and tick routing
WHEN a bank handles a press on a mapped physical encoder, THE bank SHALL populate the pressed parameter's visible modulation-depth cells from parent-owned modulation-depth controls, SHALL materialize missing modulation-depth controls as local bipolar default-zero controls when group capacity allows, SHALL NOT append those modulation-depth controls to the manager global parameter list, SHALL initialize lazily materialized modulation-depth control short name and color from the corresponding modulator metadata, SHALL derive an effective depth control name from the target parameter name plus the modulator metadata name when the metadata name is non-empty, SHALL derive an effective fallback name from the target parameter name plus the one-based modulation index when the metadata name is empty, and SHALL place the selected top-level parameter in the final physical slot position as the return cell when the press is routed through a `BankSlot`; direct bank presses without a slot layout SHALL use the bank's compact top-level mapping order as the physical layout fallback. If a routed slot has `N` physical positions, THE system SHALL reserve position `N - 1` for the return cell, SHALL use positions `0..N-2` for modulation-depth cells, SHALL leave unused positions before the return cell disconnected, and SHALL treat `numModulators > N - 1` as a configuration error. Pressing a modulation cell SHALL open that modulation control's modulation view; pressing the return cell SHALL restore the top-level bank; tick and shift-press SHALL route to the parameter or modulation-depth control visible in the pressed cell; shift-press SHALL revert the pressed top-level parameter to default and neutralize its modulation-depth subtree without deleting those controls; and routed manager/slot APIs SHALL dispatch press, shift-press, and tick/inc-dec events by physical encoder ID to the selected bank.

#### Scenario: Press opens modulation view
- **WHEN** a bank is showing top-level parameters and the user presses a parameter encoder through a slot
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
- **WHEN** a shift-press resets a parameter that owns modulation-depth controls
- **THEN** the parameter returns to its default value
- **AND** its modulation-depth controls are reset to neutral zero values
- **AND** those controls remain attached to the parent parameter for future modulation-view routing

#### Scenario: Return cell closes modulation view
- **WHEN** a modulation-depth view is open
- **AND** the return cell in the final slot position is pressed
- **THEN** the bank restores the top-level parameter view

#### Scenario: Tick routes to selected bank
- **WHEN** the manager receives a tick for a physical encoder ID owned by a slot's selected bank
- **THEN** the manager routes the delta through the slot and bank to the mapped parameter's `HandleIncDec`

### Requirement: spm-26 — Miniapp: JUCE external control probe
WHEN the synth external UI/message layer, DSP miniapp integration, and module-backed VCO patch are implemented, THE repository SHALL contain a `projects/synth/miniapp` JUCE application that demonstrates the parameter system, MIDI message routing, DSP-backed module parameters, scope UI-state snapshots, and reusable JUCE components while keeping JUCE code outside core synth library headers and sources.

#### Scenario: Miniapp shows current feature set
- **WHEN** the miniapp runs
- **THEN** it displays reusable synth JUCE encoder components, buttons, sliders, one parameter group with two voices, module-backed page-bank controls for Tune, Phase, Shape, Volume, and LFO Speed, three scene selection buttons, scene blend, visible left/right scene endpoint state, gesture selection, gesture value, latching shift state, three modulation sources, and one waveform pane containing both VCO traces

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

## ADDED Requirements

### Requirement: spm-46 — Parameters: registration IDs and lookup
WHEN modules or application code register top-level parameters, THE synth parameter modulation system SHALL provide a `ParameterManager::RegisterParameter` API, or equivalent manager-level API, that accepts a parameter group and `ParameterConfig`, validates the group and effective parameter name, creates the parameter in the supplied group, appends it to the manager's global parameter list, and returns a `ParameterId` equal to that parameter's index in the global parameter list for future module lookup; `CreateParameter` SHALL use the same global-list path, while modulation-depth controls SHALL remain parent-owned local controls without `ParameterId` values in the manager global list.

#### Scenario: First registered parameter is list index zero
- **WHEN** a fresh manager registers its first parameter
- **THEN** the returned `ParameterId` is `0`
- **AND** looking up parameter ID `0` returns that parameter

#### Scenario: IDs follow global registration order
- **WHEN** parameters are registered across two groups
- **THEN** each returned parameter ID equals the parameter's index in the manager's global parameter list
- **AND** the IDs remain stable for the lifetime of the manager

#### Scenario: Duplicate effective name fails
- **WHEN** a parameter is registered with an effective name already present in the manager's global parameter list
- **THEN** registration raises a coding error
- **AND** the manager does not append a partial parameter

#### Scenario: Invalid lookup fails
- **WHEN** code requests a parameter ID outside the manager's global parameter list
- **THEN** lookup raises a coding error

#### Scenario: CreateParameter uses list-index IDs
- **WHEN** existing code creates a parameter through `CreateParameter`
- **THEN** the created parameter is appended to the manager's global parameter list
- **AND** its `ParameterId` equals its index in that list

#### Scenario: Lazy modulation-depth controls do not use global IDs
- **WHEN** a routed modulation view lazily materializes a modulation-depth control
- **THEN** the manager global parameter list length is unchanged
- **AND** previously returned top-level parameter IDs remain stable

### Requirement: spm-47 — Parameters: normalized mapping helpers
WHEN modules map normalized parameter values into natural units from their `SetInput` functions, THE synth parameter modulation system SHALL provide manager-level helpers that read a parameter by voice ID and parameter ID and return mapped values for linear interpolation, exponential geometric interpolation, zero-based exponential interpolation with a specified midpoint value, and bipolar variants of each supported mapping.

#### Scenario: Linear mapping reaches endpoints
- **WHEN** a unipolar parameter value is `0`
- **AND** code calls `GetLinear(minValue, maxValue, voiceIx, parameterId)`
- **THEN** the helper returns `minValue`
- **WHEN** the same parameter value is `1`
- **THEN** the helper returns `maxValue`

#### Scenario: Exponential mapping reaches endpoints
- **WHEN** a unipolar parameter value is `0`
- **AND** code calls `GetExponential(minValue, maxValue, voiceIx, parameterId)` with positive endpoint values
- **THEN** the helper returns `minValue`
- **WHEN** the same parameter value is `1`
- **THEN** the helper returns `maxValue`

#### Scenario: Zero-based exponential honors midpoint
- **WHEN** a unipolar parameter value is `0`
- **AND** code calls `GetZeroBasedExponential(maxValue, midpointValue, voiceIx, parameterId)`
- **THEN** the helper returns `0`
- **WHEN** the same parameter value is `0.5`
- **THEN** the helper returns `midpointValue` within numeric tolerance
- **WHEN** the same parameter value is `1`
- **THEN** the helper returns `maxValue`

#### Scenario: Bipolar mapping returns signed values
- **WHEN** a bipolar mapping helper is called for normalized values below and above the center point
- **THEN** values below center map to negative natural-unit values
- **AND** values above center map to positive natural-unit values
- **AND** the center point maps to zero within numeric tolerance

#### Scenario: Mapping helper uses parameter Get
- **WHEN** a mapped parameter has current modulation applied for a voice
- **THEN** each mapping helper maps the parameter's audio-rate `Get(voiceIx)` value rather than only the scene center value

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
- **AND** the bank slot selects only one associated bank at a time for routed press, shift-press, tick, and UI-state behavior

#### Scenario: Missing slot layout rejected
- **WHEN** module registration requests capacity from a bank that is not associated with a bank slot
- **THEN** bank registration raises a coding error
- **AND** does not guess a capacity from existing top-level mappings

### Requirement: spm-49 — Modulators: pointer-backed source registration and update
WHEN runtime modulation sources are produced by modules or application code, THE synth parameter modulation system SHALL provide a group-owned modulation-source manager, or equivalent `ParameterGroup`/`Modulators` API, where `SetModulationSource` is the source of truth for a modulator's metadata and per-voice source pointers, registers a modulation source by modulation index, per-voice array of `float` pointers, source name, short name, color, connected state, and related metadata, then updates current modulator values by dereferencing those pointers through `UpdateModValues` without applying scaling, normalization, or voice swapping.

#### Scenario: Source registration stores metadata
- **WHEN** code registers modulation source `0` with name `VCO`, short name `VCO`, color `Cyan`, and two voice pointers
- **THEN** the group stores the supplied metadata for modulation source `0`
- **AND** marks that modulation source connected

#### Scenario: Update dereferences source pointers
- **WHEN** a registered modulation source points to voice values `0.25` and `0.75`
- **AND** `UpdateModValues` is called
- **THEN** the group's flat modulator values for that source become `0.25` for voice `0` and `0.75` for voice `1`

#### Scenario: Update does not transform source values
- **WHEN** a registered modulation source points to already-normalized voice values
- **AND** `UpdateModValues` is called
- **THEN** the group copies those values into the flat modulator values unchanged
- **AND** does not clamp, scale, normalize, or swap voices during the update

#### Scenario: Manager updates group modulation values
- **WHEN** `ParameterManager::UpdateModValues` or an equivalent manager API is called for a group
- **THEN** the manager delegates to that group's modulation-source update function

#### Scenario: Update is sample-rate safe
- **WHEN** `UpdateModValues` is called every sample after initialization
- **THEN** it performs no heap allocation
- **AND** does not mutate source metadata

#### Scenario: Invalid source pointers fail
- **WHEN** source registration supplies the wrong number of voice pointers or a null pointer for a connected source
- **THEN** registration raises a coding error
- **AND** the previous source configuration remains unchanged
