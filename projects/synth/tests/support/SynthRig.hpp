#pragma once

// synth_rig::SynthRig — a headless, JUCE-free test harness that drives a
// synth::Engine<App> the same way the JUCE runtime shell would: it owns the
// audio-thread block pump (RunBlocks/RunSamples/RunSeconds), injects
// production-bus messages (Turn/Press/ResetPress/gesture/scene/bank
// selection, SendMidi) exactly like a real control surface or MIDI input
// would, and observes the engine's output the way an external harness must
// (captured output frames, peak, sticky NaN/Inf, parameter values, UI
// state). Patch persistence commands are exposed as blocking helpers that
// pump blocks internally until the manager reports a terminal status or a
// configurable block budget is exhausted.
//
// Deliberately depends on nothing but synth::Engine<App> and the headers it
// already pulls in (AppContext/AppConcepts/MidiController/
// ParameterModulation/PatchPersistence): no JUCE, so this can run in plain
// unit-test binaries.
//
// Test-support surface: InstallInstrumentForTest() below (and the
// Engine::RebuildMidiProcessorsForTest() hook it delegates to) exists solely
// so system tests can install a MIDI instrument (any number of controller
// slots) without fabricating a full patch document. No production caller
// uses either.

#include "synth/Engine.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <vector>

namespace synth_rig {

enum class RigPatchStatus { Ok, Written, Failed, TimedOut };

template <synth::SynthApplicationCore App>
class SynthRig {
public:
    struct OutputFrame {
        std::vector<float> channels;
    };

    explicit SynthRig(std::size_t patchPumpBudgetBlocks = 64)
        : patchPumpBudgetBlocks_(patchPumpBudgetBlocks)
        , engine_([this] { return NextTimestamp(); }) {
        const synth::RuntimeConfig config = App::Config();
        numInputChannels_ = config.numAudioInputs;
        numOutputChannels_ = config.numAudioOutputs;
        blockSize_ = static_cast<std::size_t>(config.preferredBlockSize);
        sampleRate_ = config.preferredSampleRate;

        inputBuffers_.assign(static_cast<std::size_t>(numInputChannels_),
                             std::vector<float>(blockSize_, 0.0f));
        outputBuffers_.assign(static_cast<std::size_t>(numOutputChannels_),
                              std::vector<float>(blockSize_, 0.0f));
        inputPointers_.resize(static_cast<std::size_t>(numInputChannels_));
        outputPointers_.resize(static_cast<std::size_t>(numOutputChannels_));
        for (std::size_t ch = 0; ch < inputPointers_.size(); ++ch) {
            inputPointers_[ch] = inputBuffers_[ch].data();
        }
        for (std::size_t ch = 0; ch < outputPointers_.size(); ++ch) {
            outputPointers_[ch] = outputBuffers_[ch].data();
        }

        engine_.Initialize();
        engine_.Prepare(config.preferredSampleRate, config.preferredBlockSize);
    }

    SynthRig(const SynthRig&) = delete;
    SynthRig& operator=(const SynthRig&) = delete;

    // --- time ---------------------------------------------------------

    void RunBlocks(std::size_t count) {
        for (std::size_t i = 0; i < count; ++i) {
            RunOneBlock();
        }
    }

    void RunSamples(std::size_t count) {
        if (blockSize_ == 0) {
            return;
        }
        const std::size_t blocks = (count + blockSize_ - 1) / blockSize_;
        RunBlocks(blocks);
    }

    void RunSeconds(double seconds) {
        if (sampleRate_ <= 0.0 || seconds <= 0.0) {
            return;
        }
        const double samples = seconds * sampleRate_;
        RunSamples(static_cast<std::size_t>(std::ceil(samples)));
    }

    // --- injection ------------------------------------------------------

    void Turn(std::size_t slotIx, std::size_t position, float delta) {
        engine_.UiBus().Push(synth::MessageIn::ParamIncDec(NextTimestamp(), slotIx, position, delta));
    }

    void Press(std::size_t slotIx, std::size_t position) {
        engine_.UiBus().Push(synth::MessageIn::ParamPush(NextTimestamp(), slotIx, position));
    }

    void ResetPress(std::size_t slotIx, std::size_t position) {
        SetReset(true);
        engine_.UiBus().Push(synth::MessageIn::ParamPush(NextTimestamp(), slotIx, position));
        SetReset(false);
    }

