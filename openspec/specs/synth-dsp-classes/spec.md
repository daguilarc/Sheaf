## Purpose

Reusable Sheaf synth DSP class patterns, math, multichannel values, filters, scopes, wavetables, VCOs, waveform UI drawing, and miniapp integration behavior.
## Requirements
### Requirement: sdsp-1 — Project: synth DSP modules
WHEN the synth DSP classes capability is implemented, THE repository SHALL provide JUCE-free C++20 synth DSP modules under `projects/synth/include/synth` and `projects/synth/src`, SHALL include those modules in the `projects/synth` library build, and SHALL keep JUCE-dependent waveform rendering in `projects/synth/juce`, `projects/synth/runtime`, or `projects/synth/apps` rather than in JUCE-free DSP headers.

#### Scenario: DSP code builds in synth library
- **WHEN** a developer runs `make -C projects/synth build`
- **THEN** the synth library builds the DSP source files and public DSP headers without including JUCE headers

#### Scenario: DSP tests run in synth suite
- **WHEN** a developer runs `make -C projects/synth test`
- **THEN** the DSP unit tests run as part of the synth test suite

#### Scenario: JUCE waveform code stays outside core DSP
- **WHEN** a JUCE-free synth test includes every public DSP header
- **THEN** the test compiles without seeing `JUCE_MAJOR_VERSION`

### Requirement: sdsp-2 — Pattern: DSP class contract
WHEN reusable synth DSP behavior is implemented, THE synth DSP system SHALL model each DSP unit as a stateful class that owns its processing state, defines an input struct for runtime inputs, processes through `Process(Input&)` or `Process(const Input&)`, and exposes output state on the instance through fields or accessors.

#### Scenario: DSP class owns state
- **WHEN** an incrementer, filter, tanh saturator, or VCO instance is constructed
- **THEN** all state required for subsequent processing is owned by that instance

#### Scenario: DSP class uses input struct
- **WHEN** a caller processes a DSP class
- **THEN** runtime values such as frequency, cutoff, gain, phase offset, or wavetable position are provided through that class's input struct or equivalent strongly named input type

#### Scenario: DSP class exposes output state
- **WHEN** processing completes
- **THEN** output values such as sample output, wrapped phase, total phase, or top-crossing state are readable from the processed instance

### Requirement: sdsp-3 — UI state: DSP publication and transfer functions
WHEN a DSP class has UI-visible state, THE synth DSP system SHALL provide a nested or associated `UIState` and a `PopulateUIState` function that publish UI-readable state without transferring ownership of audio-thread state; filter-like UI states that draw frequency response SHALL implement a transfer-function interface with `FrequencyResponse` and `TransferFunctionValue`.

#### Scenario: UI state uses UI-safe fields
- **WHEN** a DSP class populates UI state
- **THEN** the UI state contains atomics, value snapshots, stable pointers, or indices sufficient for UI rendering
- **AND** the UI state does not require the UI to mutate DSP processing state

#### Scenario: Filter UI state draws response
- **WHEN** a low-pass or high-pass filter UI state is used for visualization
- **THEN** the UI can call `FrequencyResponse` and `TransferFunctionValue` for normalized frequencies

### Requirement: sdsp-4 — Math: arbitrary precision table-backed trig
WHEN DSP math is needed, THE synth DSP system SHALL provide a table-backed math template parameterized by table precision, SHALL support cosine, sine, tangent, polar, roots of unity, Hann windows, and Hann kernels, and SHALL use that math in DSP trig paths instead of ordinary trig after table initialization.

#### Scenario: Different precisions instantiate
- **WHEN** code instantiates the DSP math template for two different bit depths
- **THEN** both instantiations compile and expose table sizes equal to `1 << Bits`

#### Scenario: Sin and cosine are periodic
- **WHEN** the table-backed math evaluates sine or cosine for phases separated by an integer cycle
- **THEN** the returned values are equal within the configured interpolation tolerance

#### Scenario: DSP classes use synth math
- **WHEN** a DSP oscillator, wavetable generator, filter pan helper, or FFT helper needs sine, cosine, tangent, or roots of unity
- **THEN** it uses the synth DSP math API rather than direct `std::sin`, `std::cos`, `std::tan`, `sinf`, `cosf`, or `tanf` calls in the processing path

