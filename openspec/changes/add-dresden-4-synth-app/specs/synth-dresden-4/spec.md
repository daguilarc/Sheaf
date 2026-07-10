# synth-dresden-4 Specification

Project: `projects/synth`. ID prefix: `d4`.

## Purpose

Define the Dresden 4 synth application's parameter topology, oscillator and matrix signal graph, stereo output behavior, scope publication, and headless verification contract.

## ADDED Requirements

### Requirement: d4-1 — Topology: three heterogeneous parameter groups and one bank slot
WHEN the Dresden 4 application initializes, THE application SHALL create exactly one two-voice stereo parameter group, one four-voice oscillator parameter group, and one monophonic parameter group shared by the eight oscillator-detail parameters and sixteen matrix gains; SHALL give every group exactly two scenes; SHALL initialize the manager-global scene endpoints to `0/1` with one shared blend value; SHALL give only the four-voice group one modulator; and SHALL map two banks to one sixteen-encoder bank slot, with the Dresden controls in the first bank and the 4x4 matrix controls in the second bank.

#### Scenario: One bank spans three Dresden groups
- **WHEN** the Dresden bank is selected
- **THEN** its visible mapped parameters include members of the stereo, four-voice, and monophonic Dresden groups
- **AND** all mappings route through one bank slot with sixteen physical positions

#### Scenario: Matrix shares the mono group and uses its own bank
- **WHEN** the matrix bank is selected
- **THEN** all sixteen slot positions expose sixteen row-major matrix gain parameters from the same monophonic group that owns PM Index and Frequency
- **AND** the parameter manager contains exactly three groups

#### Scenario: Group voice counts remain native
- **WHEN** the manager publishes slot UI state
- **THEN** X and Y report two voices, Tune/Phase/Shape/Gain report four voices, and PM Index/Frequency/matrix gains report one voice

#### Scenario: Scene selection and blend are global
- **WHEN** the user selects scene endpoints or moves the scene fader while either bank is active
- **THEN** the manager applies the same endpoint pair and blend value to stereo, quad, and shared mono parameter evaluation
- **AND** switching banks does not switch to a different scene state

#### Scenario: Quad group reserves modulation-depth capacity
- **WHEN** the user opens the modulation view for each four-voice Dresden parameter
- **THEN** the group can materialize one matrix modulation-depth control for every Tune, Phase, Shape, and Gain parameter without exhausting parameter storage

### Requirement: d4-2 — Controls: zero-based sixteen-position Dresden layout
WHEN the Dresden bank is registered, THE application SHALL map zero-based positions `0=X`, `1=Y`, `4=Tune`, `5=Phase`, `6=Shape`, `7=Gain`, `8..11=PM Index 1..4`, and `12..15=Frequency 1..4`; SHALL leave positions `2` and `3` disconnected; and SHALL assign `Color::Red` to every registered Dresden and matrix parameter.

#### Scenario: Reserved cells are blank
- **WHEN** the Dresden bank UI state is published
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

### Requirement: d4-3 — Signal graph: four VCOs, matrix feedback source, and sample ordering
WHILE the Dresden 4 application processes audio, THE application SHALL process all three parameter groups for each absolute internal sample index at four times the negotiated host rate, map and process the four Dresden VCOs, feed their post-linear-gain pre-stereo-mix outputs into the 4x4 matrix, process the matrix, clamp and normalize the four raw matrix outputs into the existing parameter-modulation source range, publish those four normalized values to modulator index `0` of the four-voice group, advance its scope writer once per internal sample, and submit Dresden's stereo result to the final decimator.

#### Scenario: Matrix receives post-gain oscillator outputs
- **WHEN** a VCO produces sample `v` and its Gain voice maps to `g`
- **THEN** Dresden stores `v * g` as that oscillator output
- **AND** the corresponding matrix input receives `v * g`

#### Scenario: Matrix outputs normalize before addressing quad voices
- **WHEN** the matrix produces outputs `m0`, `m1`, `m2`, and `m3`
- **THEN** the app first computes `0.5 + 0.5 * clamp(m, -1, 1)` for each output
- **AND** the next modulation-source update exposes those normalized values as modulator `0` for quad voices `0`, `1`, `2`, and `3` respectively
- **AND** all other modulator slots are absent

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
WHEN Dresden computes stereo output, THE application SHALL treat oscillators 1 through 4 as the top-left, top-right, bottom-left, and bottom-right corners of a 2x2 plane and SHALL compute each channel independently from that channel voice's X and Y values using `a(x)a(y)o1 + b(x)a(y)o2 + a(x)b(y)o3 + b(x)b(y)o4`, where `a(t)=cos(pi*t/2)`, `b(t)=sin(pi*t/2)`, voice `0` is left, and voice `1` is right.

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

