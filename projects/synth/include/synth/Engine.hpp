#pragma once

// synth::Engine — the JUCE-free engine core that owns every framework object
// an application touches (sar-3), wires AppContext, and drives the
// application through its pre-audio lifecycle (sar-5) and its audio-thread
// block pump (sar-6, Task 4). Task 5 (MessageThreadTick) fills in the
// message-thread pump: rebuilding MIDI processors when midiRebuildPending_
// is set, and growing serializationArena_ when arenaGrowPending_ is set.
// Retrying pendingPatchMessage_ is NOT the tick's job — ProcessBlock alone
// retries the stash (first, before draining anything newer) once the tick
// has cleared arenaGrowPending_; see the tick contract note on
// MessageThreadTick.

#include "synth/AppConcepts.hpp"
#include "synth/AppContext.hpp"
#include "synth/AsyncLogger.hpp"
#include "synth/MidiController.hpp"
#include "synth/ParameterModulation.hpp"
#include "synth/PatchPersistence.hpp"

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <utility>

namespace synth {

template <SynthApplicationCore App>
class Engine {
public:
    using TimestampProvider = std::function<std::uint64_t()>;

    explicit Engine(TimestampProvider timestampProvider, std::size_t initialArenaCapacity = 256 * 1024)
        : manager_()
        , uiBus_(&manager_)
        , midiBus_(&manager_)
        , parameterMessageOutBus_()
        , patchInputBus_()
        , patchOutputBus_()
        , midiSender_()
        , patchManager_(&patchInputBus_, &patchOutputBus_, initialArenaCapacity)
        , midiProfileConfig_()
        , defaultMidiProfileConfig_()
        , endpoints_()
        , defaultEndpoints_()
        , serializationArena_(initialArenaCapacity)
        , serializationContext_()
        , config_()
        , context_()
        , app_()
        , uiState_()
        , midiProcessors_()
        , timestampProvider_(std::move(timestampProvider))
        , sampleCounter_(0)
        , midiProcessorsRebuiltCallback_() {
        manager_.SetParameterMessageOutBus(&parameterMessageOutBus_);
        patchManager_.SetBuses(&patchInputBus_, &patchOutputBus_);
        serializationContext_.arena = &serializationArena_;
        serializationContext_.initialArenaCapacity = initialArenaCapacity;

        context_.parameterManager = &manager_;
        context_.patchManager = &patchManager_;
        context_.uiBus = &uiBus_;
        context_.midiBus = &midiBus_;
        context_.parameterMessageOutBus = &parameterMessageOutBus_;
        context_.patchInputBus = &patchInputBus_;
        context_.patchOutputBus = &patchOutputBus_;
        context_.midiSender = &midiSender_;
        context_.midiProfileConfig = &midiProfileConfig_;
        context_.defaultMidiProfileConfig = &defaultMidiProfileConfig_;
        context_.config = &config_;
        context_.uiState = nullptr;
    }

    Engine(const Engine&) = delete;
    Engine& operator=(const Engine&) = delete;
    Engine(Engine&&) = delete;
    Engine& operator=(Engine&&) = delete;