#### Scenario: Hann kernel supports partial writes
- **WHEN** wavetable or DFT code requests a Hann kernel value for a fractional bin offset
- **THEN** the math API returns an interpolated complex windowed-sinc kernel suitable for Smart Grid-derived partial writes

### Requirement: sdsp-5 — Numbers: n-ary channel values
WHEN multi-channel numeric values are needed, THE synth DSP system SHALL provide an `NaryNumber<T, Size>` style value type with indexed access, arithmetic, scalar operations, modulo-one wrapping, sum, and average behavior, and SHALL provide aliases for stereo and quad float and double values.

#### Scenario: N-ary arithmetic is elementwise
- **WHEN** two same-sized n-ary numbers are added, subtracted, multiplied, or divided
- **THEN** each output lane is computed from the corresponding input lanes

#### Scenario: Scalar arithmetic applies to every lane
- **WHEN** an n-ary number is multiplied or divided by a scalar
- **THEN** every lane is multiplied or divided by that scalar

#### Scenario: Stereo and quad aliases exist
- **WHEN** code requests stereo float, stereo double, quad float, or quad double aliases
- **THEN** the aliases resolve to n-ary number types with sizes two or four and the requested numeric precision

### Requirement: sdsp-6 — Filters and tanh: one-pole DSP utilities
WHEN basic filter and saturation DSP is implemented, THE synth DSP system SHALL provide one-pole low-pass and high-pass filters with normalized-frequency alpha helpers and static transfer-function helpers, and SHALL provide a tanh saturator using the Smart Grid cubic rational approximation clamped to `[-1, 1]`.

#### Scenario: Low-pass converges toward input
- **WHEN** a one-pole low-pass filter processes repeated constant input with a valid cutoff
- **THEN** its output monotonically approaches that input within numeric tolerance

#### Scenario: High-pass rejects constant input
- **WHEN** a one-pole high-pass filter processes repeated constant input with a valid cutoff
- **THEN** its output approaches zero within numeric tolerance

#### Scenario: Tanh approximation clamps
- **WHEN** the tanh saturator processes large positive or negative inputs
- **THEN** its output remains in `[-1, 1]`

#### Scenario: Tanh approximation matches cubic rational form
- **WHEN** the tanh saturator processes an unclipped input `x`
- **THEN** the raw approximation is computed as `x * (27 + x * x) / (27 + 9 * x * x)` before clamping or optional normalization

### Requirement: sdsp-7 — Scope: flat channel writer and reader
WHEN waveform scope capture is needed, THE synth DSP system SHALL provide scope writer, holder, reader, and reader factory utilities using a flat channel namespace where owners reserve contiguous channel blocks through `ReserveChans(numChans)` during initialization and later write by relative channel index.

#### Scenario: Channel blocks reserve contiguously
- **WHEN** a scope writer receives reservations for two channels and then three channels
- **THEN** the first holder owns a block of two flat channels
- **AND** the second holder owns the next block of three flat channels

#### Scenario: Holder writes relative channel
- **WHEN** a holder with base channel `B` writes relative channel `1`
- **THEN** the scope writer stores the sample in flat channel `B + 1`

#### Scenario: Publish exposes stable read index
- **WHEN** the scope writer advances and publishes after sample writes
- **THEN** scope readers created after publish read from the published index rather than unpublished future writes

#### Scenario: Top markers drive reader alignment
- **WHEN** a holder records start and end markers for a channel
- **THEN** a scope reader can align the drawn cycle from the most recent marker history

### Requirement: sdsp-8 — Wavetables: basic, adaptive, and morphing tables
WHEN wavetable DSP is needed, THE synth DSP system SHALL provide basic wavetable storage, FFT-derived adaptive mipmapped wavetable levels, and a morphing wavetable that evaluates across a list of adaptive wavetables by position in `[0, 1]`.

#### Scenario: Basic wavetable evaluates wrapped phase
- **WHEN** a basic wavetable evaluates phases outside `[0, 1)`
- **THEN** evaluation wraps into the table and interpolates adjacent samples

#### Scenario: Adaptive wavetable selects level from frequency
- **WHEN** an adaptive wavetable evaluates a phase at a given oscillator frequency and maximum frequency
- **THEN** it selects or interpolates mip levels based on the maximum usable harmonic count

