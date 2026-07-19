## Purpose

Define reusable JUCE-free synth module patterns that compose DSP processors with
parameter registration, bank mapping, input mapping, UI state, and modulation
source publication.
## Requirements
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

### Requirement: smod-6 — Miniapp: module-backed VCO patch
WHEN the synth miniapp demonstrates the module-backed VCO and LFO patch, THE miniapp SHALL instantiate `WavetableVcoModule<2>` and `BasicLfoModule<2>`, register their parameters through the modules, register their visible controls to the VCO and LFO page banks through the modules, process both modules each sample, update modulation values through the group/manager modulation-source update system, and keep app-level code focused on page selection, MIDI/control routing, scene/gesture controls, and rendering.

#### Scenario: Miniapp no longer hand-registers VCO parameters
- **WHEN** the miniapp initializes the VCO page
- **THEN** Tune, Phase, Shape, and Volume are registered by `WavetableVcoModule<2>` rather than by ad hoc miniapp parameter creation code

#### Scenario: Miniapp bank uses VCO module registration
- **WHEN** the miniapp initializes the VCO bank
- **THEN** the VCO bank receives Tune, Phase, Shape, and Volume from `WavetableVcoModule<2>`'s bank registration function

#### Scenario: Miniapp bank uses LFO module registration
- **WHEN** the miniapp initializes the LFO bank
- **THEN** the LFO bank receives Frequency, Shape, Phase Offset, Skew, and Exponent from `BasicLfoModule<2>`'s bank registration function

#### Scenario: Miniapp updates modulators every sample
- **WHEN** the miniapp processes an audio sample
- **THEN** it calls the parameter manager or group update-mod-values API so pointer-backed VCO and LFO modulation sources are current for that sample

#### Scenario: Miniapp remains simple
- **WHEN** the miniapp processing loop runs
- **THEN** app-level code delegates VCO input mapping and processing to `WavetableVcoModule<2>`
- **AND** delegates LFO input mapping and processing to `BasicLfoModule<2>`
- **AND** does not duplicate those modules' parameter mapping formulas

### Requirement: smod-5 — Wavetable VCO module
WHEN the wavetable VCO module is implemented, THE synth module system SHALL provide a `WavetableVcoModule<Polyphony>` module containing one default wavetable VCO processor per voice, registering Tune, Phase, Shape, and Volume parameters in that visible order, mapping Tune exponentially from 32 Hz to 3000 Hz, mapping Phase unipolar-linearly from `0` to `1` cycle of phase offset, mapping Shape linearly to wavetable position, mapping Volume unipolar-linearly from `0` to `1` gain, and publishing per-voice raw audio outputs, normalized direct/swapped modulation-source floats, and VCO waveform UI state.

#### Scenario: Wavetable VCO registers four parameters
- **WHEN** the wavetable VCO module registers parameters with prefix `Osc`
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
- **WHEN** `WavetableVcoModule<Polyphony>` processes its voices
- **THEN** every voice index from `0` through `Polyphony - 1` has a separate output available
- **AND** no mixed-output API is required for this module version

#### Scenario: Modulation source floats are normalized
- **WHEN** voice outputs are raw bipolar samples
- **THEN** the module's direct modulation-source floats contain `(output + 1) * 0.5` for each corresponding voice, clamped to `[0, 1]`
- **AND** the module's swapped modulation-source floats contain values from the reversed voice order, clamped to `[0, 1]`

#### Scenario: UI state contains VCO traces for every voice
- **WHEN** the module populates UI state after processing
- **THEN** the UI state exposes the waveform render data for every internal VCO processor

#### Scenario: Miniapp uses two-voice VCO instance
- **WHEN** the miniapp initializes its VCO module
- **THEN** it instantiates `WavetableVcoModule<2>`
- **AND** it preserves the existing two-voice direct and swapped VCO modulation-source behavior

