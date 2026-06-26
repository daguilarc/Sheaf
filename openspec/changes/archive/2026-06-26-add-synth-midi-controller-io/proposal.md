## Why

The synth parameter system now has a general `MessageInBus`, slot-position routing, and a JUCE miniapp, but it cannot yet talk to real encoder controllers. This change ports the useful MIDI controller semantics from The All Electric Smart Grid into the more general synth library so hardware encoders can drive and mirror parameter state without importing Smart Grid routing assumptions.

## What Changes

- Add a JUCE-free `BasicMidi` value type to the synth library, semantically ported from Smart Grid but without route IDs.
- Add a chainable `MidiInProcessor` abstraction that receives `BasicMidi` off the audio thread, owns a `MessageInBus*`, and can pass unused messages to an optional thru processor.
- Add an encoder MIDI input processor with explicit controller mapping config from CC/channel pairs to `(slotIx, position)` and pushbutton CC/channel pairs to parameter push messages.
- Add `TwisterDefault` and `WrldBldrDefault` encoder presets based on Smart Grid: encoder turns on channel 0, pushbuttons on channel 1, CCs 0-15 laid out as a 4x4 controller grid, with signed-7-bit relative turn decoding as the default.
- Add a JUCE `MidiInHandler` that owns a `MidiInProcessor`, opens MIDI input devices, converts JUCE MIDI into `BasicMidi`, and exposes enough device/open/close state for later config pages or patch reloads.
- Add a MIDI sender thread and output-side processor abstraction that enqueue outgoing `BasicMidi` from message-thread/UI-state processing instead of audio-thread dispatch.
- Add separate Twister and Wrld.Bldr MIDI output processors for encoder value/color feedback because their color and SysEx protocols differ.
- Hook the MIDI processors into the synth miniapp behind a small configuration page where the user can choose a controller preset, input device, and output device, then control the miniapp encoders from hardware.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `synth-parameter-modulation`: extend the synth external UI/message layer with MIDI encoder input, MIDI encoder output feedback, JUCE MIDI transport handlers, and miniapp hardware-controller configuration.

## Impact

- Core synth library: `projects/synth/include/synth/ParameterModulation.hpp`, `projects/synth/src/ParameterModulation.cpp`, and likely a new JUCE-free MIDI header/source pair under `projects/synth/include/synth/` and `projects/synth/src/`.
- JUCE layer: new reusable MIDI handlers/processors under `projects/synth/juce/`, kept outside core synth headers and sources.
- Miniapp: `projects/synth/miniapp/Main.cpp` and `projects/synth/miniapp/Makefile` gain MIDI configuration UI, device opening, processor registration, and periodic MIDI output processing.
- Tests: core unit coverage for MIDI message decoding, mapping, thru chaining, output diff/debounce behavior, and sender queue ordering; miniapp/JUCE build coverage where local JUCE is available.
- External source material: The All Electric Smart Grid files `private/src/BasicMidi.hpp`, `private/src/EncoderMidi.hpp`, `private/src/WrldBLDRMidi.hpp`, `JUCE/SmartGridOne/Source/MidiHandlers.hpp`, `JUCE/SmartGridOne/Source/MidiSender.hpp`, and `JUCE/SmartGridOne/Source/NonagonWrapper.hpp`.