#### Scenario: Morph position selects endpoints
- **WHEN** morph position is `0`
- **THEN** the morphing wavetable evaluates the first contained adaptive wavetable
- **WHEN** morph position is `1`
- **THEN** it evaluates the last contained adaptive wavetable

#### Scenario: Morph position crossfades adjacent tables
- **WHEN** morph position falls between two adjacent contained adaptive wavetables
- **THEN** the output is the linear interpolation of those two wavetable evaluations

### Requirement: sdsp-9 — Default wavetables: sine, triangle, saw, square
WHEN default oscillator waveforms are requested, THE synth DSP system SHALL provide generated adaptive wavetables for sine, triangle, saw, and square waves using a default 12-bit table precision alias and SHALL provide a default morphing wavetable ordered through those waveforms.

#### Scenario: Default morph contains four waveforms
- **WHEN** the default morphing wavetable is constructed
- **THEN** it contains sine, triangle, saw, and square adaptive wavetables in that order

#### Scenario: Sine table starts at zero
- **WHEN** the default sine wavetable is evaluated at phase `0`
- **THEN** the output is near zero within wavetable interpolation tolerance

#### Scenario: Square table changes sign
- **WHEN** the default square wavetable is evaluated on opposite half-cycles at low frequency
- **THEN** the outputs have opposite signs

### Requirement: sdsp-10 — Incrementer: total phase and top crossing
WHEN oscillator phase accumulation is needed, THE synth DSP system SHALL provide an incrementer DSP class whose input contains frequency in cycles per sample, whose state stores total accumulated phase as a double, whose process step does not modulo that total phase, and whose `top` state is true when the previous increment crossed an integer boundary.

#### Scenario: Total phase is not modulo one
- **WHEN** an incrementer processes frequencies whose sum exceeds one cycle
- **THEN** its total phase remains greater than or equal to one rather than wrapping to `[0, 1)`

#### Scenario: Wrapped phase is derivable
- **WHEN** an incrementer has total phase `P`
- **THEN** its wrapped phase for wavetable lookup is equivalent to `P - floor(P)`

#### Scenario: Top is set on integer crossing
- **WHEN** an increment step moves total phase from below integer `N` to greater than or equal to integer `N`
- **THEN** the incrementer reports `top=true` for that process step

#### Scenario: No alias protection is applied
- **WHEN** the incrementer processes an arbitrary valid frequency input
- **THEN** it advances by that frequency without clamping or band-limiting for alias protection

### Requirement: sdsp-11 — VCO: wavetable oscillator with scope UI state
WHEN wavetable oscillator DSP is needed, THE synth DSP system SHALL provide a `WavetableVco` class that owns an incrementer, uses a morphing wavetable, processes inputs for frequency, phase offset, and wavetable position, writes optional scope samples and top markers through a nullable scope writer holder, and publishes UI state containing the scope channel, color, and scope pointer needed for waveform rendering.

#### Scenario: VCO evaluates wrapped phase plus offset
- **WHEN** the VCO processes an input with phase offset
- **THEN** it evaluates the morphing wavetable at the incrementer's wrapped phase plus the offset wrapped into `[0, 1)`

#### Scenario: VCO uses wavetable position
- **WHEN** the VCO processes two inputs with different wavetable positions and all other inputs equal
- **THEN** it uses the corresponding morphing wavetable positions for output evaluation

#### Scenario: VCO writes scope when configured
- **WHEN** the VCO has a non-null scope writer holder
- **AND** it processes a sample
- **THEN** it writes the output sample to the holder's assigned channel

#### Scenario: VCO records top marker
- **WHEN** the VCO incrementer reports top during processing
- **AND** a scope writer holder is configured
- **THEN** the VCO records a scope start marker for that sample

#### Scenario: VCO UI state contains render data
- **WHEN** the VCO populates UI state
- **THEN** the UI state identifies the VCO color, the scope writer or reader source, and the flat scope channel index needed to render that VCO waveform

### Requirement: sdsp-12 — JUCE waveform rendering
WHEN waveform scope UI is rendered, THE synth DSP system SHALL provide a JUCE path drawer, a `DrawWaveformFromScope` helper that draws a scope reader using a color, minimum y value, maximum y value, and optional indicator flag, and a VCO waveform component whose constructor accepts a list of VCO UI-state pointers and draws each connected VCO waveform.

