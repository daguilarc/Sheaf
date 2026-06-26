## Context

The synth library already has the important internal contract for hardware control:
`MessageIn` addresses parameters by `(slotIx, position)`, and `BankSlot` resolves that
position through its `AddPhysicalEncoder` order to a physical encoder ID and selected
bank. The miniapp currently creates one slot with three physical encoders `{10, 11, 12}`
and sends messages from on-screen encoders through `MessageInBus`.

The All Electric Smart Grid is the source material for the MIDI semantics. The relevant
parts are:

- `BasicMidi`: a tiny timestamped MIDI message wrapper with CC/note/realtime helpers.
- `EncoderMidi`: maps 4x4 CC positions to encoder turn/push messages. Smart Grid uses
  channel 0 for turns, channel 1 for pushbuttons, and CC 0-15 as a 4x4 grid.
- `MidiInputHandler`: JUCE callback wrapper that converts 3-byte MIDI and realtime
  one-byte MIDI to `BasicMidi`.
- `MidiSender`: a queued sender thread that drains `BasicMidi` to output handlers.
- `EncoderMidiWriter` and `WrldBLDRMidiWriter`: separate output feedback protocols.

This library is more general than Smart Grid, so the port keeps MIDI values and
processor contracts in synth code, keeps JUCE device ownership in the JUCE layer, and
does not add Smart Grid route IDs.

## Goals / Non-Goals

**Goals:**

- Provide a JUCE-free MIDI value type and input/output processor model for synth
  parameter controllers.
- Make encoder input map controller CCs to specific `(slotIx, position)` addresses.
- Support incomplete and multi-slot controller maps without requiring every 4x4 CC to
  be connected.
- Provide Twister and Wrld.Bldr defaults based on Smart Grid's hardcoded encoder MIDI
  behavior.
- Make output feedback read `ParameterManager::UIState` from message-thread/UI refresh
  code and enqueue MIDI to a sender thread.
- Keep Twister and Wrld.Bldr output processors separate because their color and SysEx
  protocols are different.
- Add a miniapp configuration page that opens real MIDI devices and wires the selected
  preset to the existing demo parameter slot.

**Non-Goals:**

- No pad/grid, analog, transport-clock, Launchpad, or KMix support beyond accepting
  realtime statuses where already useful.
- No patch serialization of MIDI configuration in this change.
- No audio-thread MIDI output dispatch.
- No automatic MIDI learn.
- No dynamic controller discovery beyond exposing JUCE device lists and opening selected
  devices in the miniapp.

## Decisions

1. **Add `synth::BasicMidi` without route IDs.**
   Smart Grid embeds `m_routeId` because its adapters multiplex several controller
   routes. The synth message system already addresses parameter slots explicitly, and
   JUCE output devices are owned by separate handlers. `BasicMidi` should contain only
   timestamp, raw bytes, size/status helpers, and constructors such as `CC`, `Note`,
   `Clock`, `TransportStart`, `TransportStop`, and `Realtime`.

2. **Keep core MIDI processors JUCE-free.**
   `MidiInProcessor`, `EncoderMidiInProcessor`, `MidiSender`, `MidiOutProcessor`,
   `TwisterMidiOutProcessor`, and `WrldBldrMidiOutProcessor` live in the synth library
   and speak only `BasicMidi`, `MessageInBus`, and `ParameterManager::UIState`. JUCE
   handlers adapt OS devices to those abstractions.

3. **Make controller mapping explicit and slot-position based.**
   An encoder input config should contain turn mappings and push mappings:
   `(channel, cc) -> (slotIx, position)`. A controller can therefore map several slots
   or leave positions unmapped. A received CC with no mapping is unused and should be
   offered to the processor's thru chain.

4. **Support two relative turn modes.**
   The default mode is Smart Grid/Twister compatible: delta is `value - 64`, so values
   below 64 decrement and values above 64 increment by magnitude. The alternate mode
   ignores magnitude: values greater than 64 produce `+1`, values less than 64 produce
   `-1`, and value 64 produces no message.

5. **Scale relative encoder ticks before creating `ParamIncDec`.**
   `MessageIn::ParamIncDec` deltas are normalized parameter-space increments, not raw
   MIDI tick counts. Encoder input config therefore carries `turnStep`, defaulting to
   `1.0f / 128.0f`, and relative decoding produces `rawTick * turnStep`. This keeps a
   single detent small, while still preserving magnitude in signed-7-bit mode.

6. **Model pushbutton CCs as `ParamPush` only on nonzero values.**
   The current synth message model has `ParamPush` but no `ParamRelease`, and the user
   requested encoder-only behavior. The input processor should ignore pushbutton zero
   values unless a later change adds release semantics.

