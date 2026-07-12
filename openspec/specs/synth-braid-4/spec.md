# synth-braid-4 Specification

## Purpose
TBD - created by archiving change add-braid-4-synth-app. Update Purpose after archive.
## Requirements
### Requirement: d4-1 — Topology: three heterogeneous parameter groups and one bank slot
WHEN the Braid 4 application initializes, THE application SHALL create exactly one two-voice stereo parameter group, one four-voice oscillator parameter group, and one monophonic parameter group shared by audible Braid VCO controls, audible matrix controls, LFO Braid VCO controls, and LFO matrix controls; SHALL give every group exactly two scenes; SHALL initialize the manager-global scene endpoints to `0/1` with one shared blend value; SHALL give each group exactly two audio-rate modulators; and SHALL map four banks to one sixteen-encoder bank slot, with the audible Braid controls in the first bank, the audible 4x4 matrix controls in the second bank, the LFO Braid controls in the third bank, and the LFO 4x4 matrix controls in the fourth bank.

#### Scenario: One bank spans three Braid groups
- **WHEN** the Braid bank is selected
- **THEN** its visible mapped parameters include members of the stereo, four-voice, and monophonic Braid groups
- **AND** all mappings route through one bank slot with sixteen physical positions

#### Scenario: Matrices share the mono group and use their own banks
- **WHEN** either matrix bank is selected
- **THEN** all sixteen slot positions expose sixteen row-major matrix gain parameters from the same monophonic group that owns audible and LFO PM Index and Frequency parameters
- **AND** the parameter manager contains exactly three groups

#### Scenario: Group voice counts remain native
- **WHEN** the manager publishes slot UI state
- **THEN** X and Y report two voices, Tune/Phase/Shape/Gain report four voices, and PM Index/Frequency/matrix gains report one voice

#### Scenario: Scene selection and blend are global
- **WHEN** the user selects scene endpoints or moves the scene fader while any Braid bank is active
- **THEN** the manager applies the same endpoint pair and blend value to stereo, quad, and shared mono parameter evaluation
- **AND** switching banks does not switch to a different scene state

#### Scenario: Groups reserve modulation-depth capacity
- **WHEN** the user opens the modulation view for each four-voice Braid parameter
- **THEN** the quad group can materialize modulation-depth controls for both audible-matrix and LFO-matrix sources without exhausting parameter storage
- **AND** the stereo and mono groups can expose modulation depth for their audible-output and LFO-output sources without exhausting parameter storage

### Requirement: d4-2 — Controls: zero-based sixteen-position Braid layout
WHEN either Braid VCO bank is registered, THE application SHALL map zero-based positions `0=X`, `1=Y`, `4=Tune`, `5=Phase`, `6=Shape`, `7=Gain`, `8..11=PM Index 1..4`, and `12..15=Frequency 1..4`; SHALL leave positions `2` and `3` disconnected; SHALL assign full red to audible stereo XY controls; SHALL assign four red shades to audible oscillator controls; SHALL assign four green shades to LFO oscillator controls; SHALL assign orange diagonal and yellow off-diagonal colors to the audible matrix; and SHALL assign green diagonal and yellow LFO-matrix colors to the LFO matrix.

#### Scenario: Reserved cells are blank
- **WHEN** the Braid bank UI state is published
- **THEN** positions `2` and `3` are disconnected cells
- **AND** no dummy parameter is persisted for either position

#### Scenario: Quad controls use requested mappings
- **WHEN** Tune moves from normalized `0` through `0.5` to `1`
- **THEN** each voice maps exponentially from multiplier `0.5` through `1` to `2`
- **WHEN** Phase moves from signed bipolar `-1` through `0` to `1`
- **THEN** it maps linearly from `-1` through `0` to `1` cycles
- **WHEN** Shape moves from normalized `0` to `1`
- **THEN** it maps linearly across wavetable position `[0, 1]`
- **WHEN** Gain moves from signed bipolar `-1` through `0` to `1`
- **THEN** it maps linearly from ring gain `-1` through silence to gain `1`

#### Scenario: PM indices use quarter-center zero-based exponential mapping
- **WHEN** a PM Index parameter is at normalized `0`, `0.5`, or `1`
- **THEN** it maps respectively to `0`, `0.25`, or `1`

#### Scenario: Frequencies use oscillator-specific ranges
- **WHEN** Frequency 1, 2, 3, and 4 move across their normalized range
- **THEN** they map exponentially across `10..160` Hz, `50..800` Hz, `250..2000` Hz, and `1000..16000` Hz respectively

