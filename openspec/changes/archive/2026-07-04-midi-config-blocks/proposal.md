# Proposal: midi-config-blocks

## Why

The Controllers page renders one row per persisted mapping. A real controller
config is dozens of near-identical rows (16 bank buttons, 16 encoder turns,
16 pushes, 8 gesture faders...), which is unusable to read or author. The
persisted model is right — one config per thing — but the *presentation*
needs runs of uniform mappings collapsed into "blocks" (one row describing a
range), reconstructed on demand and never persisted. Separately, the
system-message address code duplicates per-kind field handling and shows dead
columns (e.g. a channel column for kinds with a fixed or absent channel).

## What Changes

- **Address schema abstraction.** A system-message address is a per-kind
  tuple: wrldbldr = (chan, x, y); launchpad = (x, y); twister = (button);
  generic = (chan, cc). One shared schema definition drives row fields,
  column headers, and block address forms — no dead columns per kind
  (twister stops showing an editable channel; its side-button channel is
  fixed).
- **Canonical config ordering.** Committed profile configs are normalized:
  encoder turns/pushes sorted by (slot, position); system messages sorted by
  (message type, message arg); analog gestures sorted by gesture index. This
  makes block runs consecutive and reconstruction deterministic. Persistence
  format is unchanged — only element order within existing arrays.
- **Block presentation model (never persisted).** When a section is
  expanded, the view model reconstructs a block description of the sorted
  config that is minimal under the reconstruction's canonical traversal
  (design D4): runs of uniform mappings become block rows; everything else
  stays individual rows. Blocks expand to exactly their equivalent individual
  configs on commit. Encoder blocks: (chan, start cc, end cc, slot, start
  pos), one each typically for turn and push. System blocks (blockable types
  only — scene select, bank select, gesture select): CC form (chan, start cc,
  end cc, type, start arg); wrldbldr form (chan, start x/y, end x/y, type,
  start arg, row-major); launchpad form the same minus chan; twister has no
  blocks. Analog gesture blocks: (chan, start cc, end cc, start gesture).
  Reset/random/etc. and scene blend are always individual.
- **Stable presentation while expanded.** Blocks are reconstructed only when
  a section is expanded (collapse + re-expand = fresh minimal
  reconstruction). While expanded, edits and additions never re-group the
  presentation — new rows/blocks append where the user put them; the
  presentation is independent of the persisted config's canonical order.
- **Add and delete.** Each mapping group gets "+" (add one config) and,
  where blocks apply, "+B" (add a block) buttons. Individual mapping rows
  and block rows are deletable; config-level rows (encoder mode, turn step,
  scene blend) are not.

## Capabilities

### Modified Capabilities

- `synth-runtime-ui`: the Controllers page's mapping presentation gains the
  block layer, group-level add/delete affordances, and per-kind address
  schemas (sru-5 modified; new requirements for canonical ordering, block
  reconstruction/expansion, presentation stability, and add/delete). The
  JUCE-free view model (sru-7) grows the presentation/block model,
  unit-testable headlessly.

## Impact

- `projects/synth/include/synth` + `src`: new JUCE-free block module
  (reconstruction + expansion pure functions), config normalization helper,
  address-schema helper; `MidiConfigViewModel` gains the expanded-section
  presentation state and add/delete/block edit operations.
- `projects/synth/runtime/ControllersPage.hpp`: renders presentation rows
  (block rows with their own column schema), group headers with +/+B,
  per-row delete buttons.
- `projects/synth/tests`: block reconstruction/expansion truth-table tests,
  normalization tests, presentation-stability tests, updated existing
  view-model tests where twister loses its dead channel column.
- No persistence format change; no engine/audio-path change.
