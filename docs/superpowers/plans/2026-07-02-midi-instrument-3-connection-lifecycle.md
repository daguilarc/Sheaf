# MIDI Instrument Config — Plan 3/4: Runtime Connection Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Self-healing connections: per-controller device handlers, the `ThreadId::IoPoll` poller thread (5 s USB MIDI list snapshots → dirty flag), message-thread plan execution (open/close/offline/ref-update/resync), startup connect-all, patch-load reconcile, and clean shutdown ordering.

**Architecture:** The runtime replaces `MidiPanel`'s single handler pair with a per-controller vector of `MidiInHandler`/`MidiOutputHandler` (from `juce/MidiHandlers.hpp`) parallel to the instrument slots, plus a `MidiConnectionState` mirror. `MidiDevicePoller` owns a `std::thread` that every 5 s enumerates devices, compares to its previous snapshot, and publishes `{dirty flag, latest list}` under a mutex — it never opens/closes devices or touches the engine. The runtime's existing message-thread timer consumes the flag, re-enumerates authoritatively on the message thread, calls `PlanMidiReconciliation`, and executes the plan. Startup runs one synchronous reconcile after processors are built, THEN starts the poller. Shutdown stops/joins the poller before closing devices.

**Tech Stack:** C++20, JUCE (runtime layer only), GNU make.

**OpenSpec change:** `openspec/changes/midi-instrument-config-ui` — implements task group 5 of `tasks.md`; requirements smi-4, smi-5, smi-6, smi-8 (runtime side), sar-5, sar-8, sar-9.

## Global Constraints

- Plans 1–2 landed: instrument model, per-controller `RebuildMidiProcessors`/`MidiInputProcessor(ix)`/`ResetMidiOutputProcessors(ix)`, `MidiSender::SetSink(ix,...)`, `PlanMidiReconciliation` exist exactly as specified there.
- Core build/tests stay JUCE-free and green: `make -C projects/synth build test`. JUCE code only under `runtime/`, `juce/`, `apps/`. App link check per task: `make -C projects/synth miniapp`.
- `ThreadId` gains `IoPoll` BEFORE `Unknown` (`include/synth/ThreadId.hpp`) — update `kThreadIdCount`-derived arrays (AsyncLogger per-identity queues) and the thread-name table; poll thread body runs under `ScopedThreadId(ThreadId::IoPoll)` and logs through `INFO`.
- Poller contract (smi-4, binding): wakes every 5 s (condition-variable wait with stop predicate — never a bare `sleep` that delays join); calls ONLY the injected enumerate function + snapshot compare; on difference: store latest list, set dirty. Stop() joins. If JUCE enumeration off the message thread misbehaves on this platform, fall back to the degraded mode from design D4 — poller ticks the dirty flag every 5 s unconditionally and the message thread compares snapshots itself; keep the planner/executor path identical and note the mode in the session log.
- Message-thread executor (binding): consume dirty flag on the existing runtime timer tick; re-enumerate on the message thread (authoritative); build `MidiConnectionState` from handler state; run planner; execute actions in plan order — `Open*` via handler `Open(identifier)` (failure → treat as offline, log, no retry until next poll), `Close*` via `Close()`, `Update*Ref` writes the slot's stored ref through `engine.EditInstrument` (this marks the patch dirty exactly like a UI edit), `Resync` = swap-safe forwarding rebuild for that controller's input + `engine.ResetMidiOutputProcessors(ix)`.
- Forwarding-processor swap safety: reuse the existing detach → rebuild → reattach discipline (`MidiPanel.hpp:240-294`, `OnMidiProcessorsWillRebuild` + `InstallForwardingProcessor` precedent) — per controller.
- Startup order (sar-5, binding): engine init → startup patch → processor rebuild → ONE synchronous reconcile (connect mapped controllers; absent → offline, never a startup failure) → start poller → audio device → audio callback → timers. Shutdown: audio callback off → poller Stop/join → MidiSender stop/join → close all handlers.
- Patch-load consumption (sar-8): rebuild per-controller processors from the loaded instrument, then run one reconcile pass — same executor function as the poll path.
- Commit per task, trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: ThreadId::IoPoll + MidiDevicePoller (JUCE-free core)

**Files:**
- Modify: `projects/synth/include/synth/ThreadId.hpp` (+ name table / logger arrays it feeds)
- Create: `projects/synth/include/synth/MidiDevicePoller.hpp`, `projects/synth/src/MidiDevicePoller.cpp`
- Create: `projects/synth/tests/poller_tests.cpp` (+ Makefile binary)

**Interfaces:**
- Produces (runtime consumes; JUCE-free — enumeration is injected):

```cpp
class MidiDevicePoller {
public:
    using Enumerate = std::function<MidiDeviceList()>;   // runs ON the poll thread
    explicit MidiDevicePoller(std::chrono::milliseconds interval = std::chrono::seconds(5));
    ~MidiDevicePoller();                                  // calls Stop()
    void Start(Enumerate enumerate);
    void Stop();                                          // signals + joins; idempotent
    bool ConsumeChange(MidiDeviceList& latest);           // message thread: true once per detected change
    void PollNowForTests();                               // forces one immediate poll cycle
};
```

**Steps:**
- [ ] **Step 1: Failing tests.** Fake enumerate returning a controllable list: Start + `PollNowForTests` with list A → first poll primes the snapshot, `ConsumeChange` false (no *change* yet — priming is not a change; startup reconcile covers the initial state); mutate to list B + `PollNowForTests` → `ConsumeChange` true with list B, second call false; identical repeat polls → false; Stop() joins promptly (< interval — assert wall time under 1 s); enumerate runs under `ThreadId::IoPoll` (fake records `GetCurrentThreadId()`); destructor-without-Stop safe.
- [ ] **Step 2:** Run — fails.
- [ ] **Step 3:** Implement: worker loop `cv.wait_for(interval, stop-or-poke predicate)`; snapshot compare = identifier+name vector equality (inputs and outputs); publish under mutex.
- [ ] **Step 4:** Suite green (JUCE-free).
- [ ] **Step 5: Commit** — `feat(synth): add IoPoll thread identity and MIDI device poller`.

