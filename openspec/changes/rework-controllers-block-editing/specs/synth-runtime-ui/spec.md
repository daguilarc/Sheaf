## MODIFIED Requirements

### Requirement: sru-5 — Controllers page: expandable config sections
WHEN a controller row's config section is used, THE runtime library SHALL provide an expandable config area that starts collapsed, containing collapsible submenus — encoders, system messages, and analogs/gestures — that each start collapsed and are omitted entirely when the controller's kind does not support them; the submenus SHALL present the controller's mappings as the block presentation of sru-10/sru-11 (block rows for uniform runs, individual rows otherwise, config-level rows for relative mode, turn step, and scene blend), SHALL edit them through the view model (encoder channel/CC to parameter slot and position; kind-schema system-message addresses to press/release message-ins per sru-8; analog channel/CC to gesture index and scene blend), SHALL expose scrollable content with distinct visible viewport bounds and content extent so every row remains reachable in JUCE and portable backends, and SHALL remain usable with multiple controllers each carrying dozens of mappings; committed edits apply through the live-edit rebuild path (smi-8).

#### Scenario: Config starts collapsed
- **WHEN** the Controllers page opens
- **THEN** every controller's config section and submenus are collapsed

#### Scenario: Unsupported submenus are skipped
- **WHEN** a launchpad controller's config is expanded
- **THEN** no encoders or analogs submenu is shown
- **AND** the system messages submenu is shown

#### Scenario: Mapping lists scroll
- **WHEN** a controller has more mappings than fit in the visible page
- **THEN** the mapping lists expose a content extent larger than the visible viewport
- **AND** the page can scroll to every mapping row and keep it reachable and editable

#### Scenario: Committed edit reaches the hardware path
- **WHEN** the user edits a system-message association or a block row and commits it
- **THEN** the live instrument configuration is updated and the controller's processors are rebuilt

#### Scenario: Uniform runs present as blocks
- **WHEN** the default WRLD.Bldr controller's encoders submenu is expanded
- **THEN** the 16 turn mappings present as one turn block row and the 16 push mappings as one push block row rather than 32 individual rows

### Requirement: sru-11 — Controllers page: edit-session stability, add, and delete
WHILE a section is expanded, THE runtime library SHALL render an explicit in-memory edit-session row list for that controller section; the edit session SHALL be created by coalescing the current persisted profile elements only on the collapsed-to-expanded transition, SHALL be discarded on expanded-to-collapsed, SHALL NOT be replaced or re-coalesced by accepted edits, adds, deletes, view-model rebuilds, or canonical persisted-order sorting while the section remains expanded, and SHALL flush accepted changes by expanding the current session rows back into the existing persisted profile arrays, validating the full candidate section, and normalizing the persisted element order; each addable mapping group SHALL offer "+" (append one config with next-free defaults) and, where blocks apply, "+B" (append a block, committed as its expansion) which append session rows at the end of the requested group — EVEN WHEN the group is currently empty, so an empty section is never a dead end, and adding the first mapping into a section whose profile-config container is absent (no encoder-input or analog-input) SHALL create that container as part of the commit; individual mapping rows and block rows SHALL be deletable (a block delete removes all its cells in one commit); config-level rows (relative mode, turn step, scene blend) SHALL NOT be deletable.

#### Scenario: Empty group still offers add
- **WHEN** a controller's section (e.g. system messages, or analog gestures) currently has zero mappings
- **THEN** the section still shows the group's "+" (and "+B" where blocks apply) so the first mapping can be added

#### Scenario: First add creates an absent container
- **WHEN** the user adds the first encoder (or analog) mapping to a controller whose config has no encoder-input (or analog-input) container
- **THEN** the commit creates the container and adds the mapping rather than refusing

#### Scenario: Session rows survive canonical persisted sorting
- **WHEN** the user edits a row while a section stays expanded
- **THEN** the edit session keeps rendering the same row list with the edited row updated in place
- **AND** the persisted profile arrays are expanded from the session and normalized without reordering the visible session rows

#### Scenario: Edits do not re-group while expanded
- **WHEN** the user adds two individual scene-select rows that happen to form a contiguous run while the section stays expanded
- **THEN** they remain two individual rows until the section is collapsed and re-expanded
- **AND** re-expanding presents them as one block

#### Scenario: Block edit keeps its row
- **WHEN** the user edits a block's start argument and commits
- **THEN** the block row stays in place with updated values
- **AND** the config holds the new expansion normalized into persisted order

#### Scenario: Add block appends
- **WHEN** the user presses "+B" on the system group of a launchpad controller and commits the block form
- **THEN** the block's cells are added to the config in one commit
- **AND** the block row appears at the end of the session group without re-coalescing neighboring rows

#### Scenario: Delete removes exactly its rows
- **WHEN** the user deletes a 16-cell bank block
- **THEN** all 16 associations represented by that session block are removed in one commit and no other mapping changes

#### Scenario: Config-level rows are not deletable
- **WHEN** the encoders section presents relative mode and turn step
- **THEN** neither exposes a delete affordance

#### Scenario: Close and reopen re-coalesces
- **WHEN** the user closes a section after edits that left adjacent compatible singleton rows visible
- **AND** the user opens that section again
- **THEN** the section coalesces from the current persisted profile arrays and may present those rows as a block

