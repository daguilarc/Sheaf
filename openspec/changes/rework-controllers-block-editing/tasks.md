## 1. Regression Tests First

- [x] 1.1 Add JUCE-free view-model regression tests for stable open-section rows: add two compatible singleton system-message rows, verify they do not coalesce while open, then close/reopen and verify they coalesce.
- [x] 1.2 Add JUCE-free view-model regression tests for block edit flush: editing a block updates that session row in place, expands to normalized persisted config, and does not re-coalesce visible rows.
- [x] 1.3 Add JUCE-free view-model regression tests for add/delete semantics: "+" and "+B" append to the requested open-session group, delete removes exactly the targeted singleton or block, and config-level rows remain non-deletable.
- [x] 1.4 Add portable UI/JUCE layout regression tests for large expanded controller sections: scroll nodes expose visible viewport and content extent separately, and the final rendered row is reachable without clipping.
- [x] 1.5 Add system-message editor tests proving message kind choices are argument-free labels ("Scene Select", "Bank Select", "Gesture Select") with separate argument fields, and no option label contains values such as "Scene Select 3".
- [x] 1.6 Add shared-pipeline tests that exercise WRLD.Bldr, Launchpad, MF Twister, and Generic system-message rows through common expectations, with only address field shape varying by kind.

## 2. Edit-Session Model

- [x] 2.1 Introduce a JUCE-free controller config edit-session type that owns open section rows keyed by stable controller identity and section.
- [x] 2.2 Split pure coalesce/open logic from pure expand/flush logic: coalescing only creates session rows from normalized persisted arrays on section open; expansion only projects current session rows back to persisted arrays on commit.
- [x] 2.3 Move `MidiConfigViewModel::SectionRows` to render stored session rows while a section is open, and remove ordinary edit-flow dependence on identity re-resolution against normalized persisted arrays.
- [x] 2.4 Make view-model rebuild preserve compatible open sessions without re-coalescing, and discard an open session only when the controller/kind/section no longer matches the live instrument.

## 3. Row Operations and System Messages

- [x] 3.1 Rework mapping field edits so accepted edits mutate the target session row, validate the expanded candidate section, flush normalized persisted config, and leave refused edits with session and persisted state unchanged.
- [x] 3.2 Rework "+" and "+B" to append singleton/block session rows to the end of the requested group before flushing, including first-add creation of absent encoder/analog containers.
- [x] 3.3 Rework delete to remove exactly the targeted session row and flush the remaining session rows, including block deletion as removal of all cells represented by that block.
- [x] 3.4 Replace singleton system-message catalog choices with shared message-kind and argument fields for scene select, bank select, and gesture select.
- [x] 3.5 Consolidate WRLD.Bldr, Launchpad, MF Twister, and Generic system-message row/block editing into one shared pipeline parameterized by address schema and address validation.

## 4. Portable Tree and JUCE Renderer

- [x] 4.1 Extend the portable scroll-area node contract to carry visible viewport bounds and scroll content extent separately.
- [x] 4.2 Update `ControllersPageUI` layout so expanded sections compute stable content extents without mutating visible viewport height.
- [x] 4.3 Update the JUCE Controllers page renderer to set viewport bounds from visible bounds and content component size from content extent.
- [x] 4.4 Ensure button, combo, text-field, and toggle actions refresh the surface immediately after accepted state changes without requiring a second click or focus bounce.

## 5. Model-Based Simulation

- [ ] 5.1 Replace the current broad random-click simulation with an oracle-driven simulation model of persisted arrays, open sessions, expanded/collapsed state, and scroll position.
- [ ] 5.2 Generate replayable random actions for opening/closing nested sections, adding singleton rows, adding block rows, deleting rows, editing row fields, changing system-message kind/arguments, and scrolling.
- [ ] 5.3 After every simulation step, assert implementation session rows match oracle rows, persisted arrays match oracle expansion normalized, rendered tree controls match the oracle, and scroll extent/bottom reachability invariants hold.
- [ ] 5.4 Print failing seed and action index, accept a seed override for local replay, and promote discovered regressions to named deterministic tests.

## 6. Harness, Verification, and Cleanup

- [x] 6.1 Keep the standalone Controllers harness wired to the production view model and renderer so visual iteration exercises the same edit-session model as tests.
- [ ] 6.2 Use the harness to inspect the Controllers page with large WRLD.Bldr, Launchpad, Twister, and Generic fixtures; refine layout only where it improves clarity without changing required behavior.
- [ ] 6.3 Remove obsolete identity re-resolution/re-coalescing code paths and comments that contradict open-session semantics.
- [x] 6.4 Run `make -C projects/synth test`, the JUCE Controllers page tests/simulation, and the controllers harness build.
- [x] 6.5 Update OpenSpec task checkboxes only after implementation, review, and verification pass.
