#pragma once

#include "synth/Engine.hpp"
#include "synth/browser/BrowserCommandBuffer.hpp"

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
        started_ = true;
    }

    void Stop()
    {
        started_ = false;
        stopped_ = true;
    }

    bool IsRunning() const { return started_; }

    void Prepare(double sampleRate, std::size_t blockSize)
    {
        RequireStarted();
        if (blockSize > static_cast<std::size_t>(std::numeric_limits<int>::max())) {
            throw std::out_of_range("browser block size exceeds engine range");
        }
        engine_.Prepare(sampleRate, static_cast<int>(blockSize));
    }

    void Process(float** outputs, std::size_t frames, std::uint64_t timestampMicros)
    {
        RequireStarted();
        this->timestampMicros_.store(timestampMicros, std::memory_order_relaxed);
        synth::AudioBlock block;
        block.outputs = outputs;
        block.numOutputChannels = engine_.Config().numAudioOutputs;
        block.numFrames = frames;
        engine_.ProcessBlock(block, timestampMicros);
    }

    void MessageTick(std::uint64_t timestampMicros)
    {
        RequireStarted();
        this->timestampMicros_.store(timestampMicros, std::memory_order_relaxed);
        engine_.MessageThreadTick();
    }

    CommandBuffer BuildUiFrame()
    {
        RequireStarted();
        return SerializeNodeTree(engine_.Application().PortableSurface().BuildTree());
    }

    void DispatchAction(std::string name, std::string value)
    {
        RequireStarted();
        engine_.Application().PortableSurface().DispatchAction(
            synth::ui::Action::WithValue(std::move(name), std::move(value)));
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
    bool started_ = false;
    bool stopped_ = false;
};

}  // namespace synth_browser

namespace synth_browser {

// The ABI erases an application-specific Runtime<App>. BrowserAppEntry is the
// sole binding point that instantiates this adapter for a concrete app.
class RuntimeAbi {
public:
    virtual ~RuntimeAbi() = default;
    virtual int Initialize(const char* dataRoot) = 0;
    virtual int Prepare(double sampleRate, std::size_t blockSize) = 0;
    virtual int Process(float** outputs, std::size_t frames, std::uint64_t timestampMicros) = 0;
    virtual int MessageTick(std::uint64_t timestampMicros) = 0;
    virtual const std::uint8_t* BuildUiFrame(std::size_t* size) = 0;
    virtual int DispatchAction(const char* name, const char* value) = 0;
    virtual void Destroy() = 0;
};

template <synth::SynthApplication App>
class RuntimeAbiAdapter final : public RuntimeAbi {
public:
    int Initialize(const char* dataRoot) override
    {
        if (dataRoot == nullptr) {
            return -1;
        }
        try {
            runtime_.SetRuntimeDataPaths(synth::RuntimeDataPaths::FromDataRoot(dataRoot));
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

    int Process(float** outputs, std::size_t frames, std::uint64_t timestampMicros) override
    {
        return Invoke([this, outputs, frames, timestampMicros] { runtime_.Process(outputs, frames, timestampMicros); });
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
};

}  // namespace synth_browser

extern "C" {

struct synth_browser_runtime;

synth_browser_runtime* synth_browser_create();
int synth_browser_initialize(synth_browser_runtime* runtime, const char* dataRoot);
int synth_browser_prepare(synth_browser_runtime* runtime, double sampleRate, std::size_t blockSize);
int synth_browser_process(synth_browser_runtime* runtime, float** outputs, std::size_t frames,
                          std::uint64_t timestampMicros);
int synth_browser_message_tick(synth_browser_runtime* runtime, std::uint64_t timestampMicros);
const std::uint8_t* synth_browser_build_ui_frame(synth_browser_runtime* runtime, std::size_t* size);
int synth_browser_dispatch_action(synth_browser_runtime* runtime, const char* name, const char* value);
void synth_browser_destroy(synth_browser_runtime* runtime);

}
