# Delta — `synth-browser-wasm-runtime`

sbw-13 is added.

## ADDED Requirements

### Requirement: sbw-13 — MIDI: the app MIDI-out port in the browser
WHEN the browser runtime has MIDI access and the runtime configuration names a MIDI-out port, THE browser runtime SHALL bind that `MIDIOutput` to the app MIDI-out sink (smi-20) through the same reconciliation planner, drain and `send(bytes, timestamp)` path controller outputs use, keyed by a value no controller slot can take, and SHALL send All Notes Off (Control Change 123, value 0) on all sixteen channels to that port before it releases it.

The bridge's actions and outbound messages carry a 32-bit key: a controller slot for controller outputs, and the largest 32-bit value for the MIDI out. Controller rows have no count limit, so the MIDI out cannot take the index after the last controller slot, which a further row would also take; the largest 32-bit value is one no row reaches. `midi.ts` routes both through its one output map. The MIDI-out port claims no device from the controller rows, so it may be a port a controller row also uses; releasing it then leaves that port's pending controller messages in place. A port chosen on the Controllers page is bound within one `midi.ts` poll, which submits the endpoints every 500 ms. The browser's MIDI permission gate is unchanged. Delivery on Chrome and Firefox depends on operator runs that have not happened: R5 (drain cadence, per-pass throughput and MIDI-to-audio offset, tab hidden for three minutes while audible) and R6 (the Firefox add-on flow), whose confirming and clearing results are recorded in the frogg3rs change `frogg3rs-midi-out`'s tasks, which run them on frogg3rs's browser build. Browser Level and Pitch also depended on a measurement of the audio-worklet cost of the app's mono fold, level follower and pitch detector plus the per-block enqueue in the real browser build (48 kHz AudioContext rate, 128-frame render quantum, 2,666.7 µs budget; the Emscripten clock behind those figures resolves to 1 ms): the additions pass's worst block reaches 1.1250x budget, the same single block-0 startup transient every baseline pass also shows, and no block anywhere in the additions run exceeds what the baselines reach on their own, so browser delivery of Level and Pitch needs no fix. `MidiSender::Start()`, which `BrowserMidiBridge::Start()` calls, runs on the main thread only, before `StartAudioWorklet()`/`Prepare()` creates the worklet's own thread, since starting it lazily from inside the worklet callback silently kills the callback under `-sPTHREAD_POOL_SIZE=1`.

#### Scenario: The sender starts on the main thread, never from the audio callback
- **WHEN** the browser runtime starts
- **THEN** `MidiSender::Start()` completes, from `BrowserMidiBridge::Start()` called by `synth_browser::Runtime::Start()`, before `StartAudioWorklet()`/`Prepare()` creates the worklet's own thread
- **AND** no code path starts or constructs it lazily from inside the AudioWorklet callback
- Check: `tests/browser_runtime_contract_tests.cpp: TestMidiSenderStartsOnlyOnTheMainThread`

#### Scenario: The MIDI-out port receives the app's messages
- **WHEN** MIDI access is granted, a MIDI-out port is configured and the app appends a Control Change
- **THEN** that port's `send` is called with those bytes and the message's due time in milliseconds
- **AND** no controller slot's port receives it
- Check: `projects/synth/browser/tests/midi-app-out.test.mjs: drainOutputsNow delivers an app-out payload via port.send with dueTimeMicros/1000, and no controller port receives it`

#### Scenario: Releasing the browser port silences it
- **WHEN** the MIDI-out port is changed to None
- **THEN** the released port receives Control Change 123 value 0 on all sixteen channels before the runtime stops sending to it
- Check: `projects/synth/browser/tests/midi-app-out.test.mjs: releasing the app MIDI-out port sends All Notes Off on all sixteen channels before releasing it`

#### Scenario: Controller outputs are unaffected
- **WHEN** two controller slots and the MIDI out use three different ports
- **THEN** each port receives only its own traffic, and reconnecting the MIDI-out port does not close or remap either controller port
- **WHEN** a ninth controller row exists and the MIDI out has a port
- **THEN** the ninth row's key is its own slot, the MIDI out's is the largest 32-bit value, and neither receives the other's traffic
- Check: `projects/synth/browser/tests/midi-app-out.test.mjs: controller ports keep their own traffic across a MIDI-out reconnect, and a ninth controller row and the app key never cross`
