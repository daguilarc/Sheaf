# Disconnected Modulator Depths Design

## Status

Approved in conversation on 2026-07-16.

## Context

A parameter group's modulation view currently materializes a depth parameter for
every configured modulator index. This makes an unregistered modulator appear as
an ordinary connected encoder cell even though its `ModulatorMetadata` is marked
`connected == false` and it has no visualizer.

Disconnected modulator indexes are fixed empty positions, not temporarily
unavailable sources. They should behave like empty top-level bank positions.

## Intended behavior

- Opening a modulation view materializes depth parameters only for connected
  modulator indexes.
- A disconnected index keeps its physical position in the modulation view but
  has no parameter at that position.
- The UI publishes that position as disconnected and draws no encoder state.
- Presses, turns, and held modifier actions on that position do nothing.
- Random Mod selects only connected modulator indexes. If none are connected,
  it is a no-op.
- No saved-data migration or source-reconnection behavior is required.

## Design

Keep the existing sparse bank-cell representation: a modulation-view cell for a
disconnected index has the correct physical encoder ID and a null parameter.
This reuses the same UI publication and input behavior as an empty top-level
position instead of introducing a second UI-connectivity flag.

The bank's modulation-depth helper checks the owning parameter group's live
modulator metadata before returning or creating a depth parameter. If the source
is disconnected, it returns null even if a depth was created explicitly by
programmatic or legacy code. Explicit parameter APIs remain unchanged; the UI
simply does not expose such a route.

Capacity preflight counts only missing depths for connected sources. This keeps
opening a modulation view atomic while avoiding storage requests for empty
positions.

Random Mod builds or samples from the connected modulator indexes only. It does
not materialize or alter depths for disconnected indexes. Existing randomization
probability for the eligible indexes remains otherwise unchanged.

## Scope

The change belongs in the generic parameter-modulation bank code. MiniApp and
Braid4 receive the behavior through their parameter groups without app-specific
branches. DSP registration, modulator processing, standard-modulator defaults,
and serialization formats are unchanged.

## Verification

Tests should establish that:

1. a modulation view leaves disconnected indexes unmaterialized and publishes
   their cells as disconnected;
2. turning, pressing, Reset, and Random on a disconnected position have no
   effect;
3. Random Mod never creates or changes a disconnected depth;
4. capacity preflight counts connected missing depths only;
5. connected indexes retain existing modulation-view and randomization behavior;
6. MiniApp gaps and Braid4's monophonic constant position are blank and have no
   depth parameters.

