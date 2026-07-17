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

#### Scenario: Publish exposes a coherent sample and cycle-start boundary
- **WHEN** the scope writer records samples and cycle-start markers after its latest publish
- **THEN** readers continue to observe the previously published sample boundary and marker count
- **AND** a subsequent publish exposes the new sample boundary before exposing the pending marker-count advances
- **AND** a reader uses one published marker count for every marker lookup in that reader snapshot

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

### Requirement: sdsp-18 — Portable waveform rendering: fractional scope reads
WHEN portable waveform rendering draws a scope path from a scope reader, THE synth DSP system SHALL pass each render point's floating-point scope x-sample coordinate to the scope reader and SHALL avoid casting that coordinate to an integer before sampling.

#### Scenario: Portable waveform builder preserves floating-point render sample
- **WHEN** shared portable waveform drawing computes a render point whose scope x-sample coordinate is fractional
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

### Requirement: sdsp-23 — Filters: classic two-pole state-variable filter
WHEN classic multimode filtering is needed, THE synth DSP system SHALL provide a JUCE-free stateful two-pole state-variable filter processor that accepts runtime input value, cutoff in cycles per sample, resonance, and blend, computes low-pass, band-pass, and high-pass outputs, publishes the final output as `low * max(-blend, 0) + high * max(blend, 0) + band * sqrt(1 - blend * blend)` with blend clamped to `[-1, 1]`, and provides UI-state publication through a transfer-function-capable UI state representing the current blended response.

#### Scenario: Blend selects low pass at negative endpoint
- **WHEN** the processor input blend is `-1`
- **THEN** the processor's final output equals its low-pass output within numeric tolerance
- **AND** the high-pass and band-pass blend amounts are zero

#### Scenario: Blend selects high pass at positive endpoint
- **WHEN** the processor input blend is `1`
- **THEN** the processor's final output equals its high-pass output within numeric tolerance
- **AND** the low-pass and band-pass blend amounts are zero

#### Scenario: Blend selects band pass at center
- **WHEN** the processor input blend is `0`
- **THEN** the processor's final output equals its band-pass output within numeric tolerance
- **AND** the low-pass and high-pass blend amounts are zero

#### Scenario: Filter behaves as a two-pole low pass
- **WHEN** the processor repeatedly processes a constant positive input with a valid cutoff, finite resonance, and blend `-1`
- **THEN** its final output converges toward that input within numeric tolerance

#### Scenario: Filter rejects invalid output under high resonance
- **WHEN** the processor processes finite input with cutoff in the supported audio range and high finite resonance such as `5.5`
- **THEN** its low-pass, band-pass, high-pass, and final outputs remain finite

#### Scenario: UI state publishes filter response inputs
- **WHEN** the processor populates its UI state after processing
- **THEN** the UI state contains UI-safe snapshots of the current filter coefficient or cutoff, resonance or damping, and blend values
- **AND** the UI does not need to mutate processor state to inspect them

#### Scenario: UI state implements blended transfer function
- **WHEN** a caller asks the filter UI state for `FrequencyResponse` or `TransferFunctionValue` at a normalized frequency
- **THEN** the returned response represents the same low/band/high blend law used for audio output
- **AND** the response is finite for valid normalized frequencies

### Requirement: sdsp-24 — Pattern: Smart Grid DSP ports remain low-level and dependency-clean
WHEN Smart Grid-derived DSP code is ported into Sheaf, THE synth DSP system SHALL expose the ported behavior as JUCE-free low-level DSP classes under `projects/synth/include/synth` or `projects/synth/src`, SHALL use stateful processor instances with named `Input` structs using DSP units such as cycles per sample, normalized phase, alphas, gains, and ratios, and SHALL NOT require Smart Grid product dependencies including `TheoryOfTime`, `FrequencyDependentParameter`, `PhaseUtils::ExpParam`, Smart Grid encoder/module wrappers, movable write-head grain managers, `PartialMachine`, file IO, or JUCE UI classes.

