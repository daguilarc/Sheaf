## ADDED Requirements

### Requirement: d4-10 — Modulation smoothing: oscillator-owned cached-value filters
WHILE Braid 4 processes an internal sample, THE application SHALL run parameter phase 1 before application-owned filtering and phase 2 afterward; SHALL own one independent one-pole state for every oscillator-owned top-level parameter voice other than X/Y, including every audible/LFO cutoff control and every audible/LFO matrix entry; SHALL compute exactly one alpha from each oscillator's pre-Mod-LPF phase-1 cutoff cache after ordinary parameter-state slew per internal sample and reuse it for every filter owned by that oscillator; SHALL replace each filtered normalized cache before phase 2 and before module or matrix input extraction; SHALL seed filter states from current caches on initialization and prepare/reset; and SHALL perform this work without allocation, virtual dispatch, runtime name lookup, or recursive modulation-depth traversal.

#### Scenario: Audible oscillator ownership is explicit
- **WHEN** audible oscillator index `i` is processed
- **THEN** it owns voice `i` of audible Tune, Phase, Shape, and Gain
- **AND** it owns monophonic audible Frequency `i`
- **AND** it owns and independently filters audible matrix gains `[i][0]` through `[i][3]`, where the first index is matrix output row
- **AND** each of those four monophonic entries uses audible oscillator `i`'s cutoff regardless of its input-column index

#### Scenario: LFO oscillator ownership mirrors audible ownership
- **WHEN** LFO oscillator index `i` is processed
- **THEN** it owns voice `i` of LFO Tune, Phase, Shape, and Gain
- **AND** it owns monophonic LFO Frequency `i`
- **AND** it owns and independently filters LFO matrix gains `[i][0]` through `[i][3]`
- **AND** each of those four monophonic entries uses LFO oscillator `i`'s cutoff regardless of its input-column index

#### Scenario: Each oscillator reuses one alpha across ten states
- **WHEN** an audible or LFO oscillator's pre-Mod-LPF phase-1 cutoff cache, after ordinary parameter-state slew, maps to cutoff `f` and the internal sample rate is `I`
- **THEN** Braid computes `alpha = OnePoleLowPass::AlphaFromNatFreq(f / I)` once for that oscillator on that internal sample
- **AND** reuses that alpha for exactly its four quad-control voices, one Cutoff control, one Frequency control, and four matrix-row gains
- **AND** every one of those ten values retains independent filter output state

#### Scenario: Cutoff range and default cover clamped to open modulation
- **WHEN** an audible or LFO Mod LPF Cutoff control is at normalized `0` or `1`
- **THEN** it maps exponentially to `0.1 Hz` or `20000 Hz` respectively
- **AND** its default normalized value is `0`
- **AND** the LFO oscillator-frequency octave shift does not alter this cutoff range

#### Scenario: Cutoff values are coefficient sources and filter targets
- **WHEN** Braid runs its cache-filtering stage
- **THEN** X and Y caches pass from phase 1 to phase 2 unchanged
- **AND** each Mod LPF Cutoff's pre-Mod-LPF phase-1 cache determines its oscillator's alpha
- **AND** that same alpha filters and replaces the Mod LPF Cutoff cache before phase 2

#### Scenario: Every matrix entry is filtered by output ownership
- **WHEN** audible or LFO matrix gain `[row][column]` has phase-1 cached value `x`
- **THEN** its own one-pole state filters `x` with oscillator `row`'s alpha
- **AND** Braid replaces that matrix entry's cache with the filtered result before matrix input extraction
- **AND** changing `column` does not change which oscillator supplies the cutoff

#### Scenario: Nested modulation depths remain outside application filtering
- **WHEN** any filtered top-level parameter has one or more materialized modulation-depth parameters
- **THEN** phase 1 incorporates their recursively computed depth state into the top-level cached value
- **AND** Braid filters only that top-level cache
- **AND** it neither traverses nor replaces any nested modulation-depth cache

#### Scenario: DSP and UI consume the same filtered value
- **WHEN** phase 1 produces normalized value `x` and the associated one-pole produces `y`
- **THEN** Braid replaces the cached knob with `y` before phase 2
- **AND** mapping helpers and module/matrix input extraction consume `y`
- **AND** UI center/spread smoothing consumes `y` without observing `x`

#### Scenario: Filter reset does not synthesize a zero ramp
- **WHEN** Braid initializes or prepares after parameters have current cached values
- **THEN** every owned filter state is reset to its associated current cache
- **AND** the first filtered sample begins from that value rather than zero

