## MODIFIED Requirements

### Requirement: sdsp-13 — Miniapp: duophonic VCO patch
WHEN the synth miniapp demonstrates DSP classes through reusable modules, THE miniapp SHALL use one parameter group configured for two voices and three modulators, SHALL expose page one module parameters Tune, Phase, Shape, and Volume through visible encoder cells, SHALL expose page two with module-backed LFO Frequency, Shape, Phase Offset, Skew, and Exponent controls through visible encoder cells, SHALL represent each page as both `ParameterManager` page metadata and the corresponding selected bank for the existing bank-slot encoder routing, and SHALL display waveform panes from module-published VCO and LFO UI state.

#### Scenario: Miniapp creates one duophonic group
- **WHEN** the miniapp initializes parameters
- **THEN** it creates one parameter group with polyphony two
- **AND** the group has exactly three modulators

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

### Requirement: sdsp-14 — Miniapp: VCO and LFO modulators
WHEN the synth miniapp publishes modulation values, THE miniapp SHALL provide two duophonic modulators from pointer-backed `WavetableVcoModule<2>` source floats, one with each VCO mapped to its corresponding voice and one with the VCO outputs swapped, and SHALL provide a third duophonic modulator from pointer-backed `BasicLfoModule<2>` source floats controlled by the LFO module's five parameters.

#### Scenario: Direct VCO modulator follows voices
- **WHEN** VCO 0 outputs `A` and VCO 1 outputs `B`
- **THEN** the VCO module's direct source floats publish `(A + 1) * 0.5` for voice 0 and `(B + 1) * 0.5` for voice 1
- **AND** those source floats are clamped to `[0, 1]`

#### Scenario: Swapped VCO modulator swaps voices
- **WHEN** VCO 0 outputs `A` and VCO 1 outputs `B`
- **THEN** the VCO module's swapped source floats publish `(B + 1) * 0.5` for voice 0 and `(A + 1) * 0.5` for voice 1
- **AND** those source floats are clamped to `[0, 1]`

#### Scenario: Third modulator is basic LFO module output
- **WHEN** the miniapp processing step updates modulators
- **THEN** modulator 2 publishes `BasicLfoModule<2>`'s per-voice unipolar output values through the pointer-backed modulation-source update system
- **AND** the miniapp does not compute that source with app-local sine/cosine LFO helpers

#### Scenario: LFO parameters control module output
- **WHEN** any LFO page parameter changes
- **THEN** the miniapp changes `BasicLfoModule<2>` input mapping for the affected voice before publishing the next LFO modulation-source values

### Requirement: sdsp-16 — Miniapp: DSP processors composed through modules
WHEN the synth miniapp uses reusable DSP processors for the duophonic VCO and LFO patch, THE miniapp SHALL compose those processors through `WavetableVcoModule<2>` and `BasicLfoModule<2>` rather than binding miniapp UI controls directly to individual DSP processor input fields.

#### Scenario: Miniapp delegates frequency mapping
- **WHEN** the miniapp processes the VCO patch
- **THEN** Tune-to-frequency mapping is performed by `WavetableVcoModule<2>`
- **AND** the app does not duplicate that mapping in its sample loop

#### Scenario: Miniapp delegates VCO UI state publication
- **WHEN** the miniapp refreshes waveform UI state
- **THEN** it receives VCO UI-state data through the module
- **AND** does not reach through to internal DSP processors except through module-provided state or accessors

#### Scenario: Miniapp delegates LFO mapping
- **WHEN** the miniapp processes the LFO patch
- **THEN** Frequency, Shape, Phase Offset, Skew, and Exponent mapping is performed by `BasicLfoModule<2>`
- **AND** the app does not duplicate that mapping in its sample loop

#### Scenario: Miniapp delegates LFO UI state publication
- **WHEN** the miniapp refreshes waveform UI state
- **THEN** it receives LFO UI-state data through the module
- **AND** does not reach through to internal DSP processors except through module-provided state or accessors

## ADDED Requirements

### Requirement: sdsp-20 — LFO: shape processor
WHEN reusable LFO shape computation is needed, THE synth DSP system SHALL provide an `LFOShape` processor whose input contains `inPhase`, `shape`, `phaseOffset`, `skew`, and `exponent`, whose processing is a pure computation with no owned phase state, and whose output is clamped to `[0, 1]` from `Pow(Shape(shape, Tri(PD(skew, wrap(inPhase + phaseOffset)))), exponent)`.