### Requirement: d4-3 — Signal graph: audible VCOs, matrix feedback source, and sample ordering
WHILE the Braid 4 application processes audio, THE application SHALL process all three parameter groups for each absolute internal sample index at four times the negotiated host rate, map and process the four audible Braid VCOs, feed their post-linear-gain pre-stereo-mix outputs into the audible 4x4 matrix, process the matrix, clamp and normalize the four raw matrix outputs into the existing parameter-modulation source range, publish those four normalized values to modulator index `0` of the four-voice group, advance the shared scope writer once per internal sample, and submit only the audible Braid stereo result to the final decimator.

#### Scenario: Matrix receives post-gain oscillator outputs
- **WHEN** a VCO produces sample `v` and its Gain voice maps to `g`
- **THEN** Braid stores `v * g` as that oscillator output
- **AND** the corresponding matrix input receives `v * g`

#### Scenario: Matrix outputs normalize before addressing quad voices
- **WHEN** the matrix produces outputs `m0`, `m1`, `m2`, and `m3`
- **THEN** the app first computes `0.5 + 0.5 * clamp(m, -1, 1)` for each output
- **AND** the next modulation-source update exposes those normalized values as modulator `0` for quad voices `0`, `1`, `2`, and `3` respectively
- **AND** modulator `1` of the quad group is reserved for the LFO matrix source defined by `d4-8`

#### Scenario: Modulation source anchors match the parameter system
- **WHEN** one raw matrix output is `-2`, `-1`, `0`, `1`, or `2`
- **THEN** the corresponding published modulation source value is respectively `0`, `0`, `0.5`, `1`, or `1`
- **AND** the raw matrix output remains available to matrix tests without normalization

#### Scenario: Existing one-sample modulation delay is explicit
- **WHEN** an oscillator sample changes a matrix output during sample `n`
- **THEN** parameter processing for sample `n` has already consumed the prior modulation value
- **AND** sample `n+1` is the first sample that consumes the new matrix value
- **AND** those sample numbers refer to the four-times-host internal clock

#### Scenario: Identity matrix preserves oscillator routing
- **WHEN** the matrix is at its defaults
- **THEN** each matrix output equals the correspondingly indexed post-gain oscillator input

#### Scenario: Normalized modulation depth remains calibrated
- **WHEN** a quad parameter has a matrix modulation depth assigned
- **THEN** the parameter-system target min/max and depth behavior are computed against a normalized `[0, 1]` source
- **AND** an out-of-range raw matrix sum clips only at the modulation-source adapter before parameter evaluation clamps to the parameter range

### Requirement: d4-4 — Stereo: per-channel equal-power XY oscillator fade
WHEN Braid computes stereo output, THE application SHALL treat oscillators 1 through 4 as the top-left, top-right, bottom-left, and bottom-right corners of a 2x2 plane and SHALL compute each channel independently from that channel voice's X and Y values using `a(x)a(y)o1 + b(x)a(y)o2 + a(x)b(y)o3 + b(x)b(y)o4`, where `a(t)=cos(pi*t/2)`, `b(t)=sin(pi*t/2)`, voice `0` is left, and voice `1` is right.

#### Scenario: XY corners isolate oscillators
- **WHEN** one output channel has `(x,y)` equal to `(0,0)`, `(1,0)`, `(0,1)`, or `(1,1)`
- **THEN** that channel equals oscillator 1, 2, 3, or 4 respectively

#### Scenario: Left and right positions are independent
- **WHEN** X/Y voice `0` selects oscillator 1 and X/Y voice `1` selects oscillator 4
- **THEN** the left output equals oscillator 1
- **AND** the right output equals oscillator 4

#### Scenario: Center uses equal-power corner weights
- **WHEN** a channel's X and Y both equal `0.5`
- **THEN** each of the four oscillator outputs contributes amplitude weight `0.5`
- **AND** the four squared weights sum to `1`

#### Scenario: One-axis motion preserves uncorrelated-source power
- **WHEN** one axis is held constant and the other moves from `0` to `1`
- **THEN** the squared weights along the moving axis sum to `1` at every position
- **AND** no signal-dependent correlation normalization or limiter is applied

### Requirement: d4-5 — Scopes: audible and LFO raw oscillator traces and UI state
WHILE Braid processes its audible and LFO VCOs, THE application SHALL connect one scope holder to each underlying wavetable VCO, SHALL capture the underlying pre-gain VCO sample for each oscillator, and SHALL publish four independent audible VCO UI-state entries plus four independent LFO UI-state entries that retain their scope writer, channel, color, and connection metadata.

