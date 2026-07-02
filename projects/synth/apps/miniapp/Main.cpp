// Compile-gate entry point for apps/miniapp.
//
// Instantiates synth_runtime::Runtime<PlaceholderApp> to prove the Runtime
// shell (runtime/Runtime.hpp) compiles and links against the JUCE modules
// wired up by runtime/juce_build.mk. PlaceholderApp is a trivial
// synth::SynthApplication: it does nothing in Init/ProcessBlock and exposes
// an empty juce::Component. Start() is deliberately NOT called here — that
// would open a real audio device, which must not happen in CI. This file
// will be replaced by the real miniapp UI in a later task (see
// .superpowers/sdd/p3-task-1-brief.md).

#include "Runtime.hpp"

#include <juce_gui_extra/juce_gui_extra.h>

namespace {

class PlaceholderComponent final : public juce::Component {};

class PlaceholderApp {
public:
    static synth::RuntimeConfig Config() {
        synth::RuntimeConfig config;
        config.appName = "Placeholder";
        config.numAudioInputs = 0;
        config.numAudioOutputs = 2;
        return config;
    }

    void Init(synth::AppContext*) {}
    void ProcessBlock(synth::AudioBlock&) {}

    juce::Component& UIComponent() { return component_; }

private:
    PlaceholderComponent component_;
};

}  // namespace

int main(int, char**) {
    juce::ScopedJuceInitialiser_GUI juceInit;
    synth_runtime::Runtime<PlaceholderApp> runtime;
    return 0;
}
