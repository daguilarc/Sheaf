# Design: midi-config-blocks

## Context

The persisted model (per-mapping configs inside `MidiControllerProfileConfig`)
stays exactly as it is. Everything here is presentation: how the view model
groups sorted mappings into block rows for display/editing, and how block
edits expand back to individual configs on commit. The Controllers page
(`runtime/ControllersPage.hpp`) already renders `MidiConfigViewModel` rows
with per-group headers/dividers; this change restructures what those rows are.

Key existing facts: system-message associations carry `control`
(channel+cc), optional `wrldBldrPosition` (channel+x+y), optional
`launchpadPosition` (x+y); WrldBldr's `control` is derived from position via
`WrldBldrPositionToCC` with `control->channel` authoritative; twister side
buttons are fixed channel 3, cc 8..13; gesture-select associations carry
press=SetGestureSelect(ix,true) and release=SetGestureSelect(ix,false);
scene/bank selectors are press-only; feedback-capable kinds (wrldbldr,
launchpad) set `feedback` = press in the default factories.

## Goals / Non-Goals

**Goals:**
- Minimal, deterministic block reconstruction from sorted configs; blocks
  expand to exactly their equivalent individual configs.
- Presentation stability while a section is expanded; reconstruction only on
  expand.
- Shared per-kind address schema; no dead columns.
- All grouping/expansion logic JUCE-free and unit-tested.

**Non-Goals:**
- Persisting blocks in any form (no JSON change, no new config fields).
- Blocks for twister (single side buttons only), for non-blockable message
  types, for scene blend, or for encoder mode/step.
- Column-major reconstruction (see D4 — column-major blocks are *authorable*
  but reconstruct as per-column row-major blocks).

## Decisions

### D1 — Address schema is a single per-kind table

`SystemAddressSchema(MidiProfileKind)` returns the ordered field list that
IS the kind's address tuple:

| kind      | address fields                  |
|-----------|---------------------------------|
| wrldbldr  | Channel, WrldBldrX, WrldBldrY   |
| launchpad | LaunchpadX, LaunchpadY          |
| twister   | Button (logical side button 0..5) |
| generic   | Channel, Cc                     |

Row `editableFields`, column headers, and block address forms all derive
from this one table (plus Press/Release columns appended for system rows).
Twister rows stop advertising Channel — the fixed channel 3 is display-only
in the row label — and the user edits the *logical button number 0..5*
(labeled "Btn"), which the view model stores as `control->cc = 8 + button`;
values outside 0..5 are refused. `FieldShortLabel` supplies the header
strings as today.

### D2 — Canonical ordering: `NormalizeMidiProfileConfig`

A JUCE-free library function sorts, in place: `encoderInput->turns` and
`->pushes` by (slotIx, position); `systemMessages` by `SystemMessageSortKey`
over the *press* message; analog `gestures` by gestureIx.
`SystemMessageSortKey` is a total semantic tuple covering every
`MessageIn::Type` — (type enum order, arg1, arg2, boolKey, address
tie-break) with per-type args:

| type                         | arg1     | arg2      | boolKey                       |
|------------------------------|----------|-----------|-------------------------------|
| SceneSelect                  | sceneIx  | 0         | 0                             |
| SelectParamBank              | slotIx   | bankIx    | 0                             |
| Toggle/SetGestureSelect      | gestureIx| 0         | (hasBoolValue, boolValue)     |
| ToggleReset/Random/RandomMod | 0        | 0         | (hasBoolValue, boolValue)     |
| ParamIncDec / ParamPush      | slotIx   | position  | 0                             |
| SetGestureValue              | gestureIx| 0         | 0                             |
| SetSceneBlend / Start/Stop/Clock | 0    | 0         | 0                             |

so e.g. SetReset(true) vs SetReset(false) press variants order
deterministically. Ties (identical keys) fall to the kind's address tuple,
then to original position (stable sort). The view model
applies it to every config it commits (`ApplyMappingEdit`, add, delete,
block operations, `AddController`), and block reconstruction sorts its input
view defensively, so externally-authored unsorted JSON still reconstructs
correctly and becomes canonical on first edit.

### D3 — Block structs and expansion (pure, JUCE-free)

