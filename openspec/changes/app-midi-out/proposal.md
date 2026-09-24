# Proposal — `app-midi-out`

This change gives a Sheaf app one MIDI out: a per-block list the app writes
channel messages into, a sender sink of its own that clock and transport never
reach, a runtime-configuration setting for its port and content, a MIDI out
section on the Controllers page, and the standalone and browser port bindings.
It is the library half of the frogg3rs change `frogg3rs-midi-out`, which
supplies what the app sends. It was written against `62829a4a`, which
frogg3rs `main` at `2255303` pins. By the operator's ruling, midi-out is
developed and pushed on its own branch, `app-midi-out`; it is rebased onto
upstream `main` as main stands when the operator says the other sessions'
work on main is done (task 0), and open changes nobody is working on are not
waited for. Paths are relative to `projects/synth/`, and code is named by
symbol.

## Why

The frogg3rs operator's story, in their rulings:

1. Frogg3rs gets ONE MIDI out, carrying the app's audio output.
2. The user picks what it sends: the output level as a continuous CC, or the
   output's pitch as MIDI notes, tracked monophonically. It sends one or the
   other, never both. 36–100 ms of pitch latency is acceptable.
3. MIDI out is off by default and ships with no presets.
4. It is wanted on the standalone, VST3, AU and browser builds, but only where
   feasibility is shown.

The library cannot carry any of it today. The only audio-thread route to a MIDI
port is the scheduled-realtime lane, and its event holds realtime status bytes
only:

```
$ sed -n 51,57p include/synth/MasterClock.hpp
enum class ScheduledMidiEventKind : std::uint8_t {
    PhaseGenerationCutoff,
    TimingClock,
    Start,
    Continue,
    Stop,
};
```

`ProcessScheduledFront` builds `BasicMidi::Realtime(dueTime, MidiStatusByte())`,
one byte. A non-broadcast event would reach sink 0 only, because the event names
no sink, and no production code sends one:

```
$ grep -n "sinkCount = " src/MidiController.cpp
1262:    const std::size_t sinkCount = entry.event.broadcast ? kMaxSinks : 1;
$ grep -rn "broadcast = false" include src runtime juce apps
(no output)
```

The sink table is the controller rows' own, eight wide, with eight-bit pending
masks (`MidiSender::kMaxSinks = 8`, `PendingScheduledEntry::hostScheduledMask`
and `immediateFallbackMask` are `std::uint8_t`), and the browser bridge already
says slots past it "can still receive input but cannot bind an output"
(`BrowserMidiBridge::ResizeForControllers`). A broadcast clock goes to every
registered sink (smi-11).

## Story steps each requirement serves

Steps are numbered as in Why above. The specs state behaviour only; this table
carries the story citations.

| Requirement | Story steps |
|---|---|
| smi-11 (broadcast skips the MIDI-out sink) | 1 ("ONE MIDI out, carrying the app's audio output"), with the operator's ruling that the port carries only the audio-output messages and is excluded from clock and transport broadcast |
| smi-20 (app channel messages to one sink) | 1; 4 (standalone and browser) |
| smi-19 (catalog MIDI-out contents) | 2 ("The user picks what it sends"); 3 ("off by default") |
| sar-37 (per-block list and host routing) | 1; 4 (all four builds from one app-side producer) |
| sar-36 (the setting, host-scoped) | 2 (channel, CC number and velocity the player sets); 3 (off by default; editable fields, not presets); 4 (the setting must not switch MIDI out on in the plugin). Its rule that a bad `midiOut` entry resets only itself serves the ratified story's requirement that the controller setup persists across relaunch (story items CTL-17 and QR-05, in the operator's ratified story, which a separate change is committing to frogg3rs) |
| sru-71 (Controllers page section) | 2 ("The user picks what it sends"); 3 (Off and None by default; defaults, not presets) |
| sbw-13 (browser MIDI-out port) | 1; 4 (the browser build, after R5, R6 and M6) |

## What Changes

- **The app writes MIDI per block.** `AudioBlock` carries an engine-owned,
  fixed-capacity list of three-byte channel messages stamped with their frame
  (sar-37).
- **The engine routes it where the host asks.** Standalone and browser
  runtimes enable routing before the engine initializes, and the engine
  enqueues each message on the scheduled-realtime lane, due at its frame's
  output time; a plugin host reads the list instead (sar-37).
- **The sender gets a MIDI-out sink with its own registration calls.** App
  channel messages go only to it, clock and transport never do, and no
  controller row's ordinal can bind it (smi-20, smi-11).