### Requirement: smod-7 — Basic LFO module
WHEN the basic LFO module is implemented, THE synth module system SHALL provide a `BasicLfoModule<Polyphony>` module containing one `BasicLFOProcessor` per voice, registering Frequency, Shape, Phase Offset, Skew, and Exponent parameters in that visible order, mapping Frequency exponentially from `0.1` Hz to `1000` Hz before converting to cycles per sample, mapping Shape and Skew unipolar-linearly from `0` to `1`, mapping Phase Offset unipolar-linearly from `0` to `1` and adding a deterministic per-voice phase stagger of `voiceIx / (2 * Polyphony)` cycles, mapping Exponent from signed bipolar `-1 -> 0.2`, `0 -> 1`, and `1 -> 5` through the centered bipolar exponential helper, and publishing per-voice unipolar output values and LFO waveform UI state.

#### Scenario: Basic LFO registers five parameters
- **WHEN** the basic LFO module registers parameters with prefix `LFO`
- **THEN** the manager contains effective parameters for `LFO Frequency`, `LFO Shape`, `LFO Phase Offset`, `LFO Skew`, and `LFO Exponent`
- **AND** the module stores all five parameter IDs

#### Scenario: Frequency maps to LFO cycles per sample
- **WHEN** the Frequency parameter is at normalized `0`
- **THEN** the module maps it to `0.1` Hz before converting to cycles per sample
- **WHEN** the Frequency parameter is at normalized `1`
- **THEN** the module maps it to `1000` Hz before converting to cycles per sample

#### Scenario: Shape maps to shape processor input
- **WHEN** the Shape parameter changes
- **THEN** the module updates each LFO processor input's shape value from that parameter

#### Scenario: Phase offset maps to cycle offset
- **WHEN** the Phase Offset parameter is at normalized `0`
- **THEN** the module maps it to `0` cycles of phase offset
- **WHEN** the Phase Offset parameter is at normalized `1`
- **THEN** the module maps it to `1` cycle of phase offset

#### Scenario: Per-voice phase stagger preserves two-voice separation
- **WHEN** `BasicLfoModule<2>` maps inputs for voice `0` and voice `1`
- **THEN** voice `0` receives the mapped Phase Offset parameter plus `0` cycles
- **AND** voice `1` receives the mapped Phase Offset parameter plus `0.25` cycles

#### Scenario: Skew maps to phase distortion input
- **WHEN** the Skew parameter is at normalized `0.5`
- **THEN** the module maps it to the phase-distortion identity breakpoint
- **WHEN** the Skew parameter changes
- **THEN** the module updates each LFO processor input's phase-distortion skew value from that parameter

#### Scenario: Exponent maps geometrically around one
- **WHEN** the Exponent parameter is at signed bipolar `-1`
- **THEN** the module maps it to `0.2`
- **WHEN** the Exponent parameter is at signed bipolar `0`
- **THEN** the module maps it to `1`
- **WHEN** the Exponent parameter is at signed bipolar `1`
- **THEN** the module maps it to `5`

#### Scenario: Outputs are per voice
- **WHEN** `BasicLfoModule<Polyphony>` processes its voices
- **THEN** every voice index from `0` through `Polyphony - 1` has a separate unipolar `[0, 1]` output available
- **AND** no mixed-output API is required for this module version

#### Scenario: Modulation source floats are address-stable
- **WHEN** the module registers its LFO modulation source with a parameter group
- **THEN** the group stores pointers to the module's per-voice output source floats
- **AND** manager or group modulation updates copy those floats into the flat modulator values

#### Scenario: LFO modulation source label is shape-neutral
- **WHEN** the module registers its LFO modulation source with a parameter group
- **THEN** the source metadata name does not describe the source as sine-only
- **AND** the source remains identifiable as an LFO modulation source

#### Scenario: UI state contains LFO traces
- **WHEN** the module populates UI state after processing
- **THEN** the UI state exposes the waveform render data for each internal LFO processor

#### Scenario: Module lifecycle follows reusable pattern
- **WHEN** the basic LFO module is registered, bank-mapped, given input, processed, and asked for UI state
- **THEN** it follows the same registration-once, stored-parameter-ID, bank-capacity validation, natural-input mapping, arbitrary-polyphony array sizing, and UI-state publication pattern as `WavetableVcoModule<Polyphony>`

#### Scenario: Miniapp uses two-voice LFO instance
- **WHEN** the miniapp initializes its LFO module
- **THEN** it instantiates `BasicLfoModule<2>`
- **AND** it registers that module's per-voice output floats as the miniapp's third modulator

