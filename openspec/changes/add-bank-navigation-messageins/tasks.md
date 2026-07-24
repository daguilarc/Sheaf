## 1. Regression Tests First

- [ ] 1.1 Add focused `MessageIn` and `MessageInBus` tests for next/previous factories, forward/backward movement, wrapping at both ends, a one-bank range, and slot-only message arguments.
- [ ] 1.2 Add focused tests proving reset, random, and random-mod next/previous actions modify the current bank through existing modifier behavior and never change selection.
- [ ] 1.3 Add mutation-free no-op tests for an invalid slot, no manager banks, no selected bank, and a selected bank not owned by the manager.
- [ ] 1.4 Add MIDI profile tests for `nextParamBank`/`prevParamBank` JSON and in-memory round trips, message equality/sorting, direction-and-slot descriptions, and default-off output-info evaluation.
- [ ] 1.5 Add JUCE-free controller view-model tests for Next Bank/Previous Bank catalog choices, slot-as-Arg editing and kind conversion, absent releases, feedback mirroring, canonical ordering, and non-blockable individual-row reconstruction.

## 2. Relative Bank Runtime

- [ ] 2.1 Add `NextParamBank` and `PrevParamBank` enum cases and factories that store `slotIx` without a bank index.
- [ ] 2.2 Add one `ParameterManager` relative-bank operation that resolves the current manager-owned bank, applies the effective modifier to it when present, and otherwise selects the explicitly wrapped neighbor without unsigned underflow.
- [ ] 2.3 Route both new types through `MessageInBus` and preserve mutation-free no-op behavior for invalid or incomplete state.

## 3. Persistence, Feedback, and Controller Configuration

- [ ] 3.1 Add `nextParamBank` and `prevParamBank` type-name serialization/parsing and update every message comparison, equality, sorting, and profile-validation switch that requires the new slot argument.
- [ ] 3.2 Treat relative bank output info as a stateless off action and add readable direction-and-slot message descriptions.
- [ ] 3.3 Add Next Bank and Previous Bank to the shared system-message catalog and conversion switches, using `slotIx` as the primary `Arg`, no release, and an unchanged press-shaped feedback message.
- [ ] 3.4 Keep both message kinds outside block reconstruction while preserving canonical individual-row round trips for every controller kind.

## 4. Deterministic Simulation Coverage

- [ ] 4.1 Extend the message-driven randomized parameter simulation and its independent oracle with next/previous movement, wrapping, current-bank modifier actions, invalid states, replayable seeds, and failure traces.
- [ ] 4.2 Extend the deterministic controller view-model simulation and oracle with add, kind conversion, slot edit, rebuild, ordering, and delete actions for relative bank mappings.

## 5. Verification

- [ ] 5.1 Run the focused synth tests while iterating, then run `make -C projects/synth test`.
- [ ] 5.2 Audit exhaustive `MessageIn::Type` and `UISystemMessage` switches and confirm existing absolute bank-selection behavior and profile compatibility remain unchanged.
- [ ] 5.3 Run `openspec status --change "add-bank-navigation-messageins"` and mark task checkboxes complete only after implementation, review, and verification pass.