#### Scenario: Eight holders use eight independent channels
- **WHEN** the app initializes its scope topology
- **THEN** it reserves eight channels and connects one holder per audible or LFO VCO
- **AND** every published audible or LFO UI-state entry names a different scope channel

#### Scenario: Scope advances at the internal rate
- **WHEN** one host frame is processed
- **THEN** each audible and LFO VCO scope receives four successive raw samples
- **AND** the scope writer advances four indices

#### Scenario: Scope remains pre-gain
- **WHEN** an oscillator Gain is zero or negative
- **THEN** the scope trace still represents the underlying VCO sample before that gain
- **AND** the matrix and stereo paths use the post-gain sample

### Requirement: d4-6 — Verification: headless audio, control, modulation, and persistence coverage
WHEN Braid 4 is added to the synth project, THE synth test suite SHALL run JUCE-free headless and portable-UI coverage for initialization, both bank layouts, parameter mappings, finite non-silent stereo processing, four-times-host processing at representative device rates, XY corner selection, matrix identity and cross-routing, matrix-source normalization anchors, the documented internal-sample modulation delay, decimator response/state, mono and extra-channel output policy, scope/UI publication, and patch save/load round trips across all three groups.

#### Scenario: Core runs without JUCE
- **WHEN** the Braid core and UI model are included by their synth test targets
- **THEN** they compile and run without JUCE include paths

#### Scenario: Patch round trip covers heterogeneous groups
- **WHEN** a test changes stereo, quad, oscillator-detail mono, and matrix parameters, saves a patch, perturbs them, and reloads the patch
- **THEN** every changed top-level value is restored to its saved state

#### Scenario: Representative host rates preserve time and pitch
- **WHEN** headless runs prepare Braid at 44.1, 48, and 96 kHz host rates
- **THEN** the internal rate is respectively 176.4, 192, and 384 kHz
- **AND** oscillator pitch, parameter time constants, one-internal-sample delay accounting, and four-to-one output frame counts remain correct within numeric tolerance

#### Scenario: Extreme routing remains finite
- **WHEN** every matrix gain and oscillator ring gain is driven to either endpoint for an extended headless run
- **THEN** both output channels remain finite

#### Scenario: Output channel counts are deterministic
- **WHEN** the actual audio block exposes one output channel
- **THEN** Braid writes `0.5 * (left + right)` to channel `0`
- **WHEN** the actual audio block exposes more than two output channels
- **THEN** Braid writes left to channel `0`, right to channel `1`, and silence to every output channel above `1`

#### Scenario: Scope capacity is explicit
- **WHEN** Braid initializes its scope writer
- **THEN** the writer capacity is `6'553'600` internal frames for each of the eight channels
- **AND** at a 48 kHz host rate the capture duration is approximately `34.13` seconds

### Requirement: d4-7 — Audio clock: four-times-host processing and final FIR decimation
WHEN Braid prepares and processes audio at a negotiated positive host rate `R`, THE application SHALL configure its internal rate as exactly `4R`; SHALL execute parameter `ProcessSample`, VCO processing, matrix processing, normalized modulation-source publication, and scope advancement four times for every host output frame; SHALL derive internal sample index `4 * (block.startSample + hostFrameIx) + subframeIx`; and SHALL send only the final stereo XY stream through a persistent allocation-free 4:1 FIR decimator before writing one host-rate output frame using the app's declared channel policy.

#### Scenario: Preferred host rate yields 192 kHz internal processing
- **WHEN** the host negotiates the preferred rate of 48 kHz
- **THEN** Braid runs its parameter and DSP graph at exactly 192 kHz
- **AND** emits exactly one 48 kHz stereo frame after each four internal frames

#### Scenario: Negotiated rate scales the whole graph
- **WHEN** the host negotiates a positive rate other than 48 kHz
- **THEN** Braid sets every VCO's sample rate, parameter timing configuration, modulation-delay clock, scope clock, and FIR interpretation from `4R`
- **AND** still emits exactly one host frame per four internal frames without rational-rate accumulation

#### Scenario: Parameter timing is rate-correct
- **WHEN** the internal rate is `I = 4R`
- **THEN** each 48-kHz-reference one-pole alpha `a48` is converted to `1 - pow(1 - a48, 48000 / I)`
- **AND** the target compute interval is `max(1, round(16 * I / 48000))`
- **AND** current knob/modulator sampling still runs on every internal sample

#### Scenario: One-sample delay uses internal time
- **WHEN** the host rate is `R`
- **THEN** matrix feedback reaches parameter evaluation after exactly one internal sample
- **AND** the delay duration is `1 / (4R)` seconds