#### Scenario: Ported headers are product-independent
- **WHEN** a JUCE-free synth test includes every new public DSP header added by this change
- **THEN** the test compiles without including `TheoryOfTime`, `PartialMachine`, Smart Grid encoder/module headers, JUCE headers, file-loading headers, or Smart Grid parameter-wrapper headers

#### Scenario: Inputs use DSP units
- **WHEN** a caller processes a ported filter, spectral, resynthesis, degradation, resampling, or meter processor
- **THEN** runtime values are supplied through the processor's `Input` struct in DSP units rather than through normalized UI parameters or `ExpParam` objects

#### Scenario: Sheaf parameter system owns smoothing
- **WHEN** ported processors receive already-smoothed input values from a caller
- **THEN** the processors process those values directly without adding an extra parameter-slew layer copied from Smart Grid input setters

### Requirement: sdsp-25 — Math and Fourier: templated FFT, windows, and partial writes
WHEN Fourier-domain DSP is needed by Smart Grid-derived processors, THE synth DSP system SHALL provide templated Fourier utilities that use `DspMath<Bits>` for roots of unity, trigonometry, polar conversion, Hann windows, and Hann partial kernels, SHALL preserve the existing forward-transform normalization where a unit-amplitude cosine at an exact bin produces magnitude `0.5`, and SHALL avoid hard-coded math aliases inside code templated on table precision.

#### Scenario: FFT normalization matches Smart Grid
- **WHEN** a unit-amplitude cosine exactly aligned to DFT bin `k` is transformed by `DiscreteFourierTransform<Bits>`
- **THEN** component `k` has magnitude `0.5` within numeric tolerance

#### Scenario: Inverse transform reconstructs a finite buffer
- **WHEN** a bounded set of DFT components is inverse-transformed into a wavetable buffer
- **THEN** every output sample is finite
- **AND** transforming the reconstructed buffer preserves the represented component magnitudes within tolerance

#### Scenario: Partial writes use matching math precision
- **WHEN** templated code writes a windowed partial for table precision `Bits`
- **THEN** the Hann kernel, sine, cosine, and polar math are taken from `DspMath<Bits>`
- **AND** the implementation does not call a hard-coded precision alias such as a 4096-sample math table

### Requirement: sdsp-26 — Filters: biquad, Butterworth, and Linkwitz-Riley processors
WHEN higher-order filtering or crossover DSP is needed, THE synth DSP system SHALL provide a reusable biquad section, an 8th-order Butterworth low-pass processor composed from four biquad sections, and a 4th-order Linkwitz-Riley crossover processor composed from low-pass and high-pass biquad cascades, with cutoff inputs expressed in cycles per sample, finite state reset behavior, and static transfer-function or frequency-response helpers suitable for UI inspection.

#### Scenario: Biquad reset clears history
- **WHEN** a biquad section processes nonzero input and is then reset
- **THEN** its delayed input and output history are cleared
- **AND** subsequent processing from silence produces silence within numeric tolerance

#### Scenario: Butterworth low-pass attenuates high frequencies
- **WHEN** the Butterworth processor is configured with a valid cutoff in cycles per sample
- **AND** it processes low-frequency and high-frequency test tones
- **THEN** the high-frequency tone above cutoff is attenuated more than the low-frequency tone below cutoff

#### Scenario: Linkwitz-Riley crossover splits and recombines bands
- **WHEN** the Linkwitz-Riley processor is configured with a valid crossover frequency
- **AND** it processes a finite input sample stream
- **THEN** it publishes finite low-pass and high-pass outputs
- **AND** its low-pass and high-pass frequency-response helpers are finite for valid normalized frequencies
- **AND** the complex sum of the low-pass and high-pass transfer functions has magnitude near one across representative valid normalized frequencies within numeric tolerance

