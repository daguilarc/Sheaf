#pragma once

// Application/runtime contract types for the synth application runtime
// (sar-1, sar-2, sar-3). JUCE-free: consumed by applications, the engine,
// the JUCE runtime shell, and the headless test rig.

#include "synth/MidiController.hpp"
#include "synth/ParameterModulation.hpp"
#include "synth/PatchPersistence.hpp"

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <functional>
#include <string>
#include <utility>

namespace synth {

class GridManager;

// Static configuration supplied by the application (sar-2). Audio fields are
// a request: the host negotiates actual values with the device and reports
// them through the application's prepare hook.
struct RuntimeConfig {
    std::string appName;
    int numAudioInputs = 0;
    int numAudioOutputs = 2;
    double preferredSampleRate = 48000.0;
    int preferredBlockSize = 256;
    int uiWidth = 900;
    int uiHeight = 560;
    int uiFrameHz = 30;
};

// Runtime-owned persistent data paths (sar-17). Applications do not choose
// production persistence roots; hosts resolve and inject these paths.
struct RuntimeDataPaths {
    std::filesystem::path dataRoot;
    std::filesystem::path patchesRoot;
    std::filesystem::path logsRoot;
    std::filesystem::path configFile;

    static RuntimeDataPaths FromDataRoot(std::filesystem::path root) {
        RuntimeDataPaths paths;
        paths.dataRoot = std::move(root);
        paths.patchesRoot = paths.dataRoot / "patches";
        paths.logsRoot = paths.dataRoot / "logs";
        paths.configFile = paths.dataRoot / "config.json";
        return paths;
    }

    static RuntimeDataPaths FromRoots(std::filesystem::path dataRoot,
                                      std::filesystem::path patchesRoot,
                                      std::filesystem::path logsRoot,
                                      std::filesystem::path configFile) {
        RuntimeDataPaths paths;
        paths.dataRoot = std::move(dataRoot);
        paths.patchesRoot = std::move(patchesRoot);
        paths.logsRoot = std::move(logsRoot);
        paths.configFile = std::move(configFile);
        return paths;
    }
};

// Non-owning view of one audio device block (sar-6). Channel counts are the
// device's actual counts, which may differ from the RuntimeConfig request.
struct AudioBlock {
    const float* const* inputs = nullptr;
    float* const* outputs = nullptr;
    int numInputChannels = 0;
    int numOutputChannels = 0;
    std::size_t numFrames = 0;
    std::uint64_t startSample = 0;
};

// Non-owning pointers to every framework object an application may touch
// (sar-3). The host owns all pointees; addresses are stable for the
// application's lifetime. Thread roles below are binding (sar-7); a member
// may only be used from its named thread.
struct AppContext {
    ParameterManager* parameterManager = nullptr;   // audio thread once running; message thread before start
    PatchManager* patchManager = nullptr;           // message thread only (commands + responses)
    MessageInBus* uiBus = nullptr;                  // producer: message thread; consumer: audio thread
    MessageInBus* midiBus = nullptr;                // producer: MIDI callback thread; consumer: audio thread
    ParameterMessageOutBus* parameterMessageOutBus = nullptr;  // producer: audio; consumer: message thread
    PatchMessageInBus* patchInputBus = nullptr;     // producer: message thread; consumer: audio thread
    MessageOutBus* patchOutputBus = nullptr;        // producer: audio; consumer: message thread
    MidiSender* midiSender = nullptr;               // enqueue from message thread; owned worker drains
    MidiInstrumentConfig* instrument = nullptr;              // message thread only
    const MidiInstrumentConfig* defaultInstrument = nullptr; // immutable after init
    const RuntimeConfig* config = nullptr;          // immutable after construction
    ParameterManager::UIState* uiState = nullptr;   // null during Init; set before MIDI/audio/UI start
    // Init-only topology declaration; Engine owns this manager. Do not use it
    // for application runtime mutation after Engine finalizes grid topology.
    // Message thread during Init only.
    GridManager* gridManager = nullptr;

    // Shared monotonic timestamp source, the same one passed to the owning
    // synth::Engine<App>'s constructor (Runtime.hpp's NowMicros() under the
    // JUCE shell, SynthRig's NextTimestamp() under the headless test rig).
    // Callable from any thread; exists so a UI wrapper can stamp MessageIn
    // values it pushes onto uiBus (encoder drags, button presses) without
    // inventing a second, divergent clock. Null only in contexts that never
    // construct a real Engine (there are none today); UI code should treat a
    // null now as "unavailable" rather than crash.
    std::function<std::uint64_t()> now;
};

}  // namespace synth
