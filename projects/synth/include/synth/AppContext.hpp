#pragma once

// Application/runtime contract types for the synth application runtime
// (sar-1, sar-2, sar-3). JUCE-free: consumed by applications, the engine,
// the JUCE runtime shell, and the headless test rig.

#include "synth/MidiController.hpp"
#include "synth/ParameterModulation.hpp"
#include "synth/PatchPersistence.hpp"

#include <atomic>
#include <cstddef>
#include <filesystem>
#include <string>

namespace synth {

// Static configuration supplied by the application (sar-2). Audio fields are
// a request: the host negotiates actual values with the device and reports
// them through the application's prepare hook.
struct RuntimeConfig {
    std::string appName;
    int numAudioInputs = 0;
    int numAudioOutputs = 2;
    double preferredSampleRate = 48000.0;
    int preferredBlockSize = 256;
    std::filesystem::path patchesRoot;  // patch directories live here
    std::filesystem::path logsRoot;     // session log files; empty = stdout only
    int uiWidth = 900;
    int uiHeight = 560;
    int uiFrameHz = 30;
};

// Non-owning view of one audio device block (sar-6). Channel counts are the
// device's actual counts, which may differ from the RuntimeConfig request.
struct AudioBlock {
    const float* const* inputs = nullptr;
    float* const* outputs = nullptr;
    int numInputChannels = 0;
    int numOutputChannels = 0;
    std::size_t numFrames = 0;
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
    MidiControllerProfileConfig* midiProfileConfig = nullptr;              // message thread only
    const MidiControllerProfileConfig* defaultMidiProfileConfig = nullptr; // immutable after init
    const RuntimeConfig* config = nullptr;          // immutable after construction
    ParameterManager::UIState* uiState = nullptr;   // null during Init; set before MIDI/audio/UI start
};

}  // namespace synth
