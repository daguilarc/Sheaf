## ADDED Requirements

### Requirement: mrg-1 — Topology: fixed dual-row just-intonation grid
WHEN MiniApp initializes through the synth runtime, THE MiniApp SHALL declare exactly one runtime-owned grid slot and select exactly one matching grid with the exclusive range `(0,0)` to `(8,2)`; each row SHALL contain one set-only cell for each x position in the ordered ratio sequence `1/2`, `3/4`, `2/3`, `1/1`, `5/4`, `3/2`, `4/3`, `2/1`; MiniApp SHALL not declare a `6/5` cell.

#### Scenario: MiniApp declares the complete half-open topology
- **WHEN** MiniApp finishes `Init` through an Engine or SynthRig
- **THEN** the runtime grid manager has one finalized slot, one selected grid, and 16 registered cells over x `0..7` and y `0..1`

### Requirement: mrg-2 — Interaction: independent set-only ratio selection and feedback
WHEN a grid press targets MiniApp slot `0`, THE cell SHALL set only its own row's ratio selection; MiniApp SHALL initialize both rows to x `3` (`1/1`), SHALL leave selection unchanged on release or pressure change, and SHALL publish exactly one full-brightness/on cell and seven dim/off cells per row using stable distinct ratio colors.

#### Scenario: Pressing a ratio affects only its row
- **WHEN** a press selects x `6` in row `0` after initialization
- **THEN** row `0` reports x `6` as on, all its other cells as off, and row `1` remains selected at x `3`

#### Scenario: Non-press events preserve selection
- **WHEN** MiniApp receives release and pressure-change events for cells after a row selection
- **THEN** both row selections and their full/dim packed UI-state colors remain unchanged

### Requirement: mrg-3 — Audio: per-voice ratio offsets
WHEN MiniApp prepares its VCO input for an audio sample, THE application SHALL multiply voice `0`'s prepared VCO frequency by the selected row-`0` ratio and voice `1`'s prepared VCO frequency by the selected row-`1` ratio before VCO processing; this SHALL not mutate the Tune parameter's stored scene, gesture, or patch value.

#### Scenario: Independent selected ratios alter prepared frequencies
- **WHEN** row `0` selects `1/2` and row `1` selects `2/1` with equal prepared base frequencies
- **THEN** MiniApp supplies half the base frequency to voice `0` and twice the base frequency to voice `1` before VCO processing

#### Scenario: Unity startup preserves existing pitch
- **WHEN** MiniApp processes its first block before a grid press
- **THEN** both voices use their unmodified prepared VCO frequencies