7. **Do not push MIDI input into the miniapp UI bus from the MIDI callback.**
   `MessageInBus` is explicitly single-producer/single-consumer. The miniapp's existing
   `bus_` is produced by message-thread UI controls and consumed by the timer, so MIDI
   input must not share it as a second producer. JUCE `MidiInHandler` should instead
   own a separate MIDI `MessageInBus` for the selected input processor. That MIDI bus
   has one producer, the JUCE MIDI callback, and one consumer, the miniapp timer. The
   timer drains the UI bus and the MIDI bus sequentially into the same `ParameterManager`.
   Non-miniapp callers can use the same pattern or externally serialize producers before
   sharing a bus.

8. **Normalize MIDI input timestamps into the target bus domain.**
   `BasicMidi` keeps the source timestamp for diagnostics and tests, but
   `EncoderMidiInProcessor` should stamp created `MessageIn` values with a bus-domain
   timestamp from configuration. The miniapp uses an immediate timestamp provider that
   returns `0`, so hardware input drains on the next timer call without head-of-line
   blocking behind wall-clock JUCE timestamps. Callers that have an audio or transport
   timeline can provide a different monotonic bus-domain timestamp source.

9. **Run output processing from UI/message-thread code.**
   The miniapp already ticks on a JUCE timer, processes `MessageInBus`, computes
   parameters, and populates UI state. After `PopulateUIState`, it can call the selected
   `MidiOutProcessor::Process()` to diff/debounce and enqueue feedback. The sender
   thread owns the blocking/device-send boundary.

10. **Use a sender sink interface rather than making core code depend on JUCE.**
   `MidiSender` can own a bounded queue of `BasicMidi` and an `IMidiOutputSink*`.
   The JUCE layer implements the sink by opening a `juce::MidiOutput` and sending
   `juce::MidiMessage`. This keeps core tests independent of `~/JUCE` and lets the
   miniapp supply the real device.

11. **Reduce multi-voice UI state to one hardware encoder signal deterministically.**
   Hardware encoder feedback has one value and a small number of LEDs, while
   `Parameter::UIState` exposes per-voice values and indicator colors. For this change,
   output processors use voice 0 as the hardware value source, the parameter-level
   `color` as the main encoder/button color, and `indicatorColors[0]` as the
   Wrld.Bldr indicator color when present. Twister channel 2 brightness is treated as a
   connected/on animation value: connected cells send the Smart Grid full-brightness
   animation value, disconnected cells send no feedback.

12. **Use the same UI-state snapshot protocol as the JUCE encoder component.**
   Output processors must read `Parameter::UIState::revision` before and after loading
   connectedness, voice count, value, color, indicator color, and switch fields, retrying
   when the revision is odd or changed. This mirrors `EncoderComponent::LoadSnapshot`
   and avoids emitting feedback from torn UI-state reads. If the snapshot never
   stabilizes after the bounded retry count, the processor skips that cell for this
   process call without updating its debounce cache.

13. **Debounce at the processor layer.**
   Output processors store the last sent state for each mapped cell and emit only when
   connectedness, voice-0 value, color, brightness/color-derived fields, or
   required WRLD.Bldr cooldown state says a send is needed. Resetting a processor clears
   this cache so opening a device or changing preset re-renders hardware state.

## Risks / Trade-offs

- **WRLD.Bldr SysEx color mapping is easy to under-specify** -> Port its encoder
  color/indicator packet shape directly from Smart Grid and keep it separate from the
  Twister writer.
- **Core `std::thread` sender timing will not exactly match Smart Grid's JUCE realtime
  thread** -> This change prioritizes message-thread feedback and nonblocking device
  sends over sub-millisecond audio timing. The sender only needs FIFO queued delivery
  for controller feedback in this change; clock-accurate scheduled sends are out of
  scope.
- **Miniapp slot has only three visible positions** -> Presets can expose all 16 CCs,
  but only configured slot positions should produce messages/output. The demo can map
  CC 0-2 initially, while the library defaults remain 0-15.
- **Output processors read atomics while the UI state changes** -> The existing UI-state
  contract is atomic and uses a revision seqlock for multi-field snapshots. Processors
  should reuse that protocol before comparing and sending.
- **Device open failures are common during local development** -> JUCE handlers should
  expose failed open state without breaking the miniapp, and tests should cover core
  processor behavior without requiring MIDI hardware.

## Migration Plan

This is additive. Existing parameter modulation, message-bus, and miniapp interactions
continue to work without MIDI devices. If a problem appears, callers can leave MIDI
handlers unopened or avoid constructing MIDI processors; no persisted data migration is
required.
