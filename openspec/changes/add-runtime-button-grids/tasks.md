## 1. Button-Grid Core

- [x] 1.1 Add failing JUCE-free tests for `GridRange` validation, checked capacity, signed half-open containment, row-major flattening, and independent equal-range slots.
- [x] 1.2 Add the button-grid library module and build wiring, then implement `GridRange`, dense runtime-sized `Grid` cell ownership, `GridSlot`, and `GridManager` creation/access APIs to satisfy the range tests.
- [x] 1.3 Add failing tests for duplicate/out-of-range cell registration, exact-range grid selection, atomic failed selection, disconnected/empty routing, and press/release/pressure callback dispatch; implement those contracts without event-time allocation.
- [x] 1.4 Add failing tests for every `StateCell` mode, normal and flash colors, on/off reporting independent of flash, no-flash/boolean/state-equality flash policies, pressure no-op, and non-ownership; port and adapt `StateCell` to pass them.
- [x] 1.5 Add failing tests for grid UI-state creation/publication, negative-coordinate lookup, `(r,g,b,0|1)` packing, stale-cell clearing after selection, topology freeze, stable object addresses, and allocation-free post-finalization operations; implement finalization and atomic publication.

## 2. Shared Message Model And Bus

- [x] 2.1 Add failing construction and JSON round-trip tests for grid press, release, pressure-change, and select messages, including signed x/y, grid slot/index, velocity bounds, type names, and semantic equality/sort fields.
- [x] 2.2 Extend `MessageIn`, factories, exhaustive type switches, JSON serialization/parsing, descriptions, and canonical sort keys for all grid variants while preserving every existing message representation.
- [x] 2.3 Add failing bus tests for one queue attached to parameter and grid managers, interleaved timestamp/FIFO application, namespace isolation, missing-manager behavior, and invalid-target no-ops; extend `MessageInBus` attachment and dispatch to pass them.
- [x] 2.4 Extend the seeded parameter/message simulation oracle and exhaustive invalid-message coverage so new message variants cannot bypass queue, bounds, or nonthrowing external-input contracts.

## 3. Runtime Ownership And Global UI State

- [x] 3.1 Add failing engine tests for one runtime-owned grid manager, stable parameter-plus-grid UI facade addresses, pre-MIDI grid finalization, both UI/MIDI buses bound to both managers, and destruction after processing shutdown.
- [x] 3.2 Add the internal global runtime UI-state facade while preserving existing application `ParameterManager::UIState` access, then wire `Engine` ownership, construction order, initialization, message pumping, throttled grid publication, and shutdown lifetime.
- [x] 3.3 Update engine/profile-factory wiring to pass the global UI facade to MIDI processors, and prove with existing-app tests that applications defining no grids retain their current initialization, parameter UI state, audio processing, and visible surfaces.

## 4. Polyphonic Pressure And Profile Persistence

- [x] 4.1 Add failing `BasicMidi` tests for polyphonic-aftertouch status `0xA0`, channel/note/pressure access, malformed-message rejection, and distinction from channel pressure and other statuses; implement the minimal MIDI helpers.
- [x] 4.2 Add failing processor tests for mapped pressure stamping, queue push, duplicate-address validation, unmatched and non-pressure thru behavior, and no-thru consumption; implement pressure mapping config and the JUCE-free input processor.
- [x] 4.3 Add failing profile-factory tests for pressure-only and mixed encoder/analog/system/pressure chains; insert the pressure processor into the shared thru chain with the same bus and timestamp provider.
- [x] 4.4 Add failing profile JSON tests for the new pressure config and grid message fields, previous-schema reads with absent pressure data, new-schema writes, nested instrument/runtime-config round trips, signed coordinates, and invalid field rejection; implement the backward-readable schema transition.
- [x] 4.5 Extend normalization, equality, kind validation, and canonical ordering tests and implementation for pressure mappings so semantically equivalent authored orders converge without changing existing mapping order contracts.

## 5. Grid-Aware MIDI Feedback

- [x] 5.1 Add failing `SystemMessageOutputInfo` tests for connected on/off grid cells, negative coordinates, missing slots/cells, packed final-byte interpretation, and proof that evaluation reads only the global snapshot.
- [x] 5.2 Extend system-message output lookup to resolve grid feedback through the global UI facade and return RGB plus explicit `isOn`, leaving all existing bank/scene/gesture/modifier behavior unchanged.
- [x] 5.3 Adapt WRLD.Bldr, Launchpad, and generic/monochrome system-output construction to the new state facade and add byte-for-byte regression tests for output protocols, caches, resets, budgets, and non-grid mappings.

## 6. Controllers Grid Presentation

- [x] 6.1 Add failing pure-model tests for single grid-button and signed rectangular grid-block fields, exclusive-end traversal, physical-to-logical `(x,y)` identity, target grid slot, and all-or-nothing expansion into paired system plus pressure mappings.
- [x] 6.2 Implement grid row/block types and pure expansion helpers for supported WRLD.Bldr and Launchpad address forms, always generating momentary press/release, feedback, and derived pressure with no toggle option.
- [x] 6.3 Add failing reconstruction tests for exact pair recognition, maximal rectangle coalescing, signed/descending ranges, broken-run splitting, duplicate handling, expansion/reconstruction equality, and hidden orphan-pressure preservation; implement canonical reconstruction and session sidecar ownership.
- [x] 6.4 Extend the Controllers view model's stable row identity, open-session editing, add/add-block/delete, validation, flush, and normalization paths so each grid row atomically owns its visible system mappings and derived pressure mappings while unrelated hidden entries remain byte-for-byte intact.
- [x] 6.5 Extend portable Controllers tree fields, labels, action routing, and the JUCE renderer/harness so users see only Grid Button/Grid Block concepts and never note-status or aftertouch line items.
- [x] 6.6 Add deterministic JUCE-free model simulation and JUCE rendering tests covering mixed grid/system rows, edit-session stability, add/edit/delete/reopen, invalid atomic commits, negative bounds, JSON save/reload, scroll reachability, and independent-oracle preservation of hidden pressure data.

## 7. Verification And Documentation

- [x] 7.1 Update synth capability coverage/architecture documentation for the grid core, global runtime UI facade, message routing, pressure profile schema, Controllers derived representation, and realtime allocation contract.
- [x] 7.2 Run focused button-grid, message, MIDI, persistence, engine, Controllers view-model, simulation, and JUCE harness tests; fix failures without weakening existing assertions.
- [x] 7.3 Run the complete synth build and test suite plus formatting/static checks, verify allocation instrumentation for finalized grid operations, and confirm existing MIDI output golden bytes remain unchanged.
- [x] 7.4 Run OpenSpec validation/status for `add-runtime-button-grids`, confirm every normative scenario has implementation coverage, and record any intentionally deferred application-level grid exposure as out of scope rather than incomplete work.
