// Entry point for the real SynthMiniapp application (Plan 3 Task 6).
//
// SYNTH_RUNTIME_MAIN (runtime/Shell.hpp) expands to a full
// juce::JUCEApplication wrapper around synth_runtime::Runtime<MiniApp> /
// synth_runtime::ShellComponent<MiniApp>, so this file only needs to bring
// in the app type and instantiate the macro.

#include "MiniApp.hpp"
#include "Shell.hpp"

SYNTH_RUNTIME_MAIN(synth_miniapp::MiniApp)
