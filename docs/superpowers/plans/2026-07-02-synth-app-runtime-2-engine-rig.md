# Synth App Runtime — Plan 2/3: Engine + SynthRig Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the JUCE-free `synth::Engine<App>` (shared assembly + audio pump + message tick) and the `synth_rig::SynthRig<App>` headless test harness that drives the identical production engine code.

**Architecture:** `AppConcepts.hpp` defines the layered compile-time application contract. `Engine.hpp` owns manager/buses/patch-manager/MIDI-sender/profile/endpoints/app and exposes `Initialize()`, `Prepare()`, `ProcessBlock()`, `MessageThreadTick()`. The rig wraps the engine with deterministic time driving, message injection, output capture, and bounded patch helpers. A small library extension lets `ApplyPatchMessage` reuse an engine-owned `JsonArena`.

**Tech Stack:** C++20, GNU make, the repo's bespoke `TEST_CASE` framework. All JUCE-free.

**OpenSpec change:** `openspec/changes/synth-app-runtime` — implements task groups 3 (minus already-done 3.3) and 4 of `tasks.md`; requirements sar-4, sar-5 (engine share), sar-6, sar-7, sar-8 (startup selection), sar-12, sar-13, sar-14 (rig prerequisite), slog-6 (counter wiring).

## Global Constraints