### Requirement: smod-8 — Classic SVF module
WHEN two-pole filter behavior is needed in a reusable synth module, THE synth module system SHALL provide a `ClassicSvfModule<Polyphony>` module containing one classic state-variable filter processor per voice, registering Cutoff, Resonance, and Blend parameters in that visible order, registering Blend as a bipolar-range parameter, mapping Cutoff exponentially from `20` Hz to `20000` Hz before converting to cycles per sample, mapping Resonance exponentially from `0.5` to `5.5`, mapping Blend as a bipolar linear value from `-1` to `1`, accepting a live audio input sample per voice through an explicit voice-input API separate from parameter mapping, and publishing per-voice filtered outputs plus filter UI state for every internal processor.

#### Scenario: Classic SVF registers three parameters
- **WHEN** the classic SVF module registers parameters with prefix `Filter`
- **THEN** the manager contains effective parameters for `Filter Cutoff`, `Filter Resonance`, and `Filter Blend`
- **AND** the module stores all three parameter IDs

#### Scenario: Cutoff maps to normalized filter frequency
- **WHEN** the Cutoff parameter is at normalized `0`
- **THEN** the module maps it to `20` Hz before converting to cycles per sample
- **WHEN** the Cutoff parameter is at normalized `1`
- **THEN** the module maps it to `20000` Hz before converting to cycles per sample

#### Scenario: Resonance maps exponentially
- **WHEN** the Resonance parameter is at normalized `0`
- **THEN** the module maps it to `0.5`
- **WHEN** the Resonance parameter is at normalized `1`
- **THEN** the module maps it to `5.5`

#### Scenario: Blend maps to bipolar filter mode control
- **WHEN** the Blend parameter is at bipolar value `-1`
- **THEN** the module maps it to `-1`
- **AND** the Blend parameter is registered with bipolar range metadata
- **WHEN** the Blend parameter is at bipolar value `0`
- **THEN** the module maps it to `0`
- **WHEN** the Blend parameter is at bipolar value `1`
- **THEN** the module maps it to `1`

#### Scenario: Voice input API supplies live audio samples
- **WHEN** a caller provides sample `A` to voice `0` and sample `B` to voice `1` through `SetVoiceInput` or an equivalent explicit voice-input API
- **THEN** the module writes those samples into the corresponding filter processor inputs
- **AND** `SetInput(ParameterManager&)` remains responsible for parameter-derived cutoff, resonance, and blend values rather than live audio samples

#### Scenario: Module processes each voice independently
- **WHEN** `ClassicSvfModule<Polyphony>` processes its voices
- **THEN** every voice index from `0` through `Polyphony - 1` receives that voice's input sample
- **AND** every voice index has a separate filtered output available

#### Scenario: UI state contains filter responses for every voice
- **WHEN** the module populates UI state after processing
- **THEN** the UI state exposes transfer-function-capable filter UI state for every internal filter processor

#### Scenario: Module lifecycle follows reusable pattern
- **WHEN** the classic SVF module is registered, bank-mapped, given input, and processed
- **THEN** it follows the same registration-once, stored-parameter-ID, bank-capacity validation, natural-input mapping, arbitrary-polyphony array sizing, and UI-state publication pattern as the existing VCO and LFO modules

### Requirement: smod-9 — Braid 4 wavetable VCO-bank module
WHEN four-oscillator wavetable synthesis is needed, THE synth module system SHALL provide a JUCE-free `Braid4VcoModule` containing four `DefaultWavetableVco` processors; SHALL reserve the sibling name `Braid4LfoModule` for a later LFO module; SHALL register its X/Y controls into a two-voice group, Tune/Phase/Shape/Gain controls into a four-voice group, and four PM Index plus four Frequency controls into a monophonic group; SHALL preserve the zero-based bank order and mappings defined by `d4-2`; and SHALL expose four post-gain oscillator outputs, two stereo outputs, one scope-holder connection per processor, and four VCO UI-state entries.