---

### Task 2: Per-controller handlers + plan executor (JUCE-free logic, runtime glue)

**Files:**
- Create: `projects/synth/runtime/MidiConnectionManager.hpp` (namespace `synth_runtime`, header-only like the rest of `runtime/`)
- Modify: `projects/synth/runtime/MidiPanel.hpp` (single-pair handler ownership moves out; panel keeps only what Plan 4 replaces), `projects/synth/runtime/Runtime.hpp`
- Create: `projects/synth/tests/reconcile_executor_tests.cpp` for the JUCE-free executor core (+ Makefile binary)

**Interfaces:**
- Produces:

```cpp
// JUCE-free executor core (include/synth/MidiReconcile.hpp addition):
// Applies a plan to abstract endpoint operations; runtime binds these to JUCE
// handlers. Returns the updated MidiConnectionState.
struct MidiEndpointOps {
    std::function<bool(std::size_t ix, const std::string& identifier)> openInput, openOutput;
    std::function<void(std::size_t ix)> closeInput, closeOutput;
    std::function<void(std::size_t ix, const std::string& id, const std::string& name)> updateInputRef, updateOutputRef;
    std::function<void(std::size_t ix)> resync;
};
MidiConnectionState ExecuteReconcilePlan(const ReconcilePlan& plan,
                                         const MidiConnectionState& current,
                                         const MidiEndpointOps& ops);
// synth_runtime::MidiConnectionManager<App>: owns
//   std::vector<std::unique_ptr<MidiInHandler>> / <MidiOutputHandler> parallel to slots,
//   MidiConnectionState state_, MidiDevicePoller poller_;
//   void StartupReconcile();  void OnTimerTick();  void OnInstrumentRebuilt();
//   const MidiConnectionState& State() const;      // Plan 4 UI reads this
//   MidiDeviceList EnumerateNow() const;           // message thread; also Plan 4
```

**Steps:**
- [ ] **Step 1: Failing tests** (executor core, fake ops): plan actions invoked in order; failed `openInput` (returns false) → state Offline not Online, later actions still run; `Resync` invoked once per planned controller; returned state reflects opens/closes/marks; handler-count growth after `OnInstrumentRebuilt` when a controller was added (manager resizes vectors + sinks).
- [ ] **Step 2:** Run — fails.
- [ ] **Step 3:** Implement executor core; then `MidiConnectionManager`: ops bound to real handlers; `resync` = detach forwarding → `engine.ResetMidiOutputProcessors(ix)` → reinstall forwarding for that ix; output handler registered as sender sink ix on open, cleared on close; `OnTimerTick` consumes the poller flag → message-thread re-enumerate → plan → execute; `OnInstrumentRebuilt` resizes handler/sink vectors then runs one reconcile.
- [ ] **Step 4:** Core suite green; `make -C projects/synth miniapp` links.
- [ ] **Step 5: Commit** — `feat(synth-runtime): per-controller connection manager with plan executor`.

---

### Task 3: Runtime lifecycle wiring

**Files:**
- Modify: `projects/synth/runtime/Runtime.hpp` (startup/shutdown/timer), `projects/synth/runtime/Shell.hpp` (only if member wiring requires)
- Modify: `projects/synth/tests/engine_tests.cpp` / rig tests where startup semantics are asserted

**Steps:**
- [ ] **Step 1: Failing tests** (rig/simulated where JUCE-free; the JUCE runtime parts verified by build + manual): startup with a two-controller instrument and a fake device list containing only controller 0's device → controller 0 Online, controller 1 Offline, startup completes (JUCE-free via `ExecuteReconcilePlan` against startup state); patch load carrying a different instrument → rebuild then reconcile invoked (assert via recording ops in a rig-adjacent test of the shared executor path).
- [ ] **Step 2:** Wire `Runtime::Start`: after engine init + startup patch + rebuild → `connectionManager_.StartupReconcile()` → `poller_.Start([]{ return EnumerateJuceDevices(); })` → audio device → callback → timer. Timer tick order: `engine.MessageThreadTick()` → `connectionManager_.OnTimerTick()` → repaint → `DoLog()` last. Shutdown: callback off → `poller_.Stop()` → sender stop/join → close handlers (assert ordering by inspection + log lines).
- [ ] **Step 3:** JUCE device enumeration helper `EnumerateJuceDevices()` (identifier+name from `juce::MidiInput/Output::getAvailableDevices()`) — used by both poll thread and message-thread authoritative pass. If off-thread enumeration proves unsafe here, switch to degraded mode per Global Constraints.
- [ ] **Step 4:** Full suite + miniapp link green.
- [ ] **Step 5: Commit** — `feat(synth-runtime): self-healing MIDI connection lifecycle`.

---

### Task 4: Live-hardware smoke + OpenSpec sync

- [ ] **Step 1:** Launch the miniapp with a controller attached: verify session log shows startup connect, unplug → offline within ~5 s, replug → reconnect + full LED resync (caches cleared), input works after reconnect. This is the user's smoke checklist rehearsal — record results; USER sign-off happens at Plan 4's end.
- [ ] **Step 2:** Check off `tasks.md` items 5.1–5.5; commit `Check off OpenSpec tasks 5.x`.
