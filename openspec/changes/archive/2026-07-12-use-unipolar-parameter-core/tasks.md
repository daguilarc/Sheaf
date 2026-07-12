## 1. Normalize the parameter core

- [x] 1.1 Add focused parameter tests for normalized bipolar defaults and raw reads, positive and negative full-depth crossfades, overfull normalization, and the `0.25` modulation-depth halfpoint.
- [x] 1.2 Make parameter clamping, scene/edit/random state, dynamic min/max, and modulation-depth controls use `[0, 1]`; decode depth controls with `2u - 1` while preserving the existing crossfade equation.

## 2. Convert boundaries and consumers

- [x] 2.1 Update bipolar mapping helpers and UI snapshot publication to convert normalized centers, ranges, and spread at their boundaries, with focused mapping and UI-state tests.
- [x] 2.2 Convert code-defined bipolar defaults and direct scene/gesture assignments in synth modules to normalized values, then update affected module and engine expectations.
- [x] 2.3 Update parameter JSON fixtures and the deterministic simulation oracle so persisted values and modeled runtime state use the normalized core domain.

## 3. Verify the migration

- [x] 3.1 Audit remaining polarity-dependent range branches and signed bipolar literals, then run the synth parameter, module, engine, randomized-oracle, and system test suites.
