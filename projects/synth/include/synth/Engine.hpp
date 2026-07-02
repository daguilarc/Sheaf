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
#include <mutex>
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
        , audioDeviceState_()
        , defaultAudioDeviceState_()
        , lastNotifiedAudioDeviceState_()
        , serializationArena_(initialArenaCapacity)
        , serializationContext_()
        , config_()
        , context_()
        , app_()
        , uiState_()
        , midiProcessors_()
        , timestampProvider_(std::move(timestampProvider))
        , sampleCounter_(0)
        , midiProcessorsRebuiltCallback_()
        , midiProcessorsWillRebuildCallback_() {
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
        context_.audioDeviceState = &audioDeviceState_;
        context_.config = &config_;
        context_.uiState = nullptr;
        context_.now = timestampProvider_;
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
    //   4a. snapshot defaultMidiProfileConfig_ = midiProfileConfig_,
    //       defaultEndpoints_ = endpoints_, and defaultAudioDeviceState_ =
    //       audioDeviceState_ (the app's Init-configured live profile/audio
    //       device becomes the default that revert/new-patch restore to)
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
    //      is installed and the host reopens endpoints against it; if that
    //      same drain changed audioDeviceState_ (compared against the
    //      pre-drain snapshot), invoke audioDeviceChangedCallback_ if set —
    //      same fire-after-fully-applied discipline as the MIDI callback,
    //      just without a rebuild step in between; finally
    //      patchManager_.ProcessResponses(). A missing/empty patchesRoot, or
    //      a startup patch that fails to apply, is skipped silently with no
    //      callback invocation.
    void Initialize() {
        config_ = App::Config();
        context_.config = &config_;

        AsyncLogQueue::s_instance.SetSampleCounterSource(&sampleCounter_);

        app_.Init(&context_);

        // Snapshot the app's Init-configured live MIDI profile/endpoints/audio
        // device as the default BEFORE any startup patch applies. Without
        // this, defaultMidiProfileConfig_/defaultEndpoints_/
        // defaultAudioDeviceState_ stay default-constructed (empty), so a
        // later RevertAllToDefault (via NewPatch()/RevertPatch() with no
        // saved patch) would reset MIDI routing/audio device selection to
        // empty instead of back to the app's real default — mirroring the
        // old miniapp's post-construction
        // `defaultMidiProfileConfig_ = midiProfileConfig_;` snapshot (see
        // projects/synth/miniapp/Main.cpp).
        defaultMidiProfileConfig_ = midiProfileConfig_;
        defaultEndpoints_ = endpoints_;
        {
            // Pre-audio, single-threaded (no audio/message-thread
            // concurrency exists yet): the lock here is uncontended, but
            // held anyway for uniformity with every other touch point of
            // audioDeviceState_/lastNotifiedAudioDeviceState_ (see
            // audioDeviceStateMutex_'s doc comment).
            const std::lock_guard<std::mutex> lock(audioDeviceStateMutex_);
            defaultAudioDeviceState_ = audioDeviceState_;
            // Audio-side shadow of audioDeviceState_ used to detect real
            // changes without copying two std::strings before every
            // ApplyPatchMessage (see lastNotifiedAudioDeviceState_'s member
            // doc comment). Seeded from the same post-Init snapshot so
            // steady-state comparisons start from a true baseline.
            lastNotifiedAudioDeviceState_ = audioDeviceState_;
        }

        manager_.CaptureDefaultControlState();
        uiState_ = manager_.CreateUIState();
        context_.uiState = uiState_.get();

        RebuildMidiProcessors();

        const std::optional<std::filesystem::path> patchDir = LatestPatchDirectory(config_.patchesRoot);
        if (patchDir.has_value()) {
            patchManager_.LoadPatch(*patchDir);
            AudioDeviceState audioDeviceStateBeforeDrain;
            {
                const std::lock_guard<std::mutex> lock(audioDeviceStateMutex_);
                audioDeviceStateBeforeDrain = audioDeviceState_;
            }
            // ApplyPendingPatchMessages (via ApplyPatchMessage) mutates
            // audioDeviceState_ itself; still pre-audio/single-threaded here
            // (no ProcessBlock has run yet), so it does not need to hold
            // audioDeviceStateMutex_ internally -- only the snapshot/compare
            // bracketing it does, for consistency with the audio-thread
            // drain's locking discipline.
            const bool patchApplied = ApplyPendingPatchMessages();
            if (patchApplied) {
                RebuildMidiProcessors();
                if (midiProcessorsRebuiltCallback_) {
                    midiProcessorsRebuiltCallback_();
                }
            }
            bool deviceChanged = false;
            {
                const std::lock_guard<std::mutex> lock(audioDeviceStateMutex_);
                deviceChanged = audioDeviceState_ != audioDeviceStateBeforeDrain;
                // Re-sync the audio-device-state shadow after the startup
                // drain completes. The shadow (lastNotifiedAudioDeviceState_)
                // must always equal the last state the host was told about.
                // The startup callback (or lack thereof) represents the
                // host's baseline for comparison in subsequent runtime patch
                // messages.
                lastNotifiedAudioDeviceState_ = audioDeviceState_;
            }
            if (deviceChanged && audioDeviceChangedCallback_) {
                audioDeviceChangedCallback_();
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
    //      draining for this block (never grows the arena on the audio path).
    //      After each ApplyPatchMessage call, audioDeviceState_ is compared
    //      (AudioDeviceState's operator==) against the persistent
    //      lastNotifiedAudioDeviceState_ shadow (no per-call before/after
    //      copy — see that member's doc comment); a real change sets
    //      audioDeviceChangedPending_ for MessageThreadTick (Task 5) the same
    //      way midiRebuildPending_ is set, and updates the shadow.
    //   2. uiBus_.Process(timestamp)
    //   3. midiBus_.Process(timestamp)
    //   4. manager_.ComputeAllTargets() (never ComputeAllParameters here)
    //   4a. if the app opts in via the HasProcessFrame concept, app_.ProcessFrame()
    //       exactly once: the optional once-per-block control-rate hook. Runs
    //       after ComputeAllTargets() (so it observes post-message-drain,
    //       freshly-computed target state) and before app_.ProcessBlock (so
    //       any control-rate state it updates is visible to that call).
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
                PatchApplyStatus retryStatus;
                {
                    // Patch-message application is a rare, user-initiated
                    // event within the sanctioned patch-boundary non-RT
                    // exception (ApplyPatchMessage may already allocate on
                    // this path -- see LogPatchApplyOutcome's doc comment);
                    // locking here does not touch the steady-state pump
                    // path, since this branch only runs while retrying a
                    // stashed message. See audioDeviceStateMutex_'s doc
                    // comment.
                    const std::lock_guard<std::mutex> lock(audioDeviceStateMutex_);
                    retryStatus = ApplyPatchMessage(stashed, manager_, midiProfileConfig_, defaultMidiProfileConfig_,
                                                    endpoints_, defaultEndpoints_, audioDeviceState_,
                                                    defaultAudioDeviceState_, patchOutputBus_, serializationContext_);
                    if (!(audioDeviceState_ == lastNotifiedAudioDeviceState_)) {
                        audioDeviceChangedPending_.store(true, std::memory_order_release);
                        lastNotifiedAudioDeviceState_ = audioDeviceState_;
                    }
                }
                LogPatchApplyOutcome(stashed, retryStatus);
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
        if constexpr (HasProcessFrame<App>) {
            app_.ProcessFrame();
        }
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
    //   4. if midiRebuildPending_.exchange(false) was true:
    //      RebuildMidiProcessors(), then invoke midiProcessorsRebuiltCallback_
    //      if set (so the callback always observes the rebuilt processors).
    //      The flag is consumed via exchange (not load-then-store) so an
    //      audio-thread store(true) landing between the two can't be erased
    //      — see the member's doc comment.
    //   5. if audioDeviceChangedPending_.exchange(false) was true: invoke
    //      audioDeviceChangedCallback_ if set (fired AFTER audioDeviceState_
    //      was fully applied on the audio thread, same ordering discipline
    //      as the MIDI rebuilt callback — the callback always observes the
    //      already-changed state). Same exchange-based consume as
    //      midiRebuildPending_, for the same race reason.
    //   6. each processor in midiProcessors_.outputs: Process().
    void MessageThreadTick() {
        ParameterMessageOut parameterMessage;
        while (parameterMessageOutBus_.Pop(parameterMessage)) {
            if (parameterMessage.type != ParameterMessageOut::Type::ParameterStorageBatchNeeded ||
                parameterMessage.group == nullptr) {
                continue;
            }
            // slog-7: INFO-log storage-batch provisioning (group pointer +
            // requested count) so a session log shows when/how often groups
            // are reinforced with additional parameter storage.
            INFO("MessageThreadTick: provisioning storage batch for group %p (requested=%zu)",
                 static_cast<const void*>(parameterMessage.group), parameterMessage.requestedParameters);
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
            // slog-7: INFO-log non-NoCompletion patch command results (status
            // name + path) so patch save/load/revert activity is visible in
            // the session log.
            INFO("MessageThreadTick: patch command result status=%s path=%s",
                 PatchCommandStatusName(patchResult.status), patchResult.path.string().c_str());
        }

        if (midiRebuildPending_.exchange(false, std::memory_order_acq_rel)) {
            RebuildMidiProcessors();
            if (midiProcessorsRebuiltCallback_) {
                midiProcessorsRebuiltCallback_();
            }
        }

        if (audioDeviceChangedPending_.exchange(false, std::memory_order_acq_rel)) {
            if (audioDeviceChangedCallback_) {
                audioDeviceChangedCallback_();
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
    // Invoked from the message thread (MessageThreadTick, or directly from
    // Initialize() for a startup load) whenever a consumed patch message
    // changed audioDeviceState_ — fired AFTER the state is fully applied,
    // mirroring SetMidiProcessorsRebuiltCallback's ordering discipline.
    // Hosts wire this before calling Initialize() so a startup-load change
    // is observed.
    void SetAudioDeviceChangedCallback(std::function<void()> callback) {
        audioDeviceChangedCallback_ = std::move(callback);
    }
    // Host lifecycle hook: gives the host a chance to detach any external
    // pointers into the current MIDI processor chain (e.g. device-callback
    // forwarding targets) before the chain is destroyed. Called on the
    // thread performing the rebuild.
    void SetMidiProcessorsWillRebuildCallback(std::function<void()> callback) {
        midiProcessorsWillRebuildCallback_ = std::move(callback);
    }
    // Message-thread only: iterates midiProcessors_.outputs calling Reset()
    // on each. Forces a full LED/value resync on MIDI output hardware (e.g.
    // after opening/reopening an output device). Must not be called from the
    // audio thread — midiProcessors_ is only ever replaced on the thread
    // performing a rebuild (Initialize()/MessageThreadTick(), both
    // message-thread-only), so this has no synchronization of its own.
    void ResetMidiOutputProcessors() {
        for (auto& output : midiProcessors_.outputs) {
            output->Reset();
        }
    }
    MidiEndpointState& Endpoints() { return endpoints_; }

    // Host API, message-thread only: records a host-initiated audio device
    // change (e.g. a UI combo selection) into BOTH the live state and the
    // audio-side shadow (lastNotifiedAudioDeviceState_), under
    // audioDeviceStateMutex_. Host-initiated changes are by definition
    // already known to the host that just made them, so this deliberately
    // does NOT set audioDeviceChangedPending_/invoke
    // audioDeviceChangedCallback_ -- that callback exists solely to tell the
    // host about changes IT did not originate (patch load/revert). Advancing
    // the shadow here is what makes a later patch revert back to this exact
    // state correctly detect "no change" (no spurious callback) while a
    // revert to any OTHER state still fires (see
    // AudioDeviceSnapshot/DrainPatchInputBus). Replaces the old mutable
    // AudioDevice() accessor, which let a host write audioDeviceState_
    // directly without advancing the shadow or taking the lock -- see the
    // Task 3 review finding this API was introduced to fix.
    void SetAudioDeviceFromHost(const AudioDeviceState& state) {
        const std::lock_guard<std::mutex> lock(audioDeviceStateMutex_);
        audioDeviceState_ = state;
        lastNotifiedAudioDeviceState_ = state;
    }

    // Host API: returns a locked copy of the current audio device state.
    // Safe to call from the message thread at any time (including
    // concurrently with the audio thread's patch drain, which is exactly
    // what the lock is for). Replaces host-side reads of the old mutable
    // AudioDevice() accessor.
    AudioDeviceState AudioDeviceSnapshot() const {
        const std::lock_guard<std::mutex> lock(audioDeviceStateMutex_);
        return audioDeviceState_;
    }

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

    // Public host API: rebuild midiProcessors_ from the current
    // midiProfileConfig_ on demand (e.g. after a host mutates
    // Context().midiProfileConfig directly, such as switching MIDI
    // controller presets — see MidiPanel). Runs
    // midiProcessorsWillRebuildCallback_ (if set) synchronously, BEFORE the
    // current midiProcessors_ chain is destroyed/replaced, then constructs a
    // fresh chain via CreateMidiControllerProfile against midiBus_/uiState_
    // (uiState_ may still be null the first time this runs, during
    // Initialize(), before uiState_ is populated is not the case here, since
    // Initialize() calls this after uiState_ is populated; the function
    // tolerates a null UIState* regardless since CreateMidiControllerProfile
    // does). This is the single call site for the midiProcessors_
    // assignment, so it covers every rebuild: Initialize()'s silent first
    // rebuild, Initialize()'s startup-patch rebuild, MessageThreadTick()'s
    // patch-driven rebuild, and any host-initiated rebuild (e.g. a preset
    // switch). Does NOT itself invoke midiProcessorsRebuiltCallback_ — the
    // tick's midiRebuildPending_ path does that after clearing the flag;
    // callers rebuilding directly on the message thread (like MidiPanel's
    // preset switch) invoke midiProcessorsRebuiltCallback_ themselves, or
    // otherwise handle the endpoint-reopen consequences of a fresh chain.
    void RebuildMidiProcessors() {
        if (midiProcessorsWillRebuildCallback_) {
            midiProcessorsWillRebuildCallback_();
        }
        midiProcessors_ = CreateMidiControllerProfile(midiProfileConfig_, &midiBus_, &midiSender_, uiState_.get(),
                                                       timestampProvider_);
    }

    // Test-only alias for RebuildMidiProcessors(), kept for existing test
    // call sites (e.g. SynthRig::InstallMidiProfileForTest). Prefer calling
    // RebuildMidiProcessors() directly in new code.
    void RebuildMidiProcessorsForTest() { RebuildMidiProcessors(); }

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
    // Audio-thread drain loop shared by ProcessBlock's no-stash path and its
    // post-retry continuation. Drains patchInputBus_ via ApplyPatchMessage;
    // Applied/Reverted set midiRebuildPending_; ArenaExhausted stashes the
    // popped message in pendingPatchMessage_, sets arenaGrowPending_, and
    // stops draining for this block (never grows the arena on the audio
    // path — see the ArenaExhausted handling note above
    // ApplyPendingPatchMessages). Each call is followed by comparing
    // audioDeviceState_ against the persistent lastNotifiedAudioDeviceState_
    // shadow (no per-call copy — see that member's doc comment); a real
    // change sets audioDeviceChangedPending_ for MessageThreadTick,
    // independent of status (a change is a change whether or not it happened
    // to be the last message in a Reverted/Applied outcome), and updates the
    // shadow.
    //
    // audioDeviceStateMutex_ is acquired ONLY inside the loop body, after a
    // message has actually been popped -- never around the
    // patchInputBus_.Pop() call/loop condition itself. In steady state (no
    // pending patch messages) Pop() returns false immediately and the lock
    // is never touched, so this stays lock-free on the hot per-block path;
    // the lock is only ever taken within the rare, user-initiated
    // patch-message-application window (see audioDeviceStateMutex_'s doc
    // comment).
    void DrainPatchInputBus() {
        PatchMessageIn patchMessage;
        while (patchInputBus_.Pop(patchMessage)) {
            PatchApplyStatus status;
            {
                const std::lock_guard<std::mutex> lock(audioDeviceStateMutex_);
                status = ApplyPatchMessage(patchMessage, manager_, midiProfileConfig_, defaultMidiProfileConfig_,
                                           endpoints_, defaultEndpoints_, audioDeviceState_, defaultAudioDeviceState_,
                                           patchOutputBus_, serializationContext_);
                if (!(audioDeviceState_ == lastNotifiedAudioDeviceState_)) {
                    audioDeviceChangedPending_.store(true, std::memory_order_release);
                    lastNotifiedAudioDeviceState_ = audioDeviceState_;
                }
            }
            LogPatchApplyOutcome(patchMessage, status);
            if (status == PatchApplyStatus::Applied || status == PatchApplyStatus::Reverted) {
                midiRebuildPending_.store(true, std::memory_order_release);
            } else if (status == PatchApplyStatus::ArenaExhausted) {
                pendingPatchMessage_ = std::move(patchMessage);
                arenaGrowPending_.store(true, std::memory_order_release);
                break;
            }
        }
    }

    // slog-7: INFO-log each ApplyPatchMessage outcome (message type + apply
    // status name) from the audio-thread patch drain (ProcessBlock's no-stash
    // drain loop and its stashed-message retry). This runs on the audio
    // thread, but the logger's producer path (AsyncLogQueue::Log) is
    // audio-safe (slog-3: no locks, no heap allocation, no IO), and patch
    // commands are rare/user-initiated, so the extra INFO call per message is
    // negligible relative to block-processing cost.
    void LogPatchApplyOutcome(const PatchMessageIn& message, PatchApplyStatus status) {
        INFO("ProcessBlock: patch message type=%s apply-status=%s", PatchMessageInTypeName(message.type),
             PatchApplyStatusName(status));
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
                                                        audioDeviceState_, defaultAudioDeviceState_, patchOutputBus_,
                                                        serializationContext_);
            if (status == PatchApplyStatus::ArenaExhausted) {
                // Pre-audio only: growing here is safe because the audio
                // thread has not started running ProcessBlock yet.
                serializationArena_.GrowAndReset();
                status = ApplyPatchMessage(message, manager_, midiProfileConfig_, defaultMidiProfileConfig_,
                                           endpoints_, defaultEndpoints_, audioDeviceState_,
                                           defaultAudioDeviceState_, patchOutputBus_, serializationContext_);
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
    // Default = the app's Init-configured profile; revert/new restore this.
    // Snapshotted from midiProfileConfig_ in Initialize(), immediately after
    // app_.Init(&context_) returns and before any startup patch applies (see
    // the Initialize() binding-order comment, step 4a).
    MidiControllerProfileConfig defaultMidiProfileConfig_;
    MidiEndpointState endpoints_;
    // Default = the app's Init-configured endpoints; revert/new restore
    // this. Snapshotted from endpoints_ alongside defaultMidiProfileConfig_
    // in Initialize().
    MidiEndpointState defaultEndpoints_;

    // Guards audioDeviceState_ + lastNotifiedAudioDeviceState_ (the two
    // members below) against the data race between the message thread
    // (host writes via SetAudioDeviceFromHost/AppContext.audioDeviceState
    // during Init, reads via AudioDeviceSnapshot) and the audio thread
    // (DrainPatchInputBus / ProcessBlock's stashed-message retry, which read
    // AND write both members while applying a patch message).
    //
    // Touched ONLY at patch-message application (DrainPatchInputBus, the
    // ProcessBlock stashed-message retry, ApplyPendingPatchMessages/the
    // startup drain in Initialize()) and host operations
    // (SetAudioDeviceFromHost, AudioDeviceSnapshot) -- never on the
    // steady-state pump path when there is no pending patch message to
    // apply (patchInputBus_.Pop() returning false costs nothing extra; see
    // DrainPatchInputBus's doc comment). This is the same sanctioned
    // patch-boundary non-RT exception LogPatchApplyOutcome's doc comment
    // describes: patch commands are rare and user-initiated, and
    // ApplyPatchMessage itself already isn't lock/allocation-free on that
    // path, so a mutex acquisition confined to the same window adds no new
    // audio-thread hazard in steady state.
    mutable std::mutex audioDeviceStateMutex_;

    // Engine-owned audio device selection (Task 2). Wired into
    // context_.audioDeviceState in the constructor (apps mutate it directly
    // during Init() -- pre-audio, single-threaded, before this mutex matters
    // -- the same way they mutate *ctx->midiProfileConfig; see
    // AppContext::audioDeviceState's doc comment for why post-Init mutation
    // must go through SetAudioDeviceFromHost instead), and threaded through
    // every ApplyPatchMessage call so patch load/revert can read and write
    // it. All reads/writes past Init() must hold audioDeviceStateMutex_. See
    // SetAudioDeviceFromHost/AudioDeviceSnapshot for the public API.
    AudioDeviceState audioDeviceState_;
    // Default = the app's Init-configured audio device selection; revert/new
    // restore this. Snapshotted from audioDeviceState_ alongside
    // defaultEndpoints_ in Initialize().
    AudioDeviceState defaultAudioDeviceState_;
    // Shadow of the last audioDeviceState_ value the host was told about --
    // either via audioDeviceChangedCallback_ (a patch-driven change) or via
    // SetAudioDeviceFromHost (a host-driven change, which advances this
    // shadow immediately since the host by definition already knows about
    // its own change). Seeded from the post-Init default snapshot in
    // Initialize(), immediately after defaultAudioDeviceState_ is captured.
    // Guarded by audioDeviceStateMutex_ alongside audioDeviceState_ (Task 3
    // review finding: this used to be audio-thread-exclusive, which raced
    // with a host writing audioDeviceState_ directly and never advancing the
    // shadow -- see SetAudioDeviceFromHost's doc comment). Exists so
    // DrainPatchInputBus and ProcessBlock's stashed-message retry can detect
    // a real change with a string COMPARISON after every ApplyPatchMessage
    // call instead of copying two std::strings (audioDeviceState_) before
    // every call — the old before/after-snapshot approach heap-allocated on
    // the audio thread in steady state whenever either string was
    // non-empty/non-SSO. The assignment here (`lastNotifiedAudioDeviceState_
    // = audioDeviceState_`) still allocates, but only fires when a patch
    // message actually changed the device, which happens inside the
    // sanctioned patch-command non-RT window (the same window
    // ApplyPatchMessage itself already allocates in), not on every
    // steady-state block.
    AudioDeviceState lastNotifiedAudioDeviceState_;
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
    // Invoked synchronously immediately BEFORE midiProcessors_ is
    // destroyed/replaced, from RebuildMidiProcessors() (the sole assignment
    // site). See SetMidiProcessorsWillRebuildCallback's doc comment.
    std::function<void()> midiProcessorsWillRebuildCallback_;
    // See SetAudioDeviceChangedCallback's doc comment.
    std::function<void()> audioDeviceChangedCallback_;

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
    // Consumed via exchange(false, acq_rel), NOT load-then-store: a plain
    // load() followed by a separate store(false) leaves a window where an
    // audio-thread store(true) landing between the two would be silently
    // erased, dropping the notification. exchange() reads and clears
    // atomically, closing that window.
    std::atomic<bool> midiRebuildPending_{false};

    // Set by ProcessBlock's patch drain (DrainPatchInputBus and the
    // stashed-message retry) whenever a consumed ApplyPatchMessage call
    // actually changed audioDeviceState_ (comparison against the persistent
    // lastNotifiedAudioDeviceState_ shadow — see that member's doc comment).
    // MessageThreadTick (Task 5) consumes this the same way it consumes
    // midiRebuildPending_ — via exchange(false, acq_rel), for the identical
    // drop-on-race reason — then invokes audioDeviceChangedCallback_ if set.
    std::atomic<bool> audioDeviceChangedPending_{false};

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