#### Scenario: Final filter is explicit
- **WHEN** Braid configures its stereo 4:1 decimator
- **THEN** it uses a 287-tap symmetric linear-phase Kaiser-windowed-sinc FIR with `β=9`, unity DC gain, ideal cutoff `11/24 * R`, passband edge `5/12 * R`, stopband edge `1/2 * R`, no more than 0.1 dB passband ripple, and at least 90 dB measured stopband rejection
- **AND** at `R=48 kHz` those three edges are 22 kHz, 20 kHz, and 24 kHz respectively

#### Scenario: Decimator is last in the signal path
- **WHEN** one internal sample is processed
- **THEN** stereo XY mixing completes before either channel enters the FIR decimator
- **AND** no oscillator, matrix-modulator, parameter, or scope value is computed from a downsampled signal

#### Scenario: Decimator state crosses host block boundaries
- **WHEN** consecutive host blocks are processed
- **THEN** FIR history and decimation phase remain continuous across the boundary
- **AND** prepare/reset clears both channels deterministically before subsequent processing

#### Scenario: Dual-path release callback budget is measurable
- **WHEN** the release benchmark processes 256-frame host blocks at 44.1, 48, and 96 kHz host rates on the project baseline runner
- **THEN** the average callback CPU time is no more than 60% of the real-time block duration at each rate
- **AND** the p99 callback CPU time is no more than 80% of the real-time block duration at each rate
- **AND** the benchmark covers both the audible Braid4VCO path and the parallel LFO Braid4VCO path running at the four-times-host internal clock

### Requirement: d4-8 — Parallel modulation-only LFO Braid4VCO path
WHEN Braid 4 initializes, THE application SHALL create a second `Braid4VcoModule` instance for LFO-rate modulation; SHALL register it into the same stereo, quad, and mono groups as the audible VCO instance; SHALL map it to its own sixteen-position LFO bank with the same zero-based control layout; SHALL shift only its four Frequency parameter natural ranges down by exactly ten octaves; SHALL connect it to its own four scope holders and four green voice colors; SHALL process it every internal sample at the same four-times-host clock; SHALL not route its stereo output to the final audible output; and SHALL use its post-gain oscillator outputs as inputs to a second 4x4 LFO matrix bank.

#### Scenario: LFO layout mirrors Braid VCO layout
- **WHEN** the LFO bank is selected
- **THEN** positions `0=X`, `1=Y`, `4=Tune`, `5=Phase`, `6=Shape`, `7=Gain`, `8..11=PM Index 1..4`, and `12..15=Frequency 1..4` match the audible Braid bank layout
- **AND** positions `2` and `3` remain disconnected

#### Scenario: LFO frequencies are ten octaves lower
- **WHEN** LFO Frequency 1, 2, 3, and 4 move across their normalized range
- **THEN** they map exponentially across `10/1024..160/1024` Hz, `50/1024..800/1024` Hz, `250/1024..2000/1024` Hz, and `1000/1024..16000/1024` Hz respectively
- **AND** Tune still multiplies those shifted base frequencies by `0.5..2`

#### Scenario: Group modulator slots are assigned by signal family
- **WHEN** Braid publishes modulation sources for an internal sample
- **THEN** the stereo group exposes modulator `0` as the audible VCO left/right XY output and modulator `1` as the LFO left/right XY output
- **AND** the mono group exposes modulator `0` as the audible VCO left/right average and modulator `1` as the LFO left/right average
- **AND** the quad group exposes modulator `0` as the audible VCO matrix outputs and modulator `1` as the LFO matrix outputs

#### Scenario: All audio-rate modulators are normalized
- **WHEN** any audible output, LFO output, audible matrix output, or LFO matrix output is published as a parameter modulation source
- **THEN** the source value first maps through `0.5 + 0.5 * clamp(raw, -1, 1)`
- **AND** raw linear outputs remain available to tests and later DSP consumers without this normalization

#### Scenario: Four banks share one slot
- **WHEN** the parameter manager is initialized
- **THEN** one sixteen-encoder slot can select four banks in order: audible Braid VCO, audible matrix, LFO Braid4VCO, and LFO matrix
- **AND** each bank uses the same physical encoder positions `0..15`

#### Scenario: Audible output ignores the LFO path
- **WHEN** the LFO module and LFO matrix produce nonzero values
- **THEN** the final decimated audio output is still computed only from the audible Braid VCO module's left/right XY output
- **AND** the LFO path affects audio only through assigned modulation depths in the parameter system

