# Synth App Runtime — Plan 4: Audio Device Config + Patch Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user select the audio interface (not just system default), persist that selection in the patch document alongside the MIDI config, keep patch identity on the message side, and make Save fall through to Save As when no patch exists.

**Architecture:** `AudioDeviceState` mirrors `MidiEndpointState` end to end: a JUCE-free struct in `PatchPersistence.hpp`, an `audioDevice` section in the patch JSON, live+default pairs owned by the engine (default snapshotted post-`Init`), applied by `ApplyPatchMessage`, surfaced to the JUCE runtime via a consume-side notification. The runtime gains an audio-device combo next to the MIDI panel; the shell shows the current patch name read from `PatchManager` and re-routes empty Save to the Save As chooser.

**Tech Stack / Constraints:** identical to Plans 1–3 (C++20, zero warnings, JUCE only under runtime/apps/juce, house style, commit trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`, `make -C projects/synth all` + app link green per task). Reference precedents in-repo: `MidiEndpointState` (PatchPersistence.hpp/.cpp), the engine's default-profile snapshot and `SetMidiProcessorsRebuiltCallback` path (Engine.hpp), `MidiPanel.hpp`, `Shell.hpp`.

**OpenSpec:** implements tasks 9.1–9.5 (sar-15, sar-16, spp-2 delta).

---

### Task 1: AudioDeviceState through the persistence library

**Files:** Modify `projects/synth/include/synth/PatchPersistence.hpp`, `projects/synth/src/PatchPersistence.cpp`, tests alongside existing `ApplyPatchMessage`/patch-JSON tests.

**Interfaces produced:**
```cpp
struct AudioDeviceState {
    std::string outputDeviceName;  // empty = system default
    std::string inputDeviceName;   // empty = system default
};
JSON ToJSON(JsonArena& arena, const AudioDeviceState& state);
bool FromJSON(JSON json, AudioDeviceState& state);
// BuildPatchJSON gains `const AudioDeviceState& audioDevice = {}` (writes an
// "audioDevice" section only when either name is non-empty);
// LoadPatchJSON gains `AudioDeviceState* audioDevice = nullptr` (untouched when
// the section is absent);
// ApplyPatchMessage gains `AudioDeviceState& audioDevice, const AudioDeviceState&
// defaultAudioDevice` parameters (positioned after the endpoint pair): load
// applies the section when present; RevertAllToDefault restores the default.
```

- [ ] Steps: TDD — tests first (round-trip with named devices; absent-section load leaves state untouched; revert restores default; serialize omits section when empty), mirror the `MidiEndpointState` implementation for each function, update ALL existing `ApplyPatchMessage` call sites (Engine.hpp compiles against the new signature — pass engine members added in Task 2, or for this task default-constructed locals with a TODO-free comment noting Task 2 wires them; prefer landing Task 1+2 signatures together if simpler: it is acceptable to add the engine members in this task and do only the snapshot/notification in Task 2). Full suite green; commit `feat(synth): persist audio device selection in patch documents`.

### Task 2: Engine ownership and notification

**Files:** Modify `projects/synth/include/synth/Engine.hpp`, `projects/synth/tests/engine_tests.cpp`.

- [ ] Steps: engine members `audioDeviceState_`/`defaultAudioDeviceState_` wired into `ApplyPatchMessage` calls; post-`Init` snapshot next to the MIDI-profile snapshot; `AudioDeviceState& AudioDevice()` accessor plus `SetAudioDeviceChangedCallback(std::function<void()>)` invoked from the message tick (and startup-load path) whenever a consumed patch message changed the state — same pattern and ordering discipline as the MIDI rebuilt callback (fire after the change is fully applied; document thread = message thread). Tests: revert restores post-Init default; load with an `audioDevice` section fires the callback once with the new state visible; load without the section fires nothing. Commit `feat(synth): engine-owned audio device state with change notification`.

### Task 3: Runtime selector and apply-on-load

**Files:** Modify `projects/synth/runtime/MidiPanel.hpp` (or a sibling `AudioPanel` section in the same chrome row — smallest honest layout), `projects/synth/runtime/Runtime.hpp`.

- [ ] Steps: audio output-device combo (from `deviceManager_.getCurrentDeviceTypeObject()->getDeviceNames()`; input combo only when `config.numAudioInputs > 0`) with "System Default" as the empty-name entry; selection on the message thread updates `engine.AudioDevice()`, then switches via `AudioDeviceSetup.outputDeviceName` + `setAudioDeviceSetup(..., true)` (which re-fires `audioDeviceAboutToStart` → re-Prepare; log the setup error string if non-empty — precedent commit adf0181); `Runtime::Start` wires `SetAudioDeviceChangedCallback` BEFORE `engine.Initialize()` so startup patches apply too: callback applies the named device when present in the enumerated names (absent → status label text + INFO, keep current device, no failure) and syncs the combo selection. Gates: app links, suite green. Commit `feat(synth-runtime): audio device selection applied from patches`.

### Task 4: Patch identity display and Save fallback

**Files:** Modify `projects/synth/runtime/Shell.hpp`, `projects/synth/runtime/Runtime.hpp`, `projects/synth/apps/miniapp/README.md`, `projects/synth/README.md`.

- [ ] Steps: shell chrome shows the current patch name derived from `engine.Patches().CurrentPatchDirectory()` (directory filename; "(no patch)" when unset), refreshed on the repaint tick — identity read from the message-side owner only, never cached audio-side (sar-16); `Runtime::SavePatch` (or the shell button handler) checks `CurrentPatchDirectory()`: unset → invoke the existing Save As flow instead of dispatching a doomed `SavePatch` (keep the `NeedsSaveAsPath` handling as a backstop); README notes for both. Gates: app links, suite green. Commit `feat(synth-runtime): show current patch and fall through to Save As`.

### Task 5: Verification and re-sync

- [ ] Steps: clean `make -C projects/synth all` + `make -C projects/synth miniapp`; launch probe (session log shows device selection lines; if a second output device exists, switch to it and confirm `Audio prepared` re-fires with its values); re-sync the updated deltas (spp-2, sar-15, sar-16) to main specs; check off OpenSpec 9.x. No commit unless fixes needed (sync commit expected).
