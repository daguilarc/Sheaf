## MODIFIED Requirements

### Requirement: sdsp-13 — Miniapp: duophonic VCO patch
WHEN the synth miniapp demonstrates DSP classes through reusable modules, THE miniapp SHALL use one parameter group configured for two voices and six modulators, SHALL expose page one module parameters Tune, Phase, Shape, and Volume through visible encoder cells, SHALL expose page two with module-backed LFO Frequency, Shape, Phase Offset, Skew, and Exponent controls through visible encoder cells, SHALL represent each page as both `ParameterManager` page metadata and the corresponding selected bank for the existing bank-slot encoder routing, and SHALL display waveform panes from module-published VCO and LFO UI state.

#### Scenario: Miniapp creates one duophonic group
- **WHEN** the miniapp initializes parameters
- **THEN** it creates one parameter group with polyphony two
- **AND** the group has exactly six modulators

#### Scenario: First page contains module-backed VCO controls
- **WHEN** the first miniapp page is active
- **THEN** its selected page bank exposes Tune, Phase, Shape, and Volume through visible encoder cells registered by `WavetableVcoModule<2>`
- **AND** Shape controls wavetable morph position through the module rather than the old placeholder switch-shaped parameter

#### Scenario: Second page contains module-backed LFO controls
- **WHEN** the second miniapp page is active
- **THEN** its selected page bank exposes Frequency, Shape, Phase Offset, Skew, and Exponent through visible encoder cells registered by `BasicLfoModule<2>`
- **AND** those controls drive the module-backed LFO source rather than an app-local sine/cosine helper

#### Scenario: Page selection drives bank-slot routing
- **WHEN** the miniapp selects a page
- **THEN** it selects the corresponding bank into the miniapp's single bank slot
- **AND** reusable encoder components continue to bind to `ParameterManager::UIState` slot cells

#### Scenario: Miniapp processes module-backed VCOs
- **WHEN** the miniapp processing step runs
- **THEN** it processes two wavetable VCO instances through `WavetableVcoModule<2>` using the module's Tune, Phase, Shape, and Volume mappings

#### Scenario: Miniapp processes module-backed LFOs
- **WHEN** the miniapp processing step runs
- **THEN** it processes two LFO instances through `BasicLfoModule<2>` using the module's Frequency, Shape, Phase Offset, Skew, and Exponent mappings

#### Scenario: Miniapp publishes scope
- **WHEN** the miniapp finishes a processing step
- **THEN** it publishes the scope writer index so waveform UI readers can render current VCO and LFO samples

### Requirement: sdsp-33 — MiniApp: per-modulator scope visualizer instances
WHEN MiniApp initializes its three scope-backed modulation sources at indexes `0`, `1`, and `2`, THE application SHALL construct three visible, address-stable portable scope visualizer instances; SHALL assign distinct VCO visualizer instances to modulators `0` and `1`; SHALL assign one LFO visualizer instance to modulator `2`; SHALL bind the two VCO visualizers to the stable app-owned VCO module UI state and the LFO visualizer to the stable app-owned LFO module UI state; SHALL retain all visualizers and referenced UI state through application teardown; and SHALL keep non-scope modulation-source visualizers outside this three-instance scope contract.

#### Scenario: VCO modulators do not alias component identity
- **WHEN** MiniApp initialization completes
- **THEN** modulator `0` and modulator `1` have non-null visualizer pointers with different addresses
- **AND** both visualizers render from the MiniApp VCO UI-state collection

#### Scenario: LFO modulator uses LFO state
- **WHEN** MiniApp opens a modulation view containing modulator `2`
- **THEN** its depth encoder has an LFO scope visualizer beneath it
- **AND** the visualizer reads the MiniApp LFO module's published UI state

#### Scenario: MiniApp visualizers remain portable
- **WHEN** MiniApp visualizer initialization and drawing are compiled in the JUCE-free synth test targets
- **THEN** they require no backend header or backend-specific component implementation

#### Scenario: Non-scope visualizers have separate contracts
- **WHEN** MiniApp attaches model-free or immutable-data visualizers to modulators `3`, `4`, and `5`
- **THEN** those visualizers are not counted among the three scope visualizer instances
- **AND** the ganged random LFO is governed by `sdsp-36` and `spv-6`, noise by `sdsp-38` and `spv-7`, and the constant visualizer by `sdsp-40` and `spv-8`