- **The setting is runtime configuration, forwarded only to routing hosts.**
  Port, content, channel (default 0), CC (default 16) and velocity (default
  follows the level) under `midiOut` (sar-36); the app's catalog lists its
  contents (smi-19).
- **The Controllers page shows an Audio to MIDI section** (sru-71), and the
  standalone and browser bind its port, sending All Notes Off on every channel
  when they release it (sar-36, sbw-13).

## Data flow

**Producer, every host.** `Engine::ProcessBlock` clears the engine-owned
MIDI-out list, points the block at it, and calls `app_.ProcessBlock(block)`.
The app appends `{frame, three bytes}` entries.

**Standalone** (`runtime/Runtime.hpp`). `Runtime::audioDeviceIOCallbackWithContext`
builds the `AudioBlock` and calls `Engine::ProcessBlock`. The runtime enabled
routing in `Runtime::Start`, before `engine_.Initialize()`, so after the app's block the engine turns each entry into an
app channel message, due at its frame's output time on the master clock's
committed output timeline (`MasterClock::DueTimeAtSample`, today private at
`MasterClock.hpp:425`, made reachable to the engine), and calls
`MidiSender::TryEnqueue`. The sender's worker drains the lane
(`DrainRealtimeLane` → `InsertPending` → `ProcessScheduledFront`), captures only
the app MIDI-out sink for that event, and calls `SendScheduled` on the
`synth_juce::MidiOutputHandler` that `MidiConnectionManager` bound to that sink
for the configured port. The port is reconciled as a one-slot plan by NEW
`AppMidiOutPortReconciler`, a JUCE-free class in `MidiReconcile.hpp` that the
manager and the browser bridge each own one of: it runs the existing planner
and executor on that slot through open, close and write-back operations its
owner supplies, keeps the slot's connection state, and holds the one guard
against re-entry. The manager runs it after the controller plan on every
pass, and also whenever the engine reports that the stored port changed;
today the manager reconciles only at startup, on a device-list change and on
an instrument rebuild, and a port edit causes none of those. The
port-changed entry point returns at once while the reconciler is running, so
the plan's own write-back of a device found under a new identifier starts no
second pass. Release (another port, None, or shutdown) goes through NEW
`ReleaseAppMidiOutPort` in the same header: it clears the sink, sends All
Notes Off on all sixteen channels through the port, then closes it.

**Browser** (`include/synth/browser/`). The worklet callback in
`BrowserRuntime.hpp` calls `ProcessAudioWorkletPlanarBlock()` on
`synth_browser::Runtime`, which calls `Engine::ProcessBlock`; routing is
enabled the same way, in that runtime's `Start()` before
`engine_.Initialize()`; the worker delivers to the bridge's MIDI-out
`OutputSink`, which queues the message under the MIDI-out key (the largest
32-bit value); `midi.ts` `drainOutputsNow` dequeues it and calls
`port.send(bytes, dueTimeMicros / 1000)` on the port its output map holds for
that key. The bridge reconciles the MIDI-out port with its own
`AppMidiOutPortReconciler` each time `midi.ts`'s 500 ms poll submits the
endpoints; its operations emit open and close actions under the MIDI-out key
and write a matched device back through `Engine::SetAppMidiOutConfig`, never
into a controller row.

**Plugin hosts.** The host never enables routing and reads
`Engine`'s MIDI-out list after `ProcessBlock` to write it into its own host MIDI
buffer. frogg3rs's plugin is the one such host (`frogg3rs-midi-out`).

**Setting.** `LoadRuntimeConfigJSON` reads the `midiOut` key into the engine,
which owns the setting and changes it only through `SetAppMidiOutConfig` on the
message thread (the Controllers page and the standalone's device write-back
both call it).
The engine hands the app the content, channel, CC number and velocity on the
message thread through an app-context callback, only when the host enabled
routing: once inside `Engine::Initialize`, after `LoadRuntimeConfiguration()`
(the app registered the callback in its `Init`, which `Initialize` runs
earlier), and again on every change. The Controllers page saves each
committed MIDI-out edit as it is made, through the same commit-then-save step
every Controllers-page edit takes today: `ControllersPageSurface`'s commit
calls the page's `saveRuntimeConfiguration` callback right after the commit
lands (sru-64, from the active change `fold-controller-wizard-into-add-row`).
Leaving the page by Back saves nothing for Controllers
(`RuntimePageBackSavesConfiguration`), and this change keeps that.

## Structural decisions

