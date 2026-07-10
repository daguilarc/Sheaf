## ADDED Requirements

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