## ADDED Requirements

### Requirement: sdsp-39 — Constant: runtime-sized immutable modulation processor
WHEN applications need fixed per-voice modulation spread, THE synth DSP system SHALL provide a runtime-sized `ConstantModulatorProcessor` that is constructed with a positive voice count, computes exactly one normalized value for every voice during construction using the greedy maximum-cyclic-distance permutation, owns address-stable output storage and source pointers for those values, and exposes no operation that recomputes or changes them after construction.

#### Scenario: Invalid voice count fails during setup
- **WHEN** construction requests zero voices
- **THEN** construction fails with an invalid-configuration error before any source can be registered

#### Scenario: One voice receives zero
- **WHEN** a constant modulator processor is constructed for one voice
- **THEN** it reports one voice and publishes exactly `0`

#### Scenario: Even voice counts use the greedy maximizing order
- **WHEN** a constant modulator processor is constructed for `n = 2m` voices
- **THEN** permutation entry `2k` is `k` and entry `2k + 1` is `m + k` for each `k` from `0` through `m - 1`
- **AND** voice `j` publishes permutation entry `j` divided by `n - 1`

#### Scenario: Odd voice counts use the greedy maximizing order
- **WHEN** a constant modulator processor is constructed for `n = 2m + 1` voices with `n > 1`
- **THEN** permutation entries `0` and `1` are `0` and `m`, entries `2k` and `2k + 1` are `m + k` and `k` for each `k` from `1` through `m - 1`, and final entry `2m` is `2m`
- **AND** voice `j` publishes permutation entry `j` divided by `n - 1`

#### Scenario: Assignments cover the normalized range
- **WHEN** a processor is constructed for more than one voice
- **THEN** its outputs contain every rank `0` through `n - 1` exactly once after multiplication by `n - 1` and comparison within floating-point representation tolerance
- **AND** the cyclic sum of adjacent unnormalized rank differences is `floor(n * n / 2)`

#### Scenario: Construction establishes immutable stable storage
- **WHEN** a processor is constructed for `n` voices
- **THEN** it reports voice count `n` and exposes `n` source pointers
- **AND** every pointer address and pointed-to value remains unchanged for the processor lifetime
- **AND** the processor provides no per-sample process operation

#### Scenario: Processor outputs register without adapter storage
- **WHEN** an application passes the processor's source-pointer span to a modulation source whose group has the same voice count
- **THEN** modulation-value updates dereference the processor's corresponding fixed per-voice values
- **AND** the processor does not depend on parameter IDs, banks, pages, controller layout, UI state, or modulator index selection

### Requirement: sdsp-40 — MiniApp: sixth-slot constant modulator
WHEN MiniApp publishes its fixed voice-spread modulation source, THE application SHALL configure its two-voice group with six modulator slots, retain one two-voice `ConstantModulatorProcessor`, register that processor's stable outputs as the connected `Constant` source at modulator index `5`, attach one retained yellow portable constant bar visualizer to index `5`, and perform no per-sample constant-source recomputation.

#### Scenario: Constant occupies the sixth modulator slot
- **WHEN** MiniApp initialization completes
- **THEN** the parameter group reports six modulator slots and capacity for 84 modulation-aware values
- **AND** modulator index `5` is connected with constant metadata, yellow source color, and two source pointers
- **AND** modulators `0` through `4` preserve their existing registrations

#### Scenario: MiniApp two-voice assignment spans the range
- **WHEN** MiniApp registers its two-voice constant processor
- **THEN** voice `0` publishes `0` and voice `1` publishes `1`

#### Scenario: Constant values do not enter the sample loop
- **WHEN** MiniApp processes any number of audio samples and updates group modulation values
- **THEN** modulator index `5` continues to publish the construction-time value for each corresponding voice
- **AND** MiniApp performs no processor call or output copy for the constant source in its per-sample path

#### Scenario: Constant visualizer is retained independently
- **WHEN** MiniApp opens a modulation view containing modulator index `5`
- **THEN** its depth encoder has the retained portable constant bar visualizer beneath it
- **AND** that visualizer reads only the processor's immutable value span and requires no scope or UI-state publication
