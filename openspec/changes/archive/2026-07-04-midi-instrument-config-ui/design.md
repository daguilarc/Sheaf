# Design: midi-instrument-config-ui

## Context

Today the engine holds exactly one live `MidiControllerProfileConfig` plus a
global `MidiEndpointState` (one input identifier, one output identifier).
Devices are opened manually from `MidiPanel` (preset combo, device combos,
Refresh button); there is no hotplug detection — a vanished device silently
stops delivering callbacks. The shell (`runtime/Shell.hpp`) stacks a patch
command row, the `MidiPanel`, an `AudioPanel`, and the app component. Output
processors (`TwisterMidiOutProcessor`, `WrldBldrMidiOutProcessor`,
Launchpad feedback) keep last-sent caches (the "debounce" state) with a
`Reset()` that forces a full resend. `MidiSender` is a single worker thread
with a single `IMidiOutputSink`.

Reference UI: SmartGridOne (`~/theallelectricsmartgrid`,
`JUCE/SmartGridOne/Source/MainComponent.*`, `ConfigPage.hpp`) — a 50px
right-hand sidebar with Config/File buttons and a CPU label showing
`RollingBuffer<256>::Max()` of `deviceManager.getCpuUsage()*100` updated at
60fps, and a config page of per-controller sections with dropdown rows.

No users yet: patch-format and API breaks are free.

## Goals / Non-Goals

**Goals:**

- One stored configuration object — the *instrument*: controller name →
  profile (kind + config + preferred endpoints) — independent of connection
  state, persisted in patches, seeded by the app default.
- Self-healing connections: connect everything in the map at startup, detect
  USB MIDI topology changes within ~5 seconds, reconnect or mark offline
  without user action, resync controller LEDs after reconnect.
- Library-provided UI: main pane + sidebar (Audio / Controllers / File tabs,
  deadline readout), config pages that overlay the app content and return to
  it, scrollable mapping editors that stay usable with several controllers
  and dozens of mappings.
- Keep reconciliation and UI list-building logic JUCE-free and unit-testable.

**Non-Goals:**

- Backward compatibility with existing patch JSON (`midiProfile` +
  `midiEndpoints` sections) — replaced outright, no migration.
- Editing profile *kinds'* built-in position math (e.g. Launchpad note maps).
- Multi-instrument support: exactly one instrument per app/patch.
- MIDI 2.0, network/BLE MIDI — USB device list only, as JUCE reports it.

## Decisions

### D1 — Instrument model in the JUCE-free library

`include/synth/MidiController.hpp` gains:

- `enum class MidiProfileKind { WrldBldr, MfTwister, Launchpad, Generic }`.
- `MidiEndpointRef { std::string identifier; std::string name; }` — a
  stored, best-effort matching key (empty = unconfigured). Persisting the
  device *name alongside the identifier* is what makes name-fallback
  matching well-defined after an identifier changes across replug.
- `MidiControllerSlot { std::string name; MidiProfileKind kind;
  MidiControllerProfileConfig config; MidiEndpointRef input;
  MidiEndpointRef output; }` — the persisted unit. Endpoint refs are
  preferences, not connection state.
- `MidiInstrumentConfig { std::vector<MidiControllerSlot> controllers; }` —
  vector, not map: stable UI order, small N. Names unique (enforced on
  add/load).
- Kind support is a *validity* rule, not just a display rule, and it goes
  below the section level: a slot whose config populates a section its
  kind doesn't support (e.g. launchpad with encoder mappings), or whose
  `systemMessages` entries carry a kind-unsupported address/feedback
  variant (wrldbldr: chan/CC + WRLD.Bldr feedback positions; twister:
  chan/CC only; launchpad: Launchpad positions only; generic: chan/CC
  only), is invalid — rejected at instrument-JSON load and by UI commit;
  the factory additionally builds only kind-supported associations
  (defense in depth).

Rationale: the kind drives which config submenus the UI shows and which
default factory seeds a new controller; keeping endpoints per-controller
(replacing the global `MidiEndpointState`) is what makes reconnect-by-name
possible. Alternative considered: keep profiles keyed by kind only (no
names) — rejected, two Launchpads must coexist.

Kind capability matrix (drives UI section visibility and factory choice):

| kind      | encoders | system messages | analogs/gestures |
|-----------|----------|-----------------|------------------|
| wrldbldr  | yes      | yes             | yes              |
| twister   | yes      | yes (side btns) | no               |
| launchpad | no       | yes             | no               |
| generic   | yes      | yes             | yes              |

### D2 — Engine holds the instrument; processors built per controller

`Engine` replaces `midiProfileConfig_`/`endpoints_` with
`MidiInstrumentConfig instrumentConfig_` (live, message-thread-owned) plus a
post-`Init` default snapshot for revert/new. `RebuildMidiProcessors()`
becomes per-controller: for each slot, the profile factory builds an input
chain and output processors tagged with the controller index. All input
chains feed the single MIDI input bus (unchanged audio-side contract); all
output processors poll the same UI state.