#### Scenario: Registration validates three owned groups
- **WHEN** Braid registers its parameters
- **THEN** all three supplied groups are owned by the same parameter manager and have voice counts `2`, `4`, and `1` respectively
- **AND** all three groups have exactly two scenes
- **AND** repeated registration or incompatible group shapes raise a coding error without partial registration

#### Scenario: Bank mapping preserves reserved cells
- **WHEN** Braid registers to an associated sixteen-position bank
- **THEN** it maps its fourteen parameters to positions `0`, `1`, and `4..15`
- **AND** positions `2` and `3` remain unmapped

#### Scenario: Frequency becomes cycles per sample
- **WHEN** oscillator `i` has base frequency `f` Hz, Tune multiplier `t`, and sample rate `r`
- **THEN** its underlying VCO frequency input is `(f * t) / r` cycles per sample

#### Scenario: Braid supplies four-times-host sample rate
- **WHEN** the Braid application prepares this module for host rate `R`
- **THEN** the module sample rate is `4R`

#### Scenario: PM index scales cycle offset
- **WHEN** oscillator `i` has Phase voice value `p` cycles and PM Index `m`
- **THEN** its underlying VCO phase-offset input is `p * m` cycles

#### Scenario: Gain is post-processor and bipolar
- **WHEN** an underlying VCO returns sample `v` and Gain maps to `g` in `[-1,1]`
- **THEN** Braid's oscillator output is `v * g`
- **AND** negative gain performs ring inversion without changing the VCO's raw scope sample

#### Scenario: Stereo outputs use native two-voice controls
- **WHEN** Braid processes a sample
- **THEN** its left and right outputs use voices `0` and `1` of X/Y through the separable equal-power formula in `d4-4`

### Requirement: smod-10 — Size-templated bipolar matrix-mixer module
WHEN reusable square matrix mixing is needed, THE synth module system SHALL provide a JUCE-free `BipolarMatrixMixerModule<Size>` for every positive compile-time `Size`; SHALL register `Size * Size` monophonic bipolar gain parameters in row-major order; SHALL map each gain through a zero-based bipolar exponential curve from `-1` to `1` whose half-travel magnitude is `0.25`; SHALL default diagonal gains to `1` and off-diagonal gains to `0`; and SHALL expose address-stable input and output arrays.

#### Scenario: Template rejects zero size
- **WHEN** a matrix mixer is instantiated with `Size == 0`
- **THEN** compilation fails through a static assertion

#### Scenario: Four-by-four registers row-major controls
- **WHEN** `BipolarMatrixMixerModule<4>` registers to a group and bank
- **THEN** it creates sixteen uniquely named parameters ordered row `0` columns `0..3`, then row `1`, row `2`, and row `3`
- **AND** those parameters occupy sixteen consecutive bank positions

#### Scenario: Matrix can share an existing compatible mono group
- **WHEN** a monophonic, two-scene, unmodulated group already contains Braid's eight PM Index and Frequency parameters
- **THEN** `BipolarMatrixMixerModule<4>` can register its sixteen gains into the remaining capacity of that same group
- **AND** no separate matrix parameter group is required

#### Scenario: Bipolar zero-based curve has requested anchors
- **WHEN** a matrix gain knob is `-1`, `-0.5`, `0`, `0.5`, or `1`
- **THEN** the mapped gain is `-1`, `-0.25`, `0`, `0.25`, or `1` respectively

#### Scenario: Identity is the default
- **WHEN** a new matrix mixer processes input vector `x` without parameter edits
- **THEN** every output element equals the correspondingly indexed input element

#### Scenario: Processing is linear and unclamped
- **WHEN** a matrix has mapped gains `g[row][column]` and input values `x[column]`
- **THEN** each output is the sum of `g[row][column] * x[column]` over every column
- **AND** the module applies no clipping, normalization, or hidden gain compensation

#### Scenario: Outputs can back pointer-based modulators
- **WHEN** a caller registers pointers to the output array as one parameter-group modulation source
- **THEN** those pointers remain valid for the matrix module's lifetime

### Requirement: smod-11 — Braid4VCO module styling and frequency-range options
WHEN an application reuses `Braid4VcoModule` for parallel oscillator banks, THE module SHALL allow the caller to provide registration-time parameter colors, per-oscillator voice colors, and a frequency octave shift without changing the bank layout, parameter names, equal-power XY computation, scope contract, or post-gain output semantics.

