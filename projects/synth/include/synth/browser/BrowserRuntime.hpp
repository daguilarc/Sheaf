#pragma once

#include "synth/Engine.hpp"
#include "synth/RuntimeMainComponent.hpp"
#include "synth/browser/BrowserCommandBuffer.hpp"
#include "synth/browser/BrowserMidiBridge.hpp"
#include "synth/browser/BrowserPersistence.hpp"
#include "synth/browser/BrowserRuntimeMainServices.hpp"

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#include <emscripten/webaudio.h>
#endif

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <exception>
#include <limits>
#include <stdexcept>
#include <string>
#include <utility>

namespace synth_browser {

class AudioWorkletDeadlineMeter final {
public:
    void RecordCallbackMicros(std::uint64_t elapsedMicros, std::uint64_t blockMicros)
    {
        if (blockMicros == 0) {
            return;
        }
        pendingElapsedMicros_ = SaturatingAdd(pendingElapsedMicros_, elapsedMicros);
        pendingBlockMicros_ = SaturatingAdd(pendingBlockMicros_, blockMicros);
        if (pendingBlockMicros_ < kPublishWindowMicros) {
            return;
        }
        publishedMicrounits_.store(
            DeadlineMicrounits(pendingElapsedMicros_, pendingBlockMicros_),
            std::memory_order_release);
        pendingElapsedMicros_ = 0;
        pendingBlockMicros_ = 0;
    }

    std::uint32_t SampleMicrounits() const
    {
        return publishedMicrounits_.load(std::memory_order_acquire);
    }

    float SamplePercent() const
    {
        return static_cast<float>(SampleMicrounits()) / 1'000'000.0f;
    }

private:
    static constexpr std::uint64_t kPublishWindowMicros = 100'000;

    static std::uint64_t SaturatingAdd(std::uint64_t lhs, std::uint64_t rhs)
    {
        return lhs > std::numeric_limits<std::uint64_t>::max() - rhs
                   ? std::numeric_limits<std::uint64_t>::max()
                   : lhs + rhs;
    }

    static std::uint32_t DeadlineMicrounits(std::uint64_t elapsedMicros,
                                            std::uint64_t blockMicros)
    {
        if (blockMicros == 0) {
            return 0;
        }
        const double percent = static_cast<double>(elapsedMicros) * 100.0 /
                               static_cast<double>(blockMicros);
        return static_cast<std::uint32_t>(
            std::min(static_cast<double>(std::numeric_limits<std::uint32_t>::max()),
                     std::max(0.0, percent * 1'000'000.0)));
    }

    std::uint64_t pendingElapsedMicros_ = 0;
    std::uint64_t pendingBlockMicros_ = 0;
    std::atomic<std::uint32_t> publishedMicrounits_{0};
};

template <synth::SynthApplication App>
class Runtime {
public:
    Runtime()
        : engine_([this] { return timestampMicros_.load(std::memory_order_relaxed); })
        , midiBridge_(engine_)
        , services_(engine_, midiBridge_, [this] { return AudioWorkletDeadlineSamplePercent(); })
        , mainComponent_(engine_.Application(), services_)
    {
    }

    Runtime(const Runtime&) = delete;
    Runtime& operator=(const Runtime&) = delete;

    void SetRuntimeDataPaths(synth::RuntimeDataPaths paths)
    {
        RequireNotStarted();
        engine_.SetRuntimeDataPaths(std::move(paths));
    }

    void Start()
    {
        RequireNotStarted();
        engine_.Initialize();
        midiBridge_.Start();
        started_.store(true, std::memory_order_release);
    }

    void Stop()
    {
        started_.store(false, std::memory_order_release);
#ifdef __EMSCRIPTEN__
        if (audioNode_ != 0) {
            emscripten_destroy_web_audio_node(audioNode_);
            audioNode_ = 0;
        }
        if (audioContext_ != 0) {
            emscripten_destroy_audio_context(audioContext_);
            audioContext_ = 0;
        }
#endif
        midiBridge_.Stop();
        stopped_.store(true, std::memory_order_release);
    }

