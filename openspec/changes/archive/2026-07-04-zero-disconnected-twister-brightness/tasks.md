## 1. Regression Coverage

- [x] 1.1 Add or extend a Twister output test for a realized disconnected/empty UI-state cell that asserts the MF Twister brightness-off animation values are emitted with the other blank feedback messages.
- [x] 1.2 Add a Twister output test for a configured output mapping whose slot or position is outside the current `ParameterManager::UIState` capacity, asserting the mapped hardware encoder emits brightness-off animation values and other blank feedback instead of being skipped.
- [x] 1.3 Add or confirm coverage that a Twister encoder with no configured output mapping emits no feedback and requires no blanking.
- [x] 1.4 Assert repeated processing of each disconnected mapped case emits no duplicate feedback until the processor cache is reset or relevant state changes.

## 2. Implementation

- [x] 2.1 Ensure the UI-state lookup used by `MidiOutProcessor` returns stable blank feedback state for mapped hardware encoders whose target slot/position has no backing visible cell, while preserving `std::nullopt` only for transient unstable snapshot reads.
- [x] 2.2 Ensure `TwisterMidiOutProcessor::Process` maps every blank snapshot to value `0`, color `0`, RGB brightness-off value `17`, indicator position `0`, and indicator brightness-off value `65`.
- [x] 2.3 Confirm the per-mapping cache records blank Twister output values so disconnected feedback remains debounced.

## 3. Verification

- [x] 3.1 Run the focused synth parameter modulation test target that covers Twister MIDI output.
- [x] 3.2 Run `openspec status --change "zero-disconnected-twister-brightness"` and confirm the change remains apply-ready.
