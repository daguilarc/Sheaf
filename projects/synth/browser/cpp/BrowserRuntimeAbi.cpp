#include "synth/browser/BrowserRuntime.hpp"

extern "C" synth_browser::RuntimeAbi* synth_browser_create_runtime();

namespace {

synth_browser::RuntimeAbi* RuntimeFor(synth_browser_runtime* handle)
{
    return reinterpret_cast<synth_browser::RuntimeAbi*>(handle);
}

}  // namespace

extern "C" synth_browser_runtime* synth_browser_create()
{
    return reinterpret_cast<synth_browser_runtime*>(synth_browser_create_runtime());
}

extern "C" int synth_browser_initialize(synth_browser_runtime* runtime, const char* dataRoot)
{
    return RuntimeFor(runtime) == nullptr ? -1 : RuntimeFor(runtime)->Initialize(dataRoot);
}

extern "C" int synth_browser_prepare(synth_browser_runtime* runtime, double sampleRate, std::size_t blockSize)
{
    return RuntimeFor(runtime) == nullptr ? -1 : RuntimeFor(runtime)->Prepare(sampleRate, blockSize);
}

extern "C" int synth_browser_process(synth_browser_runtime* runtime, float** outputs, std::size_t frames,
                                       std::uint64_t timestampMicros)
{
    return RuntimeFor(runtime) == nullptr ? -1 : RuntimeFor(runtime)->Process(outputs, frames, timestampMicros);
}

extern "C" int synth_browser_message_tick(synth_browser_runtime* runtime, std::uint64_t timestampMicros)
{
    return RuntimeFor(runtime) == nullptr ? -1 : RuntimeFor(runtime)->MessageTick(timestampMicros);
}

extern "C" const std::uint8_t* synth_browser_build_ui_frame(synth_browser_runtime* runtime, std::size_t* size)
{
    return RuntimeFor(runtime) == nullptr ? nullptr : RuntimeFor(runtime)->BuildUiFrame(size);
}

extern "C" int synth_browser_dispatch_action(synth_browser_runtime* runtime, const char* name, const char* value)
{
    return RuntimeFor(runtime) == nullptr ? -1 : RuntimeFor(runtime)->DispatchAction(name, value);
}

extern "C" void synth_browser_destroy(synth_browser_runtime* runtime)
{
    if (RuntimeFor(runtime) != nullptr) {
        RuntimeFor(runtime)->Destroy();
    }
}