New header `include/synth/MidiConfigBlocks.hpp` (+ .cpp):

```cpp
struct EncoderBlock {           // turn or push
    bool isPush = false;
    std::uint8_t channel = 0;
    std::uint8_t startCc = 0;   // [startCc, endCc) — count = endCc - startCc
    std::uint8_t endCc = 0;
    std::size_t slotIx = 0;
    std::size_t startPosition = 0;
};
struct AnalogBlock {
    std::uint8_t channel = 0;
    std::uint8_t startCc = 0;   // [startCc, endCc)
    std::uint8_t endCc = 0;
    std::size_t startGestureIx = 0;
};
enum class BlockableMessage { SceneSelect, BankSelect, GestureSelect };
struct SystemBlock {
    MidiProfileKind kind;           // selects the address form
    BlockableMessage message;
    std::size_t startArg = 0;       // scene/bank/gesture start index
    std::size_t bankSlotIx = 0;     // BankSelect only: the target slot
    bool rowMajor = true;           // expansion traversal order (2-D forms)
    bool outputFeedback = true;     // applied to every expanded cell
    std::uint8_t channel = 0;       // wrldbldr + generic forms
    std::uint8_t startCc = 0, endCc = 0;      // generic (1-D) form, [start, end)
    int startX = 0, startY = 0;     // 2-D forms, inclusive corners; int, not
    int endX = 0, endY = 0;         //   uint8: Launchpad legitimately uses
                                    //   y = -1 and x = 8 edge positions.
                                    //   endY may be < startY (rows traverse
                                    //   toward endY, ±1)
};
```

Expansion functions return the exact individual configs a block denotes:
- `ExpandEncoderBlock` → mappings cc→(slotIx, startPosition + (cc-startCc)).
- `ExpandAnalogBlock` → gesture mappings analogous.
- `ExpandSystemBlock` → one association per cell; cells enumerate the cc run
  (generic) or the inclusive rectangle — x ascending within a row, rows
  stepping from startY toward endY (±1) — in row-major (or column-major when
  `rowMajor` is false) order; arg = startArg + cellIndex. Per cell:
  press = the type's message (SceneSelect(arg) / SelectParamBank(bankSlotIx,
  arg) / SetGestureSelect(arg,true)); release = SetGestureSelect(arg,false)
  for GestureSelect, absent otherwise; `feedback` (a required field) = press,
  matching every default factory; `outputFeedback` = the block's flag
  (defaults true; twister's factory convention of false is irrelevant here —
  twister has no blocks); address per the kind's schema (wrldbldr also
  derives `control` = {channel, WrldBldrPositionToCC(x,y)}).

Validation mirrors the existing edit rules (channel 0-15, cc ranges,
coordinates within the kind's shape via `LaunchpadShapeSupports` / the 0-7
WrldBldr grid, arg count fits the catalog-independent index domain).

### D4 — Reconstruction: greedy runs over the sorted view

`ReconstructEncoderBlocks(turns-or-pushes)` — input sorted by (slot, pos):
a maximal run where slot is constant, positions consecutive (+1), channel
constant, and cc consecutive with constant offset becomes a block when its
length ≥ 2; otherwise rows stay individual.

`ReconstructAnalogBlocks(gestures)` — same shape over (gestureIx, cc).

`ReconstructSystemBlocks(associations, kind)` — input sorted per D2:
1. Partition into maximal candidate runs: same blockable press type (and
   same bankSlotIx for BankSelect), args consecutive (+1), release pattern
   consistent (paired set-false for gesture, absent for scene/bank),
   `feedback == press` on every cell, and `outputFeedback` constant across
   the run. Non-blockable types, and cells failing the pattern checks, skip
   straight to individual rows.
2. Within a run, fit greedy rectangles for 2-D kinds: width = the count of
   leading cells sharing startY with x consecutive from startX; the second
   row (if any) fixes the y direction (±1); height = the count of
   consecutive rows that repeat exactly that x-range with y stepping by
   that direction; emit the width×height block if it covers ≥ 2 cells, then
   continue after it. (The ±1 direction is required by the default
   WRLD.Bldr bank layout: banks 0..7 on y=3, banks 8..15 on y=2 — an 8×2
   block with endY < startY.) Generic kind fits maximal consecutive-cc
   strips on one channel. Cells that fit no ≥2 rectangle emit as individual
   rows. Column-major-authored blocks (width > 1) therefore reconstruct as
   one block per column — the presentation is *minimal under this
   x-ascending, y-directional row-major reconstruction*, not globally
   minimal over all block encodings.
