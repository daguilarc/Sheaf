## ADDED Requirements

### Requirement: bgr-1 — Topology: runtime-sized grids and slots
WHEN button-grid topology is initialized, THE synth button-grid runtime SHALL provide one `GridManager` that owns independently indexed grids and grid slots, SHALL give every grid and slot a valid signed integer range `[xmin, xmax) x [ymin, ymax)` with exclusive maxima, SHALL reject empty or overflowed ranges, SHALL flatten valid coordinates row-major with x varying fastest, and SHALL keep all grid and grid-slot indices in number spaces distinct from parameter banks and parameter bank slots.

#### Scenario: Exclusive signed range addresses expected cells
- **WHEN** a grid range is `(xmin=0, xmax=8, ymin=-1, ymax=7)`
- **THEN** it contains x coordinates `0..7` and y coordinates `-1..6`
- **AND** it does not contain x `8` or y `7`
- **AND** its cell capacity is `64`

#### Scenario: Two controllers may use the same coordinates
- **WHEN** a manager creates two grid slots with range `[0,8) x [-1,7)`
- **THEN** slot `0` and slot `1` address independent selected grids
- **AND** their equal coordinates do not alias state or input routing

#### Scenario: Parameter and grid slots do not alias
- **WHEN** parameter bank slot `0` and grid slot `0` both exist
- **THEN** a parameter message naming slot `0` cannot target the grid slot
- **AND** a grid message naming slot `0` cannot target the parameter slot

#### Scenario: Invalid range is rejected atomically
- **WHEN** a caller requests a range with `xmax <= xmin`, `ymax <= ymin`, or an unrepresentable cell count
- **THEN** creation fails without adding a grid or slot to the manager

### Requirement: bgr-2 — Grid routing: selection and cell callbacks
WHEN a grid is populated and selected, THE synth button-grid runtime SHALL let the grid own at most one `Cell` per coordinate in its dense range, SHALL select a grid into a slot only when their ranges match exactly, and SHALL route explicit press, release, and pressure-change events to the selected grid cell at the addressed coordinate without inferring pressure from repeated presses.

#### Scenario: Matching grid selects into slot
- **WHEN** a grid and slot both use `[0,8) x [-1,7)`
- **AND** the manager selects that grid for the slot
- **THEN** subsequent valid events for the slot route to that grid

#### Scenario: Range mismatch preserves selection
- **WHEN** a slot already has a selected grid
- **AND** selection targets a grid with a different minimum or exclusive maximum
- **THEN** selection fails without replacing the previously selected grid

#### Scenario: Events reach the matching callback
- **WHEN** press velocity `100`, pressure value `64`, and release messages target one populated coordinate in order
- **THEN** its cell receives `OnPress(100)`, `OnPressureChange(64)`, and `OnRelease()` in that order

#### Scenario: Empty and invalid coordinates are no-ops
- **WHEN** an event targets an unpopulated coordinate, a coordinate outside the slot range, or a disconnected slot
- **THEN** no cell callback runs
- **AND** manager topology and selection remain unchanged

#### Scenario: Duplicate cell registration is rejected
- **WHEN** a grid already owns a cell at `(x,y)`
- **AND** initialization attempts to register another cell at `(x,y)`
- **THEN** registration fails without replacing the original cell

### Requirement: bgr-3 — Cells: abstract behavior and reusable StateCell
WHEN button behavior is defined, THE synth button-grid runtime SHALL provide an abstract `Cell` contract with virtual press, release, pressure-change, color, and on/off operations, and SHALL provide a templated `StateCell` implementation with `Toggle`, `Momentary`, `SetOnly`, and `ShowOnly` modes, normal and flashing on/off colors, and non-owning flash policies; `StateCell::GetOnOff` SHALL reflect whether the observed state equals its on-state independently of flash phase.

#### Scenario: Toggle changes between on and off
- **WHEN** a toggle state cell observes its off-state and receives a press
- **THEN** it writes its on-state
- **WHEN** it receives another press
- **THEN** it writes its off-state
- **AND** releases do not change either state

#### Scenario: Momentary releases to off
- **WHEN** a momentary state cell receives a press
- **THEN** it writes its on-state
- **WHEN** it receives a release
- **THEN** it writes its off-state

#### Scenario: Set-only and show-only preserve their contracts
- **WHEN** a set-only cell receives a press and release
- **THEN** it writes its on-state on press and retains it on release
- **WHEN** a show-only cell receives press, pressure, and release
- **THEN** it does not mutate the observed state

#### Scenario: Flash affects color but not on/off
- **WHEN** a state cell's flash policy is active while the observed state equals its on-state
- **THEN** `GetColor()` returns the configured on-flash color
- **AND** `GetOnOff()` remains true

#### Scenario: StateCell does not own observed state
- **WHEN** a state cell is destroyed
- **THEN** the observed application state and flash state remain valid and are not destroyed by the cell

### Requirement: bgr-4 — UI state: atomic packed color grid
WHEN grid UI state is created and published, THE synth button-grid runtime SHALL allocate immutable range metadata and one atomic `Color` per coordinate for every grid slot, SHALL publish the selected cell's red, green, and blue bytes, SHALL overwrite the final color byte with `1` when `GetOnOff()` is true and `0` when it is false, and SHALL publish off RGB plus final byte `0` for disconnected or empty cells.

#### Scenario: Colored on cell publishes one atomic value
- **WHEN** a connected cell returns RGB `(10,20,30)` and `GetOnOff()=true`
- **THEN** its UI-state color contains bytes `(10,20,30,1)`

#### Scenario: Colored off cell retains RGB
- **WHEN** a connected cell returns RGB `(10,20,30)` and `GetOnOff()=false`
- **THEN** its UI-state color contains bytes `(10,20,30,0)`

#### Scenario: Empty cell is neutral
- **WHEN** a selected grid has no cell at one valid coordinate
- **THEN** the corresponding UI-state entry contains off RGB and final byte `0`

#### Scenario: Grid switch clears stale state
- **WHEN** a slot switches from a populated grid to a compatible grid with an empty coordinate
- **THEN** the next publication clears that coordinate to off RGB and final byte `0`

### Requirement: bgr-5 — Lifecycle: initialization allocation and realtime safety
WHEN grid topology and UI state have been finalized, THE synth button-grid runtime SHALL perform no heap allocation while selecting existing grids, routing grid messages, reading cells, or populating grid UI state; SHALL reject topology mutation after finalization; and SHALL require cell event and state-query implementations to be nonblocking and allocation-free on the runtime control/audio path.

#### Scenario: Finalized routing allocates nothing
- **WHEN** a finalized manager processes any sequence of valid selection, press, pressure-change, release, and UI-publication operations
- **THEN** the grid framework performs no heap allocation

#### Scenario: Late topology mutation fails loudly
- **WHEN** code attempts to create a grid or slot, change a range, or register a cell after finalization
- **THEN** the operation reports a coding error
- **AND** existing topology and object addresses remain unchanged

#### Scenario: No arena is required
- **WHEN** all grid and cell topology is complete before finalization
- **THEN** runtime grid operations use their dense preallocated arrays
- **AND** no parameter-style nested modulation arena or storage-growth message is created
