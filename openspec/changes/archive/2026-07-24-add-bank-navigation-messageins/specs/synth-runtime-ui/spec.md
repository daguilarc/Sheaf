## ADDED Requirements

### Requirement: sru-30 — Controllers page: relative bank message editing
WHEN system-message mappings are presented or edited, THE synth runtime UI SHALL expose “Next Bank” and “Previous Bank” message kinds, SHALL present exactly one message `Arg` for either kind and interpret it as `slotIx`, SHALL preserve that argument across message-kind conversion through the shared primary-argument path, and SHALL represent each mapping as an individual press action with no release.

#### Scenario: Relative bank rows expose slot as Arg
- **WHEN** a system-message row selects Next Bank or Previous Bank
- **THEN** the row exposes one editable `Arg` field
- **AND** editing `Arg` updates `slotIx` in the press and feedback messages
- **AND** no bank-index argument or release message is present

#### Scenario: Relative bank kind conversion preserves the argument
- **WHEN** a row whose primary argument is `5` changes to Next Bank and then Previous Bank
- **THEN** both resulting messages target slot `5`
- **AND** rebuilding the view model preserves the selected message kind and argument

#### Scenario: Relative bank mappings remain individual
- **WHEN** adjacent controller addresses map to relative bank messages
- **THEN** controller block reconstruction leaves them as individual rows
- **AND** committing the section preserves their canonical message ordering and persisted meanings

#### Scenario: Randomized controller editing covers relative bank messages
- **WHEN** the deterministic controller view-model simulation adds, converts, edits, rebuilds, and deletes relative bank mappings
- **THEN** the production row model and persisted profile arrays remain equal to the independent model
