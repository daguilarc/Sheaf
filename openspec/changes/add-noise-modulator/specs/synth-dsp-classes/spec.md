## MODIFIED Requirements

### Requirement: sdsp-13 — Miniapp: duophonic VCO patch
WHEN the synth miniapp demonstrates DSP classes through reusable modules, THE miniapp SHALL use one parameter group configured for two voices and five modulators, SHALL expose page one module parameters Tune, Phase, Shape, and Volume through visible encoder cells, SHALL expose page two with module-backed LFO Frequency, Shape, Phase Offset, Skew, and Exponent controls through visible encoder cells, SHALL represent each page as both `ParameterManager` page metadata and the corresponding selected bank for the existing bank-slot encoder routing, and SHALL display waveform panes from module-published VCO and LFO UI state.

#### Scenario: Miniapp creates one duophonic group
- **WHEN** the miniapp initializes parameters
- **THEN** it creates one parameter group with polyphony two
- **AND** the group has exactly five modulators

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

#### Scenario: Non-scope noise visualizer has a separate contract
- **WHEN** MiniApp attaches the model-free noise visualizer to modulator `4`
- **THEN** that visualizer is not counted among the three scope visualizer instances
- **AND** its behavior is governed by `sdsp-35` and `spv-6`

## ADDED Requirements

### Requirement: sdsp-34 — Noise: runtime-sized modulation processor
WHEN applications need audio-rate white-noise modulation, THE synth DSP system SHALL provide a runtime-sized `NoiseModulatorProcessor` that is constructed with a positive voice count, owns address-stable output storage and source pointers for exactly those voices, produces one new pseudorandom float strictly inside `(0, 1)` for every voice on each process call, supports explicit deterministic seeding, and performs no allocation, locking, system-entropy access, or cryptographic operation while processing.

#### Scenario: Construction establishes stable polyphonic storage
- **WHEN** a noise modulator processor is constructed for `N` voices
- **THEN** it reports voice count `N`
- **AND** exposes `N` source pointers whose addresses remain unchanged across process calls

#### Scenario: Invalid voice count fails during setup
- **WHEN** construction requests zero voices
- **THEN** construction fails with an invalid-configuration error before any source can be registered

#### Scenario: Every voice receives strict unipolar noise
- **WHEN** an `N`-voice noise modulator processor processes one sample
- **THEN** it advances its pseudorandom stream once for each voice
- **AND** replaces every voice output with a finite value greater than `0` and less than `1`

#### Scenario: Seeded processors are repeatable
- **WHEN** two processors with the same voice count receive the same explicit seed
- **AND** they receive the same sequence of process calls
- **THEN** their per-voice output sequences are identical

#### Scenario: Audio processing stays lightweight
- **WHEN** the processor runs repeatedly after construction
- **THEN** each output uses a bounded fixed-state pseudorandom update and open-interval float conversion
- **AND** processing performs no heap allocation, lock, system entropy request, distribution setup, or cryptographic work

#### Scenario: Processor outputs register without adapter storage
- **WHEN** an application passes the processor's source-pointer span to a modulation source whose group has the same voice count
- **THEN** subsequent modulation-value updates dereference the processor's latest per-voice outputs
- **AND** the processor does not depend on parameter IDs, banks, pages, controller layout, or modulator index selection

### Requirement: sdsp-35 — MiniApp: fifth-slot noise modulator
WHEN MiniApp publishes its simple noise modulation source, THE application SHALL configure its two-voice group with five modulator slots, retain one two-voice `NoiseModulatorProcessor`, register that processor's stable outputs as the connected `Noise` source at modulator index `4`, process it once per audio sample before updating group modulation values, attach one retained portable noise waveform visualizer to index `4`, and SHALL NOT claim modulator index `3` as part of this change.

#### Scenario: Noise occupies the fifth modulator slot
- **WHEN** MiniApp initialization completes
- **THEN** the parameter group reports five modulator slots
- **AND** modulator index `4` is connected with noise metadata and two source pointers

#### Scenario: Noise values update at audio rate
- **WHEN** MiniApp processes an audio sample
- **THEN** it processes the two-voice noise modulator before calling the group's modulation-value update
- **AND** modulator index `4` publishes the newly generated value for each corresponding voice

#### Scenario: Noise visualizer is retained independently
- **WHEN** MiniApp opens a modulation view containing modulator index `4`
- **THEN** its depth encoder has a non-null portable noise waveform visualizer beneath it
- **AND** that visualizer does not read MiniApp noise output, scope state, or polyphonic UI state

#### Scenario: Fourth-slot integration boundary remains available
- **WHEN** this change configures and registers the MiniApp noise source
- **THEN** it performs no source registration, metadata assignment, or visualizer assignment for modulator index `3`
- **AND** parallel fourth-modulator work can occupy index `3` while noise remains at index `4`
