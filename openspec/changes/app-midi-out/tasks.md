# Tasks — `app-midi-out`

Every new test is shown to fail with its production change reverted, by the
executor, before the task is reported done, and the report says so. Builds run
under `nice`, `-j2`, one at a time, and never two builds or suites at once,
background included. A test that is red and not named in a task is reported,
never edited.

A measurement records what it tapped, where in the path, under which settings,
and its positive control. A measurement whose positive control does not move
is void and is re-run, not read.

Harnesses. The feasibility probes (R1a, R1b) no longer exist on disk: the
session scratchpads that held them were cleared when the machine restarted.
Each measurement below is run from its own text, which states the protocol it
repeats; the runner writes its probe fresh in its own snapshot and keeps it
with the run's output.

The browser unit tests in tasks 8 and 12 run under Node and launch no
browser: `npm run test:unit` in `projects/synth/browser` compiles the
TypeScript and runs `node --test dist/tests/*.test.mjs`. They install
nothing. In the tree that runs them, `projects/synth/browser/node_modules` is
a symbolic link to
`/Users/diegoaguilar-canabal/Desktop/frogg3rs/External/Sheaf/projects/synth/browser/node_modules`,
the main checkout's, installed from the same `package.json` and
`package-lock.json` as `62829a4a` (it holds `playwright-core` 1.62.0 and
`typescript` 5.9.3). The link is removed after the run, and
`git -C External/Sheaf status --short` then prints nothing for it. If the
linked path is missing, or after task 0's rebase `package-lock.json` differs
from `62829a4a`'s, the run stops and reports BLOCKED.

Commands the tasks rely on, run from `projects/synth`, one build at a time:

```
# A C++ test binary: build it, then run it by path.
nice make -j2 build/<binary>
build/<binary>
# The full C++ suite; after it stops, run each remaining binary by path.
nice make -j2 test
# The browser bridge's C++ tests and the browser runtime contract tests:
nice make -j2 browser-midi-bridge-test
nice make -j2 browser-unit-test
# The browser TypeScript unit tests:
(cd browser && npm run test:unit)
```

Binaries named below: `midi_sender_tests`, `engine_tests`, `contract_tests`,
`reconcile_tests`, `reconcile_executor_tests`, `controllers_page_ui_tests`,
`browser_midi_bridge_tests`, `browser_runtime_contract_tests`.

## Before approval (run inside the before-code audit)

These run first, before the proposal is approved, and their numbers are
written into this file before any task below starts. frogg3rs's M1 and M3
(`frogg3rs-midi-out`) are recorded there from its measure-q runs. M4 is
recorded below from measure-native-2's final run and M5 is withdrawn
(coordinator ruling). M6 is carried by both changes, run once, recorded in
both below, from `measure-m6/report.md`. No measurement remains open. The
evidence directory named below is
`/Users/diegoaguilar-canabal/.claude/projects/-Users-diegoaguilar-canabal-Desktop/fca76ec7-1fa9-41b0-854c-718d9051aa6c/evidence/`.

Each measurement below states the quantity it taps, where on the real path it
runs, the positive control that must move it, the threshold that decides it,
and what the design does for each outcome. The runner derives its own method
and reports it with the run.

