# MIDI Instrument Config — Plan 4/4: UI Framework + Controllers Page + Miniapp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The library UI framework — main pane with right sidebar (Audio/Controllers/File + max-recent-deadline readout), Audio/File/Controllers pages with the JUCE-free controllers-page view model — and the miniapp stripped to a config-free front page hosted through the framework.

**Architecture:** `MainPane<App>` owns a fixed-width right `Sidebar` and a content host showing exactly one of: the app's `UIComponent()` or a library page. `ShellComponent` (runtime/Shell.hpp) becomes a thin `MainPane` host — the patch chrome row, `MidiPanel` strip, and `AudioPanel` strip are deleted from the shell layout. Pages: `AudioConfigPage` (re-homed AudioPanel logic), `FilePage` (patch commands + identity + Save→SaveAs fallback), `ControllersPage` (thin JUCE renderer over a JUCE-free view model in `include/synth`). Deadline readout = rolling max over 256 UI frames of `deviceManager.getCpuUsage()*100` (SmartGridOne `RollingBuffer<256>::Max()` pattern, `~/theallelectricsmartgrid/private/src/RollingBuffer.hpp`).

**Tech Stack:** C++20; JUCE only under `runtime/`, `juce/`, `apps/`; view model JUCE-free.

**OpenSpec change:** `openspec/changes/midi-instrument-config-ui` — implements task groups 6, 7, 8 of `tasks.md`; requirements sru-1..sru-7, sar-10, sar-15, sar-16, spm-37, spm-45, sar-11 parity.

## Global Constraints

- Plans 1–3 landed: instrument model, per-controller engine surface, `MidiConnectionManager` (`State()`, `EnumerateNow()`, reconcile-on-edit), `engine.EditInstrument(...)`.
- Core stays JUCE-free/green (`make -C projects/synth build test`); app links per task (`make -C projects/synth miniapp`); zero warnings; house style; commit trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Sidebar layout (sru-1/sru-2, binding): fixed width 96 px, right edge; entries top-down: Audio, Controllers, File buttons (each 96×40), deadline label (96×40) below; content host fills the remainder; resize relays out both. One page open at a time; opening a page hides the app component (`setVisible(false)` — component state retained, sru-1); Back control at the top of every page returns to the app.
- Deadline readout (binding): `RollingMax256` of `deviceManager_.getCpuUsage() * 100.0`, written once per UI timer tick, rendered `%.1f%%`. Implement `RollingMax256` as a small JUCE-free struct in the view-model header (write/read on the message thread only).
- All page edits commit through `engine.EditInstrument` + `connectionManager_` reconcile — never mutate config or handlers directly from components (smi-8).
- Kind-driven UI: submenus rendered ONLY when `KindSupport(kind)` allows; add-controller seeds from the kind default factory (`WrldBldrDefaultProfileConfig()` / `MfTwisterDefaultProfileConfig()` / `LaunchpadDefaultProfileConfig()` / empty config for generic); UI can never produce a slot violating `SlotValidForKind` (commit is refused with the reason shown in a status label).
- Mapping lists live inside `juce::Viewport`s; row edits commit on focus-loss/return (not per keystroke).
- Miniapp front page (spm-37, binding): after this plan `apps/miniapp/MiniApp.hpp` contains NO patch, file, MIDI-device, or controller-preset controls — grep-verifiable: no `FileChooser`, no device combo, no preset combo in the app component.
- Commit per task.

---

### Task 1: Controllers-page view model (JUCE-free)

**Files:**
- Create: `projects/synth/include/synth/MidiConfigViewModel.hpp`, `projects/synth/src/MidiConfigViewModel.cpp`
- Create: `projects/synth/tests/viewmodel_tests.cpp` (+ Makefile binary)

**Interfaces:**
- Produces (the JUCE page renders exactly this tree):