    // Full pre-audio lifecycle (sar-5, binding order):
    //   1. store config_ = App::Config()
    //   2. wire context (constructor already wired the stable pointers; config_
    //      is filled in here since it depends on the application)
    //   3. AsyncLogQueue::s_instance.SetSampleCounterSource(&sampleCounter_)
    //   4. app_.Init(&context_)                    -- context.uiState is null here
    //   5. manager_.CaptureDefaultControlState()
    //   6. uiState_ = manager_.CreateUIState(); context_.uiState = uiState_.get()
    //   7. RebuildMidiProcessors() (silent: this first, pre-startup-patch
    //      rebuild never invokes midiProcessorsRebuiltCallback_, since there
    //      is nothing new for a host to react to yet)
    //   8. startup patch: find LatestPatchDirectory(config_.patchesRoot); if
    //      found, patchManager_.LoadPatch(dir), then ApplyPendingPatchMessages()
    //      (drains patchInputBus_ synchronously); if and only if that load
    //      applied a patch, RebuildMidiProcessors() again and THEN invoke
    //      midiProcessorsRebuiltCallback_ if set, so a patched MIDI profile
    //      is installed and the host reopens endpoints against it; finally
    //      patchManager_.ProcessResponses(). A missing/empty patchesRoot, or
    //      a startup patch that fails to apply, is skipped silently with no
    //      callback invocation.
    void Initialize() {
        config_ = App::Config();
        context_.config = &config_;

        AsyncLogQueue::s_instance.SetSampleCounterSource(&sampleCounter_);

        app_.Init(&context_);

        manager_.CaptureDefaultControlState();
        uiState_ = manager_.CreateUIState();
        context_.uiState = uiState_.get();

        RebuildMidiProcessors();

        const std::optional<std::filesystem::path> patchDir = LatestPatchDirectory(config_.patchesRoot);
        if (patchDir.has_value()) {
            patchManager_.LoadPatch(*patchDir);
            const bool patchApplied = ApplyPendingPatchMessages();
            if (patchApplied) {
                RebuildMidiProcessors();
                if (midiProcessorsRebuiltCallback_) {
                    midiProcessorsRebuiltCallback_();
                }
            }
            patchManager_.ProcessResponses();
        }
    }

    // Stores negotiated audio values, computes the UI-state publish-throttle
    // interval (in blocks), and forwards to the application's PrepareToPlay
    // hook when present. uiPublishInterval_ = max(1, round(sampleRate /
    // (uiFrameHz * blockSize))); before Prepare runs, the default of 1
    // (publish every block) applies.
    void Prepare(double sampleRate, int blockSize) {
        sampleRate_ = sampleRate;
        blockSize_ = blockSize;

        const int uiFrameHz = config_.uiFrameHz > 0 ? config_.uiFrameHz : 30;
        if (sampleRate > 0.0 && blockSize > 0) {
            const long computed =
                std::lround(sampleRate / (static_cast<double>(uiFrameHz) * static_cast<double>(blockSize)));
            uiPublishInterval_ = static_cast<int>(std::max<long>(1, computed));
        } else {
            uiPublishInterval_ = 1;
        }
        blocksSinceUiPublish_ = 0;

        if constexpr (HasPrepareToPlay<App>) {
            app_.PrepareToPlay(sampleRate, blockSize);
        }
    }

