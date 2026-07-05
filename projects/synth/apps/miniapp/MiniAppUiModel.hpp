#pragma once

// JUCE-free miniapp UI model: encoder-grid layout, control metadata, scene
// labels, modifier/gesture/scene snapshot state, waveform draw descriptions,
// and MessageInBus action routing (Tasks 3.1 and 3.4).

#include "MiniAppCore.hpp"
#include "MiniAppDraw.hpp"

#include "synth/AppContext.hpp"
#include "synth/ParameterModulation.hpp"
#include "synth/PortableUI.hpp"
#include "synth/PortableUIBuilders.hpp"

#include <cstddef>
#include <cstdint>
#include <functional>
#include <string>
#include <utility>
#include <vector>

namespace synth_miniapp {

namespace MiniAppNodeIds {

inline constexpr const char* kRoot = "miniapp.root";
inline constexpr const char* kTitle = "miniapp.title";

inline std::string Encoder(std::size_t index)
{
    return "miniapp.encoder." + std::to_string(index);
}

inline constexpr const char* kVcoScope = "miniapp.vco.scope";
inline constexpr const char* kLfoScope = "miniapp.lfo.scope";

inline constexpr const char* kBankVco = "miniapp.bank.vco";
inline constexpr const char* kBankLfo = "miniapp.bank.lfo";
inline constexpr const char* kGestureToggle = "miniapp.gesture.toggle";
inline constexpr const char* kReset = "miniapp.reset";
inline constexpr const char* kRandom = "miniapp.random";
inline constexpr const char* kRandomMod = "miniapp.random_mod";

inline std::string SceneButton(std::size_t sceneIx)
{
    return "miniapp.scene." + std::to_string(sceneIx);
}

inline constexpr const char* kStart = "miniapp.start";
inline constexpr const char* kStop = "miniapp.stop";
inline constexpr const char* kGestureValue = "miniapp.gesture.value";
inline constexpr const char* kSceneBlend = "miniapp.scene.blend";

}  // namespace MiniAppNodeIds

namespace MiniAppActions {

inline constexpr const char* kBankSelect = "miniapp.bank.select";
inline constexpr const char* kGestureToggle = "miniapp.gesture.toggle";
inline constexpr const char* kGestureValue = "miniapp.gesture.value";
inline constexpr const char* kSceneSelect = "miniapp.scene.select";
inline constexpr const char* kSceneBlend = "miniapp.scene.blend";
inline constexpr const char* kReset = "miniapp.reset";
inline constexpr const char* kRandom = "miniapp.random";
inline constexpr const char* kRandomMod = "miniapp.random_mod";
inline constexpr const char* kStart = "miniapp.start";
inline constexpr const char* kStop = "miniapp.stop";

}  // namespace MiniAppActions

struct EncoderGridLayout
{
    static constexpr std::size_t kEncoderCount = 7;
    static constexpr std::size_t kFirstRowCount = 4;
    static constexpr float kColumnWidth = 132.0f;
    static constexpr float kRowHeight = 150.0f;
    static constexpr float kTotalHeight = kRowHeight * 2.0f;
    static constexpr float kInset = 10.0f;

    static synth::ui::Bounds BoundsForIndex(synth::ui::Bounds area, std::size_t index)
    {
        const std::size_t row = index < kFirstRowCount ? 0 : 1;
        const std::size_t column = row == 0 ? index : index - kFirstRowCount;
        synth::ui::Bounds bounds{
            area.x + static_cast<float>(column) * kColumnWidth,
            area.y + static_cast<float>(row) * kRowHeight,
            kColumnWidth,
            kRowHeight
        };
        bounds.x += kInset;
        bounds.y += kInset;
        bounds.width -= kInset * 2.0f;
        bounds.height -= kInset * 2.0f;
        return bounds;
    }
};

struct MiniAppPageLayout
{
    static constexpr float kContentMargin = 16.0f;
    static constexpr float kTitleOffset = 32.0f;
    static constexpr float kWaveformRowHeight = 130.0f;
    static constexpr float kWaveformInset = 8.0f;
    static constexpr float kDefaultWidth = 900.0f;
    static constexpr float kDefaultHeight = 560.0f;

    static synth::ui::Bounds RootBounds(const synth::AppContext* context)
    {
        const float width = context != nullptr && context->config != nullptr
                                ? static_cast<float>(context->config->uiWidth)
                                : kDefaultWidth;
        const float height = context != nullptr && context->config != nullptr
                                 ? static_cast<float>(context->config->uiHeight)
                                 : kDefaultHeight;
        return {0.0f, 0.0f, width, height};
    }

    static synth::ui::Bounds ContentArea(synth::ui::Bounds rootBounds)
    {
        return {
            kContentMargin,
            kContentMargin,
            rootBounds.width - kContentMargin * 2.0f,
            rootBounds.height - kContentMargin * 2.0f
        };
    }