    bool IsRunning() const { return started_.load(std::memory_order_acquire); }
    std::size_t AudioOutputChannels() const { return engine_.Config().numAudioOutputs; }
    bool RetainAfterStopForAudioWorklet() const
    {
#ifdef __EMSCRIPTEN__
        return audioWorkletStarted_.load(std::memory_order_acquire);
#else
        return false;
#endif
    }

    void Prepare(double sampleRate, std::size_t blockSize)
    {
        RequireStarted();
        if (blockSize > static_cast<std::size_t>(std::numeric_limits<int>::max())) {
            throw std::out_of_range("browser block size exceeds engine range");
        }
        engine_.Prepare(sampleRate, static_cast<int>(blockSize));
        services_.RecordAudioNegotiation(sampleRate, blockSize);
    }

    bool StartAudioWorklet()
    {
#ifdef __EMSCRIPTEN__
        RequireStarted();
        if (audioContext_ != 0) {
            return true;
        }
        EmscriptenWebAudioCreateAttributes attributes{
            .latencyHint = "interactive",
            .sampleRate = 0,
            .renderSizeHint = AUDIO_CONTEXT_RENDER_SIZE_DEFAULT,
        };
        audioContext_ = emscripten_create_audio_context(&attributes);
        if (audioContext_ == 0) {
            return false;
        }
        const int sampleRate = emscripten_audio_context_sample_rate(audioContext_);
        const int quantumSize = emscripten_audio_context_quantum_size(audioContext_);
        if (sampleRate <= 0 || quantumSize <= 0) {
            return false;
        }
        Prepare(static_cast<double>(sampleRate), static_cast<std::size_t>(quantumSize));
        const auto nowMicros = static_cast<std::uint64_t>(std::llround(emscripten_get_now() * 1000.0));
        timestampMicros_.store(nowMicros, std::memory_order_release);
        audioCallbackTimestampMicros_.store(nowMicros, std::memory_order_release);
        audioCallbackBlockMicros_.store(
            static_cast<std::uint64_t>(
                std::llround(static_cast<double>(quantumSize) * 1'000'000.0 /
                             static_cast<double>(sampleRate))),
            std::memory_order_release);
        emscripten_resume_audio_context_sync(audioContext_);
        audioWorkletStarted_.store(true, std::memory_order_release);
        emscripten_start_wasm_audio_worklet_thread_async(audioContext_,
                                                         audioWorkletStack_.data(),
                                                         static_cast<std::uint32_t>(audioWorkletStack_.size()),
                                                         &Runtime::AudioWorkletThreadInitialized,
                                                         this);
        return true;
#else
        return false;
#endif
    }

    std::uint32_t AudioWorkletBlockCount() const
    {
        return audioWorkletBlockCount_.load(std::memory_order_acquire);
    }

    std::uint32_t AudioWorkletPeakMicrounits() const
    {
        return audioWorkletPeakMicrounits_.load(std::memory_order_acquire);
    }

    std::uint32_t AudioWorkletDeadlineMicrounits() const
    {
        return audioWorkletDeadlineMeter_.SampleMicrounits();
    }

    float AudioWorkletDeadlineSamplePercent() const
    {
        return static_cast<float>(AudioWorkletDeadlineMicrounits()) / 1'000'000.0f;
    }

    void Process(float** outputs, std::size_t outputChannels, std::size_t frames, std::uint64_t timestampMicros)
    {
        RequireStarted();
        if (outputs != nullptr &&
            outputChannels != static_cast<std::size_t>(engine_.Config().numAudioOutputs)) {
            throw std::invalid_argument("browser audio channel count does not match app config");
        }
        this->timestampMicros_.store(timestampMicros, std::memory_order_relaxed);
        synth::AudioBlock block;
        block.outputs = outputs;
        block.numOutputChannels = outputs == nullptr ? 0 : outputChannels;
        block.numFrames = frames;
        engine_.ProcessBlock(block, timestampMicros);
    }

    void MessageTick(std::uint64_t timestampMicros)
    {
        RequireStarted();
        this->timestampMicros_.store(timestampMicros, std::memory_order_relaxed);
        engine_.MessageThreadTick();
        if (const auto patchResult = engine_.ConsumeLastTickPatchResult();
            patchResult.has_value() && patchResult->status == synth::PatchCommandStatus::Written) {
            persistenceDirty_ = true;
        }
        mainComponent_.Refresh();
    }