- C++20 `-std=c++20 -Wall -Wextra -Wpedantic -O2`, pristine zero-warning output; every new test file carries the JUCE guard (`#ifdef JUCE_MAJOR_VERSION` / `#error`).
- Namespace `synth` for engine/concepts/library code; `synth_rig` for the rig. House style: PascalCase methods, trailing-underscore privates, `k`-prefixed constants, `enum class`.
- Prior-plan interfaces (verbatim, already landed): `AppContext`/`RuntimeConfig`/`AudioBlock` per `include/synth/AppContext.hpp`; `AsyncLogQueue::s_instance` with `SetSampleCounterSource(const std::atomic<std::uint64_t>*)`; `ParameterManager::ComputeAllTargets()` (computes without snapping); `ThreadId`/`ScopedThreadId`.
- The steady-state `ProcessBlock` pump: no heap allocation, no locks, no IO — with ONE specced exception: patch-command application at the block boundary may do bounded non-RT work using the engine-owned preallocated arena (sar-7). `ComputeAllTargets()` (never `ComputeAllParameters()`) in the pump.
- Pump order per block (sar-6, binding): (1) drain `patchInputBus` via `ApplyPatchMessage`; (2) `uiBus->Process(timestamp)`; (3) `midiBus->Process(timestamp)`; (4) `ComputeAllTargets()`; (5) advance sample counter by `numFrames`; (6) `app.ProcessBlock(block)` exactly once; (7) throttled `PopulateUIState`. The engine never calls `Process` on any DSP module.
- Thread ownership (sar-7): audio side = ProcessBlock; message side = MessageThreadTick (storage-batch replies, patch responses, MIDI output polling, MIDI processor rebuild); MIDI processors are message-thread-owned — a patch-load rebuild is flagged from the pump and performed in `MessageThreadTick`, then surfaced to the host via a callback (endpoint reopen is host/JUCE code, later plan).
- Startup patch selection (sar-8): patch directory containing the lexicographically greatest version filename across all directories under `patchesRoot`; ties broken by greater directory name; missing/empty root → silent defaults.
- Rig (sar-13): single-threaded by design; deterministic block-derived timestamps; sticky NaN/Inf + peak scan over every output sample; injection through production buses and the real `MidiInProcessor` chain; patch helpers bounded by a block budget returning success/failure/timeout.
- Key library signatures (exact, from headers): `ApplyPatchMessage(const PatchMessageIn&, ParameterManager&, MidiControllerProfileConfig&, const MidiControllerProfileConfig&, MidiEndpointState&, const MidiEndpointState&, MessageOutBus&, PatchSerializationContext = {})`; `CreateMidiControllerProfile(const MidiControllerProfileConfig&, MessageInBus*, MidiSender*, ParameterManager::UIState*, MidiInProcessor::TimestampProvider = {})` returning `MidiControllerProfileResult{input, inputThru, outputs}`; `MessageInBus::Process(std::uint64_t timestamp)`; `PatchMessageInBus`/`MessageOutBus`/`ParameterMessageOutBus` are Push/Pop-only rings; `PatchManager{NewPatch,SavePatch,SavePatchAs,LoadPatch,RevertPatch,ProcessResponses,CurrentPatchDirectory,SetBuses}` with `PatchCommandStatus{Ok,Pending,NoCompletion,Written,NeedsSaveAsPath,Busy,AlreadyExists,NotFound,InvalidPatch,QueueFull,IOError}`; `MessageIn` factories `ParamIncDec/ParamPush/SetShift/ToggleGestureSelect/SetGestureSelect/SetGestureValue/SceneSelect/SetSceneBlend/SelectParamBank/Start/Stop/Clock` (no scene-endpoints or page message types — those are direct manager calls); file helpers `PatchDirectory/SavePatchVersionInDirectory/LatestPatchVersion/LoadPatchVersionText`; `MakeParameterStorageBatch(const ParameterGroupConfig&, std::size_t gestureCount, std::size_t capacity)` + `ParameterGroup::AddParameterStorageBatch` (the miniapp's `processParameterMessages` in `projects/synth/miniapp/Main.cpp` shows the exact reply pattern — copy it).
- `make -C projects/synth test` green after every task; commit per task with trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Application concepts

**Files:**
- Create: `projects/synth/include/synth/AppConcepts.hpp`
- Modify: `projects/synth/tests/contract_tests.cpp` (append)
- Modify: `projects/synth/Makefile` (add header to contract_tests deps)

**Interfaces:**
- Consumes: `synth::AppContext`, `synth::AudioBlock`, `synth::RuntimeConfig`.
- Produces (exact — Tasks 3–7 and Plan 3 depend on these):

```cpp
#pragma once
#include "synth/AppContext.hpp"
#include <concepts>
#include <utility>

namespace synth {

// JUCE-free application core contract (sar-4). The engine and the test rig
// require only this; the JUCE runtime additionally requires SynthApplication.
template <typename T>
concept SynthApplicationCore = requires(T app, AppContext* context, AudioBlock& block) {
    { T::Config() } -> std::convertible_to<RuntimeConfig>;
    { app.Init(context) } -> std::same_as<void>;
    { app.ProcessBlock(block) } -> std::same_as<void>;
};

// Full application contract: core plus the UI-component hook. The hook's
// return type is deliberately unconstrained here so this header stays
// JUCE-free; the JUCE runtime consumes whatever component type it returns.
template <typename T>
concept SynthApplication = SynthApplicationCore<T> && requires(T app) {
    app.UIComponent();
};

// Optional hooks, detected at compile time and skipped when absent.
template <typename T>
concept HasPrepareToPlay = requires(T app, double sampleRate, int blockSize) {
    { app.PrepareToPlay(sampleRate, blockSize) } -> std::same_as<void>;
};

template <typename T>
concept HasProcessFrame = requires(T app) {
    { app.ProcessFrame() } -> std::same_as<void>;
};

}  // namespace synth
```

- [ ] **Step 1: Write the failing test** — append to `contract_tests.cpp`:

```cpp
namespace {
struct ConceptCoreOnlyApp {
    static synth::RuntimeConfig Config() { return {}; }
    void Init(synth::AppContext*) {}
    void ProcessBlock(synth::AudioBlock&) {}
};
struct ConceptFullApp : ConceptCoreOnlyApp {
    int UIComponent() { return 0; }  // stand-in; runtime consumes the real type
    void PrepareToPlay(double, int) {}
};
struct ConceptNotAnApp {
    void ProcessBlock(synth::AudioBlock&) {}
};
}  // namespace

TEST_CASE(application_concepts_gate_correctly) {
    REQUIRE_TRUE(synth::SynthApplicationCore<ConceptCoreOnlyApp>);
    REQUIRE_TRUE(synth::SynthApplicationCore<ConceptFullApp>);
    REQUIRE_TRUE(!synth::SynthApplicationCore<ConceptNotAnApp>);
    REQUIRE_TRUE(!synth::SynthApplication<ConceptCoreOnlyApp>);   // UI-less core rejected by full concept
    REQUIRE_TRUE(synth::SynthApplication<ConceptFullApp>);
    REQUIRE_TRUE(!synth::HasPrepareToPlay<ConceptCoreOnlyApp>);
    REQUIRE_TRUE(synth::HasPrepareToPlay<ConceptFullApp>);
    REQUIRE_TRUE(!synth::HasProcessFrame<ConceptFullApp>);
}
```

- [ ] **Step 2: Run to verify failure** — `make -C projects/synth test` → FAIL (missing `synth/AppConcepts.hpp`).
- [ ] **Step 3: Implement** the header exactly as the Produces block.
- [ ] **Step 4: Run the tests and make sure they pass** — full suite green, zero warnings.
- [ ] **Step 5: Commit** — `feat(synth): add layered application concepts (core vs full)`.

---

### Task 2: Reusable serialization arena for ApplyPatchMessage

**Files:**
- Modify: `projects/synth/include/synth/PatchPersistence.hpp` (extend `PatchSerializationContext` at lines 112–115)
- Modify: `projects/synth/src/PatchPersistence.cpp` (the `SerializeToJSON` branch of `ApplyPatchMessage`, around lines 336–371)
- Modify: `projects/synth/tests/parameter_modulation_tests.cpp` OR the patch-persistence test section wherever `ApplyPatchMessage` is already tested (follow existing test placement — grep for `ApplyPatchMessage` in `projects/synth/tests/`)

**Interfaces:**
- Produces: `PatchSerializationContext` gains `JsonArena* arena = nullptr;` — when non-null, `ApplyPatchMessage`'s serialize path calls `arena->Reset()` (or the arena's equivalent reuse call — read `include/synth/Json.hpp` for the exact reset API) and builds into the caller's arena instead of allocating one; on exhaustion it returns `PatchApplyStatus::ArenaExhausted` WITHOUT growing (growth is the caller's message-thread job per spp-1). Null keeps today's behavior byte-for-byte.

- [ ] **Step 1: Write the failing tests** (place alongside existing `ApplyPatchMessage` tests; construct manager/profile/endpoints/buses the way the neighboring tests do):

