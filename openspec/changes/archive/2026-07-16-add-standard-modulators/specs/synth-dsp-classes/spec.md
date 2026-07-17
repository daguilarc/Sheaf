## RENAMED Requirements

- FROM: `### Requirement: sdsp-38 — MiniApp: fifth-slot noise modulator`
- TO: `### Requirement: sdsp-38 — MiniApp: standard noise modulator`
- FROM: `### Requirement: sdsp-40 — MiniApp: sixth-slot constant modulator`
- TO: `### Requirement: sdsp-40 — MiniApp: standard constant modulator`

## MODIFIED Requirements

### Requirement: sdsp-33 — MiniApp: per-modulator scope visualizer instances
WHEN MiniApp initializes its three scope-backed application-specific modulation sources at indexes `4`, `5`, and `6`, THE application SHALL construct three visible, address-stable portable scope visualizer instances; SHALL assign distinct VCO visualizer instances to modulators `4` and `5`; SHALL assign one LFO visualizer instance to modulator `6`; SHALL bind the two VCO visualizers to the stable app-owned VCO module UI state and the LFO visualizer to the stable app-owned LFO module UI state; SHALL retain all visualizers and referenced UI state through application teardown; and SHALL keep standard non-scope modulation-source visualizers outside this three-instance scope contract.

#### Scenario: VCO modulators do not alias component identity
- **WHEN** MiniApp initialization completes
- **THEN** modulator `4` and modulator `5` have non-null visualizer pointers with different addresses
- **AND** both visualizers render from the MiniApp VCO UI-state collection

#### Scenario: LFO modulator uses LFO state
- **WHEN** MiniApp opens a modulation view containing modulator `6`
- **THEN** its depth encoder has an LFO scope visualizer beneath it
- **AND** the visualizer reads the MiniApp LFO module's published UI state

#### Scenario: MiniApp visualizers remain portable
- **WHEN** MiniApp visualizer initialization and drawing are compiled in the JUCE-free synth test targets
- **THEN** they require no backend header or backend-specific component implementation

#### Scenario: Standard visualizers have a separate contract
- **WHEN** MiniApp attaches standard random, constant, and noise visualizers to modulators `0..3`, `11`, and `14`
- **THEN** those visualizers are not counted among the three scope visualizer instances
- **AND** their ownership and publication are governed by `synth-standard-modulators`, with drawing behavior governed by `spv-6`, `spv-7`, and `spv-8`

### Requirement: sdsp-38 — MiniApp: standard noise modulator
WHEN MiniApp publishes its simple noise modulation source, THE application SHALL retain one `StandardModulators<2>` that owns a two-voice `NoiseModulatorProcessor`, register that processor's stable outputs as connected `Noise` source index `14` in the fifteen-modulator group, process it once per audio sample through the standard bundle before updating group modulation values, and attach the bundle's retained portable noise waveform visualizer to index `14`.

#### Scenario: Noise occupies the last modulation cell
- **WHEN** MiniApp initialization completes
- **THEN** the parameter group reports fifteen modulator slots
- **AND** modulator index `14` is connected with white noise metadata, two source pointers, and a non-null wrapper-owned visualizer

#### Scenario: Noise values update at audio rate
- **WHEN** MiniApp processes an audio sample
- **THEN** its standard bundle processes the two-voice noise processor before the group's modulation-value update
- **AND** modulator index `14` publishes the newly generated value for each corresponding voice

#### Scenario: Noise visualizer is retained by the standard bundle
- **WHEN** MiniApp opens a modulation view containing modulator index `14`
- **THEN** its depth encoder has the retained portable noise waveform visualizer beneath it
- **AND** that visualizer does not read MiniApp noise output, scope state, or polyphonic UI state

#### Scenario: MiniApp has no direct noise plumbing
- **WHEN** MiniApp's generic source ownership is inspected
- **THEN** its core does not separately own a noise processor, noise source-pointer adapter, or noise visualizer outside `StandardModulators<2>`

### Requirement: sdsp-40 — MiniApp: standard constant modulator
WHEN MiniApp publishes its fixed voice-spread modulation source, THE application SHALL retain one `StandardModulators<2>` that owns a two-voice `ConstantModulatorProcessor`, register that processor's stable outputs as connected `Constant` source index `11` in the fifteen-modulator group, attach the bundle's retained yellow portable constant bar visualizer to index `11`, and perform no per-sample constant-source recomputation or copy.

#### Scenario: Constant occupies standard index eleven
- **WHEN** MiniApp initialization completes
- **THEN** the parameter group reports fifteen modulator slots and capacity for its complete fifteen-cell modulation view
- **AND** modulator index `11` is connected with constant metadata, yellow source color, two source pointers, and a non-null wrapper-owned visualizer
- **AND** standard random sources remain at `0..3`, application-specific sources remain at `4..6`, and noise remains at `14`

#### Scenario: MiniApp two-voice assignment spans the range
- **WHEN** MiniApp registers its standard bundle's two-voice constant processor
- **THEN** voice `0` publishes `0` and voice `1` publishes `1`

#### Scenario: Constant values do not enter the sample loop
- **WHEN** MiniApp processes any number of audio samples and updates group modulation values
- **THEN** modulator index `11` continues to publish the construction-time value for each corresponding voice
- **AND** neither MiniApp nor the standard bundle performs a constant processor call or output copy in the per-sample path

#### Scenario: Constant visualizer is retained by the standard bundle
- **WHEN** MiniApp opens a modulation view containing modulator index `11`
- **THEN** its depth encoder has the retained portable constant bar visualizer beneath it
- **AND** that visualizer reads only the processor's immutable value span and requires no scope or UI-state publication

#### Scenario: MiniApp has no direct constant plumbing
- **WHEN** MiniApp's generic source ownership is inspected
- **THEN** its core does not separately own a constant processor, constant source-pointer adapter, or constant visualizer outside `StandardModulators<2>`
