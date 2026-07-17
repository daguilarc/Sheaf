## Context

The synth core currently has one mature control-routing shape:
`ParameterManager` owns banks and bank slots, `MessageInBus` routes timestamped
commands to it, and `ParameterManager::UIState` supplies immutable-topology
atomic snapshots to UI and MIDI output processors. Controller profiles already
turn physical WRLD.Bldr/Launchpad/system-button addresses into press/release
messages and reconstruct uniform address runs as editable blocks.

The older `theallelectricsmartgrid` project supplies useful cell semantics and
the original `ColorBus` idea, but assumes one compile-time global coordinate
rectangle, global grid IDs, and fixed arrays. The synth runtime instead needs
multiple independently addressable controller grids, signed coordinates,
runtime-sized topology, and no steady-state allocation.

The implementation crosses the synth core, engine lifecycle, message/MIDI
profile model, persistence, and Controllers view model. It must preserve the
current parameter slot namespace, controller output protocols, and existing
applications.

## Goals / Non-Goals

**Goals:**

- Add a `GridManager` sibling to `ParameterManager`, owned and pumped by the
  runtime.
- Model dynamically sized signed coordinate rectangles with exclusive maxima.
- Route press, release, pressure-change, and grid-selection messages without
  allocating after initialization.
- Port the useful Smart Grid `Cell` and `StateCell` behavior into clean,
  reusable synth types.
- Publish color and monochrome on/off state through atomic grid UI snapshots.
- Reuse the existing system-message input/output association pipeline for grid
  press/release/feedback and add derived polyphonic-aftertouch input mappings.
- Present one grid block or single grid button in Controllers configuration and
  hide the derived aftertouch representation while preserving round trips.

**Non-Goals:**

- No application creates a grid, maps application behavior to cells, or renders
  a grid in its main surface in this change.
- No toggle-style user-visible grid mapping; grid mappings are always paired
  press/release controls.
- No change to MIDI output wire protocols, device ownership, reconciliation,
  patch persistence, or parameter-bank behavior.
- No port of Smart Grid global grid-ID allocation, fixed controller bounds,
  bidirectional bus epochs, or unrelated cell subclasses.
- No nested modulation-like cell topology or arena allocator.

## Decisions

### 1. Use a separate grid subsystem with its own identities

Add JUCE-free `GridRange`, `Cell`, `StateCell`, `Grid`, `GridSlot`, and
`GridManager` types in a focused button-grid module. `GridManager` owns grids
and slots in vectors, so a grid index or grid-slot index is meaningful only to
that manager. Parameter bank/slot indices and grid/slot indices are explicitly
different number spaces even when their numeric values happen to match.

`GridRange` stores signed `int` `xmin`, `xmax`, `ymin`, and `ymax`. It is valid
only when both maxima are greater than their minima, and denotes
`[xmin, xmax) x [ymin, ymax)`. Width, height, and cell-count calculations use
checked arithmetic. Coordinates flatten row-major with x varying fastest:
`(y - ymin) * width + (x - xmin)`.

Both a `Grid` and a `GridSlot` have a range. Selecting a grid into a slot
requires exact range equality and succeeds atomically; a failed selection
leaves the previous grid selected. This keeps physical and logical coordinates
identical, supports negative coordinates without translation, and makes every
dense allocation size knowable during initialization. A system with two
Launchpads therefore creates two independent slots with the same
`[0, 8) x [-1, 7)` range.

Alternative: put grids inside `ParameterManager`. Rejected because it would
conflate explicitly distinct slot/identity domains and make the already large
parameter subsystem responsible for unrelated button semantics.

Alternative: port Smart Grid's global grid allocator and fixed `ColorBus`.
Rejected because its global dimensions and IDs are exactly the constraints this
change removes.

### 2. Grids own cells and freeze topology at initialization

A `Grid` owns one dense, runtime-sized array of nullable `unique_ptr<Cell>` for
its range. Registration validates the coordinate, rejects duplicates, and
occurs before topology freeze. `GridManager::CreateUIState`, or an explicit
equivalent finalization step used by it, freezes grid and slot topology.
Creating grids/slots, changing ranges, or registering cells after that point is
a coding error. Selecting among already-created compatible grids remains a
runtime operation and does not allocate.

The abstract `Cell` has a virtual destructor and virtual `OnPress(uint8_t)`,
`OnRelease()`, `OnPressureChange(uint8_t)`, `GetColor()`, and `GetOnOff()`
surface. Event callbacks default to no-ops while the two state queries are pure,
so custom cells need only implement the state they publish. `Grid` routes each
explicit message directly to the matching callback; pressure is not inferred
from repeated presses.