```cpp
namespace synth {
struct RollingMax256 { void Write(float v); float Max() const; /* 256-slot ring */ };

struct MidiMappingRowVM {              // one editable row
    enum class Field { Channel, Cc, SlotIx, Position, RelativeMode, TurnStep,
                       PressMessage, ReleaseMessage, LaunchpadX, LaunchpadY,
                       WrldBldrX, WrldBldrY, GestureIx, SceneBlend };
    std::string label;                  // e.g. "ch 0 / cc 12 -> slot 0 pos 3"
    // typed field accessors omitted here; VM exposes Get/Set by (rowId, Field)
};
enum class MidiConfigSection { Encoders, SystemMessages, Analogs };

struct MidiControllerRowVM {
    std::string name; MidiProfileKind kind;
    MidiEndpointStatus inputStatus, outputStatus;
    std::string inputDeviceLabel, outputDeviceLabel;   // present name, stored ref when absent
    bool configExpanded;                               // starts false
    std::vector<MidiConfigSection> sections;           // kind-filtered, each starts collapsed
};

class MidiConfigViewModel {
public:
    void Rebuild(const MidiInstrumentConfig&, const MidiConnectionState&);
    const std::vector<MidiControllerRowVM>& Controllers() const;
    void ToggleConfig(std::size_t controllerIx);
    void ToggleSection(std::size_t controllerIx, MidiConfigSection);
    bool SectionExpanded(std::size_t controllerIx, MidiConfigSection) const;
    std::vector<MidiMappingRowVM> SectionRows(std::size_t controllerIx, MidiConfigSection) const;
    // Edits return false (with reason) when they would violate validity; on true,
    // `out` holds the edited instrument for the host to commit via EditInstrument.
    bool ApplyMappingEdit(std::size_t controllerIx, MidiConfigSection, std::size_t rowIx,
                          MidiMappingRowVM::Field, double value,
                          MidiInstrumentConfig& out, std::string* reason = nullptr);
    bool AddController(std::string name, MidiProfileKind kind,
                       MidiInstrumentConfig& out, std::string* reason = nullptr);
    bool SetEndpointRef(std::size_t controllerIx, bool output, MidiEndpointRef ref,
                        MidiInstrumentConfig& out);
};
}
```

**Steps:**
- [ ] **Step 1: Failing tests.** Build VM from a 4-controller instrument (all four kinds) + mixed connection state: rows in order; launchpad row's `sections` lacks Encoders/Analogs; twister lacks Analogs; all `configExpanded` false and every section collapsed initially; toggles flip and survive `Rebuild` (state keyed by controller name); `SectionRows` for a wrldbldr with the default profile lists 16 encoder turn rows + pushes; `ApplyMappingEdit` on an encoder row's Position produces an `out` whose mapping changed and nothing else (compare JSON serialization); illegal edit (e.g. adding a launchpad section row that would carry a WRLD.Bldr position) returns false + reason, `out` untouched; `AddController` dup name → false; `AddController("pads", Launchpad)` seeds the launchpad default profile; `SetEndpointRef` writes the slot ref; offline row shows stored-ref label; dozens-of-mappings scale check: 4 controllers × 64 rows rebuild under 10 ms (sanity bound, `std::chrono` assert with generous margin); `RollingMax256` returns the max of the last 256 writes and forgets older spikes.
- [ ] **Step 2:** Run — fails.
- [ ] **Step 3:** Implement (pure data transforms over the Plan 1 model; expand/collapse state in `std::map<std::string, ...>` keyed by controller name).
- [ ] **Step 4:** Suite green (JUCE-free).
- [ ] **Step 5: Commit** — `feat(synth): JUCE-free MIDI config view model with rolling max`.

---

### Task 2: MainPane + Sidebar + deadline readout

**Files:**
- Create: `projects/synth/runtime/MainPane.hpp` (namespace `synth_runtime`: `MainPane<App>`, `Sidebar`)
- Modify: `projects/synth/runtime/Shell.hpp` (ShellComponent hosts MainPane only; delete the patch row / MidiPanel strip / AudioPanel strip layout), `projects/synth/runtime/Runtime.hpp` (expose what pages need; UI timer writes the deadline sample)

**Interfaces:**
- Produces:

```cpp
template <synth::SynthApplication App>
class MainPane : public juce::Component {
public:
    enum class Page { None, Audio, Controllers, File };
    MainPane(Runtime<App>& runtime);
    void ShowPage(Page page);              // None = app component
    Page CurrentPage() const;
    void WriteDeadlineSample(float pct);   // runtime timer calls each tick
    void resized() override;               // sidebar 96px right, content rest
};
```

**Steps:**
- [ ] **Step 1:** Implement `Sidebar` (three `juce::TextButton`s + deadline `juce::Label`, callbacks into `MainPane::ShowPage`) and `MainPane` (content host swaps visibility between app component and the open page; pages constructed lazily in Tasks 3–5 — for THIS task, `ShowPage` for unbuilt pages shows a placeholder `juce::Label` with the page name so the pane is testable before the pages exist). ShellComponent reduces to: create MainPane, `addAndMakeVisible`, `resized` = full bounds. Runtime timer tick calls `mainPane_->WriteDeadlineSample(deviceManager_.getCpuUsage()*100.0f)` and repaints the sidebar label.
- [ ] **Step 2:** Build: core suite green, miniapp links and launches showing app content + sidebar; clicking a tab shows the placeholder, Back returns.
- [ ] **Step 3: Commit** — `feat(synth-runtime): main pane with sidebar and deadline readout`.

---

### Task 3: AudioConfigPage + FilePage

**Files:**
- Create: `projects/synth/runtime/AudioConfigPage.hpp`, `projects/synth/runtime/FilePage.hpp`
- Modify: `projects/synth/runtime/MainPane.hpp` (wire real pages), `projects/synth/runtime/Shell.hpp` (move the Save→SaveAs fallback + FileChooser logic here from the old chrome handlers), `projects/synth/runtime/MidiPanel.hpp` (delete `AudioPanel` after re-homing)