3. Twister kind: reconstruction always yields individual rows.

Round-trip property (tested): reconstructing the expansion of any block that
reconstruction itself can produce (row-major, x ascending, y ±1) yields that
block back, and `Expand(Reconstruct(config))` flattened equals the sorted
config exactly — for every config, including ones with duplicate addresses
or duplicate messages (which simply never satisfy the run checks and pass
through as individual rows).

### D5 — Presentation state: built on expand, stable while expanded

`MidiConfigViewModel` gains a per-(controller-name, section) *presentation*:
an ordered list of presentation rows —

```cpp
struct PresentationRow {
    enum class Kind { Individual, Block, ConfigLevel } kind;
    MidiMappingRowVM::RowGroup group;   // drives headers/dividers as today
    // Individual/ConfigLevel: an identity key resolving to the config item;
    // Block: the block struct + the identity keys it covers.
};
```

- Built by reconstruction at the collapsed→expanded transition of
  `ToggleSection` (and discarded on expanded→collapsed). `Rebuild()` (the
  page's dirty tick) re-resolves identities against the new snapshot but
  does NOT re-group rows of an expanded section.
- **Identity keys**, not indices (canonical re-sort on commit shifts
  indices): encoders (isPush, slotIx, position); analog (gestureIx) +
  scene-blend sentinel; system (press sort key *including its address
  tie-break tuple*, plus an occurrence ordinal among exact duplicates) —
  two associations may legitimately map different addresses to the same
  message (two buttons both sending SceneSelect(0)), and even exact
  duplicates must resolve to distinct rows, so the address participates in
  the key and the ordinal breaks residual ties deterministically over the
  sorted config. A key that no longer resolves (item deleted/changed by a
  patch load) drops its row from the presentation on the next re-resolve;
  identities the config has that the presentation lacks (externally added)
  append as individual rows at the end of their group.
- Edits on an individual row work as today (field edit → validated copy →
  commit). Edits on a block row re-validate the whole edited block, then
  commit a config where the block's previous cells are replaced by the new
  expansion (delete old identities, insert new expansion, normalize). The
  presentation keeps that block row in place with updated values.
- Add ("+") appends one new individual config with kind-appropriate free
  defaults (next unused address/arg in its group); add block ("+B") appends
  a block row with editable fields seeded from the next free range, and
  commits its expansion. Both append presentation rows at the end of their
  group — no re-grouping.
- Delete removes an individual row's config, or all of a block's cells, and
  drops the presentation row. Config-level rows (mode, step, scene blend)
  expose no delete.

### D6 — Renderer changes stay thin

`ControllersPage` renders presentation rows: block rows get the block
field set for their form (from D1/D3) via the same NumericFieldEditor /
combo machinery (message type as a 3-choice combo of blockable types;
row-major as a toggle); group header rows gain "+" / "+B" buttons; every
deletable row gets an "x" button. All decisions (what is editable, what a
new row's defaults are, what delete does) come from the view model.

## Risks / Trade-offs

- [Presentation identity resolution across patch loads] → identity keys +
  drop/append re-resolve rule (D5) keeps the page consistent without
  re-grouping; worst case a load reshuffles rows into "individual" until
  the user collapses/expands — accepted by design ("reconstructed when you
  expand").
- [Block edit replaces N configs in one commit] → single EditInstrument
  commit via the existing serialized path; validation happens on the whole
  expansion before any mutation (all-or-nothing).
- [Rectangle detection corner cases] → the run partition (consecutive args)
  bounds the search; property tests pin Expand∘Reconstruct round-trips
  including 1×N, N×1, ragged remainders, and duplicate-address rejection.
- [Twister channel hidden] → label still shows "ch3" read-only; the fixed
  channel remains persisted as-is.

## Open Questions

None blocking — column-major reconstruction (D4) is explicitly out; add-row
default addresses are "next free in group" with ties broken by lowest
address, which the implementer may refine.