### Requirement: d4-5 — Scopes: four raw oscillator traces and UI state
WHILE Dresden processes its VCOs, THE application SHALL connect one scope holder to each underlying wavetable VCO, SHALL capture the underlying pre-gain VCO sample for each oscillator, and SHALL publish four independent VCO UI-state entries that retain their scope writer, channel, color, and connection metadata.

#### Scenario: Four holders use four independent channels
- **WHEN** the app initializes its scope topology
- **THEN** it reserves four channels and connects one holder per VCO
- **AND** every published VCO UI-state entry names a different scope channel

#### Scenario: Scope advances at the internal rate
- **WHEN** one host frame is processed
- **THEN** each VCO scope receives four successive raw samples
- **AND** the scope writer advances four indices

#### Scenario: Scope remains pre-gain
- **WHEN** an oscillator Gain is zero or negative
- **THEN** the scope trace still represents the underlying VCO sample before that gain
- **AND** the matrix and stereo paths use the post-gain sample

### Requirement: d4-6 — Verification: headless audio, control, modulation, and persistence coverage
WHEN Dresden 4 is added to the synth project, THE synth test suite SHALL run JUCE-free headless and portable-UI coverage for initialization, both bank layouts, parameter mappings, finite non-silent stereo processing, four-times-host processing at representative device rates, XY corner selection, matrix identity and cross-routing, matrix-source normalization anchors, the documented internal-sample modulation delay, decimator response/state, mono and extra-channel output policy, scope/UI publication, and patch save/load round trips across all three groups.

#### Scenario: Core runs without JUCE
- **WHEN** the Dresden core and UI model are included by their synth test targets
- **THEN** they compile and run without JUCE include paths

#### Scenario: Patch round trip covers heterogeneous groups
- **WHEN** a test changes stereo, quad, oscillator-detail mono, and matrix parameters, saves a patch, perturbs them, and reloads the patch
- **THEN** every changed top-level value is restored to its saved state

#### Scenario: Representative host rates preserve time and pitch
- **WHEN** headless runs prepare Dresden at 44.1, 48, and 96 kHz host rates
- **THEN** the internal rate is respectively 176.4, 192, and 384 kHz
- **AND** oscillator pitch, parameter time constants, one-internal-sample delay accounting, and four-to-one output frame counts remain correct within numeric tolerance

#### Scenario: Extreme routing remains finite
- **WHEN** every matrix gain and oscillator ring gain is driven to either endpoint for an extended headless run
- **THEN** both output channels remain finite

#### Scenario: Output channel counts are deterministic
- **WHEN** the actual audio block exposes one output channel
- **THEN** Dresden writes `0.5 * (left + right)` to channel `0`
- **WHEN** the actual audio block exposes more than two output channels
- **THEN** Dresden writes left to channel `0`, right to channel `1`, and silence to every output channel above `1`

#### Scenario: Scope capacity is explicit
- **WHEN** Dresden initializes its scope writer
- **THEN** the writer capacity is `6'553'600` internal frames for each of the four channels
- **AND** at a 48 kHz host rate the capture duration is approximately `34.13` seconds

### Requirement: d4-7 — Audio clock: four-times-host processing and final FIR decimation
WHEN Dresden prepares and processes audio at a negotiated positive host rate `R`, THE application SHALL configure its internal rate as exactly `4R`; SHALL execute parameter `ProcessSample`, VCO processing, matrix processing, normalized modulation-source publication, and scope advancement four times for every host output frame; SHALL derive internal sample index `4 * (block.startSample + hostFrameIx) + subframeIx`; and SHALL send only the final stereo XY stream through a persistent allocation-free 4:1 FIR decimator before writing one host-rate output frame using the app's declared channel policy.

#### Scenario: Preferred host rate yields 192 kHz internal processing
- **WHEN** the host negotiates the preferred rate of 48 kHz
- **THEN** Dresden runs its parameter and DSP graph at exactly 192 kHz
- **AND** emits exactly one 48 kHz stereo frame after each four internal frames

#### Scenario: Negotiated rate scales the whole graph
- **WHEN** the host negotiates a positive rate other than 48 kHz
- **THEN** Dresden sets every VCO's sample rate, parameter timing configuration, modulation-delay clock, scope clock, and FIR interpretation from `4R`
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
- **WHEN** Dresden configures its stereo 4:1 decimator
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

#### Scenario: Release callback budget is measurable
- **WHEN** the release benchmark processes 256-frame host blocks at 44.1, 48, and 96 kHz host rates on the project baseline runner
- **THEN** the average callback CPU time is no more than 25% of the real-time block duration at each rate
- **AND** the p99 callback CPU time is no more than 50% of the real-time block duration at each rate