    static synth::ui::Bounds EncoderArea(synth::ui::Bounds content)
    {
        synth::ui::Bounds encoderArea = content;
        encoderArea.y += kTitleOffset;
        encoderArea.height = EncoderGridLayout::kTotalHeight;
        return encoderArea;
    }

    static void WaveformScopeBounds(synth::ui::Bounds waveformRow, synth::ui::Bounds& vcoScope, synth::ui::Bounds& lfoScope)
    {
        const float halfWaveformWidth = waveformRow.width * 0.5f;
        vcoScope = {
            waveformRow.x + kWaveformInset,
            waveformRow.y + kWaveformInset,
            halfWaveformWidth - kWaveformInset * 2.0f,
            waveformRow.height - kWaveformInset * 2.0f
        };
        lfoScope = {
            waveformRow.x + halfWaveformWidth + kWaveformInset,
            waveformRow.y + kWaveformInset,
            halfWaveformWidth - kWaveformInset * 2.0f,
            waveformRow.height - kWaveformInset * 2.0f
        };
    }
};

inline constexpr std::size_t kSceneCount = 3;

inline const char* SceneLabel(std::size_t sceneIx)
{
    static constexpr const char* x_Labels[kSceneCount] = {"S1", "S2", "S3"};
    return sceneIx < kSceneCount ? x_Labels[sceneIx] : "S?";
}

inline std::string SceneButtonLabel(std::size_t sceneIx, std::size_t leftScene, std::size_t rightScene)
{
    std::string label = SceneLabel(sceneIx);
    if (sceneIx == leftScene)
    {
        label += " L";
    }
    if (sceneIx == rightScene)
    {
        label += " R";
    }
    return label;
}

struct MiniAppModifierState
{
    bool resetHeld = false;
    bool randomHeld = false;
    bool randomModHeld = false;
};

struct MiniAppUiSnapshot
{
    MiniAppModifierState modifiers;
    bool gestureSelected = false;
    float gestureValue = 0.0f;
    float sceneBlend = 0.0f;
    std::size_t leftScene = 0;
    std::size_t rightScene = 0;
};

inline MiniAppUiSnapshot SnapshotUiState(const synth::AppContext* context, std::size_t gestureIx = 0)
{
    MiniAppUiSnapshot snapshot;
    if (context == nullptr || context->uiState == nullptr)
    {
        return snapshot;
    }

    const synth::ParameterManager::UIState& uiState = *context->uiState;
    snapshot.modifiers.resetHeld = uiState.resetHeld.load(std::memory_order_relaxed);
    snapshot.modifiers.randomHeld = uiState.randomHeld.load(std::memory_order_relaxed);
    snapshot.modifiers.randomModHeld = uiState.randomModHeld.load(std::memory_order_relaxed);
    snapshot.sceneBlend = uiState.sceneBlend.load(std::memory_order_relaxed);
    snapshot.leftScene = uiState.leftScene.load(std::memory_order_relaxed);
    snapshot.rightScene = uiState.rightScene.load(std::memory_order_relaxed);

    if (gestureIx < uiState.gestures.gestureCapacity)
    {
        snapshot.gestureSelected =
            uiState.gestures.selected[gestureIx].load(std::memory_order_relaxed);
        snapshot.gestureValue = uiState.gestures.values[gestureIx].load(std::memory_order_relaxed);
    }

    return snapshot;
}

inline VcoWaveformDrawState VcoWaveformDrawStateFromCore(const MiniAppCore& core)
{
    VcoWaveformDrawState state;
    for (const auto& vco : core.VcoUiState().vcos)
    {
        WaveformLayerDrawState layer;
        layer.connected = vco.connected.load(std::memory_order_relaxed);
        layer.color = vco.color.Load(std::memory_order_relaxed);
        layer.scope = vco.scope.load(std::memory_order_relaxed);
        layer.scopeChannel = vco.scopeChannel.load(std::memory_order_relaxed);
        state.layers.push_back(layer);
    }
    return state;
}

inline LfoWaveformDrawState LfoWaveformDrawStateFromCore(const MiniAppCore& core)
{
    LfoWaveformDrawState state;
    for (const auto& lfo : core.LfoUiState().lfos)
    {
        WaveformLayerDrawState layer;
        layer.connected = lfo.connected.load(std::memory_order_relaxed);
        layer.color = lfo.color.Load(std::memory_order_relaxed);
        layer.scope = lfo.scope.load(std::memory_order_relaxed);
        layer.scopeChannel = lfo.scopeChannel.load(std::memory_order_relaxed);
        state.layers.push_back(layer);
    }
    return state;
}

inline void AppendMiniAppControls(synth::ui::Builder& builder, const MiniAppUiSnapshot& snapshot)
{
    builder.Button(MiniAppNodeIds::kBankVco,
                   "VCO",
                   synth::ui::Action::WithValue(MiniAppActions::kBankSelect, "0"));
    builder.Button(MiniAppNodeIds::kBankLfo,
                   "LFO",
                   synth::ui::Action::WithValue(MiniAppActions::kBankSelect, "1"));
    builder.Toggle(MiniAppNodeIds::kGestureToggle,
                   "Gesture",
                   snapshot.gestureSelected,
                   synth::ui::Action::Named(MiniAppActions::kGestureToggle));
    builder.Toggle(MiniAppNodeIds::kReset,
                   "Reset",
                   snapshot.modifiers.resetHeld,
                   synth::ui::Action::Named(MiniAppActions::kReset));
    builder.Toggle(MiniAppNodeIds::kRandom,
                   "Random",
                   snapshot.modifiers.randomHeld,
                   synth::ui::Action::Named(MiniAppActions::kRandom));
    builder.Toggle(MiniAppNodeIds::kRandomMod,
                   "Random Mod",
                   snapshot.modifiers.randomModHeld,
                   synth::ui::Action::Named(MiniAppActions::kRandomMod));

    for (std::size_t sceneIx = 0; sceneIx < kSceneCount; ++sceneIx)
    {
        builder.Button(MiniAppNodeIds::SceneButton(sceneIx),
                       SceneButtonLabel(sceneIx, snapshot.leftScene, snapshot.rightScene),
                       synth::ui::Action::WithValue(MiniAppActions::kSceneSelect, std::to_string(sceneIx)));
    }

    builder.Button(MiniAppNodeIds::kStart, "Start", synth::ui::Action::Named(MiniAppActions::kStart));
    builder.Button(MiniAppNodeIds::kStop, "Stop", synth::ui::Action::Named(MiniAppActions::kStop));

    builder.Slider(MiniAppNodeIds::kGestureValue,
                   "Gesture",
                   snapshot.gestureValue,
                   0.0f,
                   1.0f,
                   0.001f,
                   synth::ui::Action::Named(MiniAppActions::kGestureValue));
    builder.Slider(MiniAppNodeIds::kSceneBlend,
                   "Blend",
                   snapshot.sceneBlend,
                   0.0f,
                   1.0f,
                   0.001f,
                   synth::ui::Action::Named(MiniAppActions::kSceneBlend));
}

inline std::size_t ParseSize(const std::string& value, std::size_t fallback)
{
    if (value.empty())
    {
        return fallback;
    }
    try
    {
        std::size_t consumed = 0;
        const unsigned long parsed = std::stoul(value, &consumed, 10);
        return consumed == value.size() ? static_cast<std::size_t>(parsed) : fallback;
    }
    catch (...)
    {
        return fallback;
    }
}

inline float ParseFloat(const std::string& value, float fallback)
{
    if (value.empty())
    {
        return fallback;
    }
    try
    {
        std::size_t consumed = 0;
        const float parsed = std::stof(value, &consumed);
        return consumed == value.size() ? parsed : fallback;
    }
    catch (...)
    {
        return fallback;
    }
}

inline bool DispatchMiniAppAction(synth::AppContext* context,
                                  std::uint64_t timestamp,
                                  const synth::ui::Action& action,
                                  const std::function<void(const synth::MessageIn&)>& pushMessage)
{
    if (context == nullptr || !pushMessage)
    {
        return false;
    }

    if (action.name == MiniAppActions::kStart)
    {
        pushMessage(synth::MessageIn::Start(timestamp));
        return true;
    }
    if (action.name == MiniAppActions::kStop)
    {
        pushMessage(synth::MessageIn::Stop(timestamp));
        return true;
    }
    if (action.name == MiniAppActions::kBankSelect)
    {
        const std::size_t bankIx = ParseSize(action.value, 0);
        pushMessage(synth::MessageIn::SelectParamBank(timestamp, 0, bankIx));
        return true;
    }
    if (action.name == MiniAppActions::kGestureToggle)
    {
        pushMessage(synth::MessageIn::ToggleGestureSelect(timestamp, 0));
        return true;
    }
    if (action.name == MiniAppActions::kGestureValue)
    {
        const float value = ParseFloat(action.value, 0.0f);
        pushMessage(synth::MessageIn::SetGestureValue(timestamp, 0, value));
        return true;
    }
    if (action.name == MiniAppActions::kSceneSelect)
    {
        const std::size_t sceneIx = ParseSize(action.value, 0);
        pushMessage(synth::MessageIn::SceneSelect(timestamp, sceneIx));
        return true;
    }
    if (action.name == MiniAppActions::kSceneBlend)
    {
        const float blend = ParseFloat(action.value, 0.0f);
        pushMessage(synth::MessageIn::SetSceneBlend(timestamp, blend));
        return true;
    }
    if (action.name == MiniAppActions::kReset)
    {
        pushMessage(synth::MessageIn::ToggleReset(timestamp));
        return true;
    }
    if (action.name == MiniAppActions::kRandom)
    {
        pushMessage(synth::MessageIn::ToggleRandom(timestamp));
        return true;
    }
    if (action.name == MiniAppActions::kRandomMod)
    {
        pushMessage(synth::MessageIn::ToggleRandomMod(timestamp));
        return true;
    }

    return false;
}

}  // namespace synth_miniapp
