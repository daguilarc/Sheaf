# Proposal: midi-instrument-config-ui

## Why

MIDI configuration today is a single controller profile per patch, wired to
manually opened devices with no reconnect story: if a controller is unplugged
or absent at startup the user must notice, press Refresh, and reopen it by
hand, and the runtime chrome only offers a preset combo plus raw device
selectors. We want the stored configuration to describe an *instrument* — a
named set of controllers with their profiles — that the app keeps connected
automatically, plus a real configuration UI the library provides. There are no
users yet, so no backward compatibility is required.

## What Changes

- **Instrument model.** Replace the single live MIDI profile with an
  instrument: an ordered collection of uniquely named controller slots
  (conceptually a controller-name → profile mapping), where each profile
  has a kind (`wrldbldr`, `twister`, `launchpad`, `generic`), the same
  internal config as today (encoder, analog, system-message associations),
  and best-effort endpoint references. The instrument is the stored
  configuration, independent of connection state. **BREAKING**: the patch
  document's `midiProfile` section is replaced by the instrument section;
  documents without it (all legacy patches) fail validation; no migration.
- **Self-healing connections.** The runtime tries to keep every controller in
  the map connected: it connects at startup, and a new IO poll thread checks
  the USB MIDI device list every 5 seconds and alerts the message thread of
  changes. The message thread then re-enumerates, reconnects controllers
  whose devices reappeared, and marks vanished ones offline. Reconnect clears
  output debounce/cache state so the controller resyncs its LEDs/displays.
- **Library UI framework.** The runtime library provides components an app
  can opt into: a main pane with a right-hand sidebar menu subcomponent and a
  "main everything else" content component that fills the remaining space,
  handles resize, and hosts the app's UI override. The sidebar has Audio,
  Controllers, and File tabs plus a max-recent-deadline percentage readout
  (rolling max of audio callback load, as in SmartGridOne).
- **Config pages.** Sidebar tabs open library-provided pages that replace the
  app content until dismissed: Audio (interface selection), Controllers
  (lists mapped controllers, their connection state and actual input/output
  devices, an expandable config section — collapsed by default — with
  collapsible submenus for encoders, system messages, and analogs/gestures,
  skipping submenus the profile kind doesn't support; a plus button adds new
  controllers), and File (patch commands). Mapping lists (chan/cc → param
  slot/position, system-message associations, analog chan/cc) are scrollable
  and usable with a realistic number of parameters and multiple controllers.
- **Miniapp adoption.** Remove file and MIDI config from the miniapp front
  page; the miniapp uses the library sidebar, file/MIDI/audio config pages,
  and provides only its main-area override.

## Capabilities

### New Capabilities

- `synth-midi-instrument`: the instrument configuration model
  (controller-name → profile map with kinds), its persistence, connection
  lifecycle (startup connect, per-controller endpoint state), the IO poll
  thread and device-change reconciliation, reconnect/offline semantics, and
  debounce-clearing resync.
- `synth-runtime-ui`: the library UI framework — main pane with sidebar menu
  and app-hosted content area, Audio/Controllers/File pages, expandable
  config sections and scrollable mapping lists, deadline-percentage readout,
  and page navigation back to the app's main view.

### Modified Capabilities

- `synth-app-runtime`: context carries the instrument config instead of a
  single live profile (sar-3); startup lifecycle connects mapped controllers
  and starts/stops the IO poll thread (sar-5); patch load rebuilds
  per-controller processors (sar-8); runtime MIDI management becomes
  per-controller with automatic reconnect (sar-9); the shell hosts the new
  UI framework instead of ad-hoc patch/MIDI chrome (sar-10, sar-16 chrome
  location); audio device selection moves into the Audio page (sar-15).
- `synth-parameter-modulation`: the miniapp's MIDI configuration surface is
  the new Controllers page (spm-37); the miniapp default becomes an
  instrument containing a WRLD.Bldr controller (spm-45); the separate global
  MIDI device selection state is removed, superseded by per-controller
  endpoints in the instrument model (spm-53 REMOVED). The profile-config
  JSON helpers (spm-52) are reused unchanged, nested per controller.
- `synth-patch-persistence`: the patch document format stores the instrument
  section in place of the single `midiProfile` section and requires it
  (spp-2); save/load APIs and the miniapp flow speak instrument
  configuration (spp-4, spp-5); serialize/load patch messages carry the
  instrument config (spp-7); the miniapp integration's load/revert rebuild
  references the instrument (spp-8).

## Impact

- `projects/synth/include/synth`: `MidiController.hpp` (profile kind,
  instrument config type), `Engine.hpp` (instrument state, per-controller
  processor sets, reconnect hooks), `PatchPersistence.hpp` (document format).
- `projects/synth/runtime`: `Shell.hpp`, `MidiPanel.hpp` are reworked into
  the new UI framework components (sidebar, pages); new IO poll thread and
  device-change reconciliation on the message thread; `juce/MidiHandlers.hpp`
  gains per-controller open/close driven by the reconciler.
- `projects/synth/apps/miniapp`: front page stripped of file/MIDI config;
  hosts its UI through the framework.
- `projects/synth/tests`: rig-level tests for instrument persistence and
  reconnect reconciliation logic (JUCE-free where possible), plus
  multi-controller/many-parameter config coverage.
- Threading: one new thread (IO poll) with a new `ThreadId`, message-thread
  reconciliation only; audio-thread contracts unchanged.
