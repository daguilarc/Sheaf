## Context

`Engine` already owns the grid manager, routes both message buses to it, and
publishes its immutable UI state. Applications currently cannot declare grid
topology because `AppContext` does not expose the runtime-owned manager.
MiniApp's two voices share module parameters but expose independently mutable
prepared VCO input frequencies, which is the correct application-local point
for ratio offsets.

## Goals / Non-Goals

**Goals:**

- Let an application declare fixed grid topology through the runtime context
  before runtime finalization.
- Give MiniApp independent, set-only JI ratio selections for its two VCO
  voices and existing grid feedback.
- Preserve the existing default sound, parameter state, patch data, controller
  profiles, and portable MiniApp surface.

**Non-Goals:**

- Adding on-screen MiniApp grid widgets or new default MIDI mappings.
- Changing grid-manager ownership, allocation/finalization rules, or output
  protocols.
- Persisting ratio selection or representing it as a modulated parameter.

## Decisions

### AppContext exposes the runtime-owned manager

`AppContext` receives a documented non-owning `GridManager*`, initialized by
`Engine` alongside its existing address-stable runtime services. The pointer
is intended for app topology declaration in `Init`, before Engine calls
`CreateUIState` and finalizes the manager. This is preferred to an
app-owned manager because runtime message routing and UI publication remain
single-owner. A dedicated registration callback was rejected because it would
only wrap the same manager surface while obscuring its fixed-topology contract.

### MiniApp uses one fixed 8x2 grid

MiniApp creates one slot and one matching selected grid over `(0,0)`–`(8,2)`.
The ordered columns are `1/2`, `3/4`, `2/3`, `1/1`, `5/4`, `3/2`, `4/3`, and
`2/1`; `6/5` is excluded. Each row shares one `std::size_t` selection value
backing eight `StateCell<std::size_t>` cells in `SetOnly` mode. Both selection
values start at `3` for unity. This guarantees exactly one on cell per row and
uses the reusable cell semantics rather than application-specific callbacks.

### Ratios alter prepared per-voice input, not Tune parameters

After normal parameter/modulation input preparation, MiniApp multiplies each
voice's VCO frequency by its selected ratio before VCO processing. This keeps
the ratio control independent per voice without modifying shared parameter
storage, scenes, gestures, controller routing, or patch persistence.

### Feedback uses existing packed grid UI state

Each ratio gets a stable distinct palette color; `StateCell` uses a dimmed
variant while unselected and the full color while selected. Existing grid UI
publication writes `GetOnOff()` into alpha, so output processors consume the
new cells without a protocol change.

## Risks / Trade-offs

- [An app configures grids after runtime finalization] → `GridManager` already
  rejects late topology mutation; document the context pointer's Init-only use
  and exercise initialization through SynthRig.
- [A ratio accidentally rewrites parameter state] → apply it only to the
  mutable prepared VCO input, with tests showing Tune raw values stay intact.
- [Rows select each other's value] → use two separate backing indices and
  independent row press tests.
- [Startup pitch changes] → initialize both rows to the `1/1` column and
  assert unity frequencies before any press.

## Migration Plan

No stored data migrates. Existing applications receive the additional context
pointer but need not use it; MiniApp alone declares the new topology. Rollback
is removal of the context member and MiniApp setup, with no persistence or
external protocol cleanup required.

## Open Questions

None.