#### Scenario: Matrix feedback timing remains one internal sample
- **WHEN** a matrix output is published during internal sample `n`
- **THEN** sample `n+1` phase 1 is the first parameter evaluation that can consume it
- **AND** filtering does not add another sample of source-publication delay

## MODIFIED Requirements

### Requirement: d4-1 — Topology: three heterogeneous parameter groups and one bank slot
WHEN the Braid 4 application initializes, THE application SHALL create exactly one two-voice stereo parameter group, one four-voice oscillator parameter group, and one monophonic parameter group shared by audible Braid VCO controls, audible matrix controls, LFO Braid VCO controls, and LFO matrix controls; SHALL give every group exactly two scenes and fifteen audio-rate modulators; SHALL initialize the manager-global scene endpoints to `0/1` with one shared blend value; SHALL retain independent `StandardModulators<2>`, `StandardModulators<4>`, and `StandardModulators<1>` instances for the respective groups; and SHALL map four banks to one sixteen-encoder bank slot, with the audible Braid controls in the first bank, the audible 4x4 matrix controls in the second bank, the LFO Braid controls in the third bank, and the LFO 4x4 matrix controls in the fourth bank.

#### Scenario: One bank spans three Braid groups
- **WHEN** the Braid bank is selected
- **THEN** its visible mapped parameters include members of the stereo, four-voice, and monophonic Braid groups
- **AND** all mappings route through one bank slot with sixteen physical positions

#### Scenario: Matrices share the mono group and use their own banks
- **WHEN** either matrix bank is selected
- **THEN** all sixteen slot positions expose sixteen row-major matrix gain parameters from the same monophonic group that owns audible and LFO Mod LPF Cutoff and Frequency parameters
- **AND** the parameter manager contains exactly three groups

#### Scenario: Group voice counts remain native
- **WHEN** the manager publishes slot UI state
- **THEN** X and Y report two voices, Tune/Phase/Shape/Gain report four voices, and Mod LPF Cutoff/Frequency/matrix gains report one voice
- **AND** every owning group reports exactly fifteen modulators

#### Scenario: Scene selection and blend are global
- **WHEN** the user selects scene endpoints or moves the scene fader while any Braid bank is active
- **THEN** the manager applies the same endpoint pair and blend value to stereo, quad, and shared mono parameter evaluation
- **AND** switching banks does not switch to a different scene state

#### Scenario: Groups reserve a complete modulation view
- **WHEN** the user opens a modulation view in any Braid group
- **THEN** every connected modulation-depth control can materialize in its fixed fifteen-position layout without exhausting that group's initial parameter storage
- **AND** disconnected positions remain empty and consume no parameter storage
- **AND** subsequently materialized controls can use the existing compatible storage-batch expansion path

#### Scenario: Standard bundles are independent
- **WHEN** Braid initializes its three standard bundles
- **THEN** every group owns distinct processor, output, pointer, random-state, and visualizer addresses
- **AND** no dynamic source state is shared across the stereo, quad, and mono groups

### Requirement: d4-2 — Controls: zero-based sixteen-position Braid layout
WHEN either Braid VCO bank is registered, THE application SHALL map zero-based positions `0=X`, `1=Y`, `4=Tune`, `5=Phase`, `6=Shape`, `7=Gain`, `8..11=Mod LPF Cutoff 1..4`, and `12..15=Frequency 1..4`; SHALL leave positions `2` and `3` disconnected; SHALL assign full red to audible stereo XY controls; SHALL assign four red shades to audible oscillator controls; SHALL assign four green shades to LFO oscillator controls; SHALL assign orange diagonal and yellow off-diagonal colors to the audible matrix; and SHALL assign green diagonal and yellow LFO-matrix colors to the LFO matrix.

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

#### Scenario: Modulation cutoffs use the shared exponential range
- **WHEN** any audible or LFO Mod LPF Cutoff parameter is at normalized `0` or `1`
- **THEN** it maps exponentially to `0.1 Hz` or `20000 Hz` respectively

#### Scenario: Frequencies use oscillator-specific ranges
- **WHEN** Frequency 1, 2, 3, and 4 move across their normalized range
- **THEN** they map exponentially across `10..160` Hz, `50..800` Hz, `250..2000` Hz, and `1000..16000` Hz respectively

