#pragma once
#include "synth/AppContext.hpp"
#include "synth/PortableUI.hpp"
#include <concepts>
#include <utility>

namespace synth {

// JUCE-free application core contract (sar-4). The engine and the test rig
// require only this; the JUCE runtime additionally requires SynthApplication.
template <typename T>
concept SynthApplicationCore = requires(T app, AppContext* context, AudioBlock& block) {
    { T::Config() } -> std::convertible_to<RuntimeConfig>;
    { app.Init(context) } -> std::same_as<void>;
    { app.ProcessBlock(block) } -> std::same_as<void>;
};

// Full application contract: core plus the portable UI surface hook.
template <typename T>
concept SynthApplication = SynthApplicationCore<T> && requires(T app) {
    { app.PortableSurface() } -> std::same_as<synth::ui::Surface&>;
};

// Optional hooks, detected at compile time and skipped when absent.
template <typename T>
concept HasPrepareToPlay = requires(T app, double sampleRate, int blockSize) {
    { app.PrepareToPlay(sampleRate, blockSize) } -> std::same_as<void>;
};

// Optional once-per-block control-rate hook. When present, synth::Engine's
// ProcessBlock invokes app.ProcessFrame() exactly once per block, after
// message drains and before the app's own ProcessBlock(block) call (so any
// control-rate state ProcessFrame updates is visible there). Intended for
// application-level work that only needs to run once per block rather than
// once per sample, e.g. control-rate modulation bookkeeping.
template <typename T>
concept HasProcessFrame = requires(T app) {
    { app.ProcessFrame() } -> std::same_as<void>;
};

}  // namespace synth
