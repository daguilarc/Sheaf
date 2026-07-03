# MIDI Instrument Config — Plan 2/4: Per-Controller Processors + Reconciliation Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the engine build MIDI processors per controller slot, route MIDI output through per-controller sinks on the single sender worker, and add the pure JUCE-free reconciliation planner that decides opens/closes/offline-marking/ref-updates/resyncs from instrument config + present devices + connection state.

**Architecture:** `Engine::RebuildMidiProcessors` iterates `LiveInstrument().controllers`, producing `std::vector<MidiControllerProfileResult>` (one per slot, same factory per slot as today's single call). `MidiSender` keeps one worker thread and one queue; each queued `BasicMidi` carries a sink index; sinks are registered per controller. The planner is a pure function over plain structs — no JUCE, no IO — exhaustively unit-tested (this is the reliability core of self-healing reconnect).

**Tech Stack:** C++20, GNU make, repo micro test framework. Everything in this plan is JUCE-free.

**OpenSpec change:** `openspec/changes/midi-instrument-config-ui` — implements task groups 3 and 4 of `tasks.md`; requirements smi-3, smi-7, sar-9 (library side), smi-8 (rebuild path).

## Global Constraints

- Plan 1 landed: `MidiProfileKind`, `MidiEndpointRef`, `MidiControllerSlot`, `MidiInstrumentConfig`, `SlotValidForKind`, engine `LiveInstrument()/DefaultInstrument()/EditInstrument(...)` exist exactly as specified there.
- C++20, zero warnings, JUCE-free tests with the `#error` guard, house style, suite green per task, commit trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- All controller input chains feed the SINGLE existing MIDI input bus; all output processors poll the SAME manager UI state — audio-thread contracts (sar-7) unchanged.
- `MidiSender` stays ONE worker thread (`ThreadId::MidiSender`), one condition variable, one bounded queue (capacity semantics unchanged). No per-controller threads.
- Planner is deterministic and pure: no clocks, no randomness, no IO, no JUCE types; identical inputs → identical plans; slot-order determinism for contention.
- Planner matching (smi-3, binding): exact identifier match against the slot's stored ref first; fallback to stored `name` match; one present device assigned to at most one slot per plan (first matching slot in order wins; the loser gets no open and — if previously online — a close+offline); empty ref (`!IsConfigured()`) → no actions, status stays `Unconfigured`; name-fallback match emits an `UpdateInputRef`/`UpdateOutputRef` action carrying the matched identifier+name; every plan that opens an OUTPUT endpoint includes a `Resync` action for that controller (input-only opens do not).
- Commit per task.

---

### Task 1: MidiSender per-controller sink routing

**Files:**
- Modify: `projects/synth/include/synth/MidiController.hpp` (MidiSender, `MidiController.hpp:211-240`), `projects/synth/src/MidiController.cpp` (`:534-631`)
- Modify: the existing MidiSender unit tests (locate via `grep -l MidiSender projects/synth/tests/`)

**Interfaces:**
- Produces (breaking — update all call sites; no users):

```cpp
class MidiSender {
public:
    static constexpr std::size_t kMaxSinks = 8;
    void SetSink(std::size_t sinkIx, IMidiOutputSink* sink);  // nullptr clears; >= kMaxSinks ignored
    bool Enqueue(std::size_t sinkIx, const BasicMidi& midi);  // false when queue full or sinkIx >= kMaxSinks
    // Start/Stop/IsRunning/FlushForTests unchanged.
};
```

- Worker drain: message with `sinkIx` whose sink is currently null is DROPPED silently (smi-7 offline drop) — worker never blocks on it, other sinks unaffected. Sink pointer reads/writes guarded by the existing mutex.

**Steps:**
- [ ] **Step 1: Failing tests.** Two fake `IMidiOutputSink`s recording received messages: enqueue to ix 0 and ix 1, `FlushForTests`, assert each sink got only its own messages in order; enqueue to an ix with null sink → returns true (queued) but message dropped after flush, other sink's traffic delivered; enqueue with `sinkIx >= kMaxSinks` returns false; `SetSink` swap mid-stream delivers subsequent messages to the new sink.
- [ ] **Step 2:** Run — fails to compile (old single-sink API).
- [ ] **Step 3:** Implement: queue entries become `{std::size_t sinkIx; BasicMidi midi;}`; `sinks_` is `std::array<IMidiOutputSink*, kMaxSinks>`; update every existing call site (`grep -rn "SetSink\|Enqueue(" projects/synth` — engine wiring, output processors, tests) to pass an explicit index (0 where a single controller exists today).
- [ ] **Step 4:** Suite green.
- [ ] **Step 5: Commit** — `feat(synth): MidiSender routes per-controller output sinks`.

---

### Task 2: Per-controller processor rebuild in the engine

**Files:**
- Modify: `projects/synth/include/synth/Engine.hpp` (member `midiProcessors_` at `Engine.hpp:806`, `RebuildMidiProcessors()` at `:521`, accessor `MidiInputProcessor()` at `:424`)
- Modify: `projects/synth/tests/engine_tests.cpp`, `projects/synth/tests/support/SynthRig.hpp` (rig `SendMidi`/`InstallMidiProfileForTest` surfaces)

**Interfaces:**
- Produces (Plan 3 runtime + rig compile against these):

```cpp
std::size_t MidiControllerCount() const;                       // == LiveInstrument().controllers.size()
MidiInProcessor* MidiInputProcessor(std::size_t controllerIx); // nullptr when ix out of range or no input chain
void ResetMidiOutputProcessors(std::size_t controllerIx);      // clears that controller's output caches (resync)
// RebuildMidiProcessors(): per-slot factory invocation; output processors of
// slot i are constructed enqueueing to sender sink index i.
```

- Rig: `SynthRig::SendMidi(controllerIx, BasicMidi)` (old single-arg form removed); `InstallInstrumentForTest(MidiInstrumentConfig)` replaces `InstallMidiProfileForTest`.

**Steps:**
- [ ] **Step 1: Failing tests** (rig-hosted): install a two-controller instrument (wrldbldr defaults + twister defaults, distinct slots); send a mapped encoder CC through controller 0's chain and a mapped CC through controller 1's chain — both drive their parameters through the single MIDI bus; each controller's output feedback lands only on its own fake sink index; `ResetMidiOutputProcessors(1)` forces controller 1's next output pass to resend all mapped positions while controller 0's caches stay warm (assert no resend for 0); rebuild after an `EditInstrument` that removes controller 1 → `MidiControllerCount()==1`, `MidiInputProcessor(1)==nullptr`.
- [ ] **Step 2:** Run — fails.
- [ ] **Step 3:** Implement: `std::vector<MidiControllerProfileResult> midiProcessors_`; per-slot `CreateMidiControllerProfile(slot.config, ...)` with sink index i; wire `EditInstrument`/patch-load consumption to the same rebuild (smi-8: one rebuild path).
- [ ] **Step 4:** Full suite green (update remaining single-controller assumptions found by compile errors).
- [ ] **Step 5: Commit** — `feat(synth): per-controller MIDI processor rebuild with sink routing`.

---

### Task 3: Reconciliation types and planner

**Files:**
- Create: `projects/synth/include/synth/MidiReconcile.hpp`, `projects/synth/src/MidiReconcile.cpp`
- Create: `projects/synth/tests/reconcile_tests.cpp` (+ Makefile binary)

**Interfaces:**
- Produces (Plan 3 executes these; exact):

```cpp
namespace synth {
enum class MidiEndpointStatus { Unconfigured, Offline, Online };

struct MidiEndpointConnection {
    MidiEndpointStatus status = MidiEndpointStatus::Unconfigured;
    std::string openIdentifier;   // meaningful only when Online
};
struct MidiControllerConnection { MidiEndpointConnection input; MidiEndpointConnection output; };
struct MidiConnectionState { std::vector<MidiControllerConnection> controllers; };

struct MidiDeviceInfoRef { std::string identifier; std::string name; };
struct MidiDeviceList { std::vector<MidiDeviceInfoRef> inputs; std::vector<MidiDeviceInfoRef> outputs; };

struct ReconcileAction {
    enum class Type {
        OpenInput, OpenOutput,          // identifier = device to open
        CloseInput, CloseOutput,
        MarkInputOffline, MarkOutputOffline,
        UpdateInputRef, UpdateOutputRef, // identifier+name = new stored ref
        Resync                           // clear output caches + force resend
    };
    Type type;
    std::size_t controllerIx = 0;
    std::string identifier;
    std::string name;
};
struct ReconcilePlan { std::vector<ReconcileAction> actions; };

ReconcilePlan PlanMidiReconciliation(const MidiInstrumentConfig& instrument,
                                     const MidiDeviceList& present,
                                     const MidiConnectionState& current);
}
```

- Precondition documented on the function: `current.controllers.size() == instrument.controllers.size()` (host maintains parallel state); mismatch → planner treats missing entries as all-`Unconfigured`.

**Steps:**
- [ ] **Step 1: Failing tests** — the truth table, one `TEST_CASE` each:
  - identifier match, closed input → `OpenInput` (+ no resync: input-only);
  - identifier match, closed output → `OpenOutput` + `Resync` for that controller;
  - name-fallback (stored id absent, name present under new id) → `Open*` + `Update*Ref` with the matched id+name;
  - contention: two slots whose refs match one present device → first slot in order gets `Open*`, second gets `MarkInputOffline`/`MarkOutputOffline` (when it was Online, also `Close*`), never two opens of one identifier in a plan;
  - vanished: Online endpoint whose open identifier is absent → `Close*` + `Mark*Offline`;
  - unconfigured ref → zero actions for that endpoint, even when devices are present;
  - input-only slot (output ref unconfigured): full input lifecycle, never an output action, never a resync from input reopen;
  - already-offline endpoint with device still absent → no actions (idempotence);
  - converged: everything Online-and-present / Offline-and-absent / Unconfigured → empty plan;
  - determinism: same inputs twice → identical action sequences;
  - both endpoints of one controller reopening → exactly ONE `Resync` (dedupe per controller);
  - state-size mismatch (empty `current`) → treated as unconfigured, no crash.
- [ ] **Step 2:** Run — fails.
- [ ] **Step 3:** Implement: two passes (inputs, outputs) over slots; per pass keep a `claimed` identifier set for one-device-one-slot; emit `Resync` once per controller if any output open was planned.
- [ ] **Step 4:** Suite green.
- [ ] **Step 5: Commit** — `feat(synth): pure MIDI reconciliation planner`.

---

### Task 4: OpenSpec sync

- [ ] Verify smi-3/smi-7 scenarios map to test names; check off `tasks.md` items 3.1–3.4 and 4.1–4.2; commit `Check off OpenSpec tasks 3.x, 4.x`.