    // Task 4: audio-thread block pump (sar-6, binding order):
    //   1. patch-drain phase (drain barrier): if a message is stashed in
    //      pendingPatchMessage_ AND arenaGrowPending_ is still set, the
    //      arena has not been grown yet — skip draining patchInputBus_
    //      entirely this block (never lose the stash, never reorder a
    //      newer message ahead of it). If a message is stashed but
    //      arenaGrowPending_ has been cleared (MessageThreadTick grew the
    //      arena), retry the stashed message FIRST: on success clear the
    //      stash and fall through to draining patchInputBus_ normally; on
    //      ArenaExhausted again, re-stash/re-set the flag and stop (skip
    //      draining new messages this block too). Otherwise (no stash),
    //      drain patchInputBus_ via ApplyPatchMessage using the engine
    //      serialization context; Applied/Reverted set midiRebuildPending_
    //      for MessageThreadTick (Task 5); ArenaExhausted stashes the popped
    //      message in pendingPatchMessage_, sets arenaGrowPending_, and stops
    //      draining for this block (never grows the arena on the audio path)
    //   2. uiBus_.Process(timestamp)
    //   3. midiBus_.Process(timestamp)
    //   4. manager_.ComputeAllTargets() (never ComputeAllParameters here)
    //   5. sampleCounter_.fetch_add(block.numFrames, relaxed)
    //   6. app_.ProcessBlock(block) exactly once
    //   7. throttled PopulateUIState every uiPublishInterval_ blocks
    void ProcessBlock(AudioBlock& block, std::uint64_t timestamp) {
        if (pendingPatchMessage_.has_value()) {
            if (arenaGrowPending_.load(std::memory_order_acquire)) {
                // Barrier still up: MessageThreadTick has not grown the
                // arena yet. Skip the entire patch-drain phase this block so
                // no newer message can apply ahead of the stash and nothing
                // overwrites it.
            } else {
                // Barrier cleared: the tick grew the arena. Retry the
                // stashed message first, before draining anything new.
                PatchMessageIn stashed = std::move(*pendingPatchMessage_);
                pendingPatchMessage_.reset();
                const PatchApplyStatus retryStatus = ApplyPatchMessage(
                    stashed, manager_, midiProfileConfig_, defaultMidiProfileConfig_, endpoints_,
                    defaultEndpoints_, patchOutputBus_, serializationContext_);
                if (retryStatus == PatchApplyStatus::Applied || retryStatus == PatchApplyStatus::Reverted) {
                    midiRebuildPending_.store(true, std::memory_order_release);
                    DrainPatchInputBus();
                } else if (retryStatus == PatchApplyStatus::ArenaExhausted) {
                    pendingPatchMessage_ = std::move(stashed);
                    arenaGrowPending_.store(true, std::memory_order_release);
                } else {
                    // Serialized/InvalidJSON/OutputQueueFull are terminal for
                    // this message; continue draining any newer messages.
                    DrainPatchInputBus();
                }
            }
        } else {
            DrainPatchInputBus();
        }

        uiBus_.Process(timestamp);
        midiBus_.Process(timestamp);
        manager_.ComputeAllTargets();
        sampleCounter_.fetch_add(block.numFrames, std::memory_order_relaxed);
        app_.ProcessBlock(block);

        if (++blocksSinceUiPublish_ >= uiPublishInterval_) {
            blocksSinceUiPublish_ = 0;
            if (uiState_ != nullptr) {
                manager_.PopulateUIState(*uiState_);
            }
        }
    }

    // Task 5: message-thread pump. Binding order:
    //   1. parameter storage-batch replies — drain parameterMessageOutBus_
    //      and reply to each ParameterStorageBatchNeeded request, mirroring
    //      the miniapp's processParameterMessages pattern exactly.
    //   2. arena grow (see the tick contract note on GrowSerializationArenaForTick):
    //      MessageThreadTick grows the arena and clears arenaGrowPending_
    //      ONLY (GrowSerializationArenaForTick clears the flag itself, in
    //      both the ordinary-growth and drop-at-cap cases). It must NOT
    //      touch pendingPatchMessage_ (except the documented drop-at-cap
    //      carve-out) and must NOT re-push anything onto patchInputBus_ —
    //      ProcessBlock alone owns retrying/clearing the stash, on the
    //      audio thread, once it observes arenaGrowPending_ cleared.
    //   3. patchManager_.ProcessResponses()
    //   4. if midiRebuildPending_: RebuildMidiProcessors(), clear the flag,
    //      then invoke midiProcessorsRebuiltCallback_ if set (so the
    //      callback always observes the rebuilt processors).
    //   5. each processor in midiProcessors_.outputs: Process().
    void MessageThreadTick() {
        ParameterMessageOut parameterMessage;
        while (parameterMessageOutBus_.Pop(parameterMessage)) {
            if (parameterMessage.type != ParameterMessageOut::Type::ParameterStorageBatchNeeded ||
                parameterMessage.group == nullptr) {
                continue;
            }
            parameterMessage.group->AddParameterStorageBatch(MakeParameterStorageBatch(
                parameterMessage.group->Config(), parameterMessage.group->GestureCount(),
                parameterMessage.requestedParameters));
        }

        if (arenaGrowPending_.load(std::memory_order_acquire)) {
            GrowSerializationArenaForTick();
        }

        const PatchCommandResult patchResult = patchManager_.ProcessResponses();
        if (patchResult.status != PatchCommandStatus::NoCompletion) {
            lastTickPatchResult_ = patchResult;
        }

        if (midiRebuildPending_.load(std::memory_order_acquire)) {
            RebuildMidiProcessors();
            midiRebuildPending_.store(false, std::memory_order_release);
            if (midiProcessorsRebuiltCallback_) {
                midiProcessorsRebuiltCallback_();
            }
        }

        for (auto& output : midiProcessors_.outputs) {
            output->Process();
        }
    }