- **One producer list, two consumers.** The app writes one list per block; the
  engine routes it to the sender in the standalone and browser runtimes, and a
  plugin host reads it. The alternative, the app calling `TryEnqueue` itself,
  would make the app know sinks and due-time mapping, and a plugin has no
  started sender (Frogg3rs adjudication adj-M, M3: the plugin never starts or
  gives a sink to `Engine::midiSender_`).
- **The MIDI out's sink is a slot of its own, registered only through its own
  calls.** It sits at index `kMaxSinks`, after the eight controller slots, so
  no controller row loses its output. Controller rows are not capped at eight
  (`MidiInstrumentConfig::AddController` has no count check) and the engine
  passes a row's ordinal as its sink index, so a ninth row's ordinal equals
  that index. `SetSink`, `ClearSinkSync` and `Enqueue` therefore keep
  rejecting every index at or past `kMaxSinks`, as today, and NEW
  `SetAppMidiOutSink` and NEW `ClearAppMidiOutSinkSync` are the only way to
  the slot. The masks widen to sixteen bits, the per-sink arrays to
  `kMaxSinks + 1` entries, and every loop that delivers or reads a sink's
  lead covers the slot. `kMaxSinks` keeps meaning controller slots, so the
  bridge's controller cap does not move. The standalone's MIDI-out port and
  handler, and the browser bridge's MIDI-out sink and key, sit outside the
  per-controller vectors and maps for the same reason.
- **Clock and transport never reach it.** The operator ruled the MIDI out port
  carries only the audio-output messages. Broadcast iterates the controller
  slots only (smi-11, modified).
- **The port picker is on the Controllers page.** The active change
  `gate-browser-midi-on-controllers` makes the Controllers sidebar action the
  one action that starts Web MIDI (apart from a grant the browser already
  holds). A picker on the Audio I/O page would list no ports in a browser whose
  player never opened Controllers.
- **The setting is host-scoped.** The frogg3rs plugin loads the standalone's own
  configuration file (adj-M, S3), so a `midiOut` saved by the standalone is in
  the plugin's engine. The engine forwards it to the app only in a host that
  enabled routing, which the plugin never does.
- **Contents come from the app's catalog.** The library does not know what
  "level" or "pitch" means; the catalog lists ids, labels and whether each sends
  Control Change or notes, and the page shows the CC or Velocity field by that.
  This is a new catalog field in a new requirement (smi-19), so smi-13, which
  the active change `app-midi-catalog` owns, is not touched.
- **One port-choice construct.** The controller rows' input-port and
  output-port columns and the section's port choice are the same shape
  (status dot, captioned `ComboBox` of `BuildEndpointOptions`), so one NEW
  `ControllersLayout::EmitPortChoice` emits all three.
- **One range rule for the setting's fields.** The configuration loader, the
  Controllers page section and frogg3rs's plugin fields all check channel, CC
  number and velocity, so the three `ParseAppMidiOut*` functions beside the
  settings type hold that rule once and all three call them.
- **Release sends All Notes Off on every channel.** The library does not know
  which channel the app last used, so a port being released gets Control
  Change 123 on all sixteen channels, 48 bytes.
- **One MIDI-out port reconciler, JUCE-free.** The standalone manager and the
  browser bridge reconcile the same one-slot plan, so the second instance
  becomes one construct: `AppMidiOutPortReconciler`, parameterized by the
  host's open, close and write-back operations, holding the slot's state and
  the re-entry guard. It lives in `MidiReconcile.hpp`, in the library every
  reconcile test links, so the guard, the port-change path and the release
  sequence are tested without JUCE; `MidiConnectionManager` is compiled by no
  test binary and keeps only the wiring to its handler.
- **Out-of-tree apps name their own include directories.** `apps/sheaf-patch/Makefile`
  gains NEW `EXTRA_APP_INCLUDE_DIRS`, a list added to `CPPFLAGS` as `-I`
  flags beside `EXTRA_APP_DIR`, so frogg3rs's launcher build reaches its
  Cycfi Q submodules. The browser build needs no library change: its
  command line already takes `--allowed-source-root` more than once.

## Evidence for the measured premises

From the frogg3rs MIDI-out feasibility runs. Their reports and probes were
kept in session scratchpads that were cleared when the machine restarted; the
lines below were quoted from them before that:

