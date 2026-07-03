## Why

The synth control layer currently names the reset modifier "shift", even though its only user-visible behavior is reset. Renaming that concept and adding random/random-mod modifiers makes the bank and encoder workflow match what the controls actually do.

## What Changes

- Rename the existing shift modifier concept to reset across `ParameterManager`, `MessageIn`, UI state, direct routing APIs, tests, and controller/profile usage.
- Add explicit manager state and `MessageIn` types for holding random and random-mod modifiers.
- Add a `GetCurrentModifier` API that returns a single modifier enum: none, reset, random, or random-mod, with random-mod taking precedence over random, and random taking precedence over reset when multiple modifiers are held.
- Change encoder press routing so a normal press opens/closes modulation as today, reset reverts the visible target, random randomizes the visible target knob value without changing modulation, and random-mod applies geometric random modulation to the visible target.
- Change bank selector processing so selecting a bank while a modifier is held applies that modifier to every parameter in the target bank instead of only selecting the bank: reset resets the bank, random randomizes values, and random-mod randomizes modulation.
- Add randomized simulation-style coverage for reset, random, random-mod, and modifier-plus-bank-selection behavior.
- Add WRLD.Bldr default profile mappings for the new random and random-mod controls near the current reset button.
- **BREAKING**: Public C++ symbols and serialized MIDI profile action strings that spell the reset modifier as shift will be renamed or migrated to reset-oriented names.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `synth-parameter-modulation`: rename the shift/reset modifier contract, add random and random-mod modifier semantics, and extend message, manager, bank, encoder, and randomized simulation requirements.

## Impact

- Affected code: `projects/synth/include/synth/ParameterModulation.hpp`, `projects/synth/src/ParameterModulation.cpp`, `projects/synth/include/synth/MidiController.hpp`, `projects/synth/src/MidiController.cpp`, synth miniapp/runtime UI surfaces that display modifier state, synth test support, randomized simulation tests, and WRLD.Bldr profile tests.
- Affected APIs: manager modifier state accessors, `MessageIn::Type`/factory names, bank/slot/manager press routing APIs, profile action serialization strings, and UI-state modifier fields.
- No new external dependencies are expected.
