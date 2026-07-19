## ADDED Requirements

### Requirement: smod-13 — ADSR envelope module
WHEN reusable envelope controls are needed, THE synth module system SHALL
provide a non-copyable, non-movable `AdsrModule<Polyphony>` for positive
polyphony, SHALL own one `AdsrProcessor` and output per voice, SHALL register
Attack, Decay, Sustain, and Release parameters in that order, SHALL map attack
exponentially from `1 ms` to `2 s`, decay and release exponentially from `1 ms`
to `5 s`, sustain linearly from `0` to `1`, and SHALL not itself register a
modulation source or integrate with an application, instrument, runtime, patch,
controller, or UI.

#### Scenario: Registration and bank order are stable
- **WHEN** an ADSR module registers with prefix `Env` and later registers to a
  bank
- **THEN** it owns parameters `Env Attack`, `Env Decay`, `Env Sustain`, and
  `Env Release` in ADSR order and exposes them in that order at the requested
  bank offset

#### Scenario: Parameter mapping uses natural units
- **WHEN** the module maps inputs at a configured sample rate
- **THEN** it converts mapped time seconds to each per-voice processor increment
  as `1 / (seconds * sampleRate)` and passes the linear sustain value and that
  voice's gate unchanged to the processor

#### Scenario: Voices process independently
- **WHEN** two module voices receive different gate values
- **THEN** each voice advances only its own ADSR state and exposes its own output

#### Scenario: Sample-rate change preserves envelope state
- **WHEN** a module's sample rate changes between input mappings
- **THEN** subsequent increments use the new sample rate without resetting any
  voice's ADSR state

#### Scenario: Module lifecycle errors fail without partial registration
- **WHEN** parameter capacity is insufficient, an effective parameter name is
  duplicated, registration is repeated, an unregistered module is used, or a
  different parameter manager is supplied
- **THEN** the module reports a coding error without creating a partial ADSR
  parameter set
