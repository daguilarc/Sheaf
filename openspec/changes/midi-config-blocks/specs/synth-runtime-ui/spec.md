# synth-runtime-ui Delta

Project: `projects/synth`. ID prefix: `sru`.

## MODIFIED Requirements

### Requirement: sru-5 — Controllers page: expandable config sections
WHEN a controller row's config section is used, THE runtime library SHALL provide an expandable config area that starts collapsed, containing collapsible submenus — encoders, system messages, and analogs/gestures — that each start collapsed and are omitted entirely when the controller's kind does not support them; the submenus SHALL present the controller's mappings as the block presentation of sru-10/sru-11 (block rows for uniform runs, individual rows otherwise, config-level rows for relative mode, turn step, and scene blend), SHALL edit them through the view model (encoder channel/CC to parameter slot and position; kind-schema system-message addresses to press/release message-ins per sru-8; analog channel/CC to gesture index and scene blend), SHALL scroll within the page, and SHALL remain usable with multiple controllers each carrying dozens of mappings; committed edits apply through the live-edit rebuild path (smi-8).

#### Scenario: Config starts collapsed
- **WHEN** the Controllers page opens
- **THEN** every controller's config section and submenus are collapsed

#### Scenario: Unsupported submenus are skipped
- **WHEN** a launchpad controller's config is expanded
- **THEN** no encoders or analogs submenu is shown
- **AND** the system messages submenu is shown

#### Scenario: Mapping lists scroll
- **WHEN** a controller has more mappings than fit in the visible page
- **THEN** the mapping lists scroll and every mapping row remains reachable and editable

#### Scenario: Committed edit reaches the hardware path
- **WHEN** the user edits a system-message association or a block row and commits it
- **THEN** the live instrument configuration is updated and the controller's processors are rebuilt

#### Scenario: Uniform runs present as blocks
- **WHEN** the default WRLD.Bldr controller's encoders submenu is expanded
- **THEN** the 16 turn mappings present as one turn block row and the 16 push mappings as one push block row rather than 32 individual rows

## ADDED Requirements

### Requirement: sru-8 — Controllers page: per-kind address schema
WHEN system-message mappings are presented or edited, THE runtime library SHALL derive each kind's address fields from a single shared schema — wrldbldr: channel, x, y; launchpad: x, y; twister: logical side-button number 0..5 only (stored as its fixed channel-3 CC `8 + button`; the channel is display-only, not an editable column); generic: channel, cc — and SHALL use that schema for row fields, column headers, and block address forms, so no kind shows dead or inapplicable address columns.

#### Scenario: Twister shows a single address column
- **WHEN** a twister controller's system messages submenu is expanded
- **THEN** each row exposes exactly one editable address field (the logical button number 0..5, persisted as CC `8 + button` on the fixed channel) plus press/release
- **AND** no editable channel field is shown
- **AND** a button value outside 0..5 is refused with a reason

#### Scenario: Schema drives every surface
- **WHEN** a kind's system-message rows, their column headers, and its system block form are compared
- **THEN** all three expose the same address fields in the same order as the shared schema

### Requirement: sru-9 — Controllers page: canonical config ordering
WHEN the view model commits any mapping change (edit, add, delete, or block operation), THE runtime library SHALL normalize the committed profile config's element order — encoder turns and pushes by (slot, position); system-message associations by a total press-message sort key defined for every `MessageIn` type (type order, then the type's semantic arguments — scene index, bank slot+index, gesture index, param slot+position, held-flag tuple for modifier set/release variants — then the kind's address tuple, then stable original order); analog gesture mappings by gesture index — through a JUCE-free library helper, without changing the persistence format; block reconstruction SHALL sort its input view the same way, so configs authored in any order reconstruct identically and become canonical on their first commit.

#### Scenario: Commit normalizes order
- **WHEN** a mapping edit is committed on a config whose system messages are stored out of order
- **THEN** the committed config's system messages are sorted by (message type, argument)
- **AND** the persisted JSON structure is otherwise unchanged

#### Scenario: Unsorted input still reconstructs
- **WHEN** an externally-authored config stores a bank-selector run out of order
- **THEN** expanding the section reconstructs the same block as for the sorted equivalent

