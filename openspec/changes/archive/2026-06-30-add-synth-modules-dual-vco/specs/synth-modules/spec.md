## ADDED Requirements

### Requirement: smod-1 — Project: reusable synth modules
WHEN synth modules are implemented, THE repository SHALL provide JUCE-free reusable module code under `projects/synth/include/synth` and `projects/synth/src`, SHALL include that module code in the `projects/synth` library build, and SHALL keep JUCE-dependent rendering or widget code outside module headers and sources.

#### Scenario: Module code builds in synth library
- **WHEN** a developer runs `make -C projects/synth build`
- **THEN** the synth library builds the module sources and public module headers without including JUCE headers

#### Scenario: Module tests run in synth suite
- **WHEN** a developer runs `make -C projects/synth test`
- **THEN** the module unit tests run as part of the synth test suite

#### Scenario: JUCE stays outside module layer
- **WHEN** a JUCE-free synth test includes the public module headers
- **THEN** the test compiles without seeing `JUCE_MAJOR_VERSION`

### Requirement: smod-2 — Pattern: module lifecycle and registration
WHEN a synth module is initialized, THE synth module system SHALL support a lifecycle in which module topology and configuration are finalized first, `RegisterParameters(ParameterManager&, prefix)` or an equivalent function registers every module-owned top-level parameter and stores returned parameter IDs, and `RegisterToBank(Bank&, offset)` or an equivalent function later maps the module's visible parameters into bank slots; after module parameter registration begins, module topology and declared visible parameter sets SHALL remain fixed, while the parameter manager's global parameter list SHALL contain only top-level parameters intended for module/application lookup and SHALL NOT grow because modulation-depth controls are materialized.

#### Scenario: Parameters register before bank mapping
- **WHEN** a module is configured and `RegisterParameters` is called with a parameter manager
- **THEN** the module registers each module-owned parameter exactly once
- **AND** stores the returned parameter IDs for future input mapping and bank registration

#### Scenario: Prefix disambiguates repeated module instances
- **WHEN** two instances of the same module register parameters with different non-empty prefixes
- **THEN** the registered parameter names are unique and include the supplied prefixes

#### Scenario: Registration is not repeated
- **WHEN** `RegisterParameters` is called again after the same module has already registered its parameters
- **THEN** the module reports a coding error rather than creating duplicate parameters

#### Scenario: Topology locks before registration
- **WHEN** parameter registration has begun for a module graph
- **THEN** module configuration and child-module topology are treated as finalized for that graph

#### Scenario: Lazy depth controls are local
- **WHEN** runtime modulation-view routing lazily materializes a modulation-depth control after module registration
- **THEN** the modulation-depth control is owned locally by its parent parameter rather than appended to the manager global parameter list
- **AND** previously returned module parameter IDs remain stable

### Requirement: smod-3 — Pattern: bank registration errors
WHEN a synth module registers to a bank, THE synth module system SHALL use the bank's associated `BankSlot` physical layout as the bank capacity source, map module-visible parameters consecutively starting at the requested bank offset, preserve the module's declared parameter order, and raise a coding error instead of silently truncating when the bank has no associated slot layout, duplicate visible parameter names, duplicate target slots in lower-level registration helpers, out-of-range offsets, or insufficient bank slots are encountered.

#### Scenario: Module maps parameters at offset
- **WHEN** a module with four visible parameters registers to a bank at offset `2`
- **AND** the bank is associated with a bank slot whose physical layout has at least six positions
- **THEN** the bank visible slots starting at offset `2` reference those four parameters in the module-declared order

#### Scenario: Multiple banks share one slot layout
- **WHEN** two page banks are associated with the same bank slot during initialization
- **THEN** each bank can validate module registration capacity from that slot's physical layout
- **AND** the slot still selects only one associated bank at a time for runtime routing

#### Scenario: Duplicate visible name fails
- **WHEN** a module attempts to register two visible bank parameters with the same effective parameter name
- **THEN** bank registration raises a coding error
- **AND** the bank does not contain a partial module registration

#### Scenario: Insufficient slots fail
- **WHEN** a module with four visible parameters registers to a bank layout with only three available slots after the requested offset
- **THEN** bank registration raises a coding error
- **AND** no visible parameters are silently dropped

#### Scenario: Missing bank slot layout fails
- **WHEN** a module registers visible parameters to a bank that is not associated with a bank slot layout
- **THEN** bank registration raises a coding error
- **AND** the bank does not contain a partial module registration

### Requirement: smod-4 — Pattern: input mapping, processing, UI state, and nesting
WHEN a synth module processes audio, THE synth module system SHALL let the module own an input struct containing natural-unit values for its internal processors, SHALL let `SetInput(ParameterManager&, Input&)` or an equivalent function fill that input from stored parameter IDs and parameter-manager mapping helpers, SHALL expose outputs as ordinary module members or accessors, SHALL publish module UI state without transferring audio-thread state ownership, and SHALL allow modules to contain child modules with their own inputs, outputs, and UI states.

