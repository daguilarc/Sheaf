## ADDED Requirements

### Requirement: spm-86 — Message input: relative parameter-bank navigation
WHEN relative parameter-bank control is requested, THE synth parameter modulation system SHALL provide `NextParamBank(timestamp, slotIx)` and `PrevParamBank(timestamp, slotIx)` `MessageIn` operations that route through `MessageInBus`, use the addressed slot's current manager-owned bank as their reference, wrap over manager bank indices `0` through `bankCount - 1` when no modifier is active, and apply the effective reset, random, or random-mod modifier to the current bank without changing selection when a modifier is active.

#### Scenario: Next bank advances
- **WHEN** slot `S` currently selects manager bank `B`
- **AND** `B` is not the last bank
- **AND** no modifier is active
- **AND** the bus applies `NextParamBank(..., S)`
- **THEN** slot `S` selects bank `B + 1`

#### Scenario: Next bank wraps
- **WHEN** slot `S` currently selects the last manager bank
- **AND** no modifier is active
- **AND** the bus applies `NextParamBank(..., S)`
- **THEN** slot `S` selects bank `0`

#### Scenario: Previous bank retreats
- **WHEN** slot `S` currently selects manager bank `B`
- **AND** `B` is greater than `0`
- **AND** no modifier is active
- **AND** the bus applies `PrevParamBank(..., S)`
- **THEN** slot `S` selects bank `B - 1`

#### Scenario: Previous bank wraps
- **WHEN** slot `S` currently selects manager bank `0`
- **AND** no modifier is active
- **AND** the bus applies `PrevParamBank(..., S)`
- **THEN** slot `S` selects the last manager bank

#### Scenario: Reset next and previous act on the current bank
- **WHEN** reset is the effective modifier
- **AND** slot `S` currently selects bank `B`
- **AND** the bus applies either `NextParamBank(..., S)` or `PrevParamBank(..., S)`
- **THEN** every top-level parameter mapped by bank `B` is reset through the existing bank-modifier behavior
- **AND** slot `S` still selects bank `B`

#### Scenario: Random next and previous act on the current bank
- **WHEN** random is the effective modifier
- **AND** slot `S` currently selects bank `B`
- **AND** the bus applies either `NextParamBank(..., S)` or `PrevParamBank(..., S)`
- **THEN** every top-level parameter mapped by bank `B` has its visible value randomized through the existing bank-modifier behavior
- **AND** slot `S` still selects bank `B`

#### Scenario: Random-mod next and previous act on the current bank
- **WHEN** random-mod is the effective modifier
- **AND** slot `S` currently selects bank `B`
- **AND** the bus applies either `NextParamBank(..., S)` or `PrevParamBank(..., S)`
- **THEN** every top-level parameter mapped by bank `B` receives the existing geometric modulation randomization
- **AND** slot `S` still selects bank `B`

#### Scenario: Invalid relative navigation is a no-op
- **WHEN** a relative bank message addresses a missing slot, the manager has no banks, the addressed slot has no selected bank, or its selected bank is not manager-owned
- **THEN** bank selection, parameter values, modulation state, scenes, gestures, and modifier state remain unchanged

### Requirement: spm-87 — MIDI profiles: relative bank persistence and stateless feedback
WHEN MIDI controller profiles contain relative parameter-bank messages, THE synth parameter modulation system SHALL serialize and parse `NextParamBank` as `nextParamBank` and `PrevParamBank` as `prevParamBank`, preserve each message's `slotIx` through in-memory and JSON round trips, describe each action with its direction and slot, and report the default off `SystemMessageOutputState` because relative navigation has no persistent selected state.

#### Scenario: Relative bank messages round-trip
- **WHEN** a profile serializes next-bank for slot `2` and previous-bank for slot `3`
- **THEN** its JSON contains `nextParamBank` with `slotIx` `2` and `prevParamBank` with `slotIx` `3`
- **AND** parsing the JSON reconstructs messages equal to the originals

#### Scenario: Relative bank descriptions include direction and slot
- **WHEN** controller configuration describes next-bank and previous-bank messages for slot `4`
- **THEN** the descriptions distinguish next from previous
- **AND** both descriptions identify slot `4`

#### Scenario: Relative bank feedback is stateless
- **WHEN** the system-message output helper evaluates next-bank or previous-bank
- **THEN** it returns off color with `isOn=false`

### Requirement: spm-88 — Tests: relative bank message simulation
WHEN automated tests cover external synth parameter control, THE synth parameter modulation test suite SHALL exercise both relative bank messages through focused unit tests and the deterministic randomized message-bus simulation, model wrapped selection and current-bank modifier behavior independently, and verify production manager, bank, slot, parameter, modulation, modifier, and UI state against the oracle.

#### Scenario: Randomized relative navigation matches the model
- **WHEN** the message-driven randomized simulation interleaves next-bank and previous-bank operations with selection, parameter edits, and reset/random/random-mod state changes
- **THEN** every processed operation leaves production state equal to the independent deterministic model
- **AND** any failure reports the seed and operation trace needed to reproduce it
