## ADDED Requirements

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