All cell callbacks and state queries are part of the audio/control-thread path
and therefore carry a nonblocking, allocation-free contract.

### 3. Port `StateCell` with state modes and flash policies

Port `StateCell<State, FlashPolicy>` as a reusable `Cell` implementation. It
holds a non-owning pointer/reference to application state, the cell's on and off
state values, normal on/off colors, optional flashing on/off colors, a flash
policy, and one of these modes:

- `Toggle`: press switches between on and off state.
- `Momentary`: press sets on state and release restores off state.
- `SetOnly`: press sets on state and release does nothing.
- `ShowOnly`: input does not mutate state.

`GetOnOff()` reports whether the underlying state equals the cell's on state.
`GetColor()` chooses the normal or flashing palette from the flash policy and
then chooses its on/off entry from the same state comparison. Flash phase never
changes `GetOnOff()`. `OnPressureChange` keeps the base no-op behavior.
Provide the useful no-flash, boolean-flash, and state-equality flash policies
from the old implementation, adapted to const-safe synth naming and without
owning the observed state.

Alternative: port only a boolean toggle helper. Rejected because momentary,
set-only, show-only, and flashing behavior are the reusable part of the
original `StateCell` and cost no runtime allocation.

### 4. Publish dense atomic colors through a global runtime snapshot

`Grid` defines a dynamically sized `UIState` shape containing its immutable
range metadata and one `AtomicColor` per coordinate. `GridManager::UIState`
contains one such selected-grid snapshot per grid slot plus immutable slot
capacity/range metadata. A disconnected slot or missing cell publishes
`Color::Off` with its final byte set to zero.

For a connected cell, publication reads `GetColor()`, preserves `r`, `g`, and
`b`, and overwrites `Color::a` with `1` when `GetOnOff()` is true or `0` when it
is false. The final byte is a packed on/off channel in this snapshot, not visual
alpha. Existing color MIDI protocols already consume RGB; monochrome feedback
uses the nonzero final byte.

The engine owns parameter UI state and grid-manager UI state behind one stable
internal runtime snapshot/facade. Existing application context access to
parameter UI state remains unchanged; this change does not expose grid state to
applications. MIDI profile/output construction receives the global facade so
encoder processors use the parameter portion and system-message feedback can
resolve either parameter/system state or a grid cell.

Alternative: store a separate atomic boolean per cell. Rejected because the
requested packed representation gives output readers one atomic load and the
existing `Color` is explicitly four bytes and atomically wrapped already.

### 5. Extend the shared message bus instead of adding a second queue

Add `GridPress`, `GridRelease`, `GridPressureChange`, and `SelectGrid` variants
to `MessageIn`. Grid event messages carry a grid slot index and signed x/y;
press and pressure-change also carry a MIDI-range `uint8_t` velocity. Grid
selection carries a grid slot index and grid index. JSON uses signed values for
x/y and preserves every new semantic field.

`MessageInBus` keeps one bounded SPSC queue and stable timestamp/FIFO behavior,
but can be attached to both a `ParameterManager` and `GridManager`. Parameter
messages continue to route exactly as today. Grid messages route only through
the grid manager. Missing managers, invalid indices, invalid coordinates, and
range-incompatible selections are nonthrowing no-ops at the external-message
boundary.

The engine constructs both its UI and MIDI buses with both managers and drains
them in the existing order before application block processing. A separate
grid queue was rejected because it would duplicate ordering, capacity, and
producer-serialization rules and could reorder parameter and grid commands that
share one MIDI stream.

### 6. Represent pressure explicitly in profile config but derive it in the UI

Keep grid press/release/output on
`MidiControllerSystemMessageAssociation`. One grid cell association uses:

- `press = GridPress(gridSlot, x, y, velocity-template)`;
- `release = GridRelease(gridSlot, x, y)`;
- `feedback = GridPress(gridSlot, x, y, 0)`; and
- the existing controller address and output-feedback fields.

Add an optional polyphonic-pressure input config containing address-to-message
mappings. Its processor recognizes MIDI status `0xA0`, matches channel/note (or
the controller-kind-derived note address), stamps the runtime timestamp and
incoming pressure byte into `GridPressureChange`, pushes it, and passes
unmatched messages to thru. Profile construction inserts it into the existing
input chain; no device handler changes.

The Controllers view model adds a grid-button row and a rectangular grid-block
row for the two-dimensional WRLD.Bldr and Launchpad address forms. Physical
address `(x,y)` is also the logical grid coordinate; the row adds only the
target grid-slot index. Expansion creates the system association and its
derived pressure mapping together. A grid block always has paired press and
release behavior and never offers toggle mode.