    CommandBuffer BuildUiFrame()
    {
        RequireStarted();
        return SerializeNodeTree(mainComponent_.BuildTree());
    }

    void DispatchAction(std::string name, std::string value)
    {
        RequireStarted();
        mainComponent_.DispatchAction(
            synth::ui::Action::WithValue(std::move(name), std::move(value)));
        mainComponent_.Refresh();
    }

    void SubmitMidiEndpoints(const std::vector<typename BrowserMidiBridge<synth::Engine<App>>::Endpoint>& endpoints)
    {
        RequireStarted();
        midiBridge_.SubmitEndpoints(endpoints);
    }

    std::optional<typename BrowserMidiBridge<synth::Engine<App>>::Action> DequeueMidiAction()
    {
        RequireStarted();
        return midiBridge_.DequeueAction();
    }

    bool DeliverMidi(std::size_t controllerIx, const std::vector<std::uint8_t>& bytes, std::uint64_t timestampMicros)
    {
        RequireStarted();
        return midiBridge_.DeliverIncoming(controllerIx, bytes, timestampMicros);
    }

    std::optional<typename BrowserMidiBridge<synth::Engine<App>>::OutboundMessage> DequeueMidiOutput()
    {
        RequireStarted();
        return midiBridge_.DequeueOutput();
    }

    synth::Engine<App>& Engine() { return engine_; }

    bool ConsumePersistenceDirty()
    {
        const bool servicesDirty = services_.ConsumePersistenceDirty();
        const bool dirty = persistenceDirty_ || servicesDirty;
        persistenceDirty_ = false;
        return dirty;
    }

private:
    void RequireStarted() const
    {
        if (!started_.load(std::memory_order_acquire)) {
            throw std::logic_error(stopped_.load(std::memory_order_acquire) ? "browser runtime is stopped" : "browser runtime is not started");
        }
    }

    void RequireNotStarted() const
    {
        if (started_.load(std::memory_order_acquire) || stopped_.load(std::memory_order_acquire)) {
            throw std::logic_error("browser runtime cannot be started again");
        }
    }

#ifdef __EMSCRIPTEN__
    static constexpr std::size_t kMaxBrowserOutputChannels = 32;

    static void AudioWorkletThreadInitialized(EMSCRIPTEN_WEBAUDIO_T audioContext, bool success, void* userData)
    {
        auto* runtime = static_cast<Runtime*>(userData);
        if (runtime == nullptr || !success) {
            return;
        }
        WebAudioWorkletProcessorCreateOptions options{
            .name = "sheaf-synth-audio",
            .numAudioParams = 0,
            .audioParamDescriptors = nullptr,
        };
        emscripten_create_wasm_audio_worklet_processor_async(audioContext,
                                                             &options,
                                                             &Runtime::AudioWorkletProcessorCreated,
                                                             userData);
    }

    static void AudioWorkletProcessorCreated(EMSCRIPTEN_WEBAUDIO_T audioContext, bool success, void* userData)
    {
        auto* runtime = static_cast<Runtime*>(userData);
        if (runtime == nullptr || !success) {
            return;
        }
        const auto channels = static_cast<int>(runtime->AudioOutputChannels());
        if (channels <= 0 || static_cast<std::size_t>(channels) > kMaxBrowserOutputChannels) {
            return;
        }
        runtime->audioOutputChannelCounts_[0] = channels;
        EmscriptenAudioWorkletNodeCreateOptions nodeOptions{
            .numberOfInputs = 0,
            .numberOfOutputs = 1,
            .outputChannelCounts = runtime->audioOutputChannelCounts_.data(),
            .channelCount = static_cast<unsigned long>(channels),
            .channelCountMode = WEBAUDIO_CHANNEL_COUNT_MODE_EXPLICIT,
            .channelInterpretation = WEBAUDIO_CHANNEL_INTERPRETATION_SPEAKERS,
        };
        runtime->audioNode_ = emscripten_create_wasm_audio_worklet_node(audioContext,
                                                                        "sheaf-synth-audio",
                                                                        &nodeOptions,
                                                                        &Runtime::ProcessAudioWorklet,
                                                                        userData);
        if (runtime->audioNode_ != 0) {
            emscripten_audio_node_connect(runtime->audioNode_, audioContext, 0, 0);
            emscripten_resume_audio_context_sync(audioContext);
        }
    }

