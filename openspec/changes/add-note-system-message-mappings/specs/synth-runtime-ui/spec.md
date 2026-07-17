## ADDED Requirements

### Requirement: sru-27 — Controllers page: Note/CC button address editing

WHEN the Controllers page edits encoder push mappings or Generic controller system-message mappings, THE runtime UI layer SHALL expose a Note/CC selector
with numeric channel and message-number fields, SHALL use numeric note values
rather than musical note names, SHALL omit the selector from encoder turns,
analog mappings, and controller-specific system-message address schemas, and
SHALL commit the selected message type through the existing config edit path.

#### Scenario: Encoder push row selects note

- **WHEN** a user changes an encoder push row from CC to Note and enters channel `1` and number `60`
- **THEN** the committed push mapping is note `60` on channel `1`
- **AND** the row displays the note as numeric value `60`

#### Scenario: Generic system-message row selects note

- **WHEN** a Generic controller system-message row is shown
- **THEN** the row includes the Note/CC selector, channel field, and numeric message-number field

#### Scenario: CC-only rows omit the selector

- **WHEN** an encoder turn, analog mapping, or non-Generic controller-specific system-message row is shown
- **THEN** that row does not offer note addressing

#### Scenario: Blocks do not mix message types

- **WHEN** adjacent button mappings have otherwise contiguous fields but one is CC and one is Note
- **THEN** the Controllers page does not coalesce them into one block row

#### Scenario: Block message type round trips

- **WHEN** a Note encoder-push block or Generic system-message block is expanded and committed
- **THEN** every resulting mapping retains the Note message type