#### Scenario: Triangle maps phase to unipolar triangle
- **WHEN** `Tri` receives phase `0`, `0.5`, and `1`
- **THEN** it returns `0`, `1`, and `0` respectively within numeric tolerance

#### Scenario: Shape morph reaches sine-linear-square landmarks
- **WHEN** `Shape` is evaluated with shape `0`
- **THEN** it uses `sin(pi * x / 2)` for the curved half-shape
- **WHEN** `Shape` is evaluated with shape `0.5`
- **THEN** it returns `x` within numeric tolerance
- **WHEN** `Shape` is evaluated near shape `1`
- **THEN** it approaches a clipped square-like response while remaining in `[0, 1]`

#### Scenario: Phase distortion uses skew breakpoint
- **WHEN** phase distortion skew is `0.5`
- **THEN** `PD` returns its input phase within numeric tolerance
- **WHEN** skew moves below or above `0.5`
- **THEN** `PD` remaps wrapped phase before triangle evaluation so the triangle rise and fall timing shifts around the skew breakpoint without returning values outside `[0, 1]`

#### Scenario: Exponent shapes output around one
- **WHEN** all other inputs are fixed and exponent is greater than `1`
- **THEN** the output equals the shaped base raised to that exponent
- **WHEN** exponent is between `0` and `1`
- **THEN** the output equals the shaped base raised to that fractional exponent

#### Scenario: Phase wraps without fmod
- **WHEN** `inPhase + phaseOffset` falls outside `[0, 1)`
- **THEN** the processor wraps it with `x - floor(x)` semantics before applying phase distortion and triangle evaluation

### Requirement: sdsp-21 — LFO: basic incrementer processor with scope UI state
WHEN stateful LFO processing is needed, THE synth DSP system SHALL provide a `BasicLFOProcessor` class that owns an `Incrementer`, accepts an input containing `LFOShape::Input` and frequency in cycles per sample, advances the incrementer on each process step, evaluates `LFOShape` at the incrementer's wrapped phase, writes optional scope samples and top markers through a nullable scope writer holder, and publishes UI state containing the scope channel, color, and scope pointer needed for waveform rendering.

#### Scenario: Basic LFO advances by frequency
- **WHEN** the basic LFO processor receives frequency `0.25` cycles per sample
- **THEN** successive process calls evaluate shape at wrapped phases advanced by `0.25`

#### Scenario: Basic LFO process is natural-unit
- **WHEN** a caller processes a basic LFO
- **THEN** it supplies frequency in cycles per sample and shape inputs in natural DSP ranges
- **AND** the processor does not read parameter IDs, bank slots, pages, or normalized knob values

#### Scenario: Basic LFO writes scope
- **WHEN** the basic LFO has a non-null scope writer holder
- **AND** it processes a sample
- **THEN** it writes the unipolar LFO output sample to the holder's assigned channel

#### Scenario: Basic LFO records top marker
- **WHEN** the basic LFO incrementer reports top during processing
- **AND** a scope writer holder is configured
- **THEN** the basic LFO records a scope start marker for that sample

#### Scenario: Basic LFO UI state contains render data
- **WHEN** the basic LFO populates UI state
- **THEN** the UI state identifies the LFO color, the scope writer or reader source, and the flat scope channel index needed to render that LFO waveform

### Requirement: sdsp-22 — JUCE waveform rendering: LFO waveform component
WHEN LFO waveform scope UI is rendered, THE synth DSP system SHALL provide a JUCE component whose constructor accepts a list of `BasicLFOProcessor::UIState` pointers and draws each connected LFO waveform from scope data without depending on `WavetableVco` UI state.

#### Scenario: LFO waveform component draws multiple LFOs
- **WHEN** an LFO waveform component is constructed with two connected LFO UI-state pointers
- **THEN** its paint operation draws both waveforms in their configured colors using the unipolar LFO y range

#### Scenario: LFO waveform component skips missing scope
- **WHEN** an LFO UI state has no connected scope reader source
- **THEN** the component skips that LFO without failing the paint operation
