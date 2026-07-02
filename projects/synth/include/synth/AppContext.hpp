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
    // Initial audio device preference (Task 3 review, Critical fix): empty =
    // system default. Engine::Initialize() seeds its engine-owned
    // audioDeviceState_ from these fields, before app_.Init() runs, so the
    // app's preferred starting device lives in static config rather than
    // being poked into engine-owned state through a mutable AppContext
    // pointer after the fact (AppContext no longer exposes one). See
    // Engine::Initialize()'s doc comment for the seeding step.
    std::string preferredOutputDeviceName;
    std::string preferredInputDeviceName;
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