    App& Application() { return app_; }
    AppContext& Context() { return context_; }
    ParameterManager& Manager() { return manager_; }
    MessageInBus& UiBus() { return uiBus_; }
    MessageInBus& MidiBus() { return midiBus_; }
    PatchManager& Patches() { return patchManager_; }
    MidiInProcessor* MidiInputProcessor() { return midiProcessors_.input.get(); }
    void SetMidiProcessorsRebuiltCallback(std::function<void()> callback) {
        midiProcessorsRebuiltCallback_ = std::move(callback);
    }
    MidiEndpointState& Endpoints() { return endpoints_; }
    const RuntimeConfig& Config() const { return config_; }
    std::uint64_t SampleCount() const { return sampleCounter_.load(std::memory_order_relaxed); }

    // Test-only accessors for the ProcessBlock drain-barrier state
    // (pendingPatchMessage_/arenaGrowPending_). PatchManager::HasPendingSave()
    // is not a substitute: it reflects PatchManager's own dispatch-time
    // bookkeeping (reset as soon as a new patch command is enqueued, e.g. by
    // RevertPatch()/NewPatch()), not whether the engine's drain has actually
    // applied the queued message yet. Exposed so tests can observe the
    // barrier directly without depending on that unrelated bookkeeping.
    bool HasStashedPatchMessageForTest() const { return pendingPatchMessage_.has_value(); }
    bool IsArenaGrowPendingForTest() const { return arenaGrowPending_.load(std::memory_order_acquire); }

    // Rig/test support: last non-NoCompletion patch response observed by
    // MessageThreadTick. Reading clears it. The JUCE runtime shell reports
    // patch results through its own PatchManager calls and does not use this.
    std::optional<PatchCommandResult> ConsumeLastTickPatchResult() {
        std::optional<PatchCommandResult> result = std::move(lastTickPatchResult_);
        lastTickPatchResult_.reset();
        return result;
    }

    // Iterate immediate subdirectories of root; for each, LatestPatchVersion.
    // Select the directory whose latest version FILENAME is lexicographically
    // greatest; ties break on lexicographically greater directory name. No
    // candidates (or a non-existent root) yields std::nullopt.
    static std::optional<std::filesystem::path> LatestPatchDirectory(const std::filesystem::path& root) {
        std::error_code ec;
        if (root.empty() || !std::filesystem::is_directory(root, ec) || ec) {
            return std::nullopt;
        }

        std::optional<std::filesystem::path> bestDir;
        std::string bestVersionName;
        std::string bestDirName;

        for (const auto& entry : std::filesystem::directory_iterator(root, ec)) {
            if (ec) {
                break;
            }
            std::error_code isDirEc;
            if (!entry.is_directory(isDirEc) || isDirEc) {
                continue;
            }
            const auto version = LatestPatchVersion(entry.path());
            if (!version.has_value()) {
                continue;
            }
            const std::string versionName = version->filename().string();
            const std::string dirName = entry.path().filename().string();
            if (!bestDir.has_value() || versionName > bestVersionName ||
                (versionName == bestVersionName && dirName > bestDirName)) {
                bestDir = entry.path();
                bestVersionName = versionName;
                bestDirName = dirName;
            }
        }
        return bestDir;
    }

private:
    // CreateMidiControllerProfile against midiBus_/uiState_. uiState_ may
    // still be null the first time this runs during Initialize is not the
    // case here (Initialize calls this after uiState_ is populated), but the
    // function tolerates a null UIState* since CreateMidiControllerProfile
    // does.
    void RebuildMidiProcessors() {
        midiProcessors_ = CreateMidiControllerProfile(midiProfileConfig_, &midiBus_, &midiSender_, uiState_.get(),
                                                       timestampProvider_);
    }