    void SetReset(bool held) {
        engine_.UiBus().Push(synth::MessageIn::SetReset(NextTimestamp(), held));
    }

    void SetRandom(bool held) {
        engine_.UiBus().Push(synth::MessageIn::SetRandom(NextTimestamp(), held));
    }

    void SetRandomMod(bool held) {
        engine_.UiBus().Push(synth::MessageIn::SetRandomMod(NextTimestamp(), held));
    }

    void SelectGesture(std::size_t gestureIx, bool selected) {
        engine_.UiBus().Push(synth::MessageIn::SetGestureSelect(NextTimestamp(), gestureIx, selected));
    }

    void SetGestureValue(std::size_t gestureIx, float value) {
        engine_.UiBus().Push(synth::MessageIn::SetGestureValue(NextTimestamp(), gestureIx, value));
    }

    void SelectScene(std::size_t sceneIx) {
        engine_.UiBus().Push(synth::MessageIn::SceneSelect(NextTimestamp(), sceneIx));
    }

    void SetSceneBlend(float blend) {
        engine_.UiBus().Push(synth::MessageIn::SetSceneBlend(NextTimestamp(), blend));
    }

    void SelectBank(std::size_t slotIx, std::size_t bankIx) {
        engine_.UiBus().Push(synth::MessageIn::SelectParamBank(NextTimestamp(), slotIx, bankIx));
    }

    // Feeds midi into controller slot controllerIx's input processor chain
    // (Engine::MidiInputProcessor(controllerIx)) -- per-controller rebuild
    // (Task 2): every slot's chain still terminates in the same underlying
    // MIDI input bus (the plan's single-bus global constraint), but which
    // slot's chain decodes a given raw message is now caller-selected, the
    // same way a real multi-device host would route each physical MIDI
    // input's bytes to the processor built for that device's slot. Silently
    // drops (with an INFO log) when controllerIx is out of range or that
    // slot has no input chain, matching the prior single-controller
    // null-check contract.
    void SendMidi(std::size_t controllerIx, const synth::BasicMidi& midi) {
        synth::MidiInProcessor* processor = engine_.MidiInputProcessor(controllerIx);
        if (processor == nullptr) {
            INFO("SynthRig::SendMidi: MidiInputProcessor(%zu) is null; dropping MIDI message", controllerIx);
            return;
        }
        processor->Process(midi);
    }

    // --- observation ----------------------------------------------------

    synth::ParameterManager::UIState& UIState() {
        engine_.Manager().PopulateUIState(*engine_.Context().uiState);
        return *engine_.Context().uiState;
    }

    float ParameterValue(synth::ParameterId id, std::size_t voiceIx = 0) {
        return engine_.Manager().ParameterById(id).Get(voiceIx);
    }

    const std::vector<OutputFrame>& Output() const { return capturedOutput_; }

    OutputFrame LastOutput() const {
        if (capturedOutput_.empty()) {
            return OutputFrame{};
        }
        return capturedOutput_.back();
    }

    float OutputPeak() const { return outputPeak_; }
    bool SawNaN() const { return sawNaN_; }
    void ClearOutput() { capturedOutput_.clear(); }
    void ClearNaN() { sawNaN_ = false; }

    App& Application() { return engine_.Application(); }
    synth::Engine<App>& Engine() { return engine_; }

    // Test-support: install a full MIDI instrument (any number of controller
    // slots) as the engine's live instrument and rebuild the MIDI processors
    // from it immediately. Production code only ever rebuilds MIDI
    // processors through the patch-apply flow (loading/reverting a patch
    // triggers midiRebuildPending_, which the message-thread tick drains),
    // through Engine::EditInstrument (which rebuilds and fires the rebuilt
    // callback itself), or once at startup. This exists so tests can install
    // an instrument (e.g. built from synth::WrldBldrDefaultProfileConfig)
    // without fabricating a full patch document or exercising
    // EditInstrument's callback-firing side effect, by writing directly into
    // Engine::LiveInstrument() and delegating to
    // Engine::RebuildMidiProcessorsForTest() (a matching test-only hook).
    // Replaces the entire controllers vector (per-controller rebuild, Task
    // 2: RebuildMidiProcessors() now builds one processor chain per slot, so
    // this installer is no longer single-slot-only -- see that method's doc
    // comment); repeated calls in the same test each fully replace whatever
    // instrument (if any) was installed before.
    void InstallInstrumentForTest(synth::MidiInstrumentConfig instrument) {
        engine_.LiveInstrument() = std::move(instrument);
        engine_.RebuildMidiProcessorsForTest();
    }