### Requirement: sdsp-27 — Buffers and resampling: bounded storage, interpolation, and rate conversion
WHEN low-level DSP buffering or sample-rate conversion is needed, THE synth DSP system SHALL provide JUCE-free bounded buffer utilities for fractional sample reads, section extrema, rolling min/max history, and offline or streaming upsampling/downsampling, SHALL use anti-alias filtering when reducing sample rate, and SHALL NOT require WAV loading, directory banks, `SampleTimer`, or async IO.

#### Scenario: Fractional buffer read interpolates adjacent samples
- **WHEN** a buffer contains two adjacent samples `a` and `b`
- **AND** the caller reads halfway between them
- **THEN** the returned sample equals the midpoint between `a` and `b` within numeric tolerance

#### Scenario: Section extrema summarize waveform ranges
- **WHEN** a buffer computes section extrema across nonempty audio
- **THEN** each populated section stores a minimum that is less than or equal to its maximum
- **AND** extrema reflect only samples that fall within that section

#### Scenario: Downsampling applies anti-alias filtering
- **WHEN** audio is resampled from a higher source rate to a lower target rate
- **THEN** output content above the target Nyquist frequency is attenuated relative to the unfiltered source within numeric tolerance

#### Scenario: Matching rates copy samples
- **WHEN** source and target sample rates are equal within the configured tolerance
- **THEN** resampling writes the same sample values and frame count to the output buffer

### Requirement: sdsp-28 — Degradation and metering: bit crusher, sample-rate reducer, and meters
WHEN signal degradation or level monitoring is needed, THE synth DSP system SHALL provide a bit-crushing processor, a sample-rate reduction processor, mono and n-channel meter processors, and UI-readable meter snapshots where applicable, with finite outputs for finite inputs and no dependency on Smart Grid stereo or quad utility headers beyond Sheaf's n-ary number types; meter gain reduction SHALL represent the linear output/input ratio observed when using a meter-owned saturating process path.

#### Scenario: Bit crusher amount zero passes through
- **WHEN** the bit-crushing processor amount is zero
- **THEN** processing a finite input returns the input unchanged within numeric tolerance

#### Scenario: Bit crusher quantizes at positive amount
- **WHEN** the bit-crushing processor amount is greater than zero
- **THEN** processing finite input snaps the output to the configured quantization step
- **AND** the output remains finite

#### Scenario: Sample-rate reducer holds between update ticks
- **WHEN** the sample-rate reducer frequency is less than one cycle per sample
- **THEN** it updates its held output only when its internal phase crosses one
- **AND** it returns the held output between crossings

#### Scenario: Meter publishes smoothed RMS and peak
- **WHEN** a meter processes a finite signal stream
- **THEN** its RMS and peak values remain finite
- **AND** a UI-readable snapshot can report linear and dBFS values without mutating audio-thread state

#### Scenario: Meter saturation publishes gain reduction
- **WHEN** a meter processes a finite signal through its saturating process path
- **THEN** its gain-reduction value is the finite linear ratio between saturated output magnitude and input magnitude with a positive floor for near-zero values
- **AND** a UI-readable snapshot can report the gain reduction in linear and dB-normalized forms

### Requirement: sdsp-29 — Spectral model: atom tracking and residual envelope
WHEN spectral modeling DSP is needed, THE synth DSP system SHALL provide a templated spectral model processor that analyzes Hann-windowed input frames with the synth Fourier utilities, extracts local-maximum analysis atoms with phase and frequency in cycles per sample, tracks atoms through attack/decay/portamento alphas supplied by the caller, optionally computes synthetic harmonics from caller-supplied magnitudes, and maintains a residual envelope bucket for each DFT component after canceling modeled organic atoms from the analysis frame.

#### Scenario: Local maxima become analysis atoms
- **WHEN** a Hann-windowed frame contains a finite sinusoidal peak above the gain threshold
- **THEN** spectral analysis emits an atom whose analysis frequency is near the source frequency
- **AND** the atom stores finite magnitude and phase values

#### Scenario: Atom tracking respects caller alphas
- **WHEN** a tracked atom receives a matching analysis atom
- **THEN** its synthesis magnitude and synthesis frequency move toward the analysis values according to the caller-supplied attack/decay and portamento alphas