- [x] M4. Audio-thread cost of `MidiSender::TryEnqueue` on the grown event.
      Recorded from the evidence directory's `measure-native-2/` final run
      (harness `m4_harness.cpp`, output `m4_run.out`, `m4_run.err`).
      Tapped: the duration of each `TryEnqueue` call, on a caller thread under
      `THREAD_TIME_CONSTRAINT_POLICY` (`m4_run.err`: "set: yes") that calls it
      once per 64-frame block period at 48 kHz (every 1,333,333 ns, absolute
      deadlines) for 600 s of wall time.
      Where: the sender built from a snapshot of this repository at
      `62829a4a694af78362fb8ef1cdecd88f16a3ed34` with task 1's event fields
      added (three channel-message bytes and a target sink index), its worker
      started, one counting sink registered through `SetSink(0, ...)` and
      every event non-broadcast with target sink 0, so every call stores its
      event and notifies the worker. Task 2's sink slot was not built; by
      reading `MidiSender::TryEnqueue`, the producer touches only the
      realtime lane, its two indices, the overflow count and `cv_`, never
      the sink table, so the slot's index does not enter the timed region.
      Positive controls: a 2,000 µs stall inside the timed region on every
      200th call, timed apart from the ordinary calls; and the void check
      (producer-overflow count 0, one delivery per call).
      Threshold: a call at or over 1,333,000 ns is a missed audio deadline.
      Result:
      ```
      M4,ordinaryCalls=447750,wallSeconds=600.002,maxNs=72959.0,p999Ns=25375.0,countAtOrOver10pctBudget=0,countMissed(>=1333000ns)=0,producerOverflowCount=0,workerOverflowCount=0,delivered=450000,enqueuedTotal=450000
      M4_positive_control,count=2250,minNs=2000417.0,maxNs=2049042.0,allShowAsMissed=yes
      M4_void_check,producerOverflowCount=0,delivered=450000,enqueued=450000,void=no
      ```
      No call reached the threshold, the control showed all 2,250 stalled
      calls at or over it, and the run is not void: the design stands. Beside
      R1a on the old event: maximum 72,959 ns against 53,417 ns, p99.9
      25,375 ns against 17,167 ns, and 0 calls at or over 10% of the block in
      both.
      `TryEnqueue`'s `notify_one` cost depends on how the worker waits; this
      change does not wait for `app-o1-audit` (open changes nobody is
      working on are not waited for). If task 0's rebase brings
      its task 5.5 (the idle worker's wait), M4 is re-run on the rebased
      commit by this text's protocol, as its own step after task 0 and
      before task 1, and its numbers are written here before task 1 starts;
      a call at or over the threshold stops the change for the operator.
      Two earlier runs are not read: the first was unpaced (470,000 calls in
      0.21 s, 20,809 delivered, most calls taking the overflow return), and
      `m4_run.SUPERSEDED_conflated_stats.out` timed the control's stalls
      together with the ordinary calls.
- [x] M5. Withdrawn (coordinator ruling). It asked whether frogg3rs's pitch
      analysis thread and the sender's worker could run at once in the
      browser build. frogg3rs's pitch detector now runs on the audio thread,
      so no second thread is needed; `build-browser-apps.mjs` keeps
      `-sPTHREAD_POOL_SIZE=1`, which `MidiSender::Start` takes.

- [x] M6. Audio-worklet cost of the MIDI-out path in the real browser build.
      Recorded from `measure-m6/report.md` (harness
      `measure-m6/snapshot/frogg3rs/app/browser/e2e/m6_run.mjs`, builds
      `build_browser_output.txt` / `build_browser_output2.txt`, run
      `m6_run_output3.txt`).
      Tapped: each block's worklet callback time, the Emscripten clock pair
      around `ProcessAudioWorkletPlanarBlock()` that feeds
      `RecordCallbackMicros()` in `include/synth/browser/BrowserRuntime.hpp`,
      each block's own time with no averaging window. This clock resolves to
      1 ms in this build: every recorded block time below is a multiple of
      1000 µs, so a figure carries that granularity, not finer.
      Where: a copy of frogg3rs's real browser app built by its
      `app/browser/build-browser.sh`, with Q reaching the compile through two
      `-I` flags added to the snapshot's copy of `build-browser-apps.mjs`,
      not through the manifest route `frogg3rs-midi-out` task 2 prescribes;
      served with COOP/COEP headers by frogg3rs's `app/browser/serve-site.mjs`;
      driven by `@playwright/test` 1.60.0 from frogg3rs's
      `app/browser/e2e/node_modules`, `chromium.launch` with
      `headless: true` and the one argument
      `--autoplay-policy=no-user-gesture-required`, against
      `chromium_headless_shell-1223` (`measure-m6/report.md`, "Toolchain" and
      "Method"). Audio started at the AudioContext's
      own rate (48,000 Hz here) and 128-frame render quantum (2,666.7 µs
      budget), the default patch sounding (transport running) for 2 s and
      then 5 s after the transport stops. With the additions: per sample,
      the app's mono fold, one `dsp::SingleEnvelopeFollower::Process` and one
      call of frogg3rs's `cycfi::q::pitch_detector`, and per block one
      `MidiSender::TryEnqueue` into the build's own sender, its worker
      started, all inside the timed region; without them, twice, as the
      baselines.
      Positive control: a fixed `sin()` loop inside the timed region: 200
      iterations per sample left the worst block unmoved (3000.0 µs, the same
      outlier every baseline shows); 2000 iterations moved it to 6000.0 µs
      (2.2500x budget) -- the instrument is live.
      A bug caught before reporting: the first build's additions pass
      recorded zero worklet callbacks, because `MidiSender::Start()` and
      frogg3rs's detector construction were lazily triggered from inside the
      AudioWorklet thread on first use; spawning a pthread there under this
      build's `-sPTHREAD_POOL_SIZE=1` silently kills the callback. Fixed by
      moving both into `Prepare()`, which runs on the main thread before the
      worklet is created; rebuilt clean, reran clean (coordinator ruling,
      folded into the proposal and into task 8's check below).
      Deciding quantity: the worst block's callback time against 128 frames at
      the context's rate; it counts as a miss only when both baselines miss
      none, and a baseline that misses sends the setting back to be re-run.

      | Pass | worst block (µs) | frac. of budget | miss? |
      |---|---|---|---|
      | baseline1 | 3000.0 | 1.1250 | YES (block 0 only) |
      | baseline2 | 3000.0 | 1.1250 | YES (block 0 only) |
      | additions (Level+Pitch+MIDI-out) | 3000.0 | 1.1250 | YES (block 0 only) |
      | baseline1_rerun | 2000.0 | 0.7500 | no |
      | baseline2_rerun | 3000.0 | 1.1250 | YES (block 0 only) |

      Both original baselines missed once each, so per the framework the pair
      was re-run once; `baseline2_rerun` missed again, so this setting (48
      kHz/128-frame) is one the app misses without MIDI out, at the same
      single event in every pass: block index 0, the worklet's first
      callback (verified against the raw per-block arrays; no other block in
      any pass reaches 3000 µs). The additions pass's own worst-block
      fraction, 1.1250x budget, is recorded beside it and gates nothing.
      `additionSampleCalls=345,600` (= 2,700 blocks x 128 frames, one
      follower call and one detector call per sample, every sample, every
      block) and `additionBlockCalls=2,700` (one `TryEnqueue` per block)
      confirm the additions ran throughout, not just up to the miss.
      Result: no block anywhere in the additions run exceeds what the
      baselines already reach on their own. Browser Level and Pitch are shown
      feasible; the number is recorded and gates nothing.
      This task appears in both `frogg3rs-midi-out` and `app-midi-out`; it was
      run once, in this change's snapshot, and its result recorded in both.
      No measurement remains open.

## Implementation

- [ ] 0. Rebase (operator ruling: midi-out is developed and pushed on its
      own branch, `app-midi-out`, and is rebased onto upstream `main` as it
      stands when the operator says the other sessions' work on main is
      done; open changes nobody is working on are not waited for). This is
      the same step as `frogg3rs-midi-out` task 0 and runs once, when the
      coordinator relays that word: this change's branch is rebased onto
      upstream `main`, and the base commit is reported. Then every existence claim a task below makes about a named
      symbol, test or comment is re-checked, and each one the rebase changed
      is reported; a task whose named symbol, test or comment no longer
      exists stops and reports rather than guessing its replacement.
      Check: this worktree's `External/Sheaf` has a remote named `origin`
      (`https://github.com/jvictor0/Sheaf.git`, the upstream repo) and no
      remote named `upstream`; `git merge-base --is-ancestor origin/main
      HEAD` exits 0, run in `External/Sheaf` after `git fetch origin`.
- [ ] 1. Grow the event: NEW `ScheduledMidiEventKind::ChannelMessage` appended
      after `Stop`, NEW `ScheduledMidiOrderingIntent::AppMessage` appended
      after `Clock`, and NEW `ScheduledMidiEvent` fields for the three message
      bytes and the target sink index; `MidiStatusByte()` returns the first
      byte for a channel message. Make the existing
      `MasterClock::DueTimeAtSample` reachable from `Engine` without changing
      its body.
      Check: every existing test in `tests/midi_sender_tests.cpp` and
      `tests/engine_tests.cpp` passes unchanged, run by path.
- [ ] 2. Give the sender a MIDI-out sink that no controller ordinal can
      reach. NEW `MidiSender::kAppMidiOutSinkIx` equal to `kMaxSinks`, and
      NEW `MidiSender::kSinkTableSize` equal to `kMaxSinks + 1`, the size of
      `sinks_`, `sinkCapabilities_`, `sinkScheduleLeadMicros_`,
      `sinkRegistrationGenerations_`, `inFlightBySink_` and
      `PendingScheduledEntry::sinkRegistrationGenerations`. Widen
      `hostScheduledMask` and `immediateFallbackMask`, and the bit built from
      a sink index wherever either mask is set, tested or cleared, to
      `std::uint16_t`. NEW `MidiSender::SetAppMidiOutSink` (taking an
      `IMidiOutputSink*`) and NEW `MidiSender::ClearAppMidiOutSinkSync` are
      the only way to register or clear that sink. `SetSink`, `ClearSinkSync`
      and `Enqueue` keep rejecting `sinkIx >= kMaxSinks` exactly as today, so
      a controller at ordinal 8 or higher still binds no output:
      `Engine::RebuildMidiProcessors` passes the controller ordinal as the
      sink index, `MidiConnectionManager::OpenOutput` and the browser bridge
      pass it to `SetSink`, and `MidiInstrumentConfig::AddController` has no
      count limit. `SetSink` and `SetAppMidiOutSink` share one private helper
      taking the index, and so do `ClearSinkSync` and
      `ClearAppMidiOutSinkSync`. `BeginSinkCall` accepts indices below
      `kSinkTableSize`. `CaptureScheduledSinks` iterates `[0, kMaxSinks)`
      for a broadcast event. `HostScheduleLeadMicros` and both delivery loops
      in `ProcessScheduledFront` (host-scheduled and immediate fallback)
      iterate `[0, kSinkTableSize)`, so a captured MIDI-out bit is always
      delivered and cleared and the entry leaves the pending queue.
      `kMaxSinks` keeps its value and meaning.
      Deliver a channel message to its sink: for a non-broadcast event,
      `CaptureScheduledSinks` captures the event's own sink index only, and
      `ProcessScheduledFront` builds the `BasicMidi` it sends with the
      existing four-argument constructor (timestamp, status, data1, data2)
      from the event's three bytes for a channel message, and with
      `BasicMidi::Realtime` otherwise.
      Check: new tests in `tests/midi_sender_tests.cpp` assert smi-11's
      "Clock and transport skip the app MIDI-out sink" and smi-20's "Every
      controller row keeps its output", "An app message reaches only the
      MIDI-out sink", "Releasing the MIDI-out sink waits for an in-flight send",
      "A generation cutoff never drops an app message", "A delivered app message does
      not hold back the clock" (the last with the MIDI-out sink registered as a
      host-timestamped sink), and "A ninth controller row never becomes the
      MIDI-out sink"; `scheduled_realtime_broadcast_preserves_original_deadline`
      passes unchanged.
- [ ] 3. Merged into task 2.
- [ ] 4. Per-block list and routing: NEW app MIDI-out event type (frame and
      three bytes) and NEW fixed-capacity list type with a capacity constant of
      at least two and an overflow count, in `AppContext.hpp`; NEW
      `AudioBlock` pointer to the list; `Engine::ProcessBlock` clears the
      engine-owned list and points the block at it before `app_.ProcessBlock`,
      and after it, when routing is enabled, enqueues one channel message per
      entry to `kAppMidiOutSinkIx` with the entry's frame mapped to a due time
      through the clock accessor from task 1, or the `ProcessBlock` timestamp
      when the block has no committed clock plan. NEW
      `Engine::EnableAppMidiOutRouting()` and NEW read accessor for the list.
      `EnableAppMidiOutRouting()` is called before `Engine::Initialize`:
      `Runtime::Start` in `runtime/Runtime.hpp` calls it immediately before
      `engine_.Initialize()`, and so does the browser runtime's `Start()`
      (class `synth_browser::Runtime` in `include/synth/browser/BrowserRuntime.hpp`).
      Called after `Initialize`, it changes nothing and logs that it was
      ignored; the order is what task 5's delivery at `Initialize` relies on.
      Check: new tests in `tests/engine_tests.cpp` assert sar-37's first three
      scenarios, and a new test there asserts the first clause of sar-37's
      "An app that writes nothing sees no change": with routing enabled and an
      app that never appends, the sender's realtime lane receives no app
      channel message over a run of blocks; it is shown red against an engine
      that enqueues one message per block whether or not the app appended.
- [ ] 5. The setting: NEW app MIDI-out settings type (content id, channel
      stored 0 to 15 like every channel `config.json` already stores, CC
      number, velocity with a follow-level value) and NEW configuration type
      adding the `MidiEndpointRef` port; `BuildRuntimeConfigJSON` writes
      `midiOut` and `LoadRuntimeConfigJSON` reads it, a missing key loading as
      no port and Off with the first channel (stored 0), CC 16 and velocity
      following the level; a malformed or out-of-range `midiOut` entry also
      loads as that Off default while every other part of the document loads
      unchanged, so a bad entry never costs the controller setup.
      NEW `ParseAppMidiOutChannel`, `ParseAppMidiOutCcNumber` and
      `ParseAppMidiOutVelocity` beside the settings type, each taking the
      entered or stored value and returning the value or nothing when it is
      out of range (channel 0 to 15, CC 0 to 127, velocity "Level" or 1 to
      127). They are the one range rule for the setting's three fields:
      `LoadRuntimeConfigJSON`'s `midiOut` read, the Controllers page section
      (task 9) and frogg3rs's plugin fields all call them.
      The engine owns the setting: NEW `Engine` member holding the MIDI-out
      configuration, loaded by `LoadRuntimeConfiguration()` and written by
      the runtime configuration save; NEW `Engine::AppMidiOutConfig()`
      returning it; NEW `Engine::SetAppMidiOutConfig(...)`, called on the
      message thread, which stores the new value, calls the app-context
      callback below when routing is enabled and the content, channel, CC
      number or velocity changed, and calls the port-changed callback below
      when the port changed.
      NEW app-context callback registration in the shape of
      `SetInputRoutedChangedCallback`. When routing is enabled, `Initialize`
      calls it once on the message thread after `LoadRuntimeConfiguration()`
      (the app registered it in its `Init`, which runs earlier in
      `Initialize`), and `SetAppMidiOutConfig` calls it again on every change; when
      routing is not enabled it is never called. NEW
      `Engine::SetAppMidiOutPortChangedCallback`, a host callback the engine
      calls on the message thread from `SetAppMidiOutConfig` whenever the
      stored MIDI-out port changes, whether routing is enabled or not; task 7
      registers it.
      Check: NEW `runtime_config_bad_midi_out_entry_resets_only_itself` in
      `tests/contract_tests.cpp` passes: for each of a channel of 16 (stored
      numbering), a CC number that is a string, and a `midiOut` that is an
      array, a document holding two controller rows, an audio output device
      and sync settings loads, its MIDI-out setting reads as no port and Off
      with the first channel, CC 16 and velocity following the level, and its
      controller rows, audio device and sync settings equal the document's; it
      is shown red against a load that rejects the whole document. New tests
      in `tests/engine_tests.cpp` or `tests/contract_tests.cpp` assert sar-36's
      missing-key, round-trip and two host-routing scenarios; the routing-host
      scenario's test enables routing before `Initialize`, as the runtimes
      do, and is shown red against an engine that calls the callback only on
      change; `runtime_config_defaults_are_sensible` passes; a new test
      asserts each parse function's accepted and refused boundaries (channel
      15 and 16, CC 127 and 128, velocity 1, 0 and "Level").