**Steps:**
- [ ] **Step 1:** `AudioConfigPage`: Back button; output combo ("System Default" + `deviceManager_.getCurrentDeviceTypeObject()->getDeviceNames(false)`); input combo only when `App::Config().numAudioInputs > 0`; status label; selection routes through the existing `Runtime::ApplyAudioDeviceSelection` path (sar-15 behavior unchanged); combo syncs on engine audio-device-changed callback.
- [ ] **Step 2:** `FilePage`: Back; New/Save/SaveAs/Load/Revert buttons; current patch name label from `engine.Patches().CurrentPatchDirectory()` ("(no patch)" when unset, refreshed on repaint tick); status label per command; Save with no current directory launches the SaveAs chooser (sar-16). Delete the shell's old patch row handlers.
- [ ] **Step 3:** Build + launch: both pages function, return to app; save/load round-trip from the File page.
- [ ] **Step 4: Commit** — `feat(synth-runtime): audio and file pages in the main pane`.

---

### Task 4: ControllersPage

**Files:**
- Create: `projects/synth/runtime/ControllersPage.hpp`
- Modify: `projects/synth/runtime/MainPane.hpp` (wire), `projects/synth/runtime/MidiPanel.hpp` (DELETE the file — its device-selection role is superseded; forwarding-swap helpers live in `MidiConnectionManager` since Plan 3)

**Steps:**
- [ ] **Step 1:** Render the VM: outer `juce::Viewport`; per `MidiControllerRowVM` a row component — name label, kind label, per-endpoint status dots (green Online / red Offline / grey Unconfigured), input/output device combos (populate from `connectionManager_.EnumerateNow()` + "None" + stored-ref-when-absent entry), config disclosure triangle; expanded config renders kind-filtered section headers with their own disclosure triangles; section bodies are inner mapping-list components (label + numeric/text editors per `MidiMappingRowVM::Field`) inside the outer viewport; "+" button bottom: name text editor + kind combo + Add (VM `AddController` → `EditInstrument` commit; reason label on refusal).
- [ ] **Step 2:** Wire edits: every successful VM edit result commits via `engine.EditInstrument([&](auto& inst){ inst = out; })`; the rebuilt-callback path (Plan 3) rebuilds processors + reconciles; device combo selection goes through `SetEndpointRef` the same way. Page refreshes its VM from `connectionManager_.State()` on the repaint tick (cheap: rebuild only when a dirty flag from state/instrument changes is set).
- [ ] **Step 3:** Build + launch with hardware: two controllers listed with live state; expand/collapse; edit an encoder mapping and verify the hardware drives the new position; add a controller via "+".
- [ ] **Step 4: Commit** — `feat(synth-runtime): controllers page over the config view model`.

---

### Task 5: Miniapp adoption + parity

**Files:**
- Modify: `projects/synth/apps/miniapp/MiniAppCore.hpp` (default instrument: one slot `{"wrldbldr", MidiProfileKind::WrldBldr, WrldBldrDefaultProfileConfig(...)}` seeded in `Init` through the context instrument pointer — spm-45), `projects/synth/apps/miniapp/MiniApp.hpp` (strip any residual config chrome), `projects/synth/tests/miniapp_system_tests.cpp`

**Steps:**
- [ ] **Step 1: Failing tests.** Rig-hosted: miniapp core's post-Init default instrument contains exactly one wrldbldr controller with the default profile (assert name/kind + encoder mapping spot-checks); existing encoder/scene/gesture/patch-round-trip system tests updated to the instrument surface and green.
- [ ] **Step 2:** Implement; grep-verify the front page: `grep -n "FileChooser\|ComboBox" projects/synth/apps/miniapp/MiniApp.hpp` shows no config controls (encoder widgets/waveform/buttons/sliders remain).
- [ ] **Step 3:** Full suite + app build green.
- [ ] **Step 4: Commit** — `feat(synth): miniapp adopts the instrument model and main pane framework`.

---

### Task 6: End-to-end verification, spec sync, sign-off

- [ ] **Step 1:** `make -C projects/synth build test` + `make -C projects/synth miniapp` clean from scratch.
- [ ] **Step 2:** Manual smoke checklist (OpenSpec task 8.4) with real hardware: cold start attached and detached; unplug → offline ≤ 5 s; replug → reconnect + LED resync; two controllers simultaneously; "+" add controller; live mapping edit; Audio/File pages round-trip; deadline readout moves under load. Record results in the session log.
- [ ] **Step 3:** Sync delta specs to main specs (`opsx:sync` flow), check off `tasks.md` 6.x, 7.x, 8.1–8.3; present the smoke results and request USER sign-off for 8.4 — do not check 8.4 without it.
- [ ] **Step 4: Commit** — `Check off OpenSpec tasks 6.x-8.x` (8.4 only after sign-off).