Reconstruction recognizes only exact pairs: matching physical address,
`GridPress`/`GridRelease`/feedback target, and derived
`GridPressureChange` target. It greedily coalesces exact uniform runs using the
existing signed half-open rectangle traversal. Exact derived pressure entries
are hidden. Unknown or orphan pressure entries are preserved verbatim as
session sidecar data so opening and committing the section never destroys
externally authored config, but they receive no user-visible aftertouch row.
Editing or deleting a grid row atomically updates or deletes its paired derived
entry.

Alternative: put pressure directly on the system association. Rejected because
polyphonic aftertouch is an independent MIDI message class and processor input,
and the persisted profile should describe the processor chain faithfully even
though the UI hides that detail.

### 7. Make pressure persistence additive and backward-readable

Add the optional pressure-input object to controller-profile JSON. The new
reader accepts the current profile schema with the field absent and treats that
as no pressure mappings; the writer emits the field in a new profile schema
version. The containing instrument and runtime configuration remain on their
current schemas because they already delegate nested profile parsing. Message
JSON gains signed grid coordinates, grid index, and byte velocity fields.

Normalization sorts pressure mappings by semantic grid target and physical
address. Serialization followed by parsing and Controllers reconstruction
followed by expansion must preserve canonical profile meaning, including
hidden orphan pressure mappings.

### 8. Reuse output processors through grid-aware feedback lookup

Extend `SystemMessageOutputInfo` to read the global runtime UI facade. For a
grid feedback message it validates grid slot and coordinate against immutable
snapshot ranges, atomically loads the packed color, returns its RGB color, and
returns `isOn = (a != 0)`. Missing/disconnected targets return off/false.

WRLD.Bldr, Launchpad, generic CC, and other existing system output processors
keep their current address conversion, caching, budgeting, and wire messages.
Only the state lookup gains the grid case. This is an output data-source
extension, not a new output protocol.

### 9. Test contracts at pure boundaries and through the engine

Add focused tests for range validation/flattening (including negative values),
grid and parameter namespace independence, exact-range selection, every cell
callback, every `StateCell` mode and flash policy, packed on/off publication,
invalid-message no-ops, SPSC ordering, and no allocation after topology freeze.

Add MIDI tests for `0xA0` matching/thru behavior, timestamp/velocity stamping,
profile chain construction, grid feedback for color and monochrome consumers,
JSON backward reads and round trips, block/single expansion and reconstruction,
orphan preservation, signed exclusive rectangles, and seeded Controllers model
simulation. Engine tests verify ownership, binding order, message draining, UI
publication, and unchanged existing parameter/MIDI behavior.

## Risks / Trade-offs

- **[Risk] Reusing `Color::a` as on/off can be mistaken for visual alpha.** →
  Name and document the packed grid snapshot helpers, always overwrite the byte
  at publication, and have output readers return RGB plus an explicit `isOn`.
- **[Risk] Virtual cell code runs on the control/audio path.** → Document and
  test the allocation-free/nonblocking callback contract; keep all framework
  lookup and publication storage preallocated.
- **[Risk] Profile config can contain orphan pressure mappings.** → Preserve
  unknown entries losslessly as hidden sidecar data and only coalesce exact
  derived pairs.
- **[Risk] Extending the shared `MessageIn` shape touches JSON sort keys and
  output evaluation.** → Define semantic fields for every new type, add
  exhaustive switch tests, and keep invalid external targets as no-ops.
- **[Trade-off] Exact grid/slot range matching is less flexible than implicit
  translation.** → It makes coordinate meaning, allocation size, negative
  bounds, and hardware feedback deterministic; translated placement can be a
  later explicit capability if needed.
- **[Trade-off] Dense arrays consume space for empty cells.** → Controller
  grids are small, dense lookup is constant-time and allocation-free, and the
  design avoids the substantially more complex nested arena used by parameters.

## Migration Plan

1. Add the grid core and tests without enabling any app grid topology.
2. Extend `MessageIn`, the shared buses, and engine-owned global UI snapshot.
3. Add pressure processor/config and backward-readable JSON.
4. Add grid-aware feedback lookup while preserving every existing output
   protocol test.
5. Add Controllers grid rows/blocks, canonical reconstruction, and simulation
   coverage.
6. Existing runtime configurations load with no pressure mappings; once saved
   by the new build they use the new nested profile schema. Rolling back loses
   awareness of the new optional profile field but does not affect patches or
   parameter state.

## Open Questions

None. The approved design fixes on/off encoding to `0/1` in `Color::a`, uses
exact signed half-open range matching, and includes the full useful
`StateCell` mode/flash behavior.