#### Scenario: Synthetic harmonics use caller magnitudes
- **WHEN** synthetic harmonic generation is enabled
- **AND** the caller supplies finite harmonic magnitudes
- **THEN** spectral analysis adds synthetic analysis atoms at harmonic frequencies derived from organic analysis atoms
- **AND** each synthetic atom's magnitude is scaled by the caller-supplied harmonic magnitude for that harmonic

#### Scenario: Residual excludes modeled organic atoms
- **WHEN** residual analysis is enabled after organic analysis atoms are extracted
- **THEN** those organic atoms are written back into the DFT at opposite phase before residual magnitudes are captured
- **AND** synthetic harmonics are not canceled from the residual because they are generated model content

#### Scenario: Residual buckets are queryable
- **WHEN** spectral analysis processes a frame
- **THEN** the residual model stores one finite envelope bucket per DFT component
- **AND** callers can query a residual envelope by bucket index

### Requirement: sdsp-30 — Resynthesizer: OLA phase-vocoder processor
WHEN phase-vocoder resynthesis is needed, THE synth DSP system SHALL provide an OLA-driven resynthesizer processor that uses Smart Grid's phase analysis and oscillator synthesis math with Sheaf Fourier and `DspMath<Bits>` utilities, accepts DSP-unit inputs for pitch shift, unison, gain, slew, and spectral distortion controls, writes synthesized DFT frames into OLA, and SHALL NOT require `Grain`, `GrainManager`, movable write-head scheduling, delay-line read heads, or `TheoryOfTime`.

#### Scenario: Hop synthesis writes through OLA
- **WHEN** the resynthesizer completes an analysis/synthesis hop
- **THEN** it writes the synthesized DFT frame into its OLA buffer
- **AND** subsequent per-sample processing reads the overlapped output from that OLA buffer

#### Scenario: Phase progression remains finite
- **WHEN** the resynthesizer processes finite previous and current analysis frames
- **THEN** instantaneous frequency, phase deltas, synthesis phases, and output samples remain finite

#### Scenario: Pitch shift uses DSP ratios
- **WHEN** a caller supplies a pitch-shift ratio or ratio set in the resynthesizer input
- **THEN** oscillator synthesis uses those ratios directly
- **AND** it does not require product-level switch parameters or just-intonation UI mapping objects

#### Scenario: Unison and gain remain DSP-unit inputs
- **WHEN** a caller supplies finite unison detune ratios and gain values in the resynthesizer input
- **THEN** oscillator synthesis applies those values directly to generated components
- **AND** every synthesized component and OLA output sample remains finite

#### Scenario: Slew controls spectral magnitude motion
- **WHEN** a caller supplies finite slew controls for spectral magnitudes
- **THEN** consecutive hop magnitudes move toward their targets according to those controls without requiring parameter-slew objects

#### Scenario: Spectral distortion remains bounded
- **WHEN** spectral distortion controls are enabled with finite input frames
- **THEN** the resynthesizer produces finite DFT components and finite OLA output samples

### Requirement: sdsp-31 — Resampling: allocation-free fixed-ratio FIR decimator
WHEN steady-state audio requires integer-factor downsampling, THE synth DSP system SHALL provide a JUCE-free fixed-ratio multichannel FIR decimator parameterized by positive compile-time factor, channel count, and tap count; SHALL own fixed-capacity history and decimation-phase state; SHALL accept one input frame at a time; SHALL report or return one output frame after every `Factor` input frames; SHALL preserve state across caller block boundaries; and SHALL perform no allocation, locking, coefficient design, logging, or IO in its processing path.

#### Scenario: Invalid template dimensions fail at compile time
- **WHEN** factor, channel count, or tap count is zero
- **THEN** template instantiation fails through a static assertion