    static bool ProcessAudioWorklet(int,
                                    const AudioSampleFrame*,
                                    int numOutputs,
                                    AudioSampleFrame* outputs,
                                    int,
                                    const AudioParamFrame*,
                                    void* userData)
    {
        auto* runtime = static_cast<Runtime*>(userData);
        if (runtime == nullptr || !runtime->started_.load(std::memory_order_acquire)) {
            return false;
        }
        if (numOutputs <= 0 || outputs == nullptr || outputs[0].data == nullptr) {
            return true;
        }
        AudioSampleFrame& output = outputs[0];
        if (output.numberOfChannels <= 0 ||
            static_cast<std::size_t>(output.numberOfChannels) > kMaxBrowserOutputChannels ||
            output.samplesPerChannel <= 0) {
            return true;
        }
        std::array<float*, kMaxBrowserOutputChannels> channelPointers{};
        for (int channel = 0; channel < output.numberOfChannels; ++channel) {
            channelPointers[static_cast<std::size_t>(channel)] =
                output.data + (channel * output.samplesPerChannel);
        }
        const std::uint64_t timestamp = runtime->audioCallbackTimestampMicros_.fetch_add(
            runtime->audioCallbackBlockMicros_.load(std::memory_order_acquire),
            std::memory_order_acq_rel);
        try {
            const double callbackStartMs = emscripten_get_now();
            runtime->Process(channelPointers.data(),
                             static_cast<std::size_t>(output.numberOfChannels),
                             static_cast<std::size_t>(output.samplesPerChannel),
                             timestamp);
            const double elapsedMicros = std::max(0.0, (emscripten_get_now() - callbackStartMs) * 1000.0);
            const auto blockMicros = runtime->audioCallbackBlockMicros_.load(std::memory_order_acquire);
            runtime->audioWorkletDeadlineMeter_.RecordCallbackMicros(
                static_cast<std::uint64_t>(std::llround(elapsedMicros)),
                blockMicros);
            runtime->audioWorkletBlockCount_.fetch_add(1, std::memory_order_acq_rel);
            float peak = 0.0f;
            for (int channel = 0; channel < output.numberOfChannels; ++channel) {
                const float* samples = channelPointers[static_cast<std::size_t>(channel)];
                for (int frame = 0; frame < output.samplesPerChannel; ++frame) {
                    peak = std::max(peak, std::abs(samples[frame]));
                }
            }
            const auto peakMicrounits = static_cast<std::uint32_t>(
                std::min(1'000'000.0f, peak * 1'000'000.0f));
            std::uint32_t current = runtime->audioWorkletPeakMicrounits_.load(std::memory_order_acquire);
            while (peakMicrounits > current &&
                   !runtime->audioWorkletPeakMicrounits_.compare_exchange_weak(
                       current, peakMicrounits, std::memory_order_acq_rel, std::memory_order_acquire)) {
            }
        } catch (const std::exception&) {
            for (int channel = 0; channel < output.numberOfChannels; ++channel) {
                std::fill_n(channelPointers[static_cast<std::size_t>(channel)], output.samplesPerChannel, 0.0f);
            }
        }
        return true;
    }
#endif

