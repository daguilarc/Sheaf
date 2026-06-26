## 1. Core MIDI Model

- [x] 1.1 Add JUCE-free `synth::BasicMidi` with timestamp, raw bytes, size, status/channel/data helpers, CC/note/realtime constructors, and no route field.
- [x] 1.2 Update `projects/synth/Makefile` so new synth MIDI source files build into `libsynth.a` and parameter modulation tests link them.
- [x] 1.3 Add unit tests for `BasicMidi` CC, note-on/note-off, pitch bend if included, and supported realtime message size/status behavior.

## 2. MIDI Input Processors

- [x] 2.1 Add abstract `synth::MidiInProcessor` with `MessageInBus*`, configurable bus-domain timestamp provider, optional `MidiInProcessor* thru`, `SetMessageInBus`, `SetThru`, and virtual `Process(BasicMidi)`.
- [x] 2.2 Add encoder input config types for turn mappings, push mappings, relative mode, normalized `turnStep` defaulting to `1 / 128`, bus-domain timestamp provider, and helper constructors for row-major 4x4 mappings.
- [x] 2.3 Implement `synth::EncoderMidiInProcessor` that converts mapped turn CCs to `MessageIn::ParamIncDec`, mapped nonzero push CCs to `MessageIn::ParamPush`, and passes unused messages to thru.
- [x] 2.4 Implement `TwisterDefault(slotIx)` and `WrldBldrDefault(slotIx)` with channel 0 turns, channel 1 pushbuttons, CCs 0-15, row-major positions 0-15, and signed-7-bit relative mode.
- [x] 2.5 Verify `WrldBldrDefault` input layout against `/Users/joyo/theallelectricsmartgrid/private/src/WrldBLDRMidi.hpp` and adjust the preset if Smart Grid differs from the Twister encoder path.
- [x] 2.6 Add unit tests for scaled signed-relative mode, scaled direction-only mode, default turn step, timestamp-provider normalization, pushbutton behavior, unmapped/thru behavior, incomplete maps, and multi-slot maps.

## 3. MIDI Output Core

- [x] 3.1 Add a JUCE-free MIDI output sink interface and queued `synth::MidiSender` thread for `BasicMidi` delivery to a sink without caller-side device I/O.
- [x] 3.2 Add abstract `synth::MidiOutProcessor` with sender, `ParameterManager::UIState*`, reset, and `Process()` contract intended for message-thread/UI refresh calls.
- [x] 3.3 Add output mapping config from `(slotIx, position)` to controller CC, including helpers for row-major 4x4 slot maps and incomplete maps.
- [x] 3.4 Add a reusable UI-state cell snapshot helper for MIDI output processors that follows `Parameter::UIState::revision` retry semantics, skips a cell without cache updates when the bounded retry count is exhausted, and reduces hardware feedback to voice-0 value, parameter-level color, and voice-0 indicator color.
- [x] 3.5 Implement Twister output feedback for mapped connected encoder cells: channel 0 voice-0 value, channel 1 parameter color code, channel 2 connected full-brightness animation value, with cached debounce and reset re-render.
- [x] 3.6 Implement Wrld.Bldr output feedback for mapped connected encoder cells: voice-0 CC value feedback plus Yaeltex-compatible parameter button and voice-0 indicator color SysEx packets, budget/cooldown, cached debounce, and reset re-render.
- [x] 3.7 Add unit tests using a fake output sink for sender FIFO delivery, sender stop/join and double-stop lifecycle behavior, processor debounce, reset re-render, disconnected/unmapped silence, revision-retry snapshot behavior, exhausted-retry skip behavior, Twister channel conventions, and Wrld.Bldr exact source-derived SysEx/value golden output.

## 4. JUCE MIDI Layer

- [x] 4.1 Add `projects/synth/juce/MidiHandlers.hpp` or equivalent with `synth_juce::MidiInHandler` that owns a `std::unique_ptr<synth::MidiInProcessor>`.
- [x] 4.2 Implement JUCE input open/close, device identifier/name state, `isOpen`/last error reporting, and conversion from 3-byte and supported one-byte realtime JUCE MIDI to `synth::BasicMidi`.
- [x] 4.3 Add JUCE MIDI output sink/handler that opens and closes `juce::MidiOutput`, exposes open state, and sends queued `BasicMidi` as `juce::MidiMessage`.
- [x] 4.4 Ensure JUCE input callbacks push only to a dedicated MIDI `MessageInBus` or another externally serialized producer path, never to a bus that also accepts message-thread UI pushes.
- [x] 4.5 Update the miniapp Makefile dependencies so the new JUCE MIDI headers are included in app and test rebuilds.

## 5. Miniapp Integration

- [x] 5.1 Extend the miniapp UI with a compact config page or tab for controller preset selection, MIDI input device selection/open/close, and MIDI output device selection/open/close.
- [x] 5.2 Instantiate a dedicated MIDI `MessageInBus`, bind the selected preset's `EncoderMidiInProcessor` to that bus with an immediate bus-domain timestamp provider, and install it into `MidiInHandler`.
- [x] 5.3 Instantiate the selected preset's Twister or Wrld.Bldr `MidiOutProcessor`, bind it to the miniapp `ParameterManager::UIState`, and connect it to the JUCE output sink through `MidiSender`.
- [x] 5.4 Ensure the miniapp's current three-encoder demo slot uses a trimmed map for positions 0-2 while keeping the library presets capable of mapping positions 0-15.
- [x] 5.5 Drain the existing UI message bus and the dedicated MIDI message bus sequentially on the miniapp timer before compute/populate, preserving the SPSC contract for each bus.
- [x] 5.6 Call MIDI output processing after `manager_.PopulateUIState(*uiState_)` in the timer callback, so hardware feedback follows the same UI-state snapshot as the on-screen encoders.
- [x] 5.7 Preserve existing miniapp on-screen controls when no MIDI devices are open or a MIDI device fails to open.
- [x] 5.8 Stop/join `MidiSender` and close open JUCE MIDI input/output devices during miniapp shutdown and when MIDI output is disabled.

## 6. Verification

- [x] 6.1 Run `make -C projects/synth test` and fix any failures.
- [x] 6.2 Run `make -C projects/synth miniapp` when `~/JUCE` is available, or confirm the documented missing-JUCE error when it is not.
- [x] 6.3 Run `make -C projects/synth/miniapp test` when `~/JUCE` is available, or confirm the documented missing-JUCE error when it is not.
- [x] 6.4 Manually smoke the miniapp with a MIDI controller when hardware is available: not run in this session because no physical Twister/Wrld.Bldr controller was available to the agent; compile-time and no-hardware behavior were verified.
- [x] 6.5 Update `openspec/changes/add-synth-midi-controller-io/tasks.md` checkboxes as implementation tasks complete.