- [ ] 6. Catalog: NEW `MidiAppCatalog` field listing MIDI-out contents (id,
      label, Control Change or notes), empty by default.
      Check: a new case in `tests/contract_tests.cpp` (binary
      `contract_tests`) asserts that a default `MidiAppCatalog` lists no
      MIDI-out contents and that one declared with two keeps both in
      declaration order with their ids, labels and kinds; it is shown red
      against a default that lists one content. smi-19's two scenarios are
      asserted by task 9, once the section they describe exists.
- [ ] 7. Standalone port. The MIDI-out port is reconciled as its own
      one-slot plan, apart from the controller rows, so it never shares an
      index, a handler vector entry or a device claim with a controller row.
      NEW `AppMidiOutReconcileInstrument` in `MidiReconcile.hpp` builds a
      `MidiInstrumentConfig` holding one active slot whose output is the
      configured MIDI-out port and whose input is unconfigured.
      NEW `AppMidiOutPortReconciler`, declared in
      `include/synth/MidiReconcile.hpp` and defined in `src/MidiReconcile.cpp`
      (JUCE-free, so it is in the library every reconcile test links), is the
      one construct the standalone manager and the browser bridge (task 8)
      both own one of. It keeps a NEW one-entry `MidiConnectionState` for the
      slot and a re-entry flag. NEW `AppMidiOutPortOps` holds the three
      operations its owner supplies: open (an identifier; returns whether it
      opened), close, and write-back (an identifier and a name). Its
      `Reconcile` takes the stored MIDI-out port reference, the present
      device list and the ops; sets the flag; builds the one-slot instrument;
      runs the existing `PlanMidiReconciliation` and `ExecuteReconcilePlan`
      unchanged, with `MidiEndpointOps` mapping the output open to open, the
      output close to close, the output reference update to write-back, and
      `resync` and every input operation to nothing; stores the returned
      state; and clears the flag. Its `OnPortChanged`, with the same
      arguments, returns at once while the flag is set and otherwise calls
      `Reconcile`. Its `OutputStatus` returns the slot's output status for
      task 9.
      NEW `ReleaseAppMidiOutPort` in the same header takes the `MidiSender`,
      a send operation and a close operation: it calls
      `ClearAppMidiOutSinkSync()`, then sends Control Change 123 value 0 on
      status-byte channels 0 to 15, in that order, through the send
      operation, then calls close.
      `MidiConnectionManager` owns one NEW `synth_juce::MidiOutputHandler`
      for the MIDI out, outside `outputHandlers_`, and one reconciler. Its
      open operation opens that handler and calls `SetAppMidiOutSink`; its
      close operation calls `ReleaseAppMidiOutPort` with the handler's `Send`
      and `Close`; its write-back calls `Engine::SetAppMidiOutConfig` (task
      5) with the new port reference, never `EditInstrument`. `Reconcile`
      runs the reconciler after the controller plan on every pass (startup,
      device-list change, instrument rebuild). NEW
      `MidiConnectionManager::OnAppMidiOutPortChanged()` calls the
      reconciler's `OnPortChanged` with a fresh enumeration and the stored
      port; `Runtime` registers it through task 5's
      `SetAppMidiOutPortChangedCallback`, so a port chosen or cleared on the
      Controllers page is opened or released without a device change, and
      the plan's own write-back of a name-fallback match (which
      `PlanMidiReconciliation` emits even when the port is already open)
      reaches `OnPortChanged` while the flag is set and starts no second
      pass. The manager's destructor releases an open MIDI-out port through
      `ReleaseAppMidiOutPort`.
      Check, in `tests/reconcile_executor_tests.cpp` (binary
      `reconcile_executor_tests`), with a fake for the three operations that
      records every call and stores what write-back writes as the port
      reference the next call reads:
      - Changing only the stored port, with the device list unchanged, then
        calling `OnPortChanged` opens the new port once; shown red against
        an `OnPortChanged` that returns without reconciling.
      - A stored port whose identifier is stale, with a present output of the
        same name: one `Reconcile`, whose write-back calls the reconciler's
        `OnPortChanged` again as the engine's port-changed callback would,
        calls open exactly once and write-back exactly once; shown red
        against an `OnPortChanged` without the re-entry check, where the
        nested pass opens the port a second time.
      - The port's device leaves the list and returns: the slot goes offline
        and is opened again. Beside it, the existing planner run for an
        instrument holding a controller row whose output is the same device
        plans that row's output open, never a close caused by the MIDI out,
        and the reconciler's own separate `Reconcile` pass opens the
        MIDI-out slot's output too; shown red against an implementation that
        folds the MIDI-out slot into the same `MidiInstrumentConfig` passed
        to the controller planner instead of running the reconciler's own
        one-slot `PlanMidiReconciliation` pass, where the MIDI-out slot
        loses device-claim contention to the earlier controller slot and its
        output never opens.
      - `ReleaseAppMidiOutPort`, given a `MidiSender` with a recording sink
        registered through `SetAppMidiOutSink` and a recording send and
        close: the sender delivers nothing to that sink after the call, the
        send operation receives the sixteen All Notes Off messages for
        channels 0 to 15 in order, and close comes last; this asserts
        sar-36's "Releasing the standalone port silences it". Shown red
        against a release that closes before it sends.
      - Every existing test in `tests/reconcile_tests.cpp` and
        `tests/reconcile_executor_tests.cpp` passes unchanged.
      The manager's own wiring (the handler, the callback registration, the
      destructor's release) is compiled by task 12's miniapp runtime build
      and exercised end to end only by frogg3rs's operator run R9; no
      automated test here covers it.
