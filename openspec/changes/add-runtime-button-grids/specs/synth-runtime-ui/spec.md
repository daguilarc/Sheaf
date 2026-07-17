## ADDED Requirements

### Requirement: sru-26 — Controllers page: grid buttons and blocks
WHEN a WRLD.Bldr or Launchpad controller's system mappings target button-grid messages, THE runtime UI SHALL present each exact press/release/feedback plus polyphonic-pressure pair as one user-visible grid button or maximal rectangular grid block, SHALL expose the target grid-slot index and the existing kind-specific signed physical x/y range with exclusive maxima, SHALL map physical `(x,y)` directly to the same logical grid coordinate, SHALL always derive press, release, pressure-change, and feedback mappings together on commit, SHALL offer no toggle or aftertouch controls, and SHALL preserve unknown pressure mappings invisibly and losslessly through open-section editing and persistence.

#### Scenario: Grid block expands all input behavior
- **WHEN** the user commits a Launchpad grid block for slot `1` over `[0,8) x [-1,7)`
- **THEN** the profile receives one system association per coordinate with paired `GridPress` and `GridRelease` and grid feedback
- **AND** receives one matching derived polyphonic-pressure mapping per coordinate
- **AND** every range maximum is treated as exclusive

#### Scenario: Single grid button hides MIDI mechanics
- **WHEN** one exact grid mapping is presented individually
- **THEN** the row identifies it as one grid button with controller address and target grid slot
- **AND** it exposes no toggle, note number, MIDI status, aftertouch, or pressure-mapping row

#### Scenario: Exact mappings reconstruct to one block
- **WHEN** canonical system and pressure config contains a uniform rectangular run of matching grid mappings
- **THEN** collapsing and reopening the section reconstructs the maximal grid block
- **AND** expanding that block reproduces the canonical underlying mappings exactly

#### Scenario: Negative coordinates round-trip
- **WHEN** a grid block includes y `-1` and has exclusive maximum y `7`
- **THEN** its row, edit session, expansion, JSON persistence, and reconstruction preserve the signed coordinates

#### Scenario: Grid mappings are always momentary
- **WHEN** a grid button or block is added or edited
- **THEN** the view model generates press and release messages as a pair
- **AND** offers no toggle variant

#### Scenario: Orphan pressure data is preserved but hidden
- **WHEN** externally authored profile config contains a pressure mapping that does not exactly pair with a grid system association
- **THEN** the Controllers page shows no aftertouch line item for it
- **AND** opening, editing an unrelated row, committing, and saving preserves that mapping unchanged

#### Scenario: Pair edit is atomic
- **WHEN** a grid block edit would create an invalid controller address, duplicate address, invalid signed rectangle, or unrepresentable logical target
- **THEN** the commit is refused with a reason
- **AND** neither its system associations nor pressure mappings change

### Requirement: sru-27 — Controllers page: grid mapping model coverage
WHEN grid mapping presentation is tested, THE synth runtime UI test suite SHALL cover pure expansion/reconstruction, profile JSON round trips, open-session edit stability, add/delete operations, signed exclusive ranges, hidden pressure sidecars, and deterministic seeded simulation against an independent model without requiring JUCE or physical MIDI devices.

#### Scenario: Pure model builds without JUCE
- **WHEN** a headless test constructs grid singleton and block rows for WRLD.Bldr and Launchpad profiles
- **THEN** it compiles and runs without JUCE headers
- **AND** produces the expected paired system and pressure config

#### Scenario: Seeded simulation preserves paired mappings
- **WHEN** a deterministic simulation adds, edits, deletes, opens, closes, and reconstructs grid rows and blocks
- **THEN** every visible grid row has exactly one matching pressure entry per cell
- **AND** unknown hidden pressure entries remain equal to the independent oracle

#### Scenario: Renderer never exposes aftertouch
- **WHEN** the portable Controllers tree and JUCE renderer are built from a profile containing grid pressure mappings
- **THEN** visible labels and editable fields contain grid button/block concepts
- **AND** contain no standalone aftertouch or polyphonic-pressure line item