#### Scenario: Four-to-one frame cadence is exact
- **WHEN** a factor-four decimator receives a continuous stream of input frames
- **THEN** it produces no more and no fewer than one output frame for every four input frames
- **AND** the cadence is unchanged when the stream is divided across arbitrary caller block boundaries

#### Scenario: Channels retain independent history
- **WHEN** a stereo decimator receives different left and right input impulses
- **THEN** each output channel reflects only its corresponding input history and the common coefficient set

#### Scenario: Reset is deterministic
- **WHEN** a decimator with nonzero history is reset
- **THEN** its history and phase match a newly constructed decimator
- **AND** processing the same subsequent input produces the same output sequence

#### Scenario: Symmetric coefficients preserve linear phase
- **WHEN** the configured odd-length FIR coefficients are symmetric
- **THEN** the impulse response has group delay `(Taps - 1) / 2` input samples within numeric tolerance

#### Scenario: Frequency response is testable
- **WHEN** tests measure representative passband and stopband tones through the decimator
- **THEN** measured ripple and rejection satisfy the coefficient set's declared bounds

#### Scenario: Audio processing is allocation-free
- **WHEN** the decimator processes after construction/configuration
- **THEN** it uses only its fixed coefficient/history/output state
- **AND** no heap allocation or buffer-sized copy occurs

### Requirement: sdsp-32 — Oversampling: reusable fixed-factor output stage
WHEN a generated synth graph needs to run at a fixed integer multiple of the host rate and downsample only its final multichannel output, THE synth DSP system SHALL provide a JUCE-free fixed-factor oversampled output-stage pattern that composes a decimator with a statically bound generator callable; SHALL invoke the generator exactly `Factor` times per host frame with absolute internal sample indices `Factor * hostSampleIndex + subframeIndex`; SHALL submit every generated internal frame to the decimator; and SHALL return exactly one host-rate frame without allocation, locking, runtime type erasure, logging, or IO in the processing path.

#### Scenario: Generator sees every internal phase
- **WHEN** a factor-four stage processes host sample index `H`
- **THEN** its generator is invoked in order for internal indices `4H`, `4H+1`, `4H+2`, and `4H+3`

#### Scenario: Only final generated stream is downsampled
- **WHEN** the generator performs an internal graph and returns one multichannel frame per invocation
- **THEN** the output stage observes only the returned frames
- **AND** internal graph state remains owned and sequenced by the generator's caller

#### Scenario: One host frame is returned
- **WHEN** one factor-four host-frame operation completes
- **THEN** the composed decimator has consumed four internal frames
- **AND** the stage returns exactly one multichannel output frame

#### Scenario: Clock and filter state cross blocks
- **WHEN** callers process consecutive host blocks through one output-stage instance
- **THEN** absolute internal indices remain derivable from host sample indices without drift
- **AND** decimator history remains continuous until reset

#### Scenario: Stage is reusable across graph types
- **WHEN** two applications provide different statically typed generator callables with the same factor/channel contract
- **THEN** both can use the same output-stage template without the DSP library depending on either application's modules or parameters

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

### Requirement: sdsp-34 — Random modulation: shaped interpolation and correlated increments
WHEN shaped random modulation timing is computed, THE synth DSP system SHALL provide a pure `ShapedInterpolate` helper that accepts double interpolation time, clamps shape and time to `[0,1]`, keeps the clamped time double until narrowing it at the float output-evaluation boundary, computes cosine-smoothed time with the float `DefaultDspMath::Cos2Pi` path, crossfades between linear and smoothed time by shape, and linearly interpolates float source to target; and SHALL provide a correlated-increment helper that samples one reflected normal center time in seconds, floors it at one sample period, takes its reciprocal as a center rate in hertz, samples reflected normal per-voice rates around that center using an internal sigma in hertz, and converts those rates to positive double cycles-per-sample increments.

#### Scenario: Shaped interpolation preserves endpoints
- **WHEN** `ShapedInterpolate` is evaluated at `t=0` or `t=1` with any finite source, target, and shape
- **THEN** it returns source or target respectively within numeric tolerance