    // --- patches ----------------------------------------------------------

    RigPatchStatus SavePatchAs(const std::filesystem::path& dir) {
        const synth::PatchCommandResult result = engine_.Patches().SavePatchAs(dir);
        return PumpSaveLike(result);
    }

    RigPatchStatus SavePatch() {
        const synth::PatchCommandResult result = engine_.Patches().SavePatch();
        return PumpSaveLike(result);
    }

    RigPatchStatus LoadPatch(const std::filesystem::path& path) {
        const synth::PatchCommandResult result = engine_.Patches().LoadPatch(path);
        return PumpLoadLike(result);
    }

    RigPatchStatus RevertPatch() {
        const synth::PatchCommandResult result = engine_.Patches().RevertPatch();
        return PumpAcceptedLike(result);
    }

private:
    std::uint64_t NextTimestamp() { return nextTimestamp_++; }

    static bool IsImmediateFailure(synth::PatchCommandStatus status) {
        switch (status) {
            case synth::PatchCommandStatus::NeedsSaveAsPath:
            case synth::PatchCommandStatus::NotFound:
            case synth::PatchCommandStatus::InvalidPatch:
            case synth::PatchCommandStatus::QueueFull:
            case synth::PatchCommandStatus::IOError:
            case synth::PatchCommandStatus::Busy:
            case synth::PatchCommandStatus::AlreadyExists:
                return true;
            default:
                return false;
        }
    }

    // Save-family commands (SavePatch/SavePatchAs) report Pending immediately
    // and complete asynchronously via ProcessResponses(); RunBlocks(1) already
    // ends with Engine::MessageThreadTick(), whose internal
    // patchManager_.ProcessResponses() call is the one that actually observes
    // the completion (arena growth/response draining happen there). Calling
    // ProcessResponses() again from here would only ever see NoCompletion
    // (the tick already consumed the real result), so this reads the result
    // the tick observed via ConsumeLastTickPatchResult() instead of calling
    // ProcessResponses() a second time.
    RigPatchStatus PumpSaveLike(const synth::PatchCommandResult& dispatchResult) {
        if (IsImmediateFailure(dispatchResult.status)) {
            return RigPatchStatus::Failed;
        }
        if (dispatchResult.status != synth::PatchCommandStatus::Pending) {
            // Should not happen for save-family commands, but treat any
            // unexpected non-Pending, non-failure status as an immediate
            // failure rather than pumping forever.
            return RigPatchStatus::Failed;
        }
        for (std::size_t i = 0; i < patchPumpBudgetBlocks_; ++i) {
            RunBlocks(1);
            const std::optional<synth::PatchCommandResult> tickResult = engine_.ConsumeLastTickPatchResult();
            if (!tickResult.has_value()) {
                continue;
            }
            if (tickResult->status == synth::PatchCommandStatus::Written) {
                return RigPatchStatus::Written;
            }
            if (IsImmediateFailure(tickResult->status)) {
                return RigPatchStatus::Failed;
            }
        }
        return RigPatchStatus::TimedOut;
    }

    // Load-family commands (LoadPatch) report Ok immediately once the
    // parsed document is queued onto patchInputBus_; the actual apply
    // happens asynchronously on the audio thread's drain phase. RunBlocks(1)
    // already drives Engine::MessageThreadTick(), whose internal
    // patchManager_.ProcessResponses() call is the one that observes any
    // completion, so this pumps blocks and checks the tick-observed result
    // (via ConsumeLastTickPatchResult()) for an immediate failure, or
    // otherwise waits for the applied effect to become visible — the input
    // bus has drained and no message is stashed behind the arena-grow
    // barrier — until the block budget is exhausted.
    RigPatchStatus PumpLoadLike(const synth::PatchCommandResult& dispatchResult) {
        if (IsImmediateFailure(dispatchResult.status)) {
            return RigPatchStatus::Failed;
        }
        if (dispatchResult.status != synth::PatchCommandStatus::Ok) {
            return RigPatchStatus::Failed;
        }
        for (std::size_t i = 0; i < patchPumpBudgetBlocks_; ++i) {
            RunBlocks(1);
            const std::optional<synth::PatchCommandResult> tickResult = engine_.ConsumeLastTickPatchResult();
            if (tickResult.has_value() && IsImmediateFailure(tickResult->status)) {
                return RigPatchStatus::Failed;
            }
            const bool drained = engine_.Context().patchInputBus->Size() == 0 &&
                                 !engine_.HasStashedPatchMessageForTest();
            if (drained) {
                return RigPatchStatus::Ok;
            }
        }
        return RigPatchStatus::TimedOut;
    }