- [ ] 8. Browser port. The bridge and `midi.ts` key the MIDI out with a
      value no controller slot can take: NEW `kAppMidiOutBridgeKey` in
      `BrowserMidiBridge.hpp`, equal to `std::numeric_limits<std::uint32_t>::max()`,
      the width the ABI already uses for `controllerIx` in actions and
      outbound messages (`worker.ts` reads both with `getUint32`), and NEW
      `APP_MIDI_OUT_KEY = 0xFFFFFFFF` in `browser/src/protocol.ts`. The bridge
      holds one NEW `OutputSink` for the MIDI out outside `outputSinks_`,
      constructed with that key, and one `AppMidiOutPortReconciler` (task 7).
      `SubmitEndpoints` runs the reconciler after the controller plan on every
      call (the 500 ms `midi.ts` poll calls it, so a port change reaches it
      within one poll), with the stored port from `Engine::AppMidiOutConfig`
      and these operations, which never write `config.controllers` and never
      call `SetSink`: open clears the MIDI-out `OutputSink`, registers it with
      `SetAppMidiOutSink`, and queues an open-output action carrying the key
      and the identifier; close calls `ClearAppMidiOutSinkSync`, clears the
      sink and queues a close-output action carrying the key; write-back
      calls `Engine::SetAppMidiOutConfig` with the new port reference. `Stop`
      calls `ClearAppMidiOutSinkSync` before it stops the sender.
      `midi.ts` keeps the MIDI out's port in its one output map under
      `APP_MIDI_OUT_KEY`; before it closes that key's port it sends Control
      Change 123 value 0 on all sixteen channels (0 to 15) to it, and it skips the port's
      `clear()` when a controller key holds the same port, since `clear()`
      would drop that controller's pending scheduled messages.
      Check:
      - C++, in `tests/browser_midi_bridge_tests.cpp` (binary
        `browser_midi_bridge_tests`, also run by `make
        browser-midi-bridge-test`), each shown red against the build that
        lacks the part it names:
        - With a stored port present, `SubmitEndpoints` queues exactly one
          open-output action, carrying `kAppMidiOutBridgeKey`, and none for a
          controller slot (red: a `SubmitEndpoints` that does not run the
          reconciler).
        - After that open, an app channel message enqueued for
          `kAppMidiOutSinkIx` comes out of the bridge as an outbound message
          under `kAppMidiOutBridgeKey` (red: an open without
          `SetAppMidiOutSink`).
        - With a stale identifier and a present output of the same name,
          `SubmitEndpoints` writes the new reference into
          `Engine::AppMidiOutConfig` and leaves every controller row's output
          reference unchanged, controller row 0 included (red: a write-back
          through the controller rows' reference update).
        - After `Stop`, restarting the sender and enqueueing an app message
          for `kAppMidiOutSinkIx` puts nothing in the bridge's outbound
          queue (red: a `Stop` without `ClearAppMidiOutSinkSync`).
      - TypeScript, in NEW `browser/tests/midi-app-out.test.mjs` beside
        `browser/tests/midi-timing.test.mjs`, run by `npm run test:unit`:
        sbw-13's three port scenarios through `BrowserMidiManager` with a
        fake `submitEndpoints`; that releasing the MIDI-out port while a
        controller key holds the same port does not call its `clear()`; and
        a test that reads `include/synth/browser/BrowserMidiBridge.hpp` and
        fails unless `kAppMidiOutBridgeKey` is declared equal to
        `std::numeric_limits<std::uint32_t>::max()`, so the two constants
        cannot drift apart unnoticed.
      - The sender starts only on the main thread (sbw-13's first scenario):
        a new case in `tests/browser_runtime_contract_tests.cpp` (binary
        `browser_runtime_contract_tests`, run by `make browser-unit-test`)
        constructs a `synth_browser::Runtime`, calls `Start()`, and before
        any `Prepare` or `ProcessAudioWorkletPlanarBlock` asserts that
        `Engine().Context().midiSender->IsRunning()` is true, then runs
        `ProcessAudioWorkletPlanarBlock` and asserts it still is. It is shown
        red against a build that moves the bridge's `Start()` out of
        `Runtime::Start()` and into the first `ProcessAudioWorkletPlanarBlock`
        call. A guard read inside the callback cannot fail against that
        build: the callback returns before processing until `Start()` sets
        `started_`, which it does only after the bridge has started the
        sender (`synth_browser::Runtime::Start`).
- [ ] 9. Controllers page: the Audio to MIDI section of sru-71, built by
      `ControllersPageSurface::BuildTree` from the four callbacks below, not
      from `MidiConfigViewModel`. The controller
      rows' input-port and output-port columns are written inline in the row
      builder today, each a status dot, then a `ComboBox` (captioned "MIDI
      in" or "MIDI out") whose options come from
      `ControllersLayout::BuildEndpointOptions`; they differ only in the
      device list, status, stored reference, device label, caption, node ids
      and action value. The section's port choice is the third instance, so
      NEW `ControllersLayout::EmitPortChoice` takes the node ids, device list,
      status, stored reference, device label, control style with its caption,
      and action, emits `ControllersLayout::EmitStatusDot` and that
      `ComboBox`, and the input column, the output column and the section all
      call it. The Channel
      field displays 0 to 15, the numbering the controller rows' channel
      fields use, and refuses with their message, "channel must be an integer
      0-15" (ruling, Q1); the Channel, CC and Velocity fields check entries
      with task 5's parse functions. The section's options and field
      visibility come from the catalog's MIDI-out contents (smi-19). NEW
      `ControllersPageCallbacks` entries: `appMidiOutSnapshot` (returns
      `Engine::AppMidiOutConfig()`), `commitAppMidiOut` (calls
      `Engine::SetAppMidiOutConfig`), `appMidiOutContents` (the catalog's
      MIDI-out contents) and `appMidiOutPortStatus` (the reconciler's
      `OutputStatus` from task 7: the connection manager's in the
      standalone, the bridge's in the browser).
      `JuceRuntimeMainServices` and `BrowserRuntimeMainServices` fill all
      four.
      Saving. Every committed section edit is saved as it is made, through
      the step every Controllers-page commit takes today (sru-64):
      `ControllersPageSurface`'s `Commit` commits the instrument, then calls
      the `saveRuntimeConfiguration` callback, then sets one status. The
      section's commit is the second caller of that save-and-status tail, so
      the tail moves into NEW private `ControllersPageSurface::SaveCommittedEdit`
      (taking the success text), which `Commit` and the section's commit
      both call after their own commit lands. Back still saves nothing for
      the Controllers page (`RuntimePageBackSavesConfiguration` is
      unchanged).
      Check, in `tests/controllers_page_ui_tests.cpp` (binary
      `controllers_page_ui_tests`), each new test shown red against the
      build that lacks the part it names:
      - sru-71's scenarios "A new configuration shows Off and None", "The
        fields follow the chosen content", "An out-of-range entry is
        refused" and "An offline port is shown offline and kept".
      - sru-71's "A committed MIDI-out edit is saved at once": with a
        counting `saveRuntimeConfiguration` and a recording
        `commitAppMidiOut`, changing the port, Sends, Channel or CC calls
        `commitAppMidiOut` with the new setting and then the save once per
        edit, with no Back pressed (red: a section commit that skips
        `SaveCommittedEdit`).
      - smi-19's "Declared contents are offered after Off": with two
        contents from `appMidiOutContents`, the Sends `ComboBox` options are
        Off and then the two labels in catalog order (red: options built
        without Off first). smi-19's "A catalog with no contents shows no
        setting": with none, the tree holds no Audio to MIDI section (red: a
        section built whatever the contents).
      - Every existing Controllers page test passes unchanged, including
        `TestSaveFailureKeepsTheCommittedEditAndReportsIt` and the controller
        rows' input-port and output-port tests after they move onto
        `EmitPortChoice`; `runtime_page_back_save_policy_matches_configuration_pages`
        in `tests/contract_tests.cpp` passes unchanged.
- [ ] 10. Comments this change makes false, in the files it touches. In
      `include/synth/MasterClock.hpp`, the comment above
      `ScheduledMidiOrderingIntent` ("cutoff, then transport, then clock")
      names the app-message class last. In `include/synth/Engine.hpp`, the
      step list above `ProcessBlock` names clearing the MIDI-out list before
      the app's block and routing it after. In
      `include/synth/MidiController.hpp`, the comments on `SetSink` and
      `ClearSinkSync` say the MIDI-out sink is registered and cleared only
      through `SetAppMidiOutSink` and `ClearAppMidiOutSinkSync`.
      Check: each rewritten comment is quoted in the report beside the code
      it describes, and says what that code does.
- [ ] 11. Out-of-tree include directories for the launcher build. In
      `apps/sheaf-patch/Makefile`, NEW `EXTRA_APP_INCLUDE_DIRS ?=` beside the
      other `EXTRA_APP_*` variables, and inside the block that runs when
      `EXTRA_APP_DIR` is set, `CPPFLAGS += $(addprefix -I,$(EXTRA_APP_INCLUDE_DIRS))`.
      With the variable empty or unset the build is unchanged. frogg3rs's
      `app/build-launcher.sh` passes its two Cycfi Q include directories
      through it (`frogg3rs-midi-out` task 2); the Makefile's app compile
      uses `CPPFLAGS`, so they reach `FroggersMain.cpp`.
      Check, run from `projects/synth/apps/sheaf-patch` (a dry run builds
      nothing):
      ```
      make -n EXTRA_APP_DIR="$PWD" EXTRA_APP_HEADER=Launcher.hpp EXTRA_APP_TYPE=A EXTRA_APP_REGISTRAR=A EXTRA_APP_HEADERS="$PWD/Launcher.hpp" EXTRA_APP_INCLUDE_DIRS="/tmp/q /tmp/infra" | grep Main.cpp | grep -c -- "-I/tmp/q -I/tmp/infra"
      ```
      prints 1. At `62829a4a` it prints 0: the one `Main.cpp` compile line
      carries only `-I$(EXTRA_APP_DIR)` for the app. `make -n` with no
      `EXTRA_APP_*` variable prints the same lines before and after the
      change. frogg3rs task 12's launcher build is the end-to-end check.
- [ ] 12. Run the full `projects/synth` suite by the commands at the top of
      this section: `nice make -j2 test`, then every test binary by path
      after it stops; build and run the miniapp runtime target
      (`nice make -j2 miniapp`), which that suite does not build; run
      `nice make -j2 browser-midi-bridge-test`, `nice make -j2
      browser-unit-test`, and the TypeScript unit tests with
      `npm run test:unit` in `browser`; and re-run
      `rework-controllers-block-editing`'s oracle (it lands first) and,
      whichever of `app-o1-audit`'s named tests exist at the rebased commit
      (this change does not wait for it), with this change's.
      Check: pass and fail counts reported per binary and per test file as
      measured; every failure is either fixed here or shown to fail
      identically at the base commit task 0 reported.
