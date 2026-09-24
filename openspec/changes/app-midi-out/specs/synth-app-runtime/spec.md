# Delta — `synth-app-runtime`

sar-37 and sar-36 are added.

## ADDED Requirements

### Requirement: sar-37 — App MIDI out: per-block output list and host routing
WHEN an app processes an audio block, THE engine SHALL hand it an empty fixed-capacity MIDI-out list through the block, in which the app may append three-byte channel messages each stamped with its frame in the block, and after the app's block THE engine SHALL route that list to the sender's app MIDI-out sink (smi-20) in a host that enabled MIDI-out routing, and SHALL leave it readable to the host, unrouted, in a host that did not.

The standalone runtime and the browser runtime enable routing when they start, before the engine initializes, so the setting delivered at initialization (sar-36) reaches the app. A plugin host does not, and reads the list after `Engine::ProcessBlock` to write it into its own host MIDI buffer. Appending never allocates and never blocks; an append past capacity is dropped and counted. The capacity is a constant declared beside the list type, no smaller than two, the most messages frogg3rs's rules produce in one block (a note-off and a note-on). A routed message is due at the output time of its frame on the master clock's committed output timeline, the same mapping clock events use, so it lines up with the audio frame it describes; in a block without a committed clock plan it is due at the timestamp the host passed to `ProcessBlock`.

#### Scenario: A routed message reaches the MIDI-out sink at its frame's due time
- **WHEN** routing is enabled and the app appends one Control Change at frame 10 of a block with a committed clock plan
- **THEN** the sender receives one app channel message with those bytes, due at frame 10's output time
- Check: none yet. Task 4 adds the test.

#### Scenario: An unrouted host reads the list and the sender receives nothing
- **WHEN** routing is not enabled and the app appends a note-on at frame 0
- **THEN** after `ProcessBlock` the host reads that one message at frame 0 from the engine
- **AND** the sender's realtime lane receives nothing from it
- Check: none yet. Task 4 adds the test.

#### Scenario: Each block starts empty
- **WHEN** the app appends a message in one block and nothing in the next
- **THEN** the second block's list is empty
- Check: none yet. Task 4 adds the test.

#### Scenario: An app that writes nothing sees no change
- **WHEN** an app never appends to the list
- **THEN** no MIDI-out message is routed and every existing sender test passes unchanged
- Check: none yet. Task 4 adds the engine test for the first clause; `tests/midi_sender_tests.cpp: scheduled_realtime_broadcast_preserves_original_deadline` covers the second.

### Requirement: sar-36 — Configuration: the MIDI-out setting belongs to hosts that route it
WHEN the runtime configuration is loaded or saved, THE runtime SHALL carry one MIDI-out setting under the key `midiOut`, holding the output port reference, the chosen content id (empty for Off), the MIDI channel (stored 0 to 15, as every channel the configuration stores, default the first channel, stored 0), the Control Change number (0 to 127, default 16, General Purpose Controller 1) and the note velocity (a fixed 1 to 127, or follow the output level at note-on, the default), and THE engine SHALL hand the setting to the app only in a host that enabled MIDI-out routing (sar-37).

A configuration with no `midiOut` key loads as no port and Off, in the shape `lastPatchVersion` already has, with no schema version change. A `midiOut` entry that is malformed or holds an out-of-range value SHALL load as that same Off default, and every other part of the configuration SHALL load exactly as it would without that entry: the controller setup persists across relaunch, and `LoadRuntimeConfigJSON` today rejects the whole document when any one field is malformed, which would drop the controller rows along with the bad entry. The plugin builds share the standalone's configuration file (Frogg3rs adjudication verdicts adj-M, S3: `ProductionDataPaths()` in the plugin resolves the same root as the standalone), so a setting saved by the standalone is present in the plugin's loaded configuration; the host gate is what keeps it inert there.

The engine hands the app the content, channel, CC number and velocity on the message thread through a callback registered on the app context in the shape of `SetInputRoutedChangedCallback`: once during initialization, after the configuration has loaded and after the app's own initialization has registered the callback, and again whenever they change. Because routing is enabled before initialization (sar-37), a relaunched standalone or browser runtime hands the app the saved setting before its first audio block.

In the standalone runtime, the connection manager reconciles the chosen port as a plan of its own beside the controller rows' plan, with the same planner and executor: it opens the port into a handler of its own, binds it to the app MIDI-out sink, and moves it offline and back when the device goes and returns. The MIDI-out port claims no device from the controller rows and is refused none, so it may be the same device a controller row outputs to. A change to the stored port reconciles at once, with no device change needed, except while a reconciliation is already running: the MIDI-out plan runs inside that pass, and when it finds the port under a new identifier and writes the stored reference back, that write starts no second pass. Before the manager releases the port (another port chosen, None chosen, or shutdown) it clears the sink and then sends All Notes Off (Control Change 123, value 0) on all sixteen channels directly through that port's handler, so a receiving instrument is never left holding a note.

#### Scenario: A configuration without the key loads Off
- **WHEN** a runtime configuration written before this setting existed is loaded
- **THEN** the MIDI-out port is none, the content is Off, the channel is the first channel (stored 0), the CC number is 16 and the velocity follows the output level
- Check: none yet. Task 5 adds the test.

#### Scenario: A bad MIDI-out entry resets only itself
- **WHEN** a runtime configuration with two controller rows, a chosen audio output device and sync settings holds a `midiOut` entry whose stored channel is 16, or whose CC number is not a number, or which is not an object
- **THEN** the configuration loads, the MIDI-out setting is no port and Off with the first channel, CC 16 and velocity following the level
- **AND** the two controller rows, the audio device and the sync settings are exactly those in the document
- Check: none yet. Task 5 adds the test.

#### Scenario: The setting round-trips
- **WHEN** a configuration with a port, content "pitch", stored channel 4, CC 20 and a fixed velocity of 90 is saved and loaded
- **THEN** every field reads back unchanged
- Check: none yet. Task 5 adds the test.

#### Scenario: A host that does not route never hands the setting to the app
- **WHEN** an engine whose host did not enable routing loads a configuration whose MIDI-out content is "level"
- **THEN** the app's MIDI-out callback is never called and the app's MIDI out stays Off
- Check: none yet. Task 5 adds the test.

#### Scenario: A routing host hands the setting over and follows changes
- **WHEN** an engine whose host enabled routing before initialization loads a configuration with content "level", then the content is changed to "pitch"
- **THEN** the app's callback receives "level" before initialization returns and "pitch" after the change
- Check: none yet. Task 5 adds the test.

#### Scenario: Choosing a port opens it without a device change
- **WHEN** the standalone's MIDI-out port is changed from None to a present output and the device list does not change
- **THEN** that port is opened and bound to the app MIDI-out sink
- Check: none yet. Task 7 adds the test.

#### Scenario: A port found under a new identifier opens once
- **WHEN** the stored MIDI-out port's identifier is stale and a present output has its name
- **THEN** one reconciliation opens that port once and writes its identifier back once, and no second reconciliation starts inside it
- Check: none yet. Task 7 adds the test.

#### Scenario: Releasing the standalone port silences it
- **WHEN** the standalone's MIDI-out port is changed to None while a note is sounding on it
- **THEN** that port receives Control Change 123 value 0 on all sixteen channels before it is closed
- Check: none yet. Task 7 adds the test.
