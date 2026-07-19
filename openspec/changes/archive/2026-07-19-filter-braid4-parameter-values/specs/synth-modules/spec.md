## MODIFIED Requirements

### Requirement: smod-9 — Braid 4 wavetable VCO-bank module
WHEN four-oscillator wavetable synthesis is needed, THE synth module system SHALL provide a JUCE-free `Braid4VcoModule` containing four `DefaultWavetableVco` processors; SHALL reserve the sibling name `Braid4LfoModule` for a later LFO module; SHALL register its X/Y controls into a two-voice group, Tune/Phase/Shape/Gain controls into a four-voice group, and four Mod LPF Cutoff plus four Frequency controls into a monophonic group; SHALL expose oscillator-indexed cutoff parameter IDs to application-owned cache filtering; SHALL preserve the zero-based bank order and mappings defined by `d4-2`; and SHALL expose four post-gain oscillator outputs, two stereo outputs, one scope-holder connection per processor, and four VCO UI-state entries.

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

#### Scenario: Phase reaches oscillator without a separate depth multiplier
- **WHEN** oscillator `i` has a filtered Phase voice value `p` cycles
- **THEN** its underlying VCO phase-offset input is `p` cycles
- **AND** the module applies no PM Index or other outside damping multiplier

#### Scenario: Cutoff IDs remain oscillator indexed
- **WHEN** an application requests the four Mod LPF Cutoff parameter IDs
- **THEN** array element `i` identifies the monophonic cutoff control belonging to oscillator `i`

#### Scenario: Gain is post-processor and bipolar
- **WHEN** an underlying VCO returns sample `v` and Gain maps to `g` in `[-1,1]`
- **THEN** Braid's oscillator output is `v * g`
- **AND** negative gain performs ring inversion without changing the VCO's raw scope sample

#### Scenario: Stereo outputs use native two-voice controls
- **WHEN** Braid processes a sample
- **THEN** its left and right outputs use voices `0` and `1` of X/Y through the separable equal-power formula in `d4-4`

### Requirement: smod-10 — Size-templated bipolar matrix-mixer module
WHEN reusable square matrix mixing is needed, THE synth module system SHALL provide a JUCE-free `BipolarMatrixMixerModule<Size>` for every positive compile-time `Size`; SHALL register `Size * Size` monophonic bipolar gain parameters in row-major order where row is output index and column is input index; SHALL map each gain through a zero-based bipolar exponential curve from `-1` to `1` whose half-travel magnitude is `0.25`; SHALL default diagonal gains to `1` and off-diagonal gains to `0`; and SHALL expose address-stable input and output arrays.

#### Scenario: Template rejects zero size
- **WHEN** a matrix mixer is instantiated with `Size == 0`
- **THEN** compilation fails through a static assertion

#### Scenario: Four-by-four registers row-major controls
- **WHEN** `BipolarMatrixMixerModule<4>` registers to a group and bank
- **THEN** it creates sixteen uniquely named parameters ordered output row `0` input columns `0..3`, then output rows `1`, `2`, and `3`
- **AND** those parameters occupy sixteen consecutive bank positions

#### Scenario: Matrix can share an existing compatible mono group
- **WHEN** a monophonic, two-scene group already contains Braid's eight Mod LPF Cutoff and Frequency parameters
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
WHEN an application reuses `Braid4VcoModule` for parallel oscillator banks, THE module SHALL allow the caller to provide registration-time parameter colors, per-oscillator voice colors, and an oscillator-frequency octave shift without changing the bank layout, parameter names, Mod LPF Cutoff range, equal-power XY computation, scope contract, or post-gain output semantics.

#### Scenario: Frequency octave shift preserves ratios but not cutoff shift
- **WHEN** a `Braid4VcoModule` is configured with oscillator-frequency octave shift `-10`
- **THEN** each oscillator's base-frequency range is multiplied by `2^-10`
- **AND** Mod LPF Cutoff remains exponentially mapped across `0.1..20000` Hz
- **AND** Tune, Phase, Shape, Gain, and XY mappings are unchanged

#### Scenario: Parameter colors are caller controlled
- **WHEN** a caller registers one `Braid4VcoModule` as audible VCOs and another as LFOs
- **THEN** the audible module can register stereo controls as full red and oscillator-related controls as four red shades
- **AND** the LFO module can register oscillator-related controls as four green shades
- **AND** the module still exposes one stable bank layout and one UI-state entry per oscillator