    // Audio-thread drain loop shared by ProcessBlock's no-stash path and its
    // post-retry continuation. Drains patchInputBus_ via ApplyPatchMessage;
    // Applied/Reverted set midiRebuildPending_; ArenaExhausted stashes the
    // popped message in pendingPatchMessage_, sets arenaGrowPending_, and
    // stops draining for this block (never grows the arena on the audio
    // path — see the ArenaExhausted handling note above
    // ApplyPendingPatchMessages).
    void DrainPatchInputBus() {
        PatchMessageIn patchMessage;
        while (patchInputBus_.Pop(patchMessage)) {
            const PatchApplyStatus status = ApplyPatchMessage(
                patchMessage, manager_, midiProfileConfig_, defaultMidiProfileConfig_, endpoints_,
                defaultEndpoints_, patchOutputBus_, serializationContext_);
            if (status == PatchApplyStatus::Applied || status == PatchApplyStatus::Reverted) {
                midiRebuildPending_.store(true, std::memory_order_release);
            } else if (status == PatchApplyStatus::ArenaExhausted) {
                pendingPatchMessage_ = std::move(patchMessage);
                arenaGrowPending_.store(true, std::memory_order_release);
                break;
            }
        }
    }

    // MessageThreadTick's (Task 5) sole responsibility for the drain
    // barrier: grow serializationArena_ off the audio thread. Heap
    // allocation here is safe because this never runs on the audio thread.
    // Growth doubles the arena's current capacity, capped at
    // serializationContext_.maxArenaCapacity. In the ordinary case (still
    // under the cap) this must NOT touch pendingPatchMessage_ — see the
    // tick contract note on MessageThreadTick. The one carve-out: if the
    // arena is already at the cap (currentCapacity >= maxArenaCapacity),
    // growing further is pointless (the stash would just exhaust again
    // forever), so this drops the stashed message, clears both the stash
    // and arenaGrowPending_, and INFO-logs the failure instead of growing.
    // A capacity that is merely below the cap but would double past it is
    // NOT dropped: it still grows once more, clamped to maxArenaCapacity.
    void GrowSerializationArenaForTick() {
        const std::size_t currentCapacity = serializationArena_.Capacity();
        if (currentCapacity >= serializationContext_.maxArenaCapacity) {
            INFO("MessageThreadTick: serialization arena at max capacity %zu; dropping stashed patch message",
                 serializationContext_.maxArenaCapacity);
            pendingPatchMessage_.reset();
            arenaGrowPending_.store(false, std::memory_order_release);
            return;
        }

        const std::size_t doubled = currentCapacity * 2;
        const std::size_t nextCapacity = std::min(doubled, serializationContext_.maxArenaCapacity);
        serializationArena_.Init(nextCapacity);
        arenaGrowPending_.store(false, std::memory_order_release);
    }

    // Pre-audio-only synchronous drain, used by Initialize(). Drains
    // patchInputBus_ via ApplyPatchMessage using the engine's serialization
    // context. Returns true if any drained message applied or reverted patch
    // state (i.e. the caller should rebuild MIDI processors).
    //
    // ArenaExhausted handling: during Initialize, audio has not started, so
    // on ArenaExhausted we simply grow serializationArena_ synchronously
    // (heap allocation is safe pre-audio) and retry that message once. This
    // growth is illegal once the audio thread is running: ProcessBlock has
    // its own inline drain loop (not this helper) that stashes the message
    // and defers growth to MessageThreadTick (Task 5) instead.
    bool ApplyPendingPatchMessages() {
        bool pendingRebuild = false;
        PatchMessageIn message;
        while (patchInputBus_.Pop(message)) {
            PatchApplyStatus status = ApplyPatchMessage(message, manager_, midiProfileConfig_,
                                                        defaultMidiProfileConfig_, endpoints_, defaultEndpoints_,
                                                        patchOutputBus_, serializationContext_);
            if (status == PatchApplyStatus::ArenaExhausted) {
                // Pre-audio only: growing here is safe because the audio
                // thread has not started running ProcessBlock yet.
                serializationArena_.GrowAndReset();
                status = ApplyPatchMessage(message, manager_, midiProfileConfig_, defaultMidiProfileConfig_,
                                           endpoints_, defaultEndpoints_, patchOutputBus_, serializationContext_);
            }
            if (status == PatchApplyStatus::Applied || status == PatchApplyStatus::Reverted) {
                pendingRebuild = true;
            }
        }
        return pendingRebuild;
    }