```cpp
TEST_CASE(apply_patch_message_reuses_caller_arena) {
    // setup manager with one registered parameter (copy neighboring test setup)
    synth::JsonArena arena(64 * 1024);
    synth::PatchSerializationContext context;
    context.arena = &arena;
    synth::MessageOutBus outputBus;
    // ... profile/endpoints defaults as in neighboring tests ...
    const auto first = synth::ApplyPatchMessage(
        synth::PatchMessageIn::SerializeToJSON(1, "A"), manager,
        profile, defaultProfile, endpoints, defaultEndpoints, outputBus, context);
    REQUIRE_TRUE(first == synth::PatchApplyStatus::Serialized);
    const auto second = synth::ApplyPatchMessage(
        synth::PatchMessageIn::SerializeToJSON(2, "B"), manager,
        profile, defaultProfile, endpoints, defaultEndpoints, outputBus, context);
    REQUIRE_TRUE(second == synth::PatchApplyStatus::Serialized);  // arena reused, both succeed
    synth::MessageOut out;
    REQUIRE_TRUE(outputBus.Pop(out));
    REQUIRE_TRUE(outputBus.Pop(out));  // both responses present and valid
}

TEST_CASE(apply_patch_message_reports_exhaustion_without_growing_caller_arena) {
    synth::JsonArena tiny(64);  // far too small for any patch document
    synth::PatchSerializationContext context;
    context.arena = &tiny;
    // ... same setup ...
    const auto status = synth::ApplyPatchMessage(
        synth::PatchMessageIn::SerializeToJSON(3, "C"), manager,
        profile, defaultProfile, endpoints, defaultEndpoints, outputBus, context);
    REQUIRE_TRUE(status == synth::PatchApplyStatus::ArenaExhausted);
}
```

