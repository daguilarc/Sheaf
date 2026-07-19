## ADDED Requirements

### Requirement: sdsp-41 — Envelopes: ADSR processor
WHEN an ADSR envelope is needed, THE synth DSP system SHALL provide a JUCE-free
single-voice `AdsrProcessor` whose input contains finite nonnegative attack,
decay, and release progress increments, a sustain value in `[0, 1]`, and a
boolean gate; the processor SHALL own idle, attack, decay, sustain, and release
state, SHALL expose its output and state, and SHALL perform no allocation,
locking, or throwing on its per-sample processing path.

#### Scenario: Gate-on progresses attack and decay
- **WHEN** the gate rises while the processor is idle and the gate remains high
- **THEN** attack progresses from the current output to exactly `1`, decay
  progresses from `1` to sustain, and sustain publishes the current sustain
  input after decay completes

#### Scenario: Gate-off releases from the current output
- **WHEN** the gate falls during attack, decay, or sustain
- **THEN** release progresses from the output captured at that edge to exactly
  `0` and the processor becomes idle when release completes

#### Scenario: Retrigger preserves the current output
- **WHEN** the gate rises during decay or release
- **THEN** attack begins from the current output rather than resetting to zero

#### Scenario: Increments define stage completion
- **WHEN** an active stage receives increment `0`
- **THEN** its progress holds
- **WHEN** an active stage receives an increment greater than or equal to `1`
- **THEN** it reaches its target and transitions on that processing call