`MidiSender` stays one worker thread but routes by sink index:
`Enqueue(controllerIx, BasicMidi)` and `SetSink(controllerIx, sink)`.
Alternative — one sender thread per controller — rejected: more threads, no
benefit at these rates.

### D3 — Connection reconciliation is a pure library function

The decision logic lives JUCE-free in the library:

```
ReconcilePlan PlanMidiReconciliation(
    const MidiInstrumentConfig&, const MidiDeviceList& present,
    const MidiConnectionState& current);
```

where `MidiDeviceList` is plain vectors of `{identifier, name}` for inputs
and outputs, `MidiConnectionState` is per-controller, per-endpoint state —
a status enum (`online` / `offline` / `unconfigured`) plus the open
identifier when online — so mark-offline/online actions and idempotence
are defined purely from planner inputs, and `ReconcilePlan` is a list of
actions: open input/output (controller ix + identifier), close
input/output, mark endpoint offline/online, update a slot's stored
`MidiEndpointRef` (identifier + name rewritten after a name-fallback
match), and resync (clear output caches + force feedback resend, emitted
when a plan opens an output endpoint). Matching prefers exact identifier
against the stored ref, falls back to the stored device name (identifiers
can change across replug on some platforms); an empty ref is unconfigured
and inert — no open attempt, no offline marking. The runtime executes the
plan with JUCE handlers.

Rationale: hotplug logic is the reliability-critical core; as a pure
function it gets exhaustive JUCE-free tests (device disappears, reappears
with new identifier, name collision, partial endpoints, empty preferences).

### D4 — IO poll thread detects changes; message thread acts

New `ThreadId::IoPoll`. A runtime-owned `MidiDevicePoller` thread wakes
every 5 s, snapshots the JUCE MIDI input/output device lists, compares
identifiers+names against its previous snapshot, and on any difference sets
an atomic dirty flag (and stores the fresh list under a mutex). The
runtime's existing message-thread timer consumes the flag, re-enumerates on
the message thread (authoritative list), runs `PlanMidiReconciliation`, and
executes the plan. The poller never opens/closes devices and never touches
engine state.

- Startup: after MIDI processors are built and mapped controllers are
  connected once (generalizing `ReopenPersistedEndpoints` to all slots), the
  poller starts. Shutdown: poller is stopped and joined before MIDI devices
  close (mirroring the MidiSender ordering in sar-5).
- Reconnect actions rebuild the forwarding processor for that controller's
  input handler (reusing the existing mutex-guarded swap) and call the
  resync action: output processor `Reset()` so caches repaint the hardware.
- Risk hedge: if `getAvailableDevices()` proves unsafe off the message
  thread on some platform, the poller degrades to a 5 s tick that only asks
  the message thread to enumerate — the architecture (flag + message-thread
  reconcile) already supports this; only the comparison site moves.

Alternative considered: JUCE `MidiDeviceListConnection` callbacks
(push-based). Rejected as the primary mechanism: polling is deterministic,
testable, and the user explicitly asked for a 5 s poll thread; the callback
can be added later as an accelerator without changing the reconcile path.

### D5 — UI framework: main pane, sidebar, page host

New components in `runtime/` (namespace `synth_runtime`), offered as
library pieces the app opts into (the shell uses them by default):

- `MainPane<App>`: fills the window; right-hand `Sidebar` (fixed width) and
  a content host taking the rest, both relaid on resize. The content host
  shows exactly one of: the app's `UIComponent()` (default) or a library
  page. Opening a page hides the app component; Back (and page "done"
  actions) restore it.
- `Sidebar`: buttons **Audio**, **Controllers**, **File** and a deadline
  label showing the max-recent audio callback load percentage: a
  `RollingBuffer<256>`-style rolling max of
  `AudioDeviceManager::getCpuUsage()*100`, written each UI timer tick,
  rendered as e.g. `7.3%` (SmartGridOne pattern).
- `AudioConfigPage`: the existing `AudioPanel` device selection re-homed
  (output combo, input combo when the app requests inputs, status line).
- `FilePage`: patch commands (New/Save/Save As/Load/Revert), current patch
  name, and command status — moved out of the shell's top chrome row, which
  is deleted.
- `ControllersPage`: see D6.

`ShellComponent` becomes a thin host: it creates `MainPane` and nothing
else. sar-16's "chrome shows patch name / Save falls through to Save As"
behavior moves into `FilePage` (+ sidebar-visible current patch name is
dropped — the File page is the identity surface).

Alternative considered: JUCE `TabbedComponent`. Rejected: the sidebar mixes
navigation buttons with status readouts (deadline %, later more), and pages
replace the app area rather than sitting in a tab strip.

### D6 — Controllers page: rows + collapsible config, JUCE-free view model

`ControllersPage` renders inside a `juce::Viewport` (vertical scroll):

- One row per controller in map order: name, kind, connection dot
  (online/offline per endpoint), input device combo, output device combo
  (listing actual present devices plus the stored preference when absent),
  and a disclosure triangle for **Config** (collapsed by default).
