## ADDED Requirements

### Requirement: spm-69 — Processing: rate-aware parameter-group timing
WHEN a parameter group is processed at a sample rate different from its reference rate, THE parameter modulation system SHALL provide pure helpers that convert a reference one-pole alpha `a` to `1 - pow(1 - a, referenceRate / processingRate)` and a positive reference sample interval to `max(1, round(referenceInterval * processingRate / referenceRate))`; and SHALL provide a pre-audio timing-reconfiguration API that updates only `processLiteAlpha`, `targetComputeIntervalSamples`, `uiDisplayCenterAlpha`, and `uiDisplaySpreadAlpha` for an existing group without changing its voice, modulator, scene, parameter-capacity, storage, routing, or value topology.

#### Scenario: Alpha conversion preserves wall-clock response
- **WHEN** a reference alpha is converted from 48 kHz to 192 kHz
- **THEN** four consecutive 192 kHz one-pole updates have the same cumulative response as one 48 kHz update within numeric tolerance

#### Scenario: Interval conversion preserves cadence
- **WHEN** reference interval `16` at 48 kHz is converted to 192 kHz
- **THEN** the returned interval is `64`
- **AND** conversion at non-integer ratios rounds to the nearest positive sample count

#### Scenario: Invalid rates and timing are rejected
- **WHEN** a conversion or timing reconfiguration receives a non-positive or non-finite rate, an alpha outside `[0,1]`, or a zero interval
- **THEN** it reports a coding/configuration error
- **AND** the group remains unchanged

#### Scenario: Reconfiguration preserves topology and values
- **WHEN** a group with registered parameters, scene values, modulation depths, and storage batches receives valid new timing
- **THEN** only its four processing-timing fields change
- **AND** all parameter IDs, pointers, values, routes, storage spans, group shape, and capacity remain unchanged

#### Scenario: Repeated prepare does not compound conversion
- **WHEN** an application prepares the same group at multiple processing rates
- **THEN** it can derive and install each timing configuration from fixed reference values
- **AND** the result does not depend on the previously installed processing rate

#### Scenario: Timing update is allocation-free
- **WHEN** valid timing is installed while audio is stopped
- **THEN** the operation performs no heap allocation and does not rebuild parameter storage