#### Scenario: Shape selects linear and cosine-smoothed time
- **WHEN** shaped interpolation is evaluated with shape `0`
- **THEN** its interpolation fraction is `t`
- **WHEN** it is evaluated with shape `1`
- **THEN** its interpolation fraction is `0.5 - 0.5 * DefaultDspMath::Cos2Pi(0.5 * t)`

#### Scenario: Output shaping does not reduce timing precision
- **WHEN** `ShapedInterpolate` receives double progress from a voice
- **THEN** it clamps progress in double precision
- **AND** narrows progress only for the float cosine and output interpolation calculation
- **AND** does not narrow or modify the voice's stored double progress or its double state-transition comparisons

#### Scenario: Voice increments share a reciprocal center
- **WHEN** deterministic normal draws populate several increments for one `(muSeconds, sigmaSeconds, internalSigmaHz)` triple
- **THEN** exactly one shared center time is sampled from `N(muSeconds, sigmaSeconds)`
- **AND** its reciprocal is the shared center rate in hertz
- **AND** every voice rate is independently sampled from `N(sharedCenterRateHz, internalSigmaHz)` before conversion to cycles per sample

#### Scenario: Outer and internal sigmas retain different units
- **WHEN** `muSeconds` and `sigmaSeconds` are supplied in seconds and `internalSigmaHz` is supplied in hertz at a positive sample rate
- **THEN** the center rate equals `1 / max(samplePeriod, abs(sampledCenterSeconds))`
- **AND** `epsilonIncrement` equals `1 / (sampleRate * 3600)`
- **AND** each returned increment equals `max(epsilonIncrement, abs(N(centerRateHz, internalSigmaHz)) / sampleRate)`
- **AND** no per-voice time distribution is sampled between the center-time draw and the per-voice rate draw

#### Scenario: Near-zero rates have a finite operational bound
- **WHEN** a reflected per-voice normal rate draw is zero or arbitrarily close to zero
- **THEN** the epsilon floor limits that wait or move phase to at most `ceil(sampleRate * 3600)` process calls
- **AND** one voice's two-phase round is bounded to the sum of two such phases
- **AND** the normal-over-time, reciprocal-center, normal-over-rate relationship is unchanged for draws above the epsilon floor

#### Scenario: Invalid timing configuration fails loudly
- **WHEN** correlated increment generation receives a non-positive or non-finite sample rate, a non-finite time or rate parameter, or a negative time or rate sigma
- **THEN** it reports a programming/configuration error rather than producing a non-finite increment

### Requirement: sdsp-35 — Random modulation: deterministic ganged voice state machine
WHEN one voice of ganged random modulation is processed, THE synth DSP system SHALL provide a randomness-free `GangedRandomLfoVoice` whose default state is `Done`, whose state enum contains `Waiting`, `Moving`, and `Done`, whose progress and waiting/moving inputs are double precision, whose source, target, shape, and output are floats, and whose `Reset(newTarget)` changes state to `Waiting`, zeros progress, copies the previous target to source, and installs `newTarget` as target.

#### Scenario: Waiting holds the source
- **WHEN** a waiting voice processes a positive waiting increment without reaching progress one
- **THEN** it adds that increment to progress
- **AND** outputs source

#### Scenario: Waiting crossing starts movement
- **WHEN** a waiting increment raises progress to or above one
- **THEN** the voice changes to `Moving`
- **AND** zeros progress
- **AND** outputs source for that process call

#### Scenario: Moving uses shaped interpolation
- **WHEN** a moving voice processes a positive moving increment without reaching progress one
- **THEN** it adds that increment to progress
- **AND** outputs `ShapedInterpolate(source, target, shape, progress)`

#### Scenario: Moving crossing finishes exactly at target
- **WHEN** a moving increment raises progress to or above one
- **THEN** interpolation uses time clamped to one
- **AND** the voice changes to `Done`
- **AND** outputs target exactly

#### Scenario: Done holds the target
- **WHEN** a done voice is processed
- **THEN** it outputs target without changing source, target, or progress