## ADDED Requirements

### Requirement: sru-14 — Controllers page: model-based edit-session verification
WHEN the Controllers page edit-session behavior is tested, THE synth test suite SHALL include deterministic model-based simulation coverage that drives the production JUCE-free view model and portable Controllers page tree through randomized open, close, add, delete, edit, and scroll actions while comparing implementation state against an independent oracle for open sessions and persisted profile arrays.

#### Scenario: Random actions preserve session and persisted state
- **WHEN** a seeded simulation randomly opens and closes controller config sections, adds singleton rows, adds block rows, deletes rows, and edits row fields
- **THEN** after each accepted action the implementation's open session rows match the oracle session rows
- **AND** the live persisted profile arrays match the oracle's expanded and normalized persisted arrays

#### Scenario: Refused actions do not mutate
- **WHEN** a seeded simulation attempts an invalid edit, add, or delete
- **THEN** the action reports a refusal reason
- **AND** the implementation session rows and persisted profile arrays remain equal to their pre-action oracle state

#### Scenario: Rendered tree matches the session
- **WHEN** a seeded simulation rebuilds the portable Controllers page tree after any action
- **THEN** the rendered row labels, row kinds, editable fields, add affordances, delete affordances, and expanded/collapsed state match the oracle's expected open-session model

#### Scenario: Scroll extent is reachable
- **WHEN** a seeded simulation expands enough controller content to exceed the visible page height
- **THEN** the portable tree reports scroll content extent greater than the viewport
- **AND** the JUCE harness or headless layout check can scroll to the final rendered row without clipping it

#### Scenario: Failing seeds are replayable
- **WHEN** a simulation invariant fails
- **THEN** the failing seed and action index are reported
- **AND** the test runner can rerun that exact seed to reproduce the same action sequence

### Requirement: sru-15 — Controllers page: system message kind and argument editors
WHEN system-message rows or blocks are edited on the Controllers page, THE runtime library SHALL present the message kind as a compact choice independent from that message's semantic argument fields, so message-kind controls contain labels such as "Scene Select", "Bank Select", and "Gesture Select" rather than enumerated labels such as "Scene Select 3"; argument-bearing message kinds SHALL expose their arguments through separate numeric or structured fields that commit through the same edit-session flush path as other row fields.

#### Scenario: Scene select separates kind from scene index
- **WHEN** a system-message row sends scene select for scene index 3
- **THEN** the row presents "Scene Select" as the message kind
- **AND** presents scene index `3` in a separate argument field
- **AND** no dropdown option for that row is labeled "Scene Select 3"

#### Scenario: Bank select separates kind from bank arguments
- **WHEN** a system-message row sends bank select for slot 0 bank 7
- **THEN** the row presents "Bank Select" as the message kind
- **AND** presents the slot and bank arguments in separate argument fields
- **AND** no dropdown option for that row is labeled "Bank Select 7"

#### Scenario: Gesture select separates kind from gesture index
- **WHEN** a system-message row sends gesture select for gesture index 4
- **THEN** the row presents "Gesture Select" as the message kind
- **AND** presents gesture index `4` in a separate argument field
- **AND** no dropdown option for that row is labeled "Gesture Select 4"

#### Scenario: Message argument edit preserves the open session
- **WHEN** the user changes a system-message argument field while the section stays expanded
- **THEN** the edit mutates the targeted session row and flushes the expanded persisted config
- **AND** the section does not re-coalesce until it is closed and reopened

### Requirement: sru-16 — Controllers page: shared system-message editing pipeline
WHEN system-message configuration is implemented for WRLD.Bldr, Launchpad, MF Twister, and Generic controller kinds, THE runtime library SHALL use one shared JUCE-free system-message row, block, coalescing, expansion, validation, and commit pipeline, with per-kind differences supplied by an address schema and address validators rather than by separate kind-specific editor implementations.

#### Scenario: Kinds share semantic message fields
- **WHEN** system-message rows are built for WRLD.Bldr, Launchpad, MF Twister, and Generic controllers
- **THEN** each kind uses the same message-kind and message-argument field definitions for scene select, bank select, and gesture select
- **AND** only the address fields differ by kind

#### Scenario: Address schema is the variation point
- **WHEN** the shared system-message pipeline builds address fields
- **THEN** WRLD.Bldr receives channel/x/y fields
- **AND** Launchpad receives x/y fields
- **AND** MF Twister receives logical side-button fields
- **AND** Generic receives channel/cc fields

#### Scenario: One edit path commits every kind
- **WHEN** a system-message kind, argument, address, output-feedback, or block field is edited for any supported controller kind
- **THEN** the edit is validated through the shared system-message pipeline
- **AND** the accepted edit flushes through the same edit-session expansion and persisted-config normalization path

#### Scenario: Regression tests cover all kinds through one contract
- **WHEN** the synth test suite verifies system-message editor behavior
- **THEN** the tests exercise all supported controller kinds through common helper expectations for message kind fields, argument fields, add, delete, edit, and block support
- **AND** kind-specific assertions are limited to address field shape and validation