### Requirement: d4-7 — Audio clock: four-times-host processing and final FIR decimation
WHEN Braid prepares and processes audio at a negotiated positive host rate `R`, THE application SHALL configure its internal rate as exactly `4R`; SHALL execute parameter phase 1, application cache filtering, parameter phase 2, VCO processing, matrix processing, normalized modulation-source publication, and scope advancement four times for every host output frame; SHALL derive internal sample index `4 * (block.startSample + hostFrameIx) + subframeIx`; and SHALL send only the final stereo XY stream through a persistent allocation-free 4:1 FIR decimator before writing one host-rate output frame using the app's declared channel policy.

#### Scenario: Preferred host rate yields 192 kHz internal processing
- **WHEN** the host negotiates the preferred rate of 48 kHz
- **THEN** Braid runs its parameter and DSP graph at exactly 192 kHz
- **AND** emits exactly one 48 kHz stereo frame after each four internal frames

#### Scenario: Negotiated rate scales the whole graph
- **WHEN** the host negotiates a positive rate other than 48 kHz
- **THEN** Braid sets every VCO's sample rate, parameter timing configuration, modulation-filter cutoff normalization, modulation-delay clock, scope clock, and FIR interpretation from `4R`
- **AND** still emits exactly one host frame per four internal frames without rational-rate accumulation

#### Scenario: Parameter timing is rate-correct
- **WHEN** the internal rate is `I = 4R`
- **THEN** each 48-kHz-reference parameter one-pole alpha `a48` is converted to `1 - pow(1 - a48, 48000 / I)`
- **AND** each Braid modulation-filter alpha is computed from its physical cutoff and `I`
- **AND** the target compute interval is `max(1, round(16 * I / 48000))`
- **AND** current knob/modulator sampling and cache filtering still run on every internal sample

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
- **AND** the benchmark covers both the audible Braid4VCO path and the parallel LFO Braid4VCO path, including all cache filters, running at the four-times-host internal clock

### Requirement: d4-8 — Parallel modulation-only LFO Braid4VCO path
WHEN Braid 4 initializes, THE application SHALL create a second `Braid4VcoModule` instance for LFO-rate modulation; SHALL register it into the same stereo, quad, and mono groups as the audible VCO instance; SHALL map it to its own sixteen-position LFO bank with the same zero-based control layout; SHALL shift only its four Frequency parameter natural ranges down by exactly ten octaves while retaining the same `0.1..20000 Hz` Mod LPF Cutoff range as the audible module; SHALL connect it to its own four scope holders and four green voice colors; SHALL process it every internal sample at the same four-times-host clock; SHALL not route its stereo output to the final audible output; SHALL use its post-gain oscillator outputs as inputs to a second 4x4 LFO matrix bank; and SHALL register each group's audible and parallel-LFO normalized sources at application-specific modulator indexes `4` and `5` after the four standard random sources.

#### Scenario: LFO layout mirrors Braid VCO layout
- **WHEN** the LFO bank is selected
- **THEN** positions `0=X`, `1=Y`, `4=Tune`, `5=Phase`, `6=Shape`, `7=Gain`, `8..11=Mod LPF Cutoff 1..4`, and `12..15=Frequency 1..4` match the audible Braid bank layout
- **AND** positions `2` and `3` remain disconnected

#### Scenario: LFO frequencies are ten octaves lower
- **WHEN** LFO Frequency 1, 2, 3, and 4 move across their normalized range
- **THEN** they map exponentially across `10/1024..160/1024` Hz, `50/1024..800/1024` Hz, `250/1024..2000/1024` Hz, and `1000/1024..16000/1024` Hz respectively
- **AND** Tune still multiplies those shifted base frequencies by `0.5..2`
- **AND** the four LFO Mod LPF Cutoff controls remain unshifted at `0.1..20000 Hz`

#### Scenario: Group modulator slots are assigned by signal family
- **WHEN** Braid publishes modulation sources for an internal sample
- **THEN** the stereo group exposes modulator `4` as the audible VCO left/right XY output and modulator `5` as the LFO left/right XY output
- **AND** the mono group exposes modulator `4` as the audible VCO left/right average and modulator `5` as the LFO left/right average
- **AND** the quad group exposes modulator `4` as the audible VCO matrix outputs and modulator `5` as the LFO matrix outputs

#### Scenario: Standard source slots coexist with Braid sources
- **WHEN** the three standard bundles register their defaults
- **THEN** every group exposes four standard random sources at `0..3` and standard noise at `14`
- **AND** the stereo and quad groups expose standard constant at `11`
- **AND** the monophonic group leaves `11` disconnected

#### Scenario: All application-specific audio-rate modulators are normalized
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
