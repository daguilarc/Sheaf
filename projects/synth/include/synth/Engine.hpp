#pragma once

// synth::Engine — the JUCE-free engine core that owns every framework object
// an application touches (sar-3), wires AppContext, and drives the
// application through its pre-audio lifecycle (sar-5). Task 4 (ProcessBlock)
// and Task 5 (MessageThreadTick) fill in the audio-thread and message-thread
// pumps; this task establishes construction, Initialize, Prepare, and
// synchronous startup patch selection/loading.

#include "synth/AppConcepts.hpp"
#include "synth/AppContext.hpp"
#include "synth/AsyncLogger.hpp"
#include "synth/MidiController.hpp"
#include "synth/ParameterModulation.hpp"
#include "synth/PatchPersistence.hpp"

#include <atomic>
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

    // Stores negotiated audio values, computes the UI-state throttle
    // interval, and forwards to the application's PrepareToPlay hook when
    // present.
    void Prepare(double sampleRate, int blockSize) {
        sampleRate_ = sampleRate;
        blockSize_ = blockSize;
        uiThrottleIntervalSamples_ =
            sampleRate > 0.0 ? static_cast<std::uint64_t>(sampleRate / static_cast<double>(config_.uiFrameHz > 0 ? config_.uiFrameHz : 30))
                              : 0;

        if constexpr (HasPrepareToPlay<App>) {
            app_.PrepareToPlay(sampleRate, blockSize);
        }
    }

    // Task 4: audio-thread block processing. Minimal stub for this task.
    void ProcessBlock(AudioBlock& block, std::uint64_t timestamp) {
        (void)block;
        (void)timestamp;
    }

    // Task 5: message-thread pump. Minimal stub for this task.
    void MessageThreadTick() {}

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

    // Shared by Initialize (synchronous drain) and ProcessBlock (Task 4).
    // Drains patchInputBus_ via ApplyPatchMessage using the engine's
    // serialization context. Returns true if any drained message applied or
    // reverted patch state (i.e. the caller should rebuild MIDI processors).
    //
    // ArenaExhausted handling: during Initialize, audio has not started, so
    // on ArenaExhausted we simply grow serializationArena_ synchronously
    // (heap allocation is safe pre-audio) and retry that message once. Once
    // ProcessBlock (Task 4) also calls this on the audio thread, growth must
    // not happen there; Task 4 is responsible for keeping that constraint.
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

    // Task 4/5 state, declared now, filled in by later tasks.
    double sampleRate_ = 0.0;
    int blockSize_ = 0;
    std::uint64_t uiThrottleIntervalSamples_ = 0;
};

}  // namespace synth
