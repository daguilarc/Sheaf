// Compile-gate entry point for apps/miniapp.
//
// Uses SYNTH_RUNTIME_MAIN (runtime/Shell.hpp) to prove the runtime shell
// (Runtime + ShellComponent + application wrapper) compiles and links
// against the JUCE modules wired up by runtime/juce_build.mk.
// PlaceholderApp is a trivial synth::SynthApplication: it does nothing in
// Init/ProcessBlock and exposes an empty juce::Component. The gate here is
// compile+link only — the app is deliberately not launched interactively in
// CI (that would open a real audio device and window). This file will be
// replaced by the real miniapp UI in a later task (see
// .superpowers/sdd/p3-task-1-brief.md).

#include "Shell.hpp"

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

SYNTH_RUNTIME_MAIN(PlaceholderApp)
