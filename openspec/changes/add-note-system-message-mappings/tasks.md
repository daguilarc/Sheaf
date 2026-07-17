## 1. Typed Button Addresses

- [ ] 1.1 Add focused tests for CC/note address matching, raw `0x90` zero-velocity note-on, nonzero-velocity note-off, press/release classification, and message-type mismatches.
- [ ] 1.2 Extend the MIDI control address and encoder/system input processors to support note-addressed pushes and Generic system messages, classifying note-off by status, while leaving turns and analogs CC-only.
- [ ] 1.3 Add JSON round-trip and legacy-load tests, then persist the address message type with missing values defaulted to CC.
- [ ] 1.4 Add instrument profile address-type validation tests and rules so note addresses are accepted only for encoder pushes and Generic system-message controls.
- [ ] 1.5 Add output-construction tests and suppress CC output feedback for note-addressed Generic system-message associations.

## 2. Controllers Page Editing

- [ ] 2.1 Add block/coalescing tests proving message type participates in ordering, equality, expansion, and mixed-type block boundaries.
- [ ] 2.2 Carry message type through encoder-push and Generic system-message row and block models without changing CC-only row schemas.
- [ ] 2.3 Add view-model tests and expose a distinctly named address-type Note/CC selector plus numeric channel and number fields for the affected rows.
- [ ] 2.4 Wire the portable/JUCE Controllers page controls to display and commit the new field through the existing edit-session path.

## 3. Verification

- [ ] 3.1 Run the focused processor, persistence, instrument, block, view-model, and Controllers page test suites.
- [ ] 3.2 Run the full synth test target and update synth capability coverage documentation for `spm-80`, `smi-9`, and `sru-27`.