    // Revert/New-family commands (RevertPatch) also report Ok immediately
    // once queued, but unlike a fresh LoadPatch there is no new document to
    // wait for landing in observable state beyond the drain itself. Since
    // RunBlocks(1) already drives MessageThreadTick()'s ProcessResponses()
    // call, calling ProcessResponses() again here would only ever observe
    // NoCompletion (the tick consumed the real result already), so the
    // settle condition is expressed directly in terms of the deterministic,
    // budget-bounded state RunBlocks(1) leaves behind: the input bus has
    // drained and no message is stashed behind the arena-grow barrier (same
    // terminal condition as PumpLoadLike), while any tick-observed result
    // that is an immediate failure short-circuits the pump.
    RigPatchStatus PumpAcceptedLike(const synth::PatchCommandResult& dispatchResult) {
        if (IsImmediateFailure(dispatchResult.status)) {
            return RigPatchStatus::Failed;
        }
        if (dispatchResult.status != synth::PatchCommandStatus::Ok) {
            return RigPatchStatus::Failed;
        }
        for (std::size_t i = 0; i < patchPumpBudgetBlocks_; ++i) {
            RunBlocks(1);
            const std::optional<synth::PatchCommandResult> tickResult = engine_.ConsumeLastTickPatchResult();
            if (tickResult.has_value() && IsImmediateFailure(tickResult->status)) {
                return RigPatchStatus::Failed;
            }
            const bool drained = engine_.Context().patchInputBus->Size() == 0 &&
                                 !engine_.HasStashedPatchMessageForTest();
            if (drained) {
                return RigPatchStatus::Ok;
            }
        }
        return RigPatchStatus::TimedOut;
    }

    void RunOneBlock() {
        synth::AudioBlock block;
        block.inputs = numInputChannels_ > 0 ? inputPointers_.data() : nullptr;
        block.outputs = numOutputChannels_ > 0 ? outputPointers_.data() : nullptr;
        block.numInputChannels = numInputChannels_;
        block.numOutputChannels = numOutputChannels_;
        block.numFrames = blockSize_;

        engine_.ProcessBlock(block, NextTimestamp());

        for (std::size_t frame = 0; frame < blockSize_; ++frame) {
            OutputFrame captured;
            captured.channels.reserve(static_cast<std::size_t>(numOutputChannels_));
            for (int ch = 0; ch < numOutputChannels_; ++ch) {
                const float sample = outputPointers_[static_cast<std::size_t>(ch)][frame];
                if (!std::isfinite(sample)) {
                    sawNaN_ = true;
                }
                outputPeak_ = std::max(outputPeak_, std::fabs(sample));
                captured.channels.push_back(sample);
            }
            AppendToCaptureRing(std::move(captured));
        }

        engine_.MessageThreadTick();
    }

    void AppendToCaptureRing(OutputFrame&& frame) {
        if (capturedOutput_.size() >= kMaxCapturedFrames) {
            // Halving eviction: drop the oldest half of the ring at once
            // (amortized O(1) rather than an O(n) pop-front every frame).
            const std::size_t keepFrom = capturedOutput_.size() / 2;
            capturedOutput_.erase(capturedOutput_.begin(),
                                  capturedOutput_.begin() + static_cast<std::ptrdiff_t>(keepFrom));
        }
        capturedOutput_.push_back(std::move(frame));
    }

    static constexpr std::size_t kMaxCapturedFrames = 1u << 20;

    std::size_t patchPumpBudgetBlocks_;
    std::uint64_t nextTimestamp_ = 0;

    int numInputChannels_ = 0;
    int numOutputChannels_ = 0;
    std::size_t blockSize_ = 0;
    double sampleRate_ = 0.0;

    std::vector<std::vector<float>> inputBuffers_;
    std::vector<std::vector<float>> outputBuffers_;
    std::vector<const float*> inputPointers_;
    std::vector<float*> outputPointers_;

    synth::Engine<App> engine_;

    std::vector<OutputFrame> capturedOutput_;
    float outputPeak_ = 0.0f;
    bool sawNaN_ = false;
};

}  // namespace synth_rig
