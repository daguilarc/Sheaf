## ADDED Requirements

### Requirement: sdsp-42 — Timing: phasor-to-tick crossing processor
WHEN a continuous double-precision musical time must produce integer-grid events, THE synth DSP system SHALL provide a JUCE-free `Phasor2Tick` processor whose input is finite double `time` plus a positive integer `multiplier`, whose process step computes `current = floor(multiplier * time)`, whose boolean `tick` is true exactly when `current != previous`, and whose retained previous value becomes `current` after the step; the processor SHALL support priming at an arbitrary valid time without emitting a tick and SHALL perform no allocation, lock, throw, or modulo reduction in its realtime process step.

#### Scenario: Boundary crossing emits one tick
- **WHEN** multiplier is 24, previous is primed below integer grid value `N`, and time advances so `floor(24 * time)` becomes `N`
- **THEN** tick is true for that process step

#### Scenario: Time within one cell is quiet
- **WHEN** consecutive inputs have the same `floor(multiplier * time)` value
- **THEN** tick is false on the later process step

#### Scenario: Priming is silent
- **WHEN** the processor is primed at time `T` and immediately processes the same time and multiplier
- **THEN** tick is false

#### Scenario: Backward or jumped time is detectable
- **WHEN** a valid input changes the floored product by any nonzero amount, including a backward phase switch or a jump across multiple cells
- **THEN** tick is true once for that process call and the retained value becomes the new floored product

#### Scenario: Processor remains dependency-clean
- **WHEN** a JUCE-free DSP test includes and processes `Phasor2Tick`
- **THEN** it compiles without JUCE and the process path performs no dynamic allocation
