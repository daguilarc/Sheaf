## Why

The synth MIDI layer can currently drive and mirror encoder cells, but WRLD.Bldr
use also needs analog controls, system buttons, system-button feedback, and a
single profile factory so apps do not hand-wire controller behavior. This change
makes controller setup declarative and safe against app-specific scene, gesture,
and bank counts.

## What Changes

- Add analog MIDI input processing that maps configured channel/CC pairs to
  gesture value or scene blend messages.
- Add system-button MIDI input processing that maps configured channel/CC pairs
  to press and optional release `MessageIn` commands.
- Harden `MessageInBus`/manager application so out-of-bounds bank, scene, and
  gesture messages are accepted and ignored without changing state.
- Add bank color metadata and publish selected bank, bank colors, and
  gesture-bank-affecting state through manager UI state.
- Add a reusable system-message output-info helper that derives `(color, isOn)`
  for a `MessageIn` from `ParameterManager::UIState`.
- Add CC and WRLD.Bldr-position system output processors that debounce their own
  feedback and mirror configured system-message associations.
- Add MIDI controller profiles that build input chains and output processors
  from shared config, with a default WRLD.Bldr profile for encoders, analogs,
  shift, scene select, bank select, and one momentary gesture selector.
- Update the synth miniapp to create the default WRLD.Bldr profile instead of
  constructing encoder processors directly.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `synth-parameter-modulation`: extend MIDI input/output, manager UI state,
  safe message handling, and miniapp MIDI controller configuration requirements.

## Impact

- Affected code: `projects/synth/include/synth/ParameterModulation.hpp`,
  `projects/synth/src/ParameterModulation.cpp`,
  `projects/synth/include/synth/MidiController.hpp`,
  `projects/synth/src/MidiController.cpp`, synth tests, JUCE MIDI handlers, and
  `projects/synth/miniapp/Main.cpp`.
- Public API impact: additive config structs, processor classes, profile factory
  types, bank color APIs/UI-state fields, and safe out-of-bounds message
  behavior.
- Dependencies: no new runtime dependencies; WRLD.Bldr defaults are source-
  derived from `/Users/joyo/theallelectricsmartgrid`.
