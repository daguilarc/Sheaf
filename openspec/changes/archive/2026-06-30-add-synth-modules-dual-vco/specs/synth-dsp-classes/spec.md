## MODIFIED Requirements

### Requirement: sdsp-13 — Miniapp: duophonic VCO patch
WHEN the synth miniapp demonstrates DSP classes through the dual wavetable VCO module, THE miniapp SHALL use one parameter group configured for two voices and three modulators, SHALL expose page one module parameters Tune, Phase, Shape, and Volume through four visible encoders, SHALL expose page two with only the existing sine/cosine LFO speed parameter, SHALL represent each page as both `ParameterManager` page metadata and the corresponding selected bank for the existing bank-slot encoder routing, and SHALL display one VCO waveform pane containing both VCOs.

#### Scenario: Miniapp creates one duophonic group
- **WHEN** the miniapp initializes parameters
- **THEN** it creates one parameter group with polyphony two
- **AND** the group has exactly three modulators

#### Scenario: First page contains module-backed VCO controls
- **WHEN** the first miniapp page is active
- **THEN** its selected page bank exposes Tune, Phase, Shape, and Volume through four visible encoder cells registered by the dual wavetable VCO module
- **AND** Shape controls wavetable morph position through the module rather than the old placeholder switch-shaped parameter

#### Scenario: Second page contains LFO speed
- **WHEN** the second miniapp page is active
- **THEN** its selected page bank exposes only the sine/cosine LFO speed parameter
- **AND** the remaining visible encoder cells are disconnected

#### Scenario: Page selection drives bank-slot routing
- **WHEN** the miniapp selects a page
- **THEN** it selects the corresponding bank into the miniapp's single bank slot
- **AND** reusable encoder components continue to bind to `ParameterManager::UIState` slot cells

#### Scenario: Miniapp processes module-backed VCOs
- **WHEN** the miniapp processing step runs
- **THEN** it processes two wavetable VCO instances through the dual wavetable VCO module using the module's Tune, Phase, Shape, and Volume mappings

#### Scenario: Miniapp publishes scope
- **WHEN** the miniapp finishes a processing step
- **THEN** it publishes the scope writer index so waveform UI readers can render current samples

### Requirement: sdsp-14 — Miniapp: VCO and LFO modulators
WHEN the synth miniapp publishes modulation values, THE miniapp SHALL provide two duophonic modulators from pointer-backed dual VCO module source floats, one with each VCO mapped to its corresponding voice and one with the VCO outputs swapped, and SHALL keep the existing sine/cosine LFO as a third pointer-backed modulator whose speed is controlled by the second page parameter.

#### Scenario: Direct VCO modulator follows voices
- **WHEN** VCO 0 outputs `A` and VCO 1 outputs `B`
- **THEN** the dual VCO module's direct source floats publish `(A + 1) * 0.5` for voice 0 and `(B + 1) * 0.5` for voice 1
- **AND** those source floats are clamped to `[0, 1]`

#### Scenario: Swapped VCO modulator swaps voices
- **WHEN** VCO 0 outputs `A` and VCO 1 outputs `B`
- **THEN** the dual VCO module's swapped source floats publish `(B + 1) * 0.5` for voice 0 and `(A + 1) * 0.5` for voice 1
- **AND** those source floats are clamped to `[0, 1]`

#### Scenario: Third modulator remains sine/cosine LFO
- **WHEN** the miniapp processing step updates modulators
- **THEN** modulator 2 publishes the existing sine/cosine LFO values for the two voices through the pointer-backed modulation-source update system

#### Scenario: LFO speed parameter controls ad-hoc LFO
- **WHEN** the LFO speed parameter changes
- **THEN** the miniapp changes the rate of the existing sine/cosine LFO without requiring a reusable LFO DSP class in this change

## ADDED Requirements

### Requirement: sdsp-15 — Pattern: DSP processors remain UI-agnostic
WHEN reusable synth DSP processors are used by modules or applications, THE synth DSP system SHALL keep DSP processor inputs expressed in natural DSP units, SHALL NOT require DSP processors to know parameter IDs, knob assignments, bank slots, pages, gestures, or controller layouts, and SHALL leave opinionated parameter/UI mapping to the module layer.

#### Scenario: VCO receives cycles per sample
- **WHEN** a wavetable VCO is processed from a module-controlled Tune parameter
- **THEN** the VCO receives frequency in cycles per sample
- **AND** the VCO does not receive the normalized Tune parameter value

#### Scenario: DSP processor has no bank dependency
- **WHEN** a DSP processor header is included in a JUCE-free synth test
- **THEN** the processor can be constructed and processed without constructing a `Bank`, `BankSlot`, page, or UI control

#### Scenario: Module owns knob mapping
- **WHEN** a module maps a Shape parameter to a wavetable position
- **THEN** the mapping occurs before calling the DSP processor
- **AND** the DSP processor remains reusable by callers that supply wavetable position directly

### Requirement: sdsp-16 — Miniapp: DSP processors composed through modules
WHEN the synth miniapp uses reusable DSP processors for the duophonic VCO patch, THE miniapp SHALL compose those processors through the dual wavetable VCO module rather than binding miniapp UI controls directly to individual DSP processor input fields.

#### Scenario: Miniapp delegates frequency mapping
- **WHEN** the miniapp processes the VCO patch
- **THEN** Tune-to-frequency mapping is performed by the dual wavetable VCO module
- **AND** the app does not duplicate that mapping in its sample loop

#### Scenario: Miniapp delegates VCO UI state publication
- **WHEN** the miniapp refreshes waveform UI state
- **THEN** it receives VCO UI-state data through the module
- **AND** does not reach through to internal DSP processors except through module-provided state or accessors
