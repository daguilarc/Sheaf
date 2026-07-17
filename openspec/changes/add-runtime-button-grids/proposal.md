## Why

The synth runtime can route banks of encoder parameters but has no parallel
abstraction for applications that use button grids, pressure-sensitive pads,
or monochrome button feedback. Adding a runtime-owned grid system lets the
existing controller-profile pipeline address those controls without importing
the fixed dimensions and global buses of the older Smart Grid implementation.

## What Changes

- Add a runtime-owned `GridManager` beside `ParameterManager`, with an
  independent grid/slot number space and dynamically sized slots whose signed
  two-dimensional coordinate ranges always use exclusive maxima.
- Add `Grid`, abstract `Cell`, and reusable `StateCell` types. Grids select into
  slots like parameter banks; cells receive press, release, and pressure-change
  callbacks and publish both color and on/off state.
- Add initialization-sized grid UI state. Each selected slot publishes a dense
  color array, with the cell's on/off value encoded in the final byte of its
  color, for both colored and monochrome controller feedback.
- Extend the shared message input path with grid press, release,
  pressure-change, and grid-select messages that route through `GridManager`.
- Extend MIDI input configuration and processing with polyphonic-aftertouch
  mappings, and make grid blocks/single grid buttons expand into ordinary
  press/release/feedback associations plus derived aftertouch mappings.
- Make Controllers configuration reconstruct those underlying mappings back
  into grid blocks or single grid buttons, preserving round trips while keeping
  aftertouch implementation details out of the user-visible model.
- Let existing MIDI output processors resolve grid feedback from the runtime's
  global UI state without changing controller output protocols.
- Add focused unit, round-trip, integration, and allocation-safety coverage.
  No application creates or displays a grid as part of this change.

## Capabilities

### New Capabilities

- `synth-button-grid-runtime`: defines grid manager ownership, signed half-open
  slot geometry, grids and cells including `StateCell`, input routing, and
  initialization-sized grid UI-state publication.

### Modified Capabilities

- `synth-parameter-modulation`: extends the shared `MessageIn`/`MessageInBus`
  and MIDI controller-profile contracts with grid messages, polyphonic
  aftertouch, grid feedback lookup, and persisted mapping round trips.
- `synth-app-runtime`: makes the engine own and pump the grid manager beside the
  parameter manager and publish both through the runtime UI snapshot used by
  MIDI processors.
- `synth-runtime-ui`: adds grid blocks and single grid buttons to Controllers
  configuration while hiding their derived aftertouch mappings.

## Impact

- `projects/synth/include/synth` and `projects/synth/src`: new button-grid core
  types; shared message-bus, MIDI processor, profile, JSON, and block-model
  extensions.
- `projects/synth/include/synth/Engine.hpp` and runtime context/UI-state wiring:
  runtime ownership, initialization, message pumping, and UI publication for
  the grid manager.
- Controllers view-model and portable/JUCE page code: user-visible grid mapping
  rows and blocks, with canonical expansion and reconstruction.
- Synth unit, engine, controller-profile, persistence, UI, and simulation tests.
- MIDI controller profile JSON gains grid-derived polyphonic-aftertouch mapping
  data; readers and writers must preserve the new data exactly.
- No new external dependency, no patch-format change, and no application-level
  grid surface in this change.