(Adapt `JsonArena` construction/reset spelling to `Json.hpp`'s real API; the behavioral assertions are binding.)

- [ ] **Step 2: Run to verify failure** — FAIL: no member `arena`.
- [ ] **Step 3: Implement** the header field + the serialize-path branch: `if (context.arena != nullptr) { reset and use it; skip internal make_shared/grow loop; map exhaustion to ArenaExhausted; }`.
- [ ] **Step 4: Run the tests and make sure they pass** — full suite green (existing ApplyPatchMessage tests unchanged).
- [ ] **Step 5: Commit** — `feat(synth): let ApplyPatchMessage reuse a caller-owned serialization arena`.

---

### Task 3: Engine core — construction, Initialize, Prepare, startup patch

**Files:**
- Create: `projects/synth/include/synth/Engine.hpp`
- Create: `projects/synth/tests/engine_tests.cpp` (new binary `engine_tests`, Makefile-wired like the others)
- Modify: `projects/synth/Makefile`

**Interfaces:**
- Consumes: everything above.
- Produces (`template <SynthApplicationCore App> class synth::Engine`), the exact surface Tasks 4–7 and Plan 3 build on:

```cpp
template <SynthApplicationCore App>
class Engine {
public:
    using TimestampProvider = std::function<std::uint64_t()>;

    explicit Engine(TimestampProvider timestampProvider);
    // non-copyable, non-movable

    void Initialize();                    // full pre-audio lifecycle below
    void Prepare(double sampleRate, int blockSize);  // stores negotiated values, computes UI-state
                                          // throttle interval, forwards to app PrepareToPlay if present
    void ProcessBlock(AudioBlock& block, std::uint64_t timestamp);   // Task 4
    void MessageThreadTick();                                        // Task 5

    App& Application();
    AppContext& Context();
    ParameterManager& Manager();
    MessageInBus& UiBus();
    MessageInBus& MidiBus();
    PatchManager& Patches();
    MidiInProcessor* MidiInputProcessor();          // profile result's input chain head (may be null)
    void SetMidiProcessorsRebuiltCallback(std::function<void()> callback);  // host reopen hook
    MidiEndpointState& Endpoints();
    const RuntimeConfig& Config() const;
    std::uint64_t SampleCount() const;

    // exposed for Initialize + tests:
    static std::optional<std::filesystem::path> LatestPatchDirectory(const std::filesystem::path& root);
private:
    void RebuildMidiProcessors();          // CreateMidiControllerProfile against midiBus_/uiState_
    void ApplyPendingPatchMessages();      // shared by Initialize (sync) and ProcessBlock
    ...
};
```

`Initialize()` order (sar-5, binding): store `config_ = App::Config()`; wire context; `AsyncLogQueue::s_instance.SetSampleCounterSource(&sampleCounter_)`; `app_.Init(&context_)` (context.uiState MUST still be null here); `manager_.CaptureDefaultControlState()`; `uiState_ = manager_.CreateUIState()`; `context_.uiState = uiState_.get()`; `RebuildMidiProcessors()`; startup patch: `LatestPatchDirectory(config_.patchesRoot)` → if found `patchManager_.LoadPatch(dir)`, then `ApplyPendingPatchMessages()` (drains `patchInputBus_` via `ApplyPatchMessage` with the engine arena context), and if a load applied, `RebuildMidiProcessors()` again BEFORE invoking the rebuilt callback (so a patched profile is installed before the host reopens endpoints); `patchManager_.ProcessResponses()`; missing/empty root → skip silently. Constructor wires: `uiBus_(&manager_)`, `midiBus_(&manager_)`, `manager_.SetParameterMessageOutBus(&parameterMessageOutBus_)`, `patchManager_.SetBuses(&patchInputBus_, &patchOutputBus_)`, all `AppContext` pointers.

`LatestPatchDirectory`: iterate immediate subdirectories of `root`; for each, `LatestPatchVersion(dir)`; select the directory whose latest version FILENAME is lexicographically greatest; tie → lexicographically greater directory name; none → `std::nullopt`. Non-existent root → `std::nullopt`.

- [ ] **Step 1: Write the failing tests** — create `tests/engine_tests.cpp` (framework block + JUCE guard + main, as before) with a recording test app:

```cpp
namespace {
struct EngineTestApp {
    static inline bool sawNullUiStateDuringInit = false;
    static inline int initCalls = 0;
    static inline double preparedSampleRate = 0.0;
    static inline int preparedBlockSize = 0;
    synth::AppContext* context = nullptr;
    synth::ParameterId probeId = 0;

    static synth::RuntimeConfig Config() {
        synth::RuntimeConfig config;
        config.appName = "EngineTest";
        config.numAudioOutputs = 2;
        config.patchesRoot = {};  // overridden per test via TestConfigPatchRoot()
        return config;
    }
    void Init(synth::AppContext* ctx) {
        ++initCalls;
        context = ctx;
        sawNullUiStateDuringInit = (ctx->uiState == nullptr);
        auto& group = ctx->parameterManager->CreateGroup({.numVoices = 1, .numModulators = 0,
                                                          .numScenes = 1, .maxParameters = 4,
                                                          .processLiteAlpha = 1.0f});
        probeId = ctx->parameterManager->RegisterParameter(group, {.name = "Probe", .defaultValue = 0.25f});
    }
    void PrepareToPlay(double sampleRate, int blockSize) {
        preparedSampleRate = sampleRate; preparedBlockSize = blockSize;
    }
    void ProcessBlock(synth::AudioBlock&) {}
};
}  // namespace
```

(Group/parameter construction: match real designated-initializer field spellings from existing tests. If per-test config injection is needed for `patchesRoot`, give `EngineTestApp` a `static inline std::filesystem::path testPatchesRoot;` consumed by `Config()` — set it before constructing the engine.)

Cases:

```cpp
TEST_CASE(engine_initialize_orders_init_before_ui_state) {
    EngineTestApp::testPatchesRoot.clear();
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });
    engine.Initialize();
    REQUIRE_TRUE(EngineTestApp::sawNullUiStateDuringInit);
    REQUIRE_TRUE(engine.Context().uiState != nullptr);
    REQUIRE_TRUE(EngineTestApp::initCalls >= 1);
}

TEST_CASE(engine_prepare_forwards_negotiated_values) {
    EngineTestApp::testPatchesRoot.clear();
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });
    engine.Initialize();
    engine.Prepare(44100.0, 128);
    REQUIRE_NEAR(static_cast<float>(EngineTestApp::preparedSampleRate), 44100.0f, 1e-3f);
    REQUIRE_TRUE(EngineTestApp::preparedBlockSize == 128);
}

TEST_CASE(engine_full_concept_rejects_ui_less_core) {
    REQUIRE_TRUE(synth::SynthApplicationCore<EngineTestApp>);
    REQUIRE_TRUE(!synth::SynthApplication<EngineTestApp>);
}

TEST_CASE(engine_missing_patches_root_keeps_defaults_silently) {
    EngineTestApp::testPatchesRoot = std::filesystem::temp_directory_path() / "engine-no-such-root";
    std::filesystem::remove_all(EngineTestApp::testPatchesRoot);
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });
    engine.Initialize();  // must not throw or report failure
    REQUIRE_NEAR(engine.Manager().ParameterById(engine.Application().probeId).Get(0), 0.25f, 1e-5f);
}

TEST_CASE(engine_startup_loads_lexicographically_latest_patch) {
    // Arrange: two patch dirs under a temp root; write real version files whose
    // parameterValues set Probe to distinct values; older filename in dir "AAA",
    // newer filename in dir "ZZZ" is NOT the rule — the rule is greatest VERSION
    // FILENAME wins, tie -> greater dir name. Build both docs via BuildPatchJSON
    // from a scratch manager (same Init topology), Serialize with Dumps, write via
    // SavePatchVersionInDirectory with explicit time_points one second apart so the
    // filenames order deterministically.
    // Assert: after Initialize(), Probe reads the value from the greatest filename.
    // Also assert LatestPatchDirectory picks that directory directly.
}
```

Write the startup-load test fully (the comment block above states the required behavior; implement it with real `BuildPatchJSON`/`Dumps`/`SavePatchVersionInDirectory` calls — `TimestampPatchFilename(now)` makes filename ordering follow the time points you pass).

- [ ] **Step 2: Run to verify failure** — FAIL (missing `synth/Engine.hpp`).
- [ ] **Step 3: Implement** `Engine.hpp` per the Produces block: members `ParameterManager manager_; MessageInBus uiBus_; MessageInBus midiBus_; ParameterMessageOutBus parameterMessageOutBus_; PatchMessageInBus patchInputBus_; MessageOutBus patchOutputBus_; MidiSender midiSender_; PatchManager patchManager_; MidiControllerProfileConfig midiProfileConfig_; MidiControllerProfileConfig defaultMidiProfileConfig_; MidiEndpointState endpoints_; MidiEndpointState defaultEndpoints_; JsonArena serializationArena_; PatchSerializationContext serializationContext_; RuntimeConfig config_; AppContext context_; App app_; std::unique_ptr<ParameterManager::UIState> uiState_; MidiControllerProfileResult midiProcessors_; TimestampProvider timestampProvider_; std::atomic<std::uint64_t> sampleCounter_{0}; std::function<void()> midiProcessorsRebuiltCallback_;` plus Task-4/5 state (declare now, implement stubs that Task 4/5 fill: `ProcessBlock`/`MessageThreadTick` may be declared but minimal). `Prepare` uses `if constexpr (HasPrepareToPlay<App>)`. Wire `serializationContext_.arena = &serializationArena_;`.
- [ ] **Step 4: Run the tests and make sure they pass** — full suite green, zero warnings.
- [ ] **Step 5: Commit** — `feat(synth): add Engine core with lifecycle and startup patch selection`.

---

### Task 4: Engine::ProcessBlock pump

**Files:**
- Modify: `projects/synth/include/synth/Engine.hpp`
- Modify: `projects/synth/tests/engine_tests.cpp` (append)

**Interfaces:**
- Produces: the block pump exactly per Global Constraints order; `context->uiState` populated at the throttle cadence (every `max(1, (int)std::lround(sampleRate / (uiFrameHz * blockSize)))` blocks, computed in `Prepare`, default 1 before Prepare); pending-rebuild and pending-arena-grow flags set for `MessageThreadTick`; on `ArenaExhausted` the popped message is stashed in `std::optional<PatchMessageIn> pendingPatchMessage_` and a grow flag set (do not lose the message).

- [ ] **Step 1: Write the failing tests** — extend `EngineTestApp` with `int processBlockCalls = 0; float lastProbeDuringBlock = -1.0f;` and `void ProcessBlock(synth::AudioBlock& block)` that records the call, reads `context->parameterManager->ParameterById(probeId).Get(0)` into `lastProbeDuringBlock`, calls `ParameterById(probeId).ProcessLite()` once per frame (the app owns per-sample work), and writes `0.5f` into every output sample. Cases:

```cpp
TEST_CASE(engine_pump_applies_messages_before_app_block) {
    // Initialize; push MessageIn::ParamIncDec(ts=1, slot mapping not needed —
    // instead use uiBus Push of SetGestureValue or direct: register the probe to a
    // bank/slot in Init and push ParamIncDec) ... simpler and binding: push
    // MessageIn::SetSceneBlend(1, 0.0f) plus a ParamIncDec against a slot/position
    // registered in Init; ProcessBlock once with timestamp 2; assert the app saw the
    // post-message parameter value during its block (lastProbeDuringBlock changed).
}

TEST_CASE(engine_pump_preserves_slew_across_blocks) {
    // Init with processLiteAlpha = 0.1f; drive a ParamIncDec that moves the target;
    // run one ProcessBlock: app-observed value must NOT equal the target (no snap);
    // run several more blocks: value approaches target monotonically.
}

TEST_CASE(engine_pump_calls_app_exactly_once_per_block_and_advances_samples) {
    // two ProcessBlock calls with numFrames=64 -> processBlockCalls==2, SampleCount()==128.
}

TEST_CASE(engine_pump_populates_ui_state_at_throttle_cadence) {
    // Prepare(48000, 256) with uiFrameHz 30 -> interval = round(48000/(30*256)) = 6;
    // craft: turn encoder, run 1 block, UIState snapshot value unchanged (no populate yet
    // unless block index hits cadence); run to the 6th block, snapshot reflects the change.
    // Read the value through engine.Context().uiState atomics (see ParameterManager::UIState
    // accessors used by miniapp painting code / spm-20 tests for the exact getter shape).
}
```

For the slot/position mapping in Init: create a `Bank` + `BankSlot`, `AddPhysicalEncoder`, map the probe parameter — copy the exact calls from existing parameter tests or `miniapp/Main.cpp` (`CreateBank`, `CreateBankSlot`, `slot->AddPhysicalEncoder`, `bank->AddMapping`, `slot->SelectBank`). Write these tests fully — the sketches above are the binding behaviors, not placeholders to defer.

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** `ProcessBlock(AudioBlock& block, std::uint64_t timestamp)`:

```cpp
void ProcessBlock(AudioBlock& block, std::uint64_t timestamp) {
    PatchMessageIn patchMessage;
    while (patchInputBus_.Pop(patchMessage)) {
        const PatchApplyStatus status = ApplyPatchMessage(
            patchMessage, manager_, midiProfileConfig_, defaultMidiProfileConfig_,
            endpoints_, defaultEndpoints_, patchOutputBus_, serializationContext_);
        if (status == PatchApplyStatus::Applied || status == PatchApplyStatus::Reverted) {
            midiRebuildPending_.store(true, std::memory_order_release);
        } else if (status == PatchApplyStatus::ArenaExhausted) {
            pendingPatchMessage_ = std::move(patchMessage);
            arenaGrowPending_.store(true, std::memory_order_release);
            break;
        }
    }
    uiBus_.Process(timestamp);
    midiBus_.Process(timestamp);
    manager_.ComputeAllTargets();
    sampleCounter_.fetch_add(block.numFrames, std::memory_order_relaxed);
    app_.ProcessBlock(block);
    if (++blocksSinceUiPublish_ >= uiPublishInterval_) {
        blocksSinceUiPublish_ = 0;
        if (uiState_ != nullptr) { manager_.PopulateUIState(*uiState_); }
    }
}
```

(Adjust flag/member spellings to the class; `Initialize`'s synchronous drain reuses the same loop via `ApplyPendingPatchMessages()`.)
- [ ] **Step 4: Run the tests and make sure they pass.**
- [ ] **Step 5: Commit** — `feat(synth): add Engine audio-side block pump`.

---

### Task 5: Engine::MessageThreadTick

**Files:**
- Modify: `projects/synth/include/synth/Engine.hpp`
- Modify: `projects/synth/tests/engine_tests.cpp` (append)

**Interfaces:**
- Produces: `MessageThreadTick()` performing, in order: (1) parameter storage-batch replies — drain `parameterMessageOutBus_`, reply per the miniapp's `processParameterMessages` pattern (`MakeParameterStorageBatch(group config, gesture count, requested capacity)` → `message.group->AddParameterStorageBatch(...)`; copy the exact arithmetic from `miniapp/Main.cpp`); (2) arena grow/retry — if grow pending: allocate the engine arena at doubled capacity (cap at `serializationContext_.maxArenaCapacity`; if already at cap, drop the pending message and `INFO`-log the failure), clear flag, re-push the stashed `pendingPatchMessage_` onto `patchInputBus_`; (3) `patchManager_.ProcessResponses()`; (4) if rebuild pending: `RebuildMidiProcessors()`, clear flag, invoke `midiProcessorsRebuiltCallback_` if set; (5) for each processor in `midiProcessors_.outputs`: `Process()`.

- [ ] **Step 1: Write the failing tests:**

```cpp
TEST_CASE(engine_tick_rebuilds_midi_processors_after_patch_load_before_reopen_callback) {
    // Initialize; set a rebuilt-callback that records (a) it was called and (b) at call
    // time engine.MidiInputProcessor() is non-null/fresh (capture the pointer before,
    // assert it changed or at minimum callback fired after a load).
    // Enqueue a LoadFromJSON patch message via patchManager_.LoadPatch(saved dir from a
    // helper like Task 3's), ProcessBlock once (applies + flags), then MessageThreadTick.
    // Assert callback fired exactly once and after the rebuild (flag order).
}

TEST_CASE(engine_tick_replies_to_storage_batch_requests) {
    // Force a ParameterStorageBatchNeeded: create a group with tiny maxParameters in a
    // dedicated test app variant, register parameters up to capacity, then trigger the
    // library's growth-request path (see how existing parameter tests provoke
    // ParameterStorageBatchNeeded — reuse their recipe). ProcessBlock, then
    // MessageThreadTick; assert the bus is drained and a subsequent registration/
    // materialization succeeds.
}

TEST_CASE(engine_tick_grows_arena_and_retries_stashed_patch_message) {
    // Construct engine whose serialization arena starts tiny (expose initial capacity
    // via an Engine test hook or constructor default small in a test-only path —
    // simplest honest approach: add optional `std::size_t initialArenaCapacity`
    // parameter to Engine's constructor, default 256*1024, tests pass 64).
    // Issue SavePatchAs via patchManager_ to a temp dir; ProcessBlock (serialize hits
    // ArenaExhausted, message stashed); MessageThreadTick (arena doubles, message
    // re-pushed); ProcessBlock again; MessageThreadTick; eventually ProcessResponses
    // returns Written and the version file exists. Bound the loop (<=10 iterations).
}
```

Write all three fully, reusing Task 3's patch-writing helper.

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** per the Produces block (add the `initialArenaCapacity` constructor parameter).
- [ ] **Step 4: Run the tests and make sure they pass.**
- [ ] **Step 5: Commit** — `feat(synth): add Engine message-thread tick with rebuild and arena-grow handling`.

---

### Task 6: SynthRig harness

**Files:**
- Create: `projects/synth/tests/support/SynthRig.hpp`
- Create: `projects/synth/tests/rig_tests.cpp` (new binary `rig_tests`, Makefile-wired; this task adds only construction/time/output smoke cases — Task 7 adds the system tests)
- Modify: `projects/synth/Makefile`

**Interfaces:**
- Consumes: `synth::Engine<App>`, `MessageIn` factories, `BasicMidi`, patch manager statuses.
- Produces (`namespace synth_rig`, JUCE-free, requires only `SynthApplicationCore`):

```cpp
enum class RigPatchStatus { Ok, Written, Failed, TimedOut };

template <synth::SynthApplicationCore App>
class SynthRig {
public:
    explicit SynthRig(std::size_t patchPumpBudgetBlocks = 64);
    // ctor: engine with deterministic provider ([this]{ return nextTimestamp_++; }),
    // allocates input/output channel buffers from App::Config() (blockSize frames),
    // engine.Initialize(), engine.Prepare(config.preferredSampleRate, config.preferredBlockSize)

    // time
    void RunBlocks(std::size_t count);   // per block: engine.ProcessBlock(block, NextTimestamp());
                                         // scan output (sticky NaN/Inf, peak, capture ring);
                                         // engine.MessageThreadTick()
    void RunSamples(std::size_t count);  // ceil(count / blockSize) blocks
    void RunSeconds(double seconds);     // seconds * preferredSampleRate samples

    // injection (all push MessageIn with NextTimestamp() onto the UI bus)
    void Turn(std::size_t slotIx, std::size_t position, float delta);
    void Press(std::size_t slotIx, std::size_t position);
    void ShiftPress(std::size_t slotIx, std::size_t position);  // SetShift(true), ParamPush, SetShift(false)
    void SetShift(bool held);
    void SelectGesture(std::size_t gestureIx, bool selected);
    void SetGestureValue(std::size_t gestureIx, float value);
    void SelectScene(std::size_t sceneIx);
    void SetSceneBlend(float blend);
    void SelectBank(std::size_t slotIx, std::size_t bankIx);
    void SendMidi(const synth::BasicMidi& midi);  // engine.MidiInputProcessor()->Process(midi); no-op+flag if null

    // observation
    synth::ParameterManager::UIState& UIState();          // populates on demand, then returns
    float ParameterValue(synth::ParameterId id, std::size_t voiceIx = 0);
    struct OutputFrame { std::vector<float> channels; };
    const std::vector<OutputFrame>& Output() const;       // bounded ring (kMaxCapturedFrames = 1<<20, halving eviction)
    OutputFrame LastOutput() const;
    float OutputPeak() const;
    bool SawNaN() const;
    void ClearOutput();
    void ClearNaN();
    App& Application();
    synth::Engine<App>& Engine();                          // escape hatch

    // patches (each: issue command, then pump RunBlocks(1) at a time until the
    // manager reports a terminal status or the block budget is exhausted)
    RigPatchStatus SavePatchAs(const std::filesystem::path& dir);
    RigPatchStatus SavePatch();
    RigPatchStatus LoadPatch(const std::filesystem::path& path);
    RigPatchStatus RevertPatch();
private:
    std::uint64_t NextTimestamp() { return nextTimestamp_++; }
    ...
};
```

Patch helper mapping: immediate command status `NeedsSaveAsPath/NotFound/InvalidPatch/QueueFull/IOError/Busy` → `Failed` (no pumping); `Ok` (e.g. revert/new accepted) → pump until `ProcessResponses` returns `NoCompletion` twice consecutively then `Ok`; `Pending` (save paths) → pump until `ProcessResponses().status == Written` → `Written`, or budget exhausted → `TimedOut`; load → pump until the applied effect is visible (`ProcessResponses` returns and the input bus is empty) then `Ok`, budget exhausted → `TimedOut`.

- [ ] **Step 1: Write the failing smoke tests** in `rig_tests.cpp` with a minimal `RigTestApp` (one group `{numVoices=1, numModulators=0, numScenes=2, maxParameters=8, processLiteAlpha=0.5f}`; parameters `"Level"` default 0.25 and `"Tone"` default 0.5; one bank+slot with physical encoders {0,1} mapped to Level/Tone; `ProcessBlock` writes `Level.Get(0)` to every frame of every output channel after calling `ProcessLite()` per frame):

```cpp
TEST_CASE(rig_runs_blocks_and_captures_output) {
    synth_rig::SynthRig<RigTestApp> rig;
    rig.RunBlocks(4);
    REQUIRE_TRUE(!rig.SawNaN());
    REQUIRE_TRUE(rig.Output().size() == 4 * RigTestApp::Config().preferredBlockSize);
    REQUIRE_NEAR(rig.LastOutput().channels.at(0), 0.25f, 1e-4f);
    REQUIRE_NEAR(rig.OutputPeak(), 0.25f, 1e-4f);
}

TEST_CASE(rig_turn_reaches_parameter_through_production_bus) {
    synth_rig::SynthRig<RigTestApp> rig;
    rig.Turn(0, 0, 0.5f);           // Level encoder
    rig.RunBlocks(8);               // settle slew
    REQUIRE_TRUE(rig.LastOutput().channels.at(0) > 0.25f);
    REQUIRE_TRUE(!rig.SawNaN());
}

TEST_CASE(rig_run_samples_and_seconds_convert_to_blocks) {
    synth_rig::SynthRig<RigTestApp> rig;
    rig.RunSamples(1);              // rounds up to one block
    const auto oneBlock = rig.Output().size();
    REQUIRE_TRUE(oneBlock == static_cast<std::size_t>(RigTestApp::Config().preferredBlockSize));
}

TEST_CASE(rig_nan_flag_is_sticky) {
    // RigTestApp variant whose ProcessBlock writes one NaN frame when a static flag set;
    // set flag, RunBlocks(1), unset, RunBlocks(4): SawNaN() still true; ClearNaN() clears.
}
```

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement the rig** per the Produces block.
- [ ] **Step 4: Run the tests and make sure they pass.**
- [ ] **Step 5: Commit** — `feat(synth): add SynthRig headless test harness over the engine`.

---

### Task 7: Rig-driven system tests

**Files:**
- Modify: `projects/synth/tests/rig_tests.cpp` (append)

**Interfaces:** consumes Task 6's rig + `WrldBldrDefaultProfileConfig`.

- [ ] **Step 1: Write the tests (these ARE the deliverable; no implementation step):**

```cpp
TEST_CASE(rig_midi_cc_routes_through_profile_to_parameter) {
    // RigTestApp variant whose Init sets the engine's live profile to
    // WrldBldrDefaultProfileConfig({.slotIx = 0}) BEFORE processors are built —
    // simplest: rig exposes Engine(); set profile via engine.Context().midiProfileConfig
    // then a manual RebuildMidiProcessors is needed; to keep production-shaped, instead
    // construct the rig, then: *rig.Engine().Context().midiProfileConfig =
    // synth::WrldBldrDefaultProfileConfig({}); trigger rebuild via the engine's
    // load path OR expose a public RebuildForTest on the rig that calls the engine's
    // rebuild + callback. Choose the smallest honest surface and document it.
    const float before = rig.ParameterValue(rig.Application().levelId);
    synth::BasicMidi turn;
    turn.timestamp = 0;
    turn.raw = {0xB0, 0x00, 0x41};  // channel 0, CC 0, +1 relative (WrldBldr turn: CC 0..15 on channel 0)
    rig.SendMidi(turn);
    rig.RunBlocks(8);
    REQUIRE_TRUE(rig.ParameterValue(rig.Application().levelId) > before);
}

TEST_CASE(rig_two_identical_runs_are_deterministic) {
    auto script = [](synth_rig::SynthRig<RigTestApp>& rig) {
        rig.Turn(0, 0, 0.3f); rig.RunBlocks(3);
        rig.SetSceneBlend(0.5f); rig.SelectScene(1); rig.RunBlocks(3);
        rig.Turn(0, 1, -0.2f); rig.RunBlocks(3);
    };
    synth_rig::SynthRig<RigTestApp> a, b;
    script(a); script(b);
    REQUIRE_TRUE(a.Output().size() == b.Output().size());
    for (std::size_t i = 0; i < a.Output().size(); ++i) {
        REQUIRE_TRUE(a.Output()[i].channels == b.Output()[i].channels);  // bit-identical
    }
    REQUIRE_NEAR(a.ParameterValue(a.Application().levelId), b.ParameterValue(b.Application().levelId), 0.0f);
}

TEST_CASE(rig_patch_round_trip_through_production_flow) {
    synth_rig::SynthRig<RigTestApp> rig;
    const auto root = std::filesystem::temp_directory_path() / "rig-patch-roundtrip";
    std::filesystem::remove_all(root); std::filesystem::create_directories(root);
    rig.Turn(0, 0, 0.4f); rig.RunBlocks(8);
    const float edited = rig.ParameterValue(rig.Application().levelId);
    REQUIRE_TRUE(rig.SavePatchAs(root / "Take1") == synth_rig::RigPatchStatus::Written);
    REQUIRE_TRUE(rig.RevertPatch() == synth_rig::RigPatchStatus::Ok);
    rig.RunBlocks(4);
    REQUIRE_NEAR(rig.ParameterValue(rig.Application().levelId), 0.25f, 1e-3f);
    REQUIRE_TRUE(rig.LoadPatch(root / "Take1") == synth_rig::RigPatchStatus::Ok);
    rig.RunBlocks(8);
    REQUIRE_NEAR(rig.ParameterValue(rig.Application().levelId), edited, 1e-3f);
    std::filesystem::remove_all(root);
}

TEST_CASE(rig_patch_helper_times_out_instead_of_hanging) {
    synth_rig::SynthRig<RigTestApp> rig(/*patchPumpBudgetBlocks=*/8);
    // Starve the response path: fill patchOutputBus_ to capacity with dummy
    // MessageOut values through the engine escape hatch so the serialize response
    // can never be pushed (ApplyPatchMessage returns OutputQueueFull), then SavePatchAs.
    auto& bus = /* engine escape hatch to patchOutputBus_ — add a Rig/Engine accessor */;
    while (bus.Push(synth::MessageOut{})) {}
    const auto root = std::filesystem::temp_directory_path() / "rig-patch-timeout";
    std::filesystem::create_directories(root);
    REQUIRE_TRUE(rig.SavePatchAs(root / "Stuck") == synth_rig::RigPatchStatus::TimedOut);
    std::filesystem::remove_all(root);
}

TEST_CASE(rig_bus_drain_order_patch_before_ui_before_midi) {
    // Observable ordering probe: enqueue a RevertAllToDefault patch message (via
    // RevertPatch command path) AND a Turn in the same pending set, run ONE block:
    // the turn must survive (applied after the revert), i.e. final value = default + turn-step
    // slewed — assert value moved off default in the direction of the turn.
}
```

Fill in every sketched region with real code while implementing; the assertions shown are binding. Where the test needs a small rig/engine accessor addition (profile rebuild for test, patchOutputBus escape hatch), add the minimal public surface and document it as test-support in the header comment.

- [ ] **Step 2: Run to verify failure, then make them pass** (this may require the small accessors noted above — implement them in the same commit).
- [ ] **Step 3: Run the full suite** — `make -C projects/synth test` green, zero warnings.
- [ ] **Step 4: Commit** — `test(synth): add rig-driven system tests for the engine contract`.