#### Scenario: Frequency octave shift preserves ratios
- **WHEN** a `Braid4VcoModule` is configured with frequency octave shift `-10`
- **THEN** each oscillator's base-frequency range is multiplied by `2^-10`
- **AND** Tune, PM Index, Phase, Shape, Gain, and XY mappings are unchanged

#### Scenario: Parameter colors are caller controlled
- **WHEN** a caller registers one `Braid4VcoModule` as audible VCOs and another as LFOs
- **THEN** the audible module can register stereo controls as full red and oscillator-related controls as four red shades
- **AND** the LFO module can register oscillator-related controls as four green shades
- **AND** the module still exposes one stable bank layout and one UI-state entry per oscillator

### Requirement: smod-12 — Reusable module semantic color roles
WHEN a reusable synth module registers colored parameters or publishes colored scopes, THE module SHALL expose role-specific configuration for parameter base colors, per-voice indicator colors, and scope-trace colors; SHALL NOT infer any of those colors from parameter-group topology; and SHALL use role-specific method names where setters remain public.

#### Scenario: Braid module separates base from indicators
- **WHEN** a `Braid4VcoModule` registers X/Y, quad, and mono oscillator controls
- **THEN** its options can assign one shared base family color and four oscillator indicator shades
- **AND** Tune/Phase/Shape/Gain use the shared base with all four indicator shades
- **AND** each PM/Frequency parameter uses its associated shade as base and indicator

#### Scenario: General modules accept parameter indicators
- **WHEN** MiniApp registers reusable wavetable VCO, classic filter, and basic LFO modules into one two-voice group
- **THEN** each module can apply the caller's two parameter indicator colors to every registered parameter
- **AND** no group palette is required

#### Scenario: Scope color is independently assigned
- **WHEN** a caller assigns an oscillator scope-trace color
- **THEN** it uses a `SetScopeColor` API
- **AND** changing that trace color does not mutate registered parameter or bank colors

#### Scenario: Matrix setter names parameter role
- **WHEN** a matrix caller assigns diagonal and off-diagonal parameter colors
- **THEN** it uses `SetParameterColors`
- **AND** the module exposes no unused generic color getter

### Requirement: smod-13 — ADSR envelope module
WHEN reusable envelope controls are needed, THE synth module system SHALL
provide a non-copyable, non-movable `AdsrModule<Polyphony>` for positive
polyphony, SHALL own one `AdsrProcessor` and output per voice, SHALL register
Attack, Decay, Sustain, and Release parameters in that order, SHALL map attack
exponentially from `1 ms` to `2 s`, decay and release exponentially from `1 ms`
to `5 s`, sustain linearly from `0` to `1`, and SHALL not itself register a
modulation source or integrate with an application, instrument, runtime, patch,
controller, or UI.

#### Scenario: Registration and bank order are stable
- **WHEN** an ADSR module registers with prefix `Env` and later registers to a
  bank
- **THEN** it owns parameters `Env Attack`, `Env Decay`, `Env Sustain`, and
  `Env Release` in ADSR order and exposes them in that order at the requested
  bank offset

#### Scenario: Parameter mapping uses natural units
- **WHEN** the module maps inputs at a configured sample rate
- **THEN** it converts mapped time seconds to each per-voice processor increment
  as `1 / (seconds * sampleRate)` and passes the linear sustain value and that
  voice's gate unchanged to the processor

#### Scenario: Voices process independently
- **WHEN** two module voices receive different gate values
- **THEN** each voice advances only its own ADSR state and exposes its own output

#### Scenario: Sample-rate change preserves envelope state
- **WHEN** a module's sample rate changes between input mappings
- **THEN** subsequent increments use the new sample rate without resetting any
  voice's ADSR state

#### Scenario: Module lifecycle errors fail without partial registration
- **WHEN** parameter capacity is insufficient, an effective parameter name is
  duplicated, registration is repeated, an unregistered module is used, or a
  different parameter manager is supplied
- **THEN** the module reports a coding error without creating a partial ADSR
  parameter set
