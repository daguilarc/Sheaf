#include "synth/browser/BrowserRuntime.hpp"

extern "C" synth_browser::RuntimeAbi* synth_browser_create_runtime();

namespace {

synth_browser::RuntimeAbi* RuntimeFor(synth_browser_runtime* handle)
{
    return reinterpret_cast<synth_browser::RuntimeAbi*>(handle);
}

}  // namespace

extern "C" std::uint32_t synth_browser_abi_version()
{
    return 2;
}

extern "C" std::uint32_t synth_browser_ui_protocol_version()
{
    return 1;
}

extern "C" std::uint32_t synth_browser_runtime_config_version()
{
    return synth_browser::kBrowserRuntimeConfigVersion;
}

extern "C" synth_browser_runtime* synth_browser_create()
{
    return reinterpret_cast<synth_browser_runtime*>(synth_browser_create_runtime());
}

extern "C" int synth_browser_initialize(synth_browser_runtime* runtime, const char* publisherId,
                                          const char* appId, std::uint32_t runtimeConfigVersion)
{
    return RuntimeFor(runtime) == nullptr
               ? -1
               : RuntimeFor(runtime)->Initialize(publisherId, appId, runtimeConfigVersion);
}

extern "C" std::size_t synth_browser_audio_output_channels(synth_browser_runtime* runtime)
{
    return RuntimeFor(runtime) == nullptr ? 0 : RuntimeFor(runtime)->AudioOutputChannels();
}

extern "C" int synth_browser_prepare(synth_browser_runtime* runtime, double sampleRate, std::size_t blockSize)
{
    return RuntimeFor(runtime) == nullptr ? -1 : RuntimeFor(runtime)->Prepare(sampleRate, blockSize);
}

extern "C" int synth_browser_process(synth_browser_runtime* runtime, float** outputs, std::size_t outputChannels,
                                       std::size_t frames, std::uint64_t timestampMicros)
{
    return RuntimeFor(runtime) == nullptr ? -1 : RuntimeFor(runtime)->Process(outputs, outputChannels, frames,
                                                                               timestampMicros);
}

extern "C" int synth_browser_start_audio_worklet(synth_browser_runtime* runtime,
                                                  std::uint32_t audioContextHandle)
{
    return RuntimeFor(runtime) == nullptr
               ? -1
               : RuntimeFor(runtime)->StartAudioWorklet(audioContextHandle);
}

extern "C" std::uint32_t synth_browser_audio_worklet_block_count(synth_browser_runtime* runtime)
{
    return RuntimeFor(runtime) == nullptr ? 0 : RuntimeFor(runtime)->AudioWorkletBlockCount();
}

extern "C" std::uint32_t synth_browser_audio_worklet_peak_microunits(synth_browser_runtime* runtime)
{
    return RuntimeFor(runtime) == nullptr ? 0 : RuntimeFor(runtime)->AudioWorkletPeakMicrounits();
}

extern "C" std::uint32_t synth_browser_audio_worklet_deadline_microunits(synth_browser_runtime* runtime)
{
    return RuntimeFor(runtime) == nullptr ? 0 : RuntimeFor(runtime)->AudioWorkletDeadlineMicrounits();
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

extern "C" int synth_browser_consume_persistence_dirty(synth_browser_runtime* runtime)
{
    return RuntimeFor(runtime) != nullptr && RuntimeFor(runtime)->ConsumePersistenceDirty() ? 1 : 0;
}

extern "C" int synth_browser_submit_midi_endpoints(synth_browser_runtime* runtime,
                                                     const synth_browser::MidiEndpointDescriptor* endpoints,
                                                     std::uint32_t count)
{
    return RuntimeFor(runtime) == nullptr ? -1 : RuntimeFor(runtime)->SubmitMidiEndpoints(endpoints, count);
}

extern "C" int synth_browser_dequeue_midi_action(synth_browser_runtime* runtime,
                                                  synth_browser::MidiActionDescriptor* action)
{
    return RuntimeFor(runtime) == nullptr ? -1 : RuntimeFor(runtime)->DequeueMidiAction(action);
}

extern "C" int synth_browser_deliver_midi(synth_browser_runtime* runtime, std::uint32_t controllerIx,
                                            const std::uint8_t* bytes, std::uint32_t size,
                                            std::uint64_t timestampMicros)
{
    return RuntimeFor(runtime) == nullptr
               ? -1
               : RuntimeFor(runtime)->DeliverMidi(controllerIx, bytes, size, timestampMicros);
}

extern "C" const std::uint8_t* synth_browser_dequeue_midi_output(synth_browser_runtime* runtime,
                                                                    std::uint32_t* controllerIx, std::uint32_t* size)
{
    return RuntimeFor(runtime) == nullptr ? nullptr : RuntimeFor(runtime)->DequeueMidiOutput(controllerIx, size);
}

extern "C" void synth_browser_destroy(synth_browser_runtime* runtime)
{
    if (RuntimeFor(runtime) != nullptr) {
        RuntimeFor(runtime)->Destroy();
    }
}
