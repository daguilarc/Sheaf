## Why

Synth encoder input currently assumes every turn CC is relative, so a controller that reports an absolute 7-bit position cannot set a parameter to the value represented by its hardware position. Treating that position as an ordinary delta is also insufficient because the existing scene and gesture distribution deliberately attenuates effective motion at intermediate blends; an absolute control instead needs an exact-target edit that preserves those distributions.

## What Changes

- Add an `Absolute` encoder input mode alongside signed-7-bit and direction-only relative modes. A mapped absolute turn CC emits a normalized parameter-set message with value `midiValue / 127` rather than an increment/decrement message.
- Add `ParamSetAbsolute` messaging and parallel manager, bank-slot, bank, and parameter routing, gated by modifiers in the same way as ordinary turns.
- Add `Parameter::HandleSetAbsolute`, which first arms selected inactive gestures and then moves the contributing scene centers and active gesture values through a range-constrained weighted projection whose resulting effective parameter value is exactly the incoming target within the specified floating-point tolerance. Active gestures participate regardless of current selection.
- **BREAKING**: Rename the C++ `EncoderRelativeMode`/`relativeMode` API to the semantically accurate `EncoderMode`/`mode`. Persist new profiles with a `mode` field while continuing to load legacy `relativeMode` fields and values.
- Extend the Controllers editor to present and persist the third encoder mode while retaining `turnStep` for relative modes and ignoring it in absolute mode.
- Preserve existing relative-turn distribution, built-in controller defaults, parameter-value persistence, and MIDI output feedback behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `synth-parameter-modulation`: Add absolute encoder decoding, exact-target parameter messaging and routing, exact scene/gesture distribution, and compatible MIDI profile persistence.
- `synth-runtime-ui`: Add the absolute choice to the Controllers editor's encoder-mode field and preserve it through the existing edit-session workflow.

## Impact

- `projects/synth/include/synth/ParameterModulation.hpp` and `projects/synth/src/ParameterModulation.cpp`: new message, routing APIs, and exact-target parameter edit.
- `projects/synth/include/synth/MidiController.hpp` and `projects/synth/src/MidiController.cpp`: encoder-mode API, absolute CC conversion, and compatible JSON loading.
- `projects/synth/include/synth/MidiConfigViewModel.hpp`, `projects/synth/src/MidiConfigViewModel.cpp`, `projects/synth/src/MidiConfigBlocks.cpp`, and Controllers-page rendering/tests: exhaustive message handling, three-value mode catalog, and edit-session integration.
- `projects/synth/tests`: mathematical exactness, saturation, routing, MIDI conversion, persistence compatibility, editor, and relative-mode regression coverage.
- The in-progress `rework-controllers-block-editing` change remains the source of truth for Controllers-page edit sessions; this change extends that model rather than introducing a second editor path.