```
R1a, realtime policy, 600 s:
calls=450112  max_call_ns=53417  p99_call_ns=12083  p999_call_ns=17167
calls_over_block_time=0  calls_over_10pct_block_time=0
max_as_fraction_of_block=0.040073
R1b, wasm pthread worker, 300 s:
calls=225056 max_call_ns=175104 p99_call_ns=9984 calls_over_block_time=0
max_as_fraction_of_block=0.131361
```

R1b ran on an ordinary pthread worker, not the AudioWorklet thread. Both runs
used the event type as it was before this change.

M4 re-measured the bound on the grown event (coordinator ruling: recorded
from measure-native-2's final run, in the frogg3rs session's evidence
directory,
`/Users/diegoaguilar-canabal/.claude/projects/-Users-diegoaguilar-canabal-Desktop/fca76ec7-1fa9-41b0-854c-718d9051aa6c/evidence/measure-native-2/`,
harness `m4_harness.cpp`, output `m4_run.out`):

```
M4,ordinaryCalls=447750,wallSeconds=600.002,maxNs=72959.0,p999Ns=25375.0,countAtOrOver10pctBudget=0,countMissed(>=1333000ns)=0,producerOverflowCount=0,workerOverflowCount=0,delivered=450000,enqueuedTotal=450000
M4_positive_control,count=2250,minNs=2000417.0,maxNs=2049042.0,allShowAsMissed=yes
M4_void_check,producerOverflowCount=0,delivered=450000,enqueued=450000,void=no
```

## Behavioural premises, measured before approval

- **M4.** Recorded above and in `tasks.md`: no call reached the block time.
- **M5.** Withdrawn (coordinator ruling). It asked whether frogg3rs's pitch
  analysis thread and the sender's worker could run at once in the browser;
  frogg3rs's pitch detector now runs on the audio thread, so no second thread
  is needed and the browser's thread pool stays as it is.
- **M6.** The audio-worklet cost of the mono fold, the level follower,
  frogg3rs's pitch detector (Cycfi Q's `pitch_detector`) and the per-block
  enqueue in the real browser build, with R4's protocol; R4 ran natively
  only. Carried by both changes, run once, and recorded in `tasks.md`: no
  block misses its deadline except worklet callback 0, a startup transient
  every baseline also shows; browser Level and Pitch are shown feasible.

M4 and M6 are written in `tasks.md` with their deciding quantity and result.

## Capabilities

### Modified Capabilities
- `synth-midi-instrument`: smi-11 modified; smi-19 and smi-20 added.
- `synth-app-runtime`: sar-36 and sar-37 added.
- `synth-runtime-ui`: sru-71 added.
- `synth-browser-wasm-runtime`: sbw-13 added.

## Overlap with active changes

Landing order (operator ruling): midi-out is developed and pushed on its own
branch, `app-midi-out`. It is rebased onto upstream `main` as main stands
when the operator says the other sessions' work on main is done (task 0), and
the conflicts below are resolved on this side. Open changes nobody is
working on are not waited for.

- `gate-browser-midi-on-controllers` (all tasks checked, not archived): this
  change relies on its rule that the Controllers action starts Web MIDI and
  does not change it.
- `fold-controller-wizard-into-add-row` (all tasks checked, not archived): its
  code is in `62829a4a`. It adds sru-64 ("every committed edit is saved") and
  changes sru-12 so that Back on the Controllers page saves nothing
  (`RuntimePageBackSavesConfiguration`, pinned by
  `runtime_page_back_save_policy_matches_configuration_pages`). sru-71 saves
  through sru-64's path and leaves that test unchanged.
- `ui-state-before-audio` (postflight tasks 2.1 to 2.3 open): its code sits in
  `Engine::ProcessBlock`, which task 4 edits to clear, hand over and route
  the MIDI-out list; after task 0's rebase, task 4 is written around that
  code.
- `app-midi-catalog` (delivery tasks 2.1 and 2.2 open): owns `MidiAppCatalog`
  and smi-13. This change adds a field and a new requirement, and leaves smi-13
  alone.
- `shifted-encoder-turns`, `fix-out-of-tree-app-gaps`: mention
  `MidiAppCatalog` or the engine's catalog read; no requirement or symbol this
  change edits.