    // Members are declared in dependency order: buses reference the manager,
    // PatchManager references the buses.
    ParameterManager manager_;
    MessageInBus uiBus_;
    MessageInBus midiBus_;
    ParameterMessageOutBus parameterMessageOutBus_;
    PatchMessageInBus patchInputBus_;
    MessageOutBus patchOutputBus_;
    MidiSender midiSender_;
    PatchManager patchManager_;
    MidiControllerProfileConfig midiProfileConfig_;
    MidiControllerProfileConfig defaultMidiProfileConfig_;
    MidiEndpointState endpoints_;
    MidiEndpointState defaultEndpoints_;
    JsonArena serializationArena_;
    PatchSerializationContext serializationContext_;
    RuntimeConfig config_;
    AppContext context_;
    App app_;
    std::unique_ptr<ParameterManager::UIState> uiState_;
    MidiControllerProfileResult midiProcessors_;
    TimestampProvider timestampProvider_;
    std::atomic<std::uint64_t> sampleCounter_{0};
    std::function<void()> midiProcessorsRebuiltCallback_;

    double sampleRate_ = 0.0;
    int blockSize_ = 0;

    // UI-state publish throttle (Task 4): PopulateUIState runs every
    // uiPublishInterval_ blocks. Prepare() computes uiPublishInterval_ =
    // max(1, round(sampleRate / (uiFrameHz * blockSize))); the default of 1
    // (publish every block) applies before Prepare runs.
    int uiPublishInterval_ = 1;
    int blocksSinceUiPublish_ = 0;

    // Set by ProcessBlock (Task 4) when a drained patch message
    // applied/reverted patch state; MessageThreadTick (Task 5) consumes this
    // to know it should rebuild MIDI processors on the message thread.
    std::atomic<bool> midiRebuildPending_{false};

    // Audio-path ArenaExhausted handling / drain barrier (Task 4/5):
    // ProcessBlock never grows serializationArena_ on the audio thread. On
    // ArenaExhausted it stashes the popped message here and sets
    // arenaGrowPending_, which bars the ENTIRE patch-drain phase (not just
    // growth) for subsequent blocks: while pendingPatchMessage_ holds a
    // value, ProcessBlock does not pop any further messages from
    // patchInputBus_, preventing a second exhaustion from clobbering the
    // stash and preventing newer messages from applying out of order ahead
    // of it. ProcessBlock retries the stash itself, first, as soon as
    // arenaGrowPending_ reads false.
    //
    // Tick contract: MessageThreadTick grows the arena and clears
    // arenaGrowPending_; it must NOT touch pendingPatchMessage_, except the
    // documented drop-at-cap carve-out in GrowSerializationArenaForTick
    // (arena already at serializationContext_.maxArenaCapacity: the stash
    // is dropped there instead of retried forever). Outside that one case,
    // only ProcessBlock (audio thread) reads, retries, or clears the stash.
    std::optional<PatchMessageIn> pendingPatchMessage_;
    std::atomic<bool> arenaGrowPending_{false};

    // Rig/test support: last non-NoCompletion PatchCommandResult observed by
    // MessageThreadTick's patchManager_.ProcessResponses() call. See
    // ConsumeLastTickPatchResult().
    std::optional<PatchCommandResult> lastTickPatchResult_;
};

}  // namespace synth
