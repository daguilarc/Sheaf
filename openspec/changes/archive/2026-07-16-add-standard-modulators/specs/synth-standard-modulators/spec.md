## ADDED Requirements

### Requirement: ssm-1 — Ownership: opt-in fixed-polyphony standard bundle
WHEN an application opts a parameter group into standard modulation, THE synth standard-modulator system SHALL provide a non-copyable and non-movable `StandardModulators<VoiceCount>` that retains a non-owning pointer to that group and owns four `GangedRandomLfoProcessor<VoiceCount>` instances, their four inputs, stable per-voice output and pointer rows, one `NoiseModulatorProcessor`, one `ConstantModulatorProcessor`, four ganged-random visualizers, one noise visualizer, and one constant visualizer for the bundle's complete registered lifetime.

#### Scenario: Bundle owns every registered address
- **WHEN** a standard bundle is constructed for a group and retained through application teardown
- **THEN** every processor output pointer and visualizer pointer installed by the bundle refers to storage owned by that same retained bundle
- **AND** no application-owned adapter row, input, or generic-source visualizer is required

#### Scenario: Adoption remains opt-in
- **WHEN** an application creates a parameter group without constructing or registering a standard bundle
- **THEN** the group receives no standard source, metadata, processing, or visualizer implicitly

#### Scenario: Registered ownership cannot move
- **WHEN** compile-time traits inspect a standard bundle specialization
- **THEN** copy construction, copy assignment, move construction, and move assignment are unavailable

### Requirement: ssm-2 — Configuration: editable MIN-16 defaults
WHEN a standard bundle is constructed but not yet registered, THE synth standard-modulator system SHALL expose editable configuration for all six indexes, six source metadata records, four random inputs, and random voice colors; SHALL default random sources to indexes `0`, `1`, `2`, and `3`, constant to `11`, and noise to `14`; SHALL default noise to white `Noise` metadata and constant to yellow `Constant`/`Const` metadata; and SHALL reject mutable configuration access after successful registration while continuing to allow read-only inspection.

#### Scenario: Default indexes leave application slots available
- **WHEN** a newly constructed bundle's configuration is inspected
- **THEN** random indexes are `[0, 1, 2, 3]`, constant index is `11`, and noise index is `14`
- **AND** indexes `4..10` and `12..13` remain available to the application

#### Scenario: Random metadata identifies four rates
- **WHEN** default random metadata is inspected in index order
- **THEN** names are `Random 500 ms`, `Random 2 s`, `Random 6 s`, and `Random 16 s`
- **AND** short names are `Rnd .5`, `Rnd 2`, `Rnd 6`, and `Rnd 16`
- **AND** source colors are Cyan, Blue, Indigo, and Orange

#### Scenario: Voice identity colors are deterministic
- **WHEN** a default bundle has at most four voices
- **THEN** each random processor uses the first `VoiceCount` colors of Cyan, Orange, Green, and Yellow in voice order

#### Scenario: Caller overrides defaults before registration
- **WHEN** a caller changes a source index, metadata field, voice color, or random input before `Register()`
- **THEN** registration and subsequent processing use the changed value

#### Scenario: Configuration freezes after registration
- **WHEN** a caller requests mutable configuration after successful registration
- **THEN** the bundle reports a lifecycle logic error
- **AND** registered pointers and metadata remain unchanged

### Requirement: ssm-3 — Random defaults: four derived time scales
WHEN the standard random inputs use their defaults, THE synth standard-modulator system SHALL use waiting means `W=[0.5, 2, 6, 16]` seconds and target internal sigmas `[0.1, 0.3, 0.2, 0.1]`; SHALL set `waiting.muSeconds=W`, `waiting.sigmaSeconds=0.3 * W`, and `waiting.internalSigmaHz=0.2 / W`; and SHALL set `moving.muSeconds=W / 2`, `moving.sigmaSeconds=0.3 * (W / 2)`, and `moving.internalSigmaHz=0.2 / (W / 2)`.

#### Scenario: 500-millisecond source has derived values
- **WHEN** random source `0` uses its defaults
- **THEN** waiting `(mu, sigma, internal)` is `(0.5, 0.15, 0.4)` and moving `(mu, sigma, internal)` is `(0.25, 0.075, 0.8)`
- **AND** target internal sigma is `0.1`

