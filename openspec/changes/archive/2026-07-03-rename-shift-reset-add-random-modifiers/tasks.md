## 1. Focused Coverage

- [x] 1.1 Add unit tests for reset/random/random-mod held state, `GetCurrentModifier` precedence, and idempotent `SetReset`, `SetRandom`, and `SetRandomMod` message handling.
- [x] 1.2 Add unit tests for modifier-aware encoder press behavior: no modifier opens/closes modulation, reset reverts, random randomizes only the visible knob value, and random-mod performs geometric modulation randomization.
- [x] 1.3 Add unit tests for modified `SelectParamBank`: reset, random, and random-mod apply to every top-level parameter in the target bank without changing the selected bank.
- [x] 1.4 Extend deterministic randomized simulation and message-bus UI-state simulation tests to model modifier held state, effective modifier precedence, random samples, modified press actions, and modified bank actions.

## 2. Parameter Modifier Core

- [x] 2.1 Rename the manager's shift-held API/state/UI snapshot contract to reset-held and add independent random-held and random-mod-held state.
- [x] 2.2 Add the manager modifier enum and `GetCurrentModifier`, with precedence random-mod before random before reset before none.
- [x] 2.3 Add a deterministic testable random source for modifier operations, defaulting production behavior to the existing C/C++ random source expectations.
- [x] 2.4 Add parameter/bank helpers for randomizing an active knob value while preserving modulation routes.
- [x] 2.5 Add parameter/bank helpers for geometric random-mod behavior, including materializing missing modulation-depth controls through the existing capacity-checked path.

## 3. Routing And Messages

- [x] 3.1 Rename `MessageIn` shift types/factories and bus handling to reset names, adding any compatibility needed for existing serialized MIDI profile action strings.
- [x] 3.2 Add `MessageIn` types/factories and bus handling for random and random-mod toggle/set messages.
- [x] 3.3 Refactor manager, slot, and bank press routing to remove shift-specific press handlers and dispatch from the current modifier.
- [x] 3.4 Update `ParamIncDec` handling so modified turns are ignored until a future change defines turn behavior.
- [x] 3.5 Update bank-selection message handling so modifier-held selection performs bulk reset/random/random-mod actions on the target bank.

## 4. MIDI, UI, And Profile Integration

- [x] 4.1 Update manager UI state consumers and synth miniapp controls/labels from shift to reset, and expose random/random-mod held feedback where applicable.
- [x] 4.2 Update MIDI controller profile serialization/deserialization action names from shift to reset and add random/random-mod actions.
- [x] 4.3 Add WRLD.Bldr default profile mappings for momentary random and random-mod controls near the reset aux button.
- [x] 4.4 Update SynthRig and other test support helpers from shift-oriented names to reset/modifier-oriented names.

## 5. Verification

- [x] 5.1 Run the focused synth parameter modulation tests.
- [x] 5.2 Run `make synth-test`.
- [x] 5.3 Search `projects/synth` and the affected OpenSpec artifacts for remaining shift-oriented names and update or justify any intentionally retained compatibility references.
- [x] 5.4 Run `openspec status --change "rename-shift-reset-add-random-modifiers"` and confirm the change remains apply-ready.
