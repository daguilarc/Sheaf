#pragma once
#include "synth/AppContext.hpp"
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

// Full application contract: core plus the UI-component hook. The hook's
// return type is deliberately unconstrained here so this header stays
// JUCE-free; the JUCE runtime consumes whatever component type it returns.
template <typename T>
concept SynthApplication = SynthApplicationCore<T> && requires(T app) {
    app.UIComponent();
};

// Optional hooks, detected at compile time and skipped when absent.
template <typename T>
concept HasPrepareToPlay = requires(T app, double sampleRate, int blockSize) {
    { app.PrepareToPlay(sampleRate, blockSize) } -> std::same_as<void>;
};

template <typename T>
concept HasProcessFrame = requires(T app) {
    { app.ProcessFrame() } -> std::same_as<void>;
};

}  // namespace synth