#### Scenario: Two-second source has derived values
- **WHEN** random source `1` uses its defaults
- **THEN** waiting `(mu, sigma, internal)` is `(2, 0.6, 0.1)` and moving `(mu, sigma, internal)` is `(1, 0.3, 0.2)`
- **AND** target internal sigma is `0.3`

#### Scenario: Six-second source has derived values
- **WHEN** random source `2` uses its defaults
- **THEN** waiting `(mu, sigma, internal)` is `(6, 1.8, 1/30)` and moving `(mu, sigma, internal)` is `(3, 0.9, 1/15)`
- **AND** target internal sigma is `0.2`

#### Scenario: Sixteen-second source has derived values
- **WHEN** random source `3` uses its defaults
- **THEN** waiting `(mu, sigma, internal)` is `(16, 4.8, 0.0125)` and moving `(mu, sigma, internal)` is `(8, 2.4, 0.025)`
- **AND** target internal sigma is `0.1`

### Requirement: ssm-4 — Registration: validated fifteen-source topology
WHEN `Register()` is called on an unregistered standard bundle, THE synth standard-modulator system SHALL validate before group mutation that the group has exactly `VoiceCount` voices and fifteen modulators, every active index is in `0..14` and unique, all active metadata and random inputs are valid, and the voice-color palette matches `VoiceCount`; SHALL then install all active sources as connected with their configured metadata and wrapper-owned visualizers; and SHALL reject a second registration or any invalid configuration without partially installing the bundle.

#### Scenario: Polyphonic group receives six sources
- **WHEN** a default bundle with `VoiceCount > 1` registers into a matching fifteen-modulator group
- **THEN** indexes `0..3`, `11`, and `14` are connected to the four random, constant, and noise sources respectively
- **AND** each of those six metadata records holds its wrapper-owned portable visualizer

#### Scenario: Monophonic group skips constant
- **WHEN** `StandardModulators<1>` registers into a matching fifteen-modulator group
- **THEN** random indexes `0..3` and noise index `14` are connected
- **AND** constant index `11` receives no source pointer, connected metadata, or visualizer from the bundle

#### Scenario: Inactive mono constant does not collide
- **WHEN** a monophonic bundle configures its unused constant index equal to another active index
- **THEN** active-index uniqueness validation ignores the inactive constant index
- **AND** the active source registers normally

#### Scenario: Shape mismatch fails atomically
- **WHEN** group voice count differs from `VoiceCount` or its modulator count differs from fifteen
- **THEN** registration fails before any source metadata or pointer is installed

#### Scenario: Active index collision fails atomically
- **WHEN** two active sources are configured for the same index
- **THEN** registration fails before either source is installed

### Requirement: ssm-5 — Lifecycle: prepare, process, publish, and explicit update
WHILE a registered standard bundle is used by an audio application, THE synth standard-modulator system SHALL require finite-positive sample-rate preparation before processing; SHALL on each `Process()` call advance all four random processors once, copy their current outputs into stable source rows, and advance noise once without processing constant; SHALL publish all four random UI snapshots only when `PublishUiState()` is called; SHALL perform no allocation, lock, system-entropy access, or group update in `Process()`; and SHALL leave `ParameterGroup::UpdateModValues()` under application control.

#### Scenario: Processing before prepare fails
- **WHEN** `Process()` is called before successful sample-rate preparation
- **THEN** the bundle reports a lifecycle logic error without advancing a source

#### Scenario: One process call advances five dynamic sources
- **WHEN** a prepared bundle processes one sample
- **THEN** each random processor advances exactly once and its per-voice outputs are copied in voice order
- **AND** noise produces one new value per voice
- **AND** constant values remain their construction-time values without a processor call or output copy

#### Scenario: Group update is explicit
- **WHEN** `Process()` finishes but the application has not called `UpdateModValues()`
- **THEN** the group's cached modulator row has not been refreshed by the bundle
- **WHEN** the application then calls `UpdateModValues()`
- **THEN** the group dereferences the latest stable standard and application-specific source pointers together

#### Scenario: UI publication is block-controlled
- **WHEN** random processors advance during an audio block
- **THEN** wrapper visualizer snapshots remain at their prior coherent publication until `PublishUiState()` is called
- **AND** one publication updates all four random UI states without reconstructing a visualizer