    std::atomic<std::uint64_t> timestampMicros_{0};
    std::atomic<std::uint64_t> audioCallbackTimestampMicros_{0};
    std::atomic<std::uint64_t> audioCallbackBlockMicros_{0};
    std::atomic<std::uint32_t> audioWorkletBlockCount_{0};
    std::atomic<std::uint32_t> audioWorkletPeakMicrounits_{0};
    AudioWorkletDeadlineMeter audioWorkletDeadlineMeter_;
    synth::Engine<App> engine_;
    BrowserMidiBridge<synth::Engine<App>> midiBridge_;
    BrowserRuntimeMainServices<App> services_;
    synth::runtime_ui::RuntimeMainComponent<App, BrowserRuntimeMainServices<App>> mainComponent_;
    std::atomic<bool> started_{false};
    std::atomic<bool> stopped_{false};
    bool persistenceDirty_ = false;
#ifdef __EMSCRIPTEN__
    EMSCRIPTEN_WEBAUDIO_T audioContext_ = 0;
    EMSCRIPTEN_WEBAUDIO_T audioNode_ = 0;
    std::atomic<bool> audioWorkletStarted_{false};
    alignas(16) std::array<std::uint8_t, 16 * 1024> audioWorkletStack_{};
    std::array<int, 1> audioOutputChannelCounts_{};
#endif
};

}  // namespace synth_browser

namespace synth_browser {

struct MidiEndpointDescriptor {
    const char* identifier = nullptr;
    std::uint32_t identifierSize = 0;
    const char* name = nullptr;
    std::uint32_t nameSize = 0;
    std::uint32_t kind = 0;
};

struct MidiActionDescriptor {
    std::uint32_t type = 0;
    std::uint32_t controllerIx = 0;
    const char* identifier = nullptr;
    std::uint32_t identifierSize = 0;
    const char* name = nullptr;
    std::uint32_t nameSize = 0;
};

// The ABI erases an application-specific Runtime<App>. BrowserAppEntry is the
// sole binding point that instantiates this adapter for a concrete app.
class RuntimeAbi {
public:
    virtual ~RuntimeAbi() = default;
    virtual std::size_t AudioOutputChannels() const = 0;
    virtual int Initialize(const char* publisherId, const char* appId,
                           std::uint32_t runtimeConfigVersion) = 0;
    virtual int Prepare(double sampleRate, std::size_t blockSize) = 0;
    virtual int Process(float** outputs, std::size_t outputChannels, std::size_t frames,
                        std::uint64_t timestampMicros) = 0;
    virtual int StartAudioWorklet() = 0;
    virtual std::uint32_t AudioWorkletBlockCount() const = 0;
    virtual std::uint32_t AudioWorkletPeakMicrounits() const = 0;
    virtual std::uint32_t AudioWorkletDeadlineMicrounits() const = 0;
    virtual int MessageTick(std::uint64_t timestampMicros) = 0;
    virtual const std::uint8_t* BuildUiFrame(std::size_t* size) = 0;
    virtual int DispatchAction(const char* name, const char* value) = 0;
    virtual bool ConsumePersistenceDirty() = 0;
    virtual int SubmitMidiEndpoints(const MidiEndpointDescriptor* endpoints, std::uint32_t count) = 0;
    virtual int DequeueMidiAction(MidiActionDescriptor* action) = 0;
    virtual int DeliverMidi(std::uint32_t controllerIx, const std::uint8_t* bytes, std::uint32_t size,
                            std::uint64_t timestampMicros) = 0;
    virtual const std::uint8_t* DequeueMidiOutput(std::uint32_t* controllerIx, std::uint32_t* size) = 0;
    virtual void Destroy() = 0;
};

template <synth::SynthApplication App>
class RuntimeAbiAdapter final : public RuntimeAbi {
public:
    std::size_t AudioOutputChannels() const override { return runtime_.AudioOutputChannels(); }

    int Initialize(const char* publisherId, const char* appId,
                   std::uint32_t runtimeConfigVersion) override
    {
        if (publisherId == nullptr || appId == nullptr) {
            return -1;
        }
        try {
            runtime_.SetRuntimeDataPaths(
                BrowserPersistentDataPaths(publisherId, appId, runtimeConfigVersion));
            runtime_.Start();
            return 0;
        } catch (const std::exception&) {
            return -1;
        }
    }

    int Prepare(double sampleRate, std::size_t blockSize) override
    {
        return Invoke([this, sampleRate, blockSize] { runtime_.Prepare(sampleRate, blockSize); });
    }

    int Process(float** outputs, std::size_t outputChannels, std::size_t frames,
                std::uint64_t timestampMicros) override
    {
        return Invoke([this, outputs, outputChannels, frames, timestampMicros] {
            runtime_.Process(outputs, outputChannels, frames, timestampMicros);
        });
    }