### Requirement: sru-10 — Controllers page: block model
WHEN a section is expanded, THE runtime library SHALL reconstruct, via pure JUCE-free functions, a block presentation of the sorted config that is minimal under the reconstruction's canonical traversal (x ascending within a row, row direction ±1 in y, row-major): encoder blocks (channel, start cc, end cc exclusive, slot, start position) for maximal runs (length ≥ 2) of constant slot/channel with consecutive positions and ccs at constant offset, separately for turns and pushes; analog gesture blocks (channel, start cc, end cc exclusive, start gesture) analogously; system blocks only for scene-select, bank-select, and gesture-select messages — presented per the kind's address form (generic: channel + cc run; wrldbldr: channel + exclusive-end x/y rectangle whose end row may be above or below its start row; launchpad: the same rectangle form without channel; twister: never blocked) — for maximal runs of the same type (and same bank slot for bank-select) with consecutive arguments, consistent release pattern (paired set-false for gesture-select, absent otherwise), feedback equal to press on every cell, and a constant output-feedback flag, fitting greedy rectangles of ≥ 2 cells with the y direction fixed by the run's second row; a block SHALL expand to exactly its equivalent individual configs (argument = start + cell index in traversal order; wrldbldr cells derive control cc from position with the block channel authoritative; feedback = press; output-feedback = the block's flag), and reconstruction composed with expansion SHALL round-trip: expanding a reconstructed presentation reproduces the sorted config exactly for every config (duplicate addresses or duplicate messages simply fail the run checks and pass through as individual rows), and reconstructing the expansion of any block reconstruction can itself produce yields that block back; mappings fitting no block — including all non-blockable message types and scene blend — SHALL present as individual rows.

#### Scenario: Encoder run reconstructs to one block
- **WHEN** a config maps ccs 0..15 on one channel to slot 0 positions 0..15 as turns
- **THEN** the encoders presentation contains one turn block (channel, cc 0..16 exclusive, slot 0, start position 0)

#### Scenario: Bank rectangle reconstructs on WRLD.Bldr
- **WHEN** the default WRLD.Bldr profile's bank selectors (banks 0..7 on row y=3, banks 8..15 on row y=2, feedback = press throughout) are reconstructed
- **THEN** the system presentation contains one bank-select block spanning x 0..7 from start row 3 to end row 2 with start argument 0

#### Scenario: Broken run splits minimally
- **WHEN** one cell in the middle of an otherwise uniform scene-select run has a non-consecutive argument
- **THEN** reconstruction emits blocks/rows covering each maximal uniform piece and an individual row for the outlier

#### Scenario: Non-blockable messages stay individual
- **WHEN** a config contains reset/random modifier associations and a scene blend assignment
- **THEN** they present as individual rows regardless of adjacency

#### Scenario: Expansion round-trips
- **WHEN** any reconstructed presentation's blocks are expanded and merged with its individual rows
- **THEN** the result equals the sorted input config exactly

#### Scenario: Block commit is all-or-nothing
- **WHEN** a block edit produces an expansion where any cell fails validation (address out of shape, argument out of domain, duplicate address)
- **THEN** the commit is refused with a reason and the config is unchanged

### Requirement: sru-11 — Controllers page: presentation stability, add, and delete
WHILE a section is expanded, THE runtime library SHALL keep its presentation's grouping stable — reconstruction runs only at the collapsed-to-expanded transition, and view-model rebuilds re-resolve rows by identity (encoders: push-flag/slot/position; analog: gesture index plus a scene-blend sentinel; system: the press sort key including its address tuple, plus an occurrence ordinal so associations sharing both message and address still resolve to distinct rows) without re-grouping, dropping rows whose identity no longer resolves and appending unknown identities as individual rows; collapsing and re-expanding SHALL present the fresh minimal reconstruction; each mapping group SHALL offer "+" (append one config with next-free defaults) and, where blocks apply, "+B" (append a block, committed as its expansion) which append presentation rows in place without re-grouping; individual mapping rows and block rows SHALL be deletable (a block delete removes all its cells in one commit); config-level rows (relative mode, turn step, scene blend) SHALL NOT be deletable.

#### Scenario: Duplicate messages resolve distinctly
- **WHEN** two associations at different addresses both send scene-select 0 and one is deleted
- **THEN** exactly the deleted association's row disappears and the other is unaffected

#### Scenario: Edits do not re-group while expanded
- **WHEN** the user adds two individual scene-select rows that happen to form a contiguous run while the section stays expanded
- **THEN** they remain two individual rows until the section is collapsed and re-expanded
- **AND** re-expanding presents them as one block

#### Scenario: Block edit keeps its row
- **WHEN** the user edits a block's start argument and commits
- **THEN** the block row stays in place with updated values and the config holds the new expansion

#### Scenario: Add block appends
- **WHEN** the user presses "+B" on the system group of a launchpad controller and commits the block form
- **THEN** the block's cells are added to the config in one commit and the block row appears at the end of the group

#### Scenario: Delete removes exactly its rows
- **WHEN** the user deletes a 16-cell bank block
- **THEN** all 16 associations are removed in one commit and no other mapping changes

#### Scenario: Config-level rows are not deletable
- **WHEN** the encoders section presents relative mode and turn step
- **THEN** neither exposes a delete affordance