- Config expands to submenus — **Encoders**, **System Messages**,
  **Analogs/Gestures** — each independently collapsible and collapsed by
  default, and skipped entirely when the kind doesn't support them (D1
  matrix). Submenu bodies are scrollable mapping lists:
  - Encoders: rows of `chan/cc → slot ix / position` for turns and pushes,
    plus relative mode and turn step.
  - System messages: controller-appropriate address (chan/cc, Launchpad
    (x,y), Twister side-button) → press/release `MessageIn`.
  - Analogs: `chan/cc → gesture ix` and the scene-blend assignment.
- A **+** button appends a controller: name prompt + kind choice, seeded
  from that kind's default profile factory.

The expand/collapse state, row construction, and edit operations live in a
JUCE-free view model (`include/synth`): a structure that, given a
`MidiInstrumentConfig` and per-controller connection state, yields the row
tree (sections present, labels, mapping row values) and applies edits
(add/remove/modify mapping, add controller, set device preference) back to
the config. JUCE components are thin renderers over it. Rationale: "test
well with multiple controllers and many configs" is only cheap if the tree
logic is headless; JUCE-level tests would be slow and flaky.

Committed edits apply to the engine's live instrument config from the
message thread and trigger the per-controller processor rebuild and
reconciliation. Threading: sar-7 is unchanged — patch messages (including
loads that replace the instrument) are still drained by the audio thread at
the block boundary; UI edits are therefore *serialized against* that drain
rather than racing it (the engine exposes a message-thread edit entry point
that hands the mutation through the same block-boundary application the
patch path uses, or an equivalent lock-guarded handoff — mirroring the
existing audio-device-state shadow/lock pattern). Both paths converge on
the same message-thread rebuild + reconcile, so UI edits and patch loads
cannot diverge.

### D7 — Persistence: `midiInstrument` section replaces `midiProfile`

Patch JSON gains one section:

```json
"midiInstrument": {
  "schema": "synth.midiInstrument", "schemaVersion": 1,
  "controllers": [
    { "name": "left pad", "kind": "launchpad",
      "input":  { "identifier": "<id>", "name": "<device name>" },
      "output": { "identifier": "<id>", "name": "<device name>" },
      "profile": { ...existing MidiControllerProfileConfig JSON... } }
  ]
}
```

`midiProfile` and the separate endpoint state disappear from the document
(**BREAKING**, no migration): a document without a `midiInstrument` section
— including every legacy document — fails patch validation; a section with
zero controllers is valid. The existing profile-config JSON round-trip is
reused verbatim inside each controller entry; loads reject unknown kinds,
duplicate names, and kind-unsupported config sections (D1). Serialize-side
(`spp-7`) message payloads carry the instrument config instead of
profile + endpoints.

### D8 — Testing strategy

- **JUCE-free unit tests**: reconcile planner (D3) truth-table coverage;
  instrument JSON round-trip incl. kind/name validation; view-model tree
  building and edits for all four kinds, multiple controllers, dozens of
  mappings; MidiSender multi-sink routing.
- **Rig tests** (`SynthRig`): instrument persists through save/load/revert
  through production patch messages; per-controller processor rebuild keeps
  MIDI input flowing after a simulated reconnect (inject reconcile plan
  execution); resync clears output caches (first post-reconnect snapshot
  resends full state).
- **Runtime/manual**: poller thread lifecycle under startup/shutdown (no
  leaks/races under TSan if available), and a smoke checklist: unplug,
  replug, cold-start with device attached/detached, two controllers.

## Risks / Trade-offs

- [JUCE device enumeration off the message thread may be platform-fragile]
  → D4's degraded mode: poller only schedules message-thread enumeration;
  reconcile path unchanged.
- [Device identifiers may differ after replug] → name-based fallback match
  in the planner; identifier preference refreshed to the matched device on
  successful open.
- [Two identical controllers (same name string in device list)] → planner
  matches deterministically in list order and never assigns one physical
  device to two controller slots in the same plan; remaining ambiguity is
  surfaced as offline rather than guessed.
- [UI churn: rebuilding processors on every mapping edit] → rebuilds are
  message-thread, already the patch-load path; debounce: apply on commit
  (row edit finished), not per keystroke.
- [Removing shell chrome breaks current muscle memory/tests] → rig tests
  don't touch chrome; miniapp system tests updated in the same change; no
  users otherwise.
- [Poll interval 5 s misses rapid replug cycles] → acceptable; reconcile is
  idempotent from current state, so the next tick converges.

## Migration Plan

None (pre-user). Old patch files under any existing patches roots become
invalid; delete them. Miniapp and tests are updated in the same change —
the repo never passes through a state where the shell and miniapp disagree
about who owns file/MIDI UI.

## Open Questions

- Sidebar "File" as a page vs. immediate action cluster — designed as a page
  (D5) for symmetry; revisit if it feels heavy in use.
- Whether the deadline readout needs a configurable window (currently fixed
  ~256 UI frames, matching SmartGridOne).
