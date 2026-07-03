# Tasks: midi-instrument-config-ui

## 1. Instrument model (JUCE-free library)

- [ ] 1.1 Add `MidiProfileKind` enum, kind section-support matrix helper, `MidiEndpointRef` (identifier + device name, empty = unconfigured), and `MidiControllerSlot` (name, kind, profile config, input/output endpoint refs) to `include/synth/MidiController.hpp` (smi-1)
- [ ] 1.2 Add `MidiInstrumentConfig` (ordered slots, unique-name add/rename/remove API) with kind-validity enforcement (slot invalid if config populates a kind-unsupported section or a system-message association carries a kind-unsupported address/feedback variant) and unit tests covering ordering, name uniqueness, and the support matrix (smi-1)
- [ ] 1.3 Implement instrument JSON serialize/load reusing profile-config JSON helpers; reject unknown kinds, duplicate names, kind-unsupported sections (e.g. launchpad with encoder mappings), and kind-incompatible address variants (e.g. launchpad entry with a WRLD.Bldr position); unit-test round-trip with all four kinds and multi-controller configs (smi-2)

## 2. Persistence integration

- [ ] 2.1 Replace `midiProfile` + endpoint state with `midiInstrument` in `BuildPatchJSON`/`LoadPatchJSON`/`ValidatePatchJSON`; a document without the section fails validation, zero-controller sections are valid (spp-2, spp-4)
- [ ] 2.2 Update patch messages and the apply helper to carry/apply `MidiInstrumentConfig` (serialize includes per-controller endpoint refs; revert restores the default instrument) (spp-7)
- [ ] 2.3 Update engine state: live `instrumentConfig_` + post-`Init` default snapshot; remove `MidiEndpointState` and its plumbing; add a message-thread instrument-edit entry point serialized against the audio-thread patch drain (block-boundary handoff or lock-guarded, mirroring the audio-device-state pattern) (spm-53 removal; sar-3, smi-8)
- [ ] 2.4 Update existing library and rig tests for the new document format; add rig test: instrument round-trips through production save/load/revert messages (spp-5, sar-8)

## 3. Per-controller processors and sender routing

- [ ] 3.1 Rework `Engine::RebuildMidiProcessors` to build input chains and output processors per controller slot, all feeding the single MIDI bus and UI state; replace the single-controller engine surface (`MidiInputProcessor()` accessor, single `MidiControllerProfileResult`, global output reset) with per-controller equivalents and update all callers (sar-9, smi-8)
- [ ] 3.2 Extend `MidiSender` to per-controller sink routing (`SetSink(ix, sink)`, `Enqueue(ix, midi)`); offline/unregistered sinks drop safely; unit tests for routing and drops (smi-7)
- [ ] 3.3 Wire output processors to their controller's sink index; keep single worker thread lifecycle unchanged (smi-7)
- [ ] 3.4 Rig test: two controllers' inputs both drive parameters; each controller's feedback reaches only its own sink (smi-7, sar-9)

## 4. Reconciliation planner (JUCE-free)

- [ ] 4.1 Define `MidiDeviceList`, per-endpoint `MidiConnectionState`, `ReconcilePlan` action types (open/close per endpoint, offline/online marking, endpoint-ref update, resync) and implement `PlanMidiReconciliation` with identifier-then-stored-name matching, one-device-one-slot, unconfigured-ref inertness, resync on output open (smi-3)
- [ ] 4.2 Unit-test the planner truth table: identifier match, name fallback emitting a ref-update action, duplicate-device contention, vanished device, input-only/output-only slots, unconfigured endpoints, input-only reopen without resync, converged-state empty plan, idempotence (smi-3)

## 5. Runtime connection lifecycle

- [ ] 5.1 Add `ThreadId::IoPoll`; implement runtime `MidiDevicePoller` thread (5 s cadence, snapshot compare, atomic dirty flag + list handoff, no device/engine access) with clean start/stop/join (smi-4)
- [ ] 5.2 Message-thread reconciliation executor: consume dirty flag from the runtime timer, re-enumerate, run planner, execute plan via per-controller `MidiInHandler`/`MidiOutputHandler` open/close, forwarding-processor swap, and output cache `Reset()` resync (smi-4, smi-5)
- [ ] 5.3 Generalize startup endpoint reopen to connect all mapped controllers after processor rebuild; absent devices mark offline without failing startup; start poller after initial connect; shutdown joins poller before device close (smi-6, sar-5)
- [ ] 5.4 Patch load path: rebuild per-controller processors from loaded instrument, then reconcile connections (sar-8, smi-8)
- [ ] 5.5 Tests: rig-level simulated reconnect (execute a plan against fake handlers) proves input flows and first post-reconnect output pass resends full feedback; unrelated controllers untouched (smi-5); runtime startup/shutdown poller lifecycle smoke (no leaks, TSan if available) (smi-4)

## 6. UI framework: main pane, sidebar, pages

- [ ] 6.1 Build `MainPane` (content host + right sidebar, resize handling, page open/dismiss returning to app UI) and rework `ShellComponent` to host it, deleting the patch chrome row (sru-1, sar-10)
- [ ] 6.2 Sidebar with Audio/Controllers/File entries and max-recent-deadline readout (rolling max of audio callback load over recent UI frames, UI-timer driven) (sru-2)
- [ ] 6.3 `AudioConfigPage`: re-home `AudioPanel` device selection (output always, input when requested), status line, selection applies through existing runtime switching (sru-3, sar-15)
- [ ] 6.4 `FilePage`: patch commands, current patch name, status, Save→Save As fall-through; remove those from shell chrome (sru-6, sar-16)

## 7. Controllers page

- [ ] 7.1 JUCE-free view model in `include/synth`: row tree (controller rows, kind-filtered submenus, expand/collapse state, mapping row values) built from instrument config + connection state; edit application back onto the config (sru-7)
- [ ] 7.2 Unit tests: view model with 4 controllers across all kinds and dozens of mappings — sections match the kind matrix, collapsed defaults, edits round-trip (sru-7, sru-5)
- [ ] 7.3 `ControllersPage` JUCE renderer: scrollable controller list with name, kind, connection state, input/output device combos (present devices + absent preference), expandable config with encoders/system-messages/analogs submenus, all collapsed by default (sru-4, sru-5)
- [ ] 7.4 Mapping list editors (encoder chan/cc→slot/position + relative mode/turn step; system addresses→press/release messages; analog chan/cc→gesture/scene-blend) with commit-time apply through the live-edit rebuild path (sru-5, smi-8)
- [ ] 7.5 Add-controller ("+") flow: name + kind, seeded from kind default profile factory, live rebuild + reconcile (sru-4, smi-8)
- [ ] 7.6 Device selection on the page updates endpoint preferences and triggers reconciliation (sru-4)

## 8. Miniapp adoption and end-to-end verification

- [ ] 8.1 Miniapp default instrument: one named WRLD.Bldr controller seeded from the default profile; remove remaining MIDI/preset config from the app surface (spm-45, spm-37)
- [ ] 8.2 Verify miniapp front page is config-free and hosts through `MainPane`; update miniapp system tests for the new document format and instrument default (spm-37, sar-11)
- [ ] 8.3 Full test suite passes: `make -C projects/synth build test` plus runtime/app builds
- [ ] 8.4 Manual smoke checklist with real hardware: cold start attached and detached, unplug→offline within ~5 s, replug→reconnect + LED resync, two controllers simultaneously, add controller via "+", mapping edit takes effect live, audio/file pages round-trip; user sign-off