    int StartAudioWorklet() override
    {
        return Invoke([this] {
            if (!runtime_.StartAudioWorklet()) {
                throw std::runtime_error("browser runtime failed to start AudioWorklet");
            }
        });
    }

    std::uint32_t AudioWorkletBlockCount() const override
    {
        return runtime_.AudioWorkletBlockCount();
    }

    std::uint32_t AudioWorkletPeakMicrounits() const override
    {
        return runtime_.AudioWorkletPeakMicrounits();
    }

    std::uint32_t AudioWorkletDeadlineMicrounits() const override
    {
        return runtime_.AudioWorkletDeadlineMicrounits();
    }

    int MessageTick(std::uint64_t timestampMicros) override
    {
        return Invoke([this, timestampMicros] { runtime_.MessageTick(timestampMicros); });
    }

    const std::uint8_t* BuildUiFrame(std::size_t* size) override
    {
        if (size == nullptr) {
            return nullptr;
        }
        try {
            frame_ = runtime_.BuildUiFrame();
            *size = frame_.bytes.size();
            return reinterpret_cast<const std::uint8_t*>(frame_.bytes.data());
        } catch (const std::exception&) {
            *size = 0;
            return nullptr;
        }
    }

    int DispatchAction(const char* name, const char* value) override
    {
        if (name == nullptr || value == nullptr) {
            return -1;
        }
        return Invoke([this, name, value] { runtime_.DispatchAction(name, value); });
    }

    bool ConsumePersistenceDirty() override
    {
        return runtime_.ConsumePersistenceDirty();
    }

    int SubmitMidiEndpoints(const MidiEndpointDescriptor* endpoints, std::uint32_t count) override
    {
        if (count > 0 && endpoints == nullptr) {
            return -1;
        }
        std::vector<typename BrowserMidiBridge<synth::Engine<App>>::Endpoint> converted;
        converted.reserve(count);
        for (std::uint32_t ix = 0; ix < count; ++ix) {
            const MidiEndpointDescriptor& endpoint = endpoints[ix];
            if ((endpoint.identifier == nullptr && endpoint.identifierSize != 0) ||
                (endpoint.name == nullptr && endpoint.nameSize != 0) || endpoint.kind > 1) {
                return -1;
            }
            converted.push_back({
                .identifier = endpoint.identifier == nullptr ? std::string{} : std::string(endpoint.identifier, endpoint.identifierSize),
                .name = endpoint.name == nullptr ? std::string{} : std::string(endpoint.name, endpoint.nameSize),
                .kind = endpoint.kind == 0 ? BrowserMidiBridge<synth::Engine<App>>::EndpointKind::Input
                                           : BrowserMidiBridge<synth::Engine<App>>::EndpointKind::Output,
            });
        }
        return Invoke([this, &converted] { runtime_.SubmitMidiEndpoints(converted); });
    }

    int DequeueMidiAction(MidiActionDescriptor* action) override
    {
        if (action == nullptr) {
            return -1;
        }
        try {
            action_.reset();
            action_ = runtime_.DequeueMidiAction();
            if (!action_.has_value()) {
                return 0;
            }
            action->type = static_cast<std::uint32_t>(action_->type);
            action->controllerIx = static_cast<std::uint32_t>(action_->controllerIx);
            action->identifier = action_->identifier.data();
            action->identifierSize = static_cast<std::uint32_t>(action_->identifier.size());
            action->name = action_->name.data();
            action->nameSize = static_cast<std::uint32_t>(action_->name.size());
            return 1;
        } catch (const std::exception&) {
            return -1;
        }
    }

    int DeliverMidi(std::uint32_t controllerIx, const std::uint8_t* bytes, std::uint32_t size,
                    std::uint64_t timestampMicros) override
    {
        if (size == 0 || bytes == nullptr) {
            return -1;
        }
        return Invoke([this, controllerIx, bytes, size, timestampMicros] {
            if (!runtime_.DeliverMidi(controllerIx, std::vector<std::uint8_t>(bytes, bytes + size), timestampMicros)) {
                throw std::runtime_error("browser MIDI input has no selected controller");
            }
        });
    }