- `app-o1-audit` (frogg3rs worktree `.claude/worktrees/o1-audit`). None of its
  tasks is ticked, but that worktree's Sheaf holds uncommitted edits in two
  files this change also edits, `include/synth/Engine.hpp` and
  `include/synth/RuntimePages.hpp` (`git -C .claude/worktrees/o1-audit/External/Sheaf
  status --short`, run from frogg3rs). It ADDS sar-35, smi-18, sru-69 and
  sru-70 with other content, so this change numbers its requirements sar-37,
  smi-20 and sru-71, which no active or archived change uses. Its task 5.5
  changes how the idle `MidiSender` worker waits, which the cost of
  `TryEnqueue`'s `notify_one` depends on, so M4 is re-run after task 0 if the
  rebase brings 5.5. Its task 5.6 rebuilds only an edited controller slot's
  processors where the shared sink index allows it; no controller ordinal
  reaches this change's MIDI-out slot, so 5.6 does not touch it. More shared
  sites: its 2.3 rewrites comments in `include/synth/Engine.hpp`, where task
  10 rewrites the `ProcessBlock` step list; its 3.1 adds
  `MidiAppCatalog::libraryDeviceKinds` beside task 6's contents field; its
  3.2 adds `ControllersPageCallbacks::gestureCount`, filled in the two
  `RuntimeMainServices` files task 9 also fills; its 4.1 routes
  `MidiConfigViewModel::RowFieldValue` and `BuildSectionRows` through shared
  per-row code in the Controllers page task 9 extends. This change does not
  wait for it (open changes nobody is working on are not waited for): if
  task 0's rebase finds it landed, task 12 re-runs whichever of its named
  tests exist at the rebased commit with this change's; if it has not
  landed, task 12 has none of its tests to re-run and reports that.
- `rework-controllers-block-editing` (22 of 28 tasks done): its open tasks
  6.2 and 6.3 change `ControllersPageUI.hpp` layout and remove code paths,
  and 5.3's oracle asserts the rendered tree. Task 9 here adds a section and
  moves the controller rows' output-port column onto a shared function; it
  lands first, and task 12 re-runs that oracle after task 0's rebase.
- `launchpad-model-on-the-row` (11 of 14 done): edits `MidiController` and
  the view model, and its task 6.2 moves the frogg3rs pin. This change does
  not wait for it (open changes nobody is working on are not waited for):
  frogg3rs task 1 moves the pin to the commit carrying `app-midi-out`
  regardless of whether 6.2 has landed, and if 6.2 lands separately its own
  pin move applies on top.

## Impact

- `include/synth/MasterClock.hpp`, `src/MasterClock.cpp`: the event kind,
  ordering class, bytes and sink fields; the due-time accessor.
- `include/synth/MidiController.hpp`, `src/MidiController.cpp`: `MidiSender`
  sink table, `SetSink`, `ClearSinkSync`, `CaptureScheduledSinks`,
  `ProcessScheduledFront`, `HostScheduleLeadMicros`, `PendingScheduledEntry`.
- `include/synth/AppContext.hpp`: `AudioBlock`'s MIDI-out list, the list type,
  the settings type, its three `ParseAppMidiOut*` functions and the
  app-context callback.
- `include/synth/Engine.hpp`: `ProcessBlock`, routing enable, list accessor,
  the MIDI-out setting member, `AppMidiOutConfig`, `SetAppMidiOutConfig`,
  configuration load and save, the callbacks.
- `include/synth/PatchPersistence.hpp`, `src/PatchPersistence.cpp`:
  `BuildRuntimeConfigJSON`, `LoadRuntimeConfigJSON`.
- `include/synth/MidiAppCatalog.hpp`: the contents field.
- `include/synth/MidiReconcile.hpp`, `src/MidiReconcile.cpp`: the one-slot
  instrument, `AppMidiOutPortReconciler` and `ReleaseAppMidiOutPort`.
  `runtime/MidiConnectionManager.hpp`, `runtime/Runtime.hpp`: standalone port.
- `apps/sheaf-patch/Makefile`: `EXTRA_APP_INCLUDE_DIRS`.
- `include/synth/browser/BrowserMidiBridge.hpp`,
  `include/synth/browser/BrowserRuntime.hpp`, `browser/src/midi.ts`,
  `browser/src/protocol.ts` (the MIDI-out key).
