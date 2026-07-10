#pragma once

#include "synth/Engine.hpp"
#include "synth/RuntimeMainComponent.hpp"
#include "synth/browser/BrowserCommandBuffer.hpp"
#include "synth/browser/BrowserMidiBridge.hpp"
#include "synth/browser/BrowserPersistence.hpp"
#include "synth/browser/BrowserRuntimeMainServices.hpp"

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <exception>
#include <limits>
#include <stdexcept>
#include <string>
#include <utility>

namespace synth_browser {

template <synth::SynthApplication App>
class Runtime {
public:
    Runtime()
        : engine_([this] { return timestampMicros_.load(std::memory_order_relaxed); })
        , midiBridge_(engine_)
        , services_(engine_, midiBridge_)
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
        started_ = true;
    }

    void Stop()
    {
        midiBridge_.Stop();
        started_ = false;
        stopped_ = true;
    }

    bool IsRunning() const { return started_; }
    std::size_t AudioOutputChannels() const { return engine_.Config().numAudioOutputs; }

    void Prepare(double sampleRate, std::size_t blockSize)
    {
        RequireStarted();
        if (blockSize > static_cast<std::size_t>(std::numeric_limits<int>::max())) {
            throw std::out_of_range("browser block size exceeds engine range");
        }
        engine_.Prepare(sampleRate, static_cast<int>(blockSize));
        services_.RecordAudioNegotiation(sampleRate, blockSize);
    }

    void Process(float** outputs, std::size_t outputChannels, std::size_t frames, std::uint64_t timestampMicros)
    {
        RequireStarted();
        if (outputs != nullptr && outputChannels != engine_.Config().numAudioOutputs) {
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

private:
    void RequireStarted() const
    {
        if (!started_) {
            throw std::logic_error(stopped_ ? "browser runtime is stopped" : "browser runtime is not started");
        }
    }

    void RequireNotStarted() const
    {
        if (started_ || stopped_) {
            throw std::logic_error("browser runtime cannot be started again");
        }
    }

    std::atomic<std::uint64_t> timestampMicros_{0};
    synth::Engine<App> engine_;
    BrowserMidiBridge<synth::Engine<App>> midiBridge_;
    BrowserRuntimeMainServices<App> services_;
    synth::runtime_ui::RuntimeMainComponent<App, BrowserRuntimeMainServices<App>> mainComponent_;
    bool started_ = false;
    bool stopped_ = false;
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
    virtual int Initialize(const char* dataRoot) = 0;
    virtual int Prepare(double sampleRate, std::size_t blockSize) = 0;
    virtual int Process(float** outputs, std::size_t outputChannels, std::size_t frames,
                        std::uint64_t timestampMicros) = 0;
    virtual int MessageTick(std::uint64_t timestampMicros) = 0;
    virtual const std::uint8_t* BuildUiFrame(std::size_t* size) = 0;
    virtual int DispatchAction(const char* name, const char* value) = 0;
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

    int Initialize(const char* dataRoot) override
    {
        if (dataRoot == nullptr) {
            return -1;
        }
        try {
            const std::string_view root{dataRoot};
            runtime_.SetRuntimeDataPaths(root == kBrowserDataRoot ? BrowserPersistentDataPaths()
                                                                  : synth::RuntimeDataPaths::FromDataRoot(dataRoot));
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
        runtime_.Stop();
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

synth_browser_runtime* synth_browser_create();
int synth_browser_initialize(synth_browser_runtime* runtime, const char* dataRoot);
std::size_t synth_browser_audio_output_channels(synth_browser_runtime* runtime);
int synth_browser_prepare(synth_browser_runtime* runtime, double sampleRate, std::size_t blockSize);
int synth_browser_process(synth_browser_runtime* runtime, float** outputs, std::size_t outputChannels,
                          std::size_t frames, std::uint64_t timestampMicros);
int synth_browser_message_tick(synth_browser_runtime* runtime, std::uint64_t timestampMicros);
const std::uint8_t* synth_browser_build_ui_frame(synth_browser_runtime* runtime, std::size_t* size);
int synth_browser_dispatch_action(synth_browser_runtime* runtime, const char* name, const char* value);
int synth_browser_submit_midi_endpoints(synth_browser_runtime* runtime,
                                        const synth_browser::MidiEndpointDescriptor* endpoints, std::uint32_t count);
int synth_browser_dequeue_midi_action(synth_browser_runtime* runtime, synth_browser::MidiActionDescriptor* action);
int synth_browser_deliver_midi(synth_browser_runtime* runtime, std::uint32_t controllerIx, const std::uint8_t* bytes,
                               std::uint32_t size, std::uint64_t timestampMicros);
const std::uint8_t* synth_browser_dequeue_midi_output(synth_browser_runtime* runtime, std::uint32_t* controllerIx,
                                                       std::uint32_t* size);
void synth_browser_destroy(synth_browser_runtime* runtime);

}