#### Scenario: SetInput maps from stored IDs
- **WHEN** a module has registered parameters and `SetInput` is called for voice `0`
- **THEN** it reads parameter values by the stored parameter IDs
- **AND** writes natural-unit values into the module input struct

#### Scenario: Process uses natural input
- **WHEN** a module processes a sample
- **THEN** its internal DSP processors receive natural-unit inputs from the module input struct rather than normalized knob values

#### Scenario: Nested module state is preserved
- **WHEN** a parent module contains two child modules
- **THEN** each child module can register parameters, register to banks, process input, expose outputs, and publish UI state without sharing mutable runtime state with the other child except through explicit parent wiring

### Requirement: smod-5 — Dual wavetable VCO module
WHEN the dual wavetable VCO module is implemented, THE synth module system SHALL provide a duophonic module containing two default wavetable VCO processors, registering Tune, Phase, Shape, and Volume parameters in that visible order, mapping Tune exponentially from 32 Hz to 3000 Hz, mapping Phase unipolar-linearly from `0` to `1` cycle of phase offset, mapping Shape linearly to wavetable position, mapping Volume unipolar-linearly from `0` to `1` gain, and publishing per-voice raw audio outputs, normalized direct/swapped modulation-source floats, and VCO waveform UI state.

#### Scenario: Dual VCO registers four parameters
- **WHEN** the dual wavetable VCO module registers parameters with prefix `Osc`
- **THEN** the manager contains effective parameters for `Osc Tune`, `Osc Phase`, `Osc Shape`, and `Osc Volume`
- **AND** the module stores all four parameter IDs

#### Scenario: Tune maps to oscillator frequency
- **WHEN** the Tune parameter is at normalized `0`
- **THEN** the module maps it to 32 Hz before converting to cycles per sample
- **WHEN** the Tune parameter is at normalized `1`
- **THEN** the module maps it to 3000 Hz before converting to cycles per sample

#### Scenario: Shape controls wavetable morph
- **WHEN** the Shape parameter changes
- **THEN** the module updates each VCO input's wavetable position from that parameter

#### Scenario: Phase maps to unipolar cycle offset
- **WHEN** the Phase parameter is at normalized `0`
- **THEN** the module maps it to `0` cycles of phase offset
- **WHEN** the Phase parameter is at normalized `1`
- **THEN** the module maps it to `1` cycle of phase offset

#### Scenario: Volume scales output
- **WHEN** the VCO processors produce raw bipolar samples
- **THEN** the module multiplies each voice output by the mapped Volume value

#### Scenario: Volume maps to unit gain
- **WHEN** the Volume parameter is at normalized `0`
- **THEN** the module maps it to zero gain
- **WHEN** the Volume parameter is at normalized `1`
- **THEN** the module maps it to unity gain

#### Scenario: Outputs are per voice
- **WHEN** the module processes its two voices
- **THEN** voice `0` and voice `1` outputs are available separately
- **AND** no mixed-output API is required for this module version

#### Scenario: Modulation source floats are normalized
- **WHEN** voice outputs are raw bipolar samples `A` and `B`
- **THEN** the module's direct modulation-source floats contain `(A + 1) * 0.5` for voice `0` and `(B + 1) * 0.5` for voice `1`, clamped to `[0, 1]`
- **AND** the module's swapped modulation-source floats contain `(B + 1) * 0.5` for voice `0` and `(A + 1) * 0.5` for voice `1`, clamped to `[0, 1]`

#### Scenario: UI state contains both VCO traces
- **WHEN** the module populates UI state after processing
- **THEN** the UI state exposes the waveform render data for both internal VCO processors

### Requirement: smod-6 — Miniapp: module-backed VCO patch
WHEN the synth miniapp demonstrates the dual wavetable VCO patch, THE miniapp SHALL instantiate the dual wavetable VCO module, register its parameters through the module, register its visible controls to the VCO page bank through the module, process the module each sample, update modulation values through the group/manager modulation-source update system, and keep app-level code focused on page selection, MIDI/control routing, scene/gesture controls, and rendering.

#### Scenario: Miniapp no longer hand-registers VCO parameters
- **WHEN** the miniapp initializes the VCO page
- **THEN** Tune, Phase, Shape, and Volume are registered by the dual wavetable VCO module rather than by ad hoc miniapp parameter creation code

#### Scenario: Miniapp bank uses module registration
- **WHEN** the miniapp initializes the VCO bank
- **THEN** the VCO bank receives Tune, Phase, Shape, and Volume from the module's bank registration function

#### Scenario: Miniapp updates modulators every sample
- **WHEN** the miniapp processes an audio sample
- **THEN** it calls the parameter manager or group update-mod-values API so pointer-backed modulation sources are current for that sample

#### Scenario: Miniapp remains simple
- **WHEN** the miniapp processing loop runs
- **THEN** app-level code delegates VCO input mapping and processing to the module
- **AND** does not duplicate the module's Tune, Phase, Shape, or Volume mapping formulas