- `include/synth/ControllersPageUI.hpp` (the section, the four new
  `ControllersPageCallbacks` entries, and the save step shared with the
  controller rows' commit), `runtime/JuceRuntimeMainServices.hpp`,
  `include/synth/browser/BrowserRuntimeMainServices.hpp`: the page section.
  The section reads the callbacks, not `MidiConfigViewModel`, which this
  change does not edit.
- Comments this change makes false: `MasterClock.hpp`'s ordering comment,
  `Engine.hpp`'s `ProcessBlock` step list, and the `SetSink` and
  `ClearSinkSync` comments in `MidiController.hpp` (task 10).
- Tests: `tests/midi_sender_tests.cpp`, `tests/engine_tests.cpp`,
  `tests/contract_tests.cpp`, `tests/reconcile_executor_tests.cpp`,
  `tests/controllers_page_ui_tests.cpp`, `tests/browser_midi_bridge_tests.cpp`,
  `tests/browser_runtime_contract_tests.cpp`, and a new `midi.ts` unit test
  under `browser/tests/`.

## Rulings folded in

These were settled by the operator (relayed by the coordinator) and refine
the rules named beside each, resolving Q1 (the MIDI out section's Channel
field and its title; no reading of the code, the rulings or the omni rule
decided either):

- Channel: the MIDI-out section's Channel field is the same construct the
  controller rows' channel fields use ("channel must be an integer 0-15",
  nine sites in `MidiConfigViewModel.cpp`), and displays the same numbering
  they do. It stays stored 0–15. Wherever this change displays or enters a
  channel (the Controllers page section) uses that one convention; the
  ruling's "channel 1" is MIDI channel 1, stored and displayed as 0.
- Title: the section is titled "Audio to MIDI", saying what it sends. The
  controller rows' "MIDI out" caption (`ControllersPageUI.hpp`) is untouched.
  Wherever the section is named (spec scenarios, the manual) it is named by
  that title. The plugin's MIDI button labels ("MIDI: OFF", "MIDI: LEVEL",
  "MIDI: PITCH") name the button's state, not the section, and stay.

Both rulings apply equally to the plugin surface's Channel field in
`frogg3rs-midi-out`, and are written into sru-71.

- Measurements (coordinator ruling): M4 is recorded from measure-native-2's
  final run, including its void check and positive control; M5 is withdrawn,
  since frogg3rs's pitch detector (Cycfi Q, in `frogg3rs-midi-out`) runs on
  the audio thread and needs no second thread; M6 is recorded from
  `measure-m6/report.md`: no block misses its deadline except worklet
  callback 0, a startup transient every baseline also shows, and browser
  Level and Pitch are shown feasible. No measurement remains open.
- The sender starts only on the main thread (coordinator ruling, from M6):
  `MidiSender::Start()` must never run inside the AudioWorklet scope,
  because spawning a pthread there is not a safe call under
  `-sPTHREAD_POOL_SIZE=1` and silently stops the worklet. M6's first build
  recorded zero worklet callbacks for exactly this reason -- its own
  measurement sender was started lazily, from inside the worklet thread, on
  first use. By reading the production path, `MidiSender::Start()` already
  runs on the main thread today: `BrowserMidiBridge::Start()` calls it, and
  `BrowserMidiBridge::Start()` runs from `synth_browser::Runtime::Start()`,
  which completes before `StartAudioWorklet()`/`Prepare()` creates the
  worklet's own thread. Task 8's check reads the sender's `IsRunning()` the
  moment `synth_browser::Runtime::Start()` returns, before any `Prepare` or
  block, so it fails against a sender started lazily from inside the worklet
  callback. A guard read inside the callback could not fail: the callback
  returns before processing until `Start()` has set `started_`, which it
  does only after the bridge has started the sender. frogg3rs's pitch
  detector construction follows the same rule in `PrepareToPlay`
  (`frogg3rs-midi-out`, task 6).

## Delivery

After task 0's rebase, once main stands as the operator says the other
sessions' work on main is done, and after frogg3rs's gates are met for the
builds that ship: this worktree's `External/Sheaf` has only an `origin`
remote (`https://github.com/jvictor0/Sheaf.git`, the upstream repo); delivery
adds a remote named `fork` for `git@github.com:daguilarc/Sheaf.git`, matching
the main checkout's Sheaf, and pushes the `app-midi-out` branch there. The
change is delivered as the next sequential pull request from `fork` against
`origin`'s `main`, and the frogg3rs pin moves to it.

This change's specs, sru-71 included, are promoted and archived only after
`fold-controller-wizard-into-add-row` is archived: sru-71 cites sru-64 and
says Back saves nothing further for the Controllers page, "as sru-12 states
for this page," and neither is true of the main spec's own sru-12 until
`fold-controller-wizard-into-add-row`'s delta has been folded in. Promoting
first would leave the main spec citing a missing sru-64 and contradicting its
own sru-12, which still states that Back on the Controllers page saves the
configuration.

The frogg3rs worktree `.claude/worktrees/midi-out` that holds this change
belongs to the operator; no task removes, moves or rebases it beyond task 0's
rebase, which the operator ruled.