#### Scenario: Draw helper maps y range
- **WHEN** `DrawWaveformFromScope` draws samples in the provided y range
- **THEN** the minimum y value maps to the bottom of the drawing bounds
- **AND** the maximum y value maps to the top of the drawing bounds

#### Scenario: Draw helper can draw indicator
- **WHEN** `DrawWaveformFromScope` is called with indicator drawing enabled
- **THEN** it draws a visible marker at the scope reader's transfer sample, which is the x-sample corresponding to the latest published point in the aligned cycle

#### Scenario: VCO waveform component draws multiple VCOs
- **WHEN** a VCO waveform component is constructed with two connected VCO UI-state pointers
- **THEN** its paint operation draws both waveforms in their configured colors

#### Scenario: VCO waveform component skips missing scope
- **WHEN** a VCO UI state has no connected scope reader source
- **THEN** the component skips that VCO without failing the paint operation

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

### Requirement: sdsp-17 — Scope: floating-point reader sampling
WHEN waveform scope samples are read through a scope reader, THE synth DSP system SHALL accept floating-point x-sample positions, SHALL preserve those positions until the final interpolated scope-writer read, and SHALL not expose an integer x-sample sampling API as the reader contract.

#### Scenario: Floating-point reader sample interpolates within aligned span
- **WHEN** a scope reader receives a floating-point x-sample coordinate between two reader x samples
- **THEN** it reads the corresponding fractional source index from the scope writer
- **AND** the returned value is interpolated between adjacent stored scope samples rather than equal to the lower integer x sample

#### Scenario: Integer conversion is deferred to buffer interpolation
- **WHEN** a scope reader maps a floating-point x-sample coordinate to the captured scope buffer
- **THEN** integer indexes are derived only for the adjacent source samples used by linear interpolation
- **AND** the fractional component is used to blend those adjacent samples

#### Scenario: Floating-point sampling respects cycle stitch
- **WHEN** a scope reader stitches the latest partial cycle to previous marker history
- **THEN** floating-point x-sample coordinates before and after the transfer boundary are mapped using the same cycle segments as the continuous reader coordinate system
- **AND** the transfer boundary calculation does not force earlier integer truncation of the source read index

#### Scenario: Transfer boundary remains floating point
- **WHEN** UI code asks a scope reader for the transfer x-sample position
- **THEN** the reader returns the floating-point transfer boundary used by sampling
- **AND** any rounding for marker drawing happens outside the reader sampling contract

### Requirement: sdsp-18 — JUCE waveform rendering: fractional scope reads
WHEN JUCE waveform rendering draws a scope path from a scope reader, THE synth DSP system SHALL pass each render point's floating-point scope x-sample coordinate to the scope reader and SHALL avoid casting that coordinate to an integer before sampling.

#### Scenario: Path drawer preserves floating-point render sample
- **WHEN** `PathDrawer::DrawScopePath` computes a render point whose scope x-sample coordinate is fractional
- **THEN** it samples the scope reader with that floating-point coordinate
- **AND** the resulting path y value reflects interpolated scope data rather than the nearest lower integer sample

### Requirement: sdsp-19 — Scope: fractional top markers
WHEN oscillator top crossings are recorded for waveform scope alignment, THE synth DSP system SHALL preserve the fractional writer position of the crossing rather than rounding the marker to a whole sample index.

#### Scenario: Incrementer reports top offset
- **WHEN** an incrementer advances from phase `0.75` by frequency `0.5`
- **THEN** it reports a top crossing
- **AND** the top crossing offset is `0.5` within the processed sample

#### Scenario: Scope writer stores fractional start marker
- **WHEN** a scope writer records a start marker with offset `0.25` at writer index `10`
- **THEN** readers created from that marker align to writer position `10.25`

#### Scenario: VCO records fractional top marker
- **WHEN** a VCO processes a sample whose incrementer crosses top halfway between the previous sample and current post-increment sample
- **THEN** its scope writer records the start marker at the previous writer index plus `0.5`

#### Scenario: Reader alignment uses fractional marker history
- **WHEN** a scope reader aligns a partial latest cycle to previous marker history
- **THEN** its transfer boundary and source reads are computed from fractional marker positions without converting markers to integer sample indexes

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