    const std::uint8_t* DequeueMidiOutput(std::uint32_t* controllerIx, std::uint32_t* size) override
    {
        if (controllerIx == nullptr || size == nullptr) {
            return nullptr;
        }
        try {
            output_.reset();
            output_ = runtime_.DequeueMidiOutput();
            if (!output_.has_value()) {
                *controllerIx = 0;
                *size = 0;
                return nullptr;
            }
            *controllerIx = static_cast<std::uint32_t>(output_->controllerIx);
            *size = static_cast<std::uint32_t>(output_->bytes.size());
            return output_->bytes.data();
        } catch (const std::exception&) {
            *controllerIx = 0;
            *size = 0;
            return nullptr;
        }
    }

    void Destroy() override
    {
        const bool retainForAudioWorklet = runtime_.RetainAfterStopForAudioWorklet();
        runtime_.Stop();
        if (retainForAudioWorklet) {
            // Emscripten's WebAudio destroy path suspends the context but does
            // not expose a synchronous join for the Wasm AudioWorklet thread.
            // Keep the erased runtime and its worklet stack alive for the
            // browser page lifetime so late process callbacks cannot touch
            // freed userdata.
            return;
        }
        delete this;
    }

private:
    template <typename Operation>
    static int Invoke(Operation&& operation)
    {
        try {
            std::forward<Operation>(operation)();
            return 0;
        } catch (const std::exception&) {
            return -1;
        }
    }

    Runtime<App> runtime_;
    CommandBuffer frame_;
    std::optional<typename BrowserMidiBridge<synth::Engine<App>>::Action> action_;
    std::optional<typename BrowserMidiBridge<synth::Engine<App>>::OutboundMessage> output_;
};

}  // namespace synth_browser

extern "C" {

struct synth_browser_runtime;

std::uint32_t synth_browser_abi_version();
std::uint32_t synth_browser_ui_protocol_version();
std::uint32_t synth_browser_runtime_config_version();
synth_browser_runtime* synth_browser_create();
int synth_browser_initialize(synth_browser_runtime* runtime, const char* publisherId,
                             const char* appId, std::uint32_t runtimeConfigVersion);
std::size_t synth_browser_audio_output_channels(synth_browser_runtime* runtime);
int synth_browser_prepare(synth_browser_runtime* runtime, double sampleRate, std::size_t blockSize);
int synth_browser_process(synth_browser_runtime* runtime, float** outputs, std::size_t outputChannels,
                          std::size_t frames, std::uint64_t timestampMicros);
int synth_browser_start_audio_worklet(synth_browser_runtime* runtime);
std::uint32_t synth_browser_audio_worklet_block_count(synth_browser_runtime* runtime);
std::uint32_t synth_browser_audio_worklet_peak_microunits(synth_browser_runtime* runtime);
std::uint32_t synth_browser_audio_worklet_deadline_microunits(synth_browser_runtime* runtime);
int synth_browser_message_tick(synth_browser_runtime* runtime, std::uint64_t timestampMicros);
const std::uint8_t* synth_browser_build_ui_frame(synth_browser_runtime* runtime, std::size_t* size);
int synth_browser_dispatch_action(synth_browser_runtime* runtime, const char* name, const char* value);
int synth_browser_consume_persistence_dirty(synth_browser_runtime* runtime);
int synth_browser_submit_midi_endpoints(synth_browser_runtime* runtime,
                                        const synth_browser::MidiEndpointDescriptor* endpoints, std::uint32_t count);
int synth_browser_dequeue_midi_action(synth_browser_runtime* runtime, synth_browser::MidiActionDescriptor* action);
int synth_browser_deliver_midi(synth_browser_runtime* runtime, std::uint32_t controllerIx, const std::uint8_t* bytes,
                               std::uint32_t size, std::uint64_t timestampMicros);
const std::uint8_t* synth_browser_dequeue_midi_output(synth_browser_runtime* runtime, std::uint32_t* controllerIx,
                                                       std::uint32_t* size);
void synth_browser_destroy(synth_browser_runtime* runtime);

}
