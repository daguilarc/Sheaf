## MODIFIED Requirements

### Requirement: sru-5 — Controllers page: expandable config sections
WHEN a controller row's config section is used, THE runtime library SHALL provide an expandable config area that starts collapsed, containing collapsible submenus — encoders, system messages, and analogs/gestures — that each start collapsed and are omitted entirely when the controller's kind does not support them; the submenus SHALL present the controller's mappings as the block presentation of sru-10/sru-11 (block rows for uniform runs, individual rows otherwise, config-level rows for encoder mode, turn step, and scene blend), SHALL edit them through the view model (encoder channel/CC to parameter slot and position; kind-schema system-message addresses to press/release message-ins per sru-8; analog channel/CC to gesture index and scene blend), SHALL expose scrollable content with distinct visible viewport bounds and content extent so every row remains reachable in JUCE and portable backends, and SHALL remain usable with multiple controllers each carrying dozens of mappings; committed edits apply through the live-edit rebuild path (smi-8).

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
WHILE a section is expanded, THE runtime library SHALL render an explicit in-memory edit-session row list for that controller section; the edit session SHALL be created by coalescing the current persisted profile elements only on the collapsed-to-expanded transition, SHALL be discarded on expanded-to-collapsed, SHALL NOT be replaced or re-coalesced by accepted edits, adds, deletes, view-model rebuilds, or canonical persisted-order sorting while the section remains expanded, and SHALL flush accepted changes by expanding the current session rows back into the existing persisted profile arrays, validating the full candidate section, and normalizing the persisted element order; each addable mapping group SHALL offer "+" (append one config with next-free defaults) and, where blocks apply, "+B" (append a block, committed as its expansion) which append session rows at the end of the requested group — EVEN WHEN the group is currently empty, so an empty section is never a dead end, and adding the first mapping into a section whose profile-config container is absent (no encoder-input or analog-input) SHALL create that container as part of the commit; individual mapping rows and block rows SHALL be deletable (a block delete removes all its cells in one commit); config-level rows (encoder mode, turn step, scene blend) SHALL NOT be deletable.

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
- **WHEN** the encoders section presents encoder mode and turn step
- **THEN** neither exposes a delete affordance

#### Scenario: Close and reopen re-coalesces
- **WHEN** the user closes a section after edits that left adjacent compatible singleton rows visible
- **AND** the user opens that section again
- **THEN** the section coalesces from the current persisted profile arrays and may present those rows as a block

## ADDED Requirements

### Requirement: sru-26 — Controllers page: absolute encoder mode editing
WHEN an encoder input configuration is presented or edited through the Controllers page, THE runtime library SHALL expose one non-deletable `Encoder mode` config-level row whose declaration-order choices are signed-7-bit, direction-only, and absolute; SHALL edit and flush the selected `EncoderMode` through the existing open-section edit session; SHALL preserve the stored `turnStep` while absolute mode is selected and identify that it affects relative modes only; and SHALL rebuild the live controller processor with the committed mode without re-coalescing or replacing the open session.

#### Scenario: Absolute mode is selectable
- **WHEN** the user edits an encoder input's `Encoder mode` row and selects the third catalog entry
- **THEN** the session row and persisted controller config use `EncoderMode::Absolute`
- **AND** the live-edit rebuild creates an absolute encoder input processor

#### Scenario: Absolute mode survives session flush and rebuild
- **WHEN** an open encoder section commits absolute mode and the view model rebuilds while that section remains open
- **THEN** the same session row remains visible in place and displays absolute mode
- **AND** the persisted controller config remains absolute

#### Scenario: Turn step is retained but ignored by absolute mode
- **WHEN** a controller has a non-default `turnStep` and the user changes its encoder mode from relative to absolute
- **THEN** the Controllers page preserves the stored `turnStep`
- **AND** identifies it as a relative-mode setting
- **AND** changing the absolute encoder position does not apply that step

#### Scenario: Switching back restores relative configuration
- **WHEN** the user changes an absolute encoder input back to signed-7-bit or direction-only mode
- **THEN** subsequent CC input uses the previously stored `turnStep`

#### Scenario: Encoder mode row is not deletable
- **WHEN** the encoder section presents the `Encoder mode` config-level row
- **THEN** the row exposes no delete affordance
