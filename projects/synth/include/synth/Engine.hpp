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
    //   7. RebuildMidiProcessors()
    //   8. startup patch: find LatestPatchDirectory(config_.patchesRoot); if
    //      found, patchManager_.LoadPatch(dir), then ApplyPendingPatchMessages()
    //      (drains patchInputBus_ synchronously); if that load applied a
    //      patch, RebuildMidiProcessors() again BEFORE the rebuilt callback
    //      fires, so a patched MIDI profile is installed before the host
    //      reopens endpoints; finally patchManager_.ProcessResponses().
    //      A missing/empty patchesRoot is skipped silently.
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

    // Task 5: message-thread pump. Minimal stub for this task, except for
    // the arenaGrowPending_ half of the drain-barrier contract (needed so
    // the barrier added in Task 4 is exercisable end-to-end): when
    // arenaGrowPending_ is set, grow serializationArena_ (heap allocation is
    // safe here — this runs off the audio thread) and clear the flag. This
    // is the ENTIRE tick contract for these two flags: MessageThreadTick
    // grows the arena and clears arenaGrowPending_; it must NOT touch
    // pendingPatchMessage_. ProcessBlock alone owns retrying/clearing the
    // stash, on the audio thread, so ordering against newly-queued patch
    // messages is guaranteed by the audio thread's single-writer view of
    // patchInputBus_ draining.
    void MessageThreadTick() {
        if (arenaGrowPending_.load(std::memory_order_acquire)) {
            GrowSerializationArenaForTick();
            arenaGrowPending_.store(false, std::memory_order_release);
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
        if (midiProcessorsRebuiltCallback_) {
            midiProcessorsRebuiltCallback_();
        }
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
    // Must NOT touch pendingPatchMessage_ — see the tick contract note on
    // MessageThreadTick.
    void GrowSerializationArenaForTick() {
        serializationArena_.GrowAndReset();
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
    // arenaGrowPending_; it must NOT touch pendingPatchMessage_. Only
    // ProcessBlock (audio thread) reads, retries, or clears the stash.
    std::optional<PatchMessageIn> pendingPatchMessage_;
    std::atomic<bool> arenaGrowPending_{false};
};

}  // namespace synth
