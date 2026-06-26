## 1. Slot-shaped modulation view

- [x] 1.1 Add tests proving a three-position slot with one modulator places the depth cell at position 0, leaves position 1 disconnected, and places the return cell at position 2.
- [x] 1.2 Add tests proving opening a modulation view is a configuration error when a slot has no spare final position after all modulators.
- [x] 1.3 Update `Bank`/`BankSlot` press routing so slot-routed presses pass physical slot layout and direct bank presses retain compact fallback behavior.
- [x] 1.4 Update randomized simulation oracle for the new slot-shaped return-cell placement.
- [x] 1.5 Run `make -C projects/synth test`.
- [x] 1.6 Run `openspec validate place-modulation-back-button-at-slot-end` and mark tasks complete.