### Requirement: sdsp-36 — Random modulation: ganged random LFO processor and snapshot
WHEN correlated polyphonic random modulation is needed, THE synth DSP system SHALL provide a fixed-voice-count `GangedRandomLfoProcessor` that owns matching arrays of `GangedRandomLfoVoice` processors and voice inputs, accepts waiting and moving `(muSeconds, sigmaSeconds, internalSigmaHz)` triples plus target internal sigma, processes every voice once per call, and only after every voice is done samples and resets the next round using shared normally distributed center times, reciprocal center rates, normally distributed per-voice increments, one uniform target center, per-voice clamped normal targets, and independent per-voice shapes uniformly sampled in `[0,1]`.

#### Scenario: Round parameters are correlated by hierarchy
- **WHEN** a new round is sampled for several voices
- **THEN** all waiting increments are normally distributed around the reciprocal of one sampled waiting center time
- **AND** all moving increments are normally distributed around the reciprocal of one sampled moving center time
- **AND** all targets share one target center uniformly sampled from `[0,1]`
- **AND** each voice receives its own increment deviation, target deviation, and shape
- **AND** every shape is independently sampled uniformly in `[0,1]`

#### Scenario: Round sampling has a canonical logical draw order
- **WHEN** a new round is sampled for `VoiceCount` voices
- **THEN** the logical draws occur in this order: waiting center time; waiting voice rates in ascending voice order; moving center time; moving voice rates in ascending voice order; target center; target deviations in ascending voice order; shapes in ascending voice order
- **AND** an injected deterministic draw source can observe and reproduce that order without depending on standard-library distribution engine-consumption details

#### Scenario: Targets remain unipolar
- **WHEN** a per-voice target draw around the shared target center falls outside `[0,1]`
- **THEN** the installed target is clamped to `[0,1]`
- **AND** every processor output remains in `[0,1]`

#### Scenario: Slowest voice gates the next round
- **WHEN** one voice reaches `Done` while another voice is still waiting or moving
- **THEN** the done voice holds its target
- **AND** no voice is reset
- **WHEN** the final active voice reaches `Done`
- **THEN** all voices are reset together after that process call's outputs are determined

#### Scenario: Heavy-tail timing is bounded at the slowest gate
- **WHEN** folded-normal voice-rate draws place one or more voice rates near zero
- **THEN** the slowest voice continues to gate round turnover
- **AND** each waiting or moving phase remains bounded by the one-hour epsilon policy
- **AND** increasing voice count can increase the chance of a long round but cannot create an unbounded round

#### Scenario: Default construction seeds through the ordinary boundary
- **WHEN** a default-constructed gang whose voices are all done is processed for the first time
- **THEN** it returns the current done outputs for that call
- **AND** samples and resets its first round for the following call

#### Scenario: Timing remains double precision and allocation-free
- **WHEN** a configured gang repeatedly processes samples and turns over rounds
- **THEN** progress, round elapsed samples, sampled center times, center rates, and increments remain double precision
- **AND** the processing path performs no heap allocation, locking, logging, or I/O

#### Scenario: Random sampling is reproducible in tests
- **WHEN** two gang processors receive the same explicit seed or deterministic random draw source and identical inputs
- **THEN** they produce matching round parameters and outputs within numeric tolerance

#### Scenario: UI snapshot reconstructs the live round
- **WHEN** the processor publishes UI state
- **THEN** one revision transaction publishes sample rate and gang round-elapsed samples plus every voice's state, progress, source, target, output, shape, waiting increment, moving increment, and assigned color
- **AND** it publishes no recorded waveform samples or prior-round history

#### Scenario: Snapshot readers reject torn rounds
- **WHEN** a UI reader observes an odd revision or a revision change while copying a gang snapshot
- **THEN** it retries up to a bounded limit
- **AND** does not treat fields from different rounds as one coherent snapshot

### Requirement: sdsp-37 — Noise: runtime-sized modulation processor
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
