## ADDED Requirements

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
