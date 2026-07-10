#pragma once

// JUCE-free UI model, layout, snapshots, and action routing for Dresden 4.

#include "Dresden4Core.hpp"
#include "Dresden4Draw.hpp"

#include "synth/AppContext.hpp"
#include "synth/ParameterModulation.hpp"
#include "synth/PortableUI.hpp"
#include "synth/PortableUIBuilders.hpp"

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <limits>
#include <string>
#include <vector>

namespace synth_dresden4 {

namespace Dresden4NodeIds {

inline constexpr const char* kRoot = "dresden4.root";
inline constexpr const char* kBackground = "dresden4.background";
inline constexpr const char* kTitle = "dresden4.title";
inline constexpr const char* kBankDresden = "dresden4.bank.dresden";
inline constexpr const char* kBankMatrix = "dresden4.bank.matrix";
inline constexpr const char* kSceneBlend = "dresden4.scene.blend";

inline std::string Scope(std::size_t index)
{
    return "dresden4.scope." + std::to_string(index);
}

inline std::string Encoder(std::size_t index)
{
    return "dresden4.encoder." + std::to_string(index);
}

inline std::string SceneButton(std::size_t sceneIx)
{
    return "dresden4.scene." + std::to_string(sceneIx);
}

}  // namespace Dresden4NodeIds

namespace Dresden4Actions {

inline constexpr const char* kBankSelect = "dresden4.bank.select";
inline constexpr const char* kSceneSelect = "dresden4.scene.select";
inline constexpr const char* kSceneBlend = "dresden4.scene.blend";
inline constexpr const char* kEncoderDrag = "dresden4.encoder.drag";
inline constexpr const char* kEncoderPush = "dresden4.encoder.push";

}  // namespace Dresden4Actions

struct Dresden4EncoderGridLayout
{
    static constexpr std::size_t kEncoderCount = 16;
    static constexpr float kGap = 8.0f;

    static synth::ui::Bounds BoundsForIndex(synth::ui::Bounds area, std::size_t index)
    {
        const std::size_t row = index / 4;
        const std::size_t column = index % 4;
        const float cellWidth = (area.width - kGap * 3.0f) * 0.25f;
        const float cellHeight = (area.height - kGap * 3.0f) * 0.25f;
        return {
            area.x + static_cast<float>(column) * (cellWidth + kGap),
            area.y + static_cast<float>(row) * (cellHeight + kGap),
            cellWidth,
            cellHeight,
        };
    }
};

struct Dresden4PageLayout
{
    static constexpr std::size_t kScopeCount = 4;
    static constexpr float kDefaultWidth = 900.0f;
    static constexpr float kDefaultHeight = 560.0f;
    static constexpr float kMargin = 16.0f;
    static constexpr float kTitleHeight = 30.0f;
    static constexpr float kSceneStripHeight = 44.0f;
    static constexpr float kGap = 14.0f;
    static constexpr float kScopeGridWidth = 390.0f;
    static constexpr float kEncoderGridWidth = 462.0f;

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
            kMargin,
            kMargin,
            std::max(0.0f, rootBounds.width - kMargin * 2.0f),
            std::max(0.0f, rootBounds.height - kMargin * 2.0f),
        };
    }

    static synth::ui::Bounds SceneStripArea(synth::ui::Bounds content)
    {
        return {
            content.x,
            content.y + content.height - kSceneStripHeight,
            content.width,
            kSceneStripHeight,
        };
    }

    static synth::ui::Bounds ScopeGridArea(synth::ui::Bounds content)
    {
        return {
            content.x,
            content.y + kTitleHeight + kGap,
            std::min(kScopeGridWidth, content.width * 0.46f),
            std::max(0.0f, content.height - kTitleHeight - kSceneStripHeight - kGap * 2.0f),
        };
    }

    static synth::ui::Bounds EncoderArea(synth::ui::Bounds content)
    {
        const synth::ui::Bounds scopeArea = ScopeGridArea(content);
        const float x = scopeArea.x + scopeArea.width + kGap;
        return {
            x,
            scopeArea.y,
            std::max(0.0f, std::min(kEncoderGridWidth, content.x + content.width - x)),
            scopeArea.height,
        };
    }

    static synth::ui::Bounds ScopeBounds(synth::ui::Bounds content, std::size_t index)
    {
        const synth::ui::Bounds area = ScopeGridArea(content);
        const std::size_t row = index / 2;
        const std::size_t column = index % 2;
        const float cellWidth = (area.width - kGap) * 0.5f;
        const float cellHeight = (area.height - kGap) * 0.5f;
        return {
            area.x + static_cast<float>(column) * (cellWidth + kGap),
            area.y + static_cast<float>(row) * (cellHeight + kGap),
            cellWidth,
            cellHeight,
        };
    }

    static bool NeedsScrolling(synth::ui::Bounds rootBounds)
    {
        return rootBounds.width < kDefaultWidth || rootBounds.height < kDefaultHeight;
    }
};

struct Dresden4UiSnapshot
{
    float sceneBlend = 0.0f;
    std::size_t leftScene = 0;
    std::size_t rightScene = 1;
    std::size_t selectedBank = 0;
    std::vector<Dresden4EncoderDrawState> encoders;
};

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

inline std::string FormatEncoderGestureValue(std::size_t slotIx, std::size_t position, float delta)
{
    return std::to_string(slotIx) + ":" + std::to_string(position) + ":" + std::to_string(delta);
}

inline bool ParseEncoderGestureValue(const std::string& value,
                                     std::size_t& slotIx,
                                     std::size_t& position,
                                     float& delta)
{
    const std::size_t first = value.find(':');
    if (first == std::string::npos)
    {
        return false;
    }
    const std::size_t second = value.find(':', first + 1);
    if (second == std::string::npos)
    {
        return false;
    }

    const std::size_t parsedSlot = ParseSize(value.substr(0, first), std::numeric_limits<std::size_t>::max());
    const std::size_t parsedPosition =
        ParseSize(value.substr(first + 1, second - first - 1), std::numeric_limits<std::size_t>::max());
    const float parsedDelta = ParseFloat(value.substr(second + 1), std::numeric_limits<float>::quiet_NaN());
    if (parsedSlot == std::numeric_limits<std::size_t>::max() ||
        parsedPosition == std::numeric_limits<std::size_t>::max() ||
        !std::isfinite(parsedDelta))
    {
        return false;
    }

    slotIx = parsedSlot;
    position = parsedPosition;
    delta = parsedDelta;
    return true;
}

inline Dresden4UiSnapshot SnapshotUiState(const synth::AppContext* context)
{
    Dresden4UiSnapshot snapshot;
    snapshot.encoders.resize(Dresden4EncoderGridLayout::kEncoderCount);
    for (std::size_t ix = 0; ix < snapshot.encoders.size(); ++ix)
    {
        snapshot.encoders[ix].label = "Cell " + std::to_string(ix);
    }

    if (context == nullptr || context->uiState == nullptr)
    {
        return snapshot;
    }

    const synth::ParameterManager::UIState& uiState = *context->uiState;
    snapshot.sceneBlend = uiState.sceneBlend.load(std::memory_order_relaxed);
    snapshot.leftScene = uiState.leftScene.load(std::memory_order_relaxed);
    snapshot.rightScene = uiState.rightScene.load(std::memory_order_relaxed);
    if (uiState.bankCapacity > 1 && uiState.banks[1].selected.load(std::memory_order_relaxed))
    {
        snapshot.selectedBank = 1;
    }

    if (uiState.slotCapacity == 0)
    {
        return snapshot;
    }

    const synth::BankSlot::UIState& slotState = uiState.slots[0];
    for (std::size_t ix = 0; ix < snapshot.encoders.size(); ++ix)
    {
        Dresden4EncoderDrawState& out = snapshot.encoders[ix];
        out.selectedBank = snapshot.selectedBank == 1;
        if (ix >= slotState.cellCapacity)
        {
            continue;
        }

        const synth::Parameter::UIState& cell = slotState.cells[ix];
        out.connected = cell.connected.load(std::memory_order_relaxed);
        out.bipolar = cell.bipolar.load(std::memory_order_relaxed);
        out.color = cell.color.Load(std::memory_order_relaxed);
        out.value = cell.voiceCapacity > 0 ? cell.values[0].load(std::memory_order_relaxed) : 0.0f;
        out.spread = cell.voiceCapacity > 0 ? cell.spreadValues[0].load(std::memory_order_relaxed) : 0.0f;
        const char* shortName = cell.shortName.load(std::memory_order_relaxed);
        if (shortName != nullptr && shortName[0] != '\0')
        {
            out.label = shortName;
        }
    }
    return snapshot;
}

inline Dresden4ScopeDrawState ScopeDrawStateFromCore(const Dresden4Core& core, std::size_t scopeIx)
{
    Dresden4ScopeDrawState state;
    if (scopeIx >= Dresden4Core::kOscillatorCount)
    {
        return state;
    }

    const auto& vco = core.VcoUiState().vcos[scopeIx];
    synth::ui::WaveformLayerDrawState layer;
    layer.connected = vco.connected.load(std::memory_order_relaxed);
    layer.color = vco.color.Load(std::memory_order_relaxed);
    layer.scope = vco.scope.load(std::memory_order_relaxed);
    layer.scopeChannel = vco.scopeChannel.load(std::memory_order_relaxed);
    state.layers.push_back(layer);
    return state;
}

inline std::string SceneButtonLabel(std::size_t sceneIx, std::size_t leftScene, std::size_t rightScene)
{
    std::string label = "S" + std::to_string(sceneIx + 1);
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

inline void AppendDresden4Controls(synth::ui::Builder& builder, const Dresden4UiSnapshot& snapshot)
{
    builder.Button(Dresden4NodeIds::kBankDresden,
                   snapshot.selectedBank == 0 ? "Dresden Bank *" : "Dresden Bank",
                   synth::ui::Action::WithValue(Dresden4Actions::kBankSelect, "0"));
    builder.Button(Dresden4NodeIds::kBankMatrix,
                   snapshot.selectedBank == 1 ? "Matrix Bank *" : "Matrix Bank",
                   synth::ui::Action::WithValue(Dresden4Actions::kBankSelect, "1"));
    for (std::size_t sceneIx = 0; sceneIx < 2; ++sceneIx)
    {
        builder.Button(Dresden4NodeIds::SceneButton(sceneIx),
                       SceneButtonLabel(sceneIx, snapshot.leftScene, snapshot.rightScene),
                       synth::ui::Action::WithValue(Dresden4Actions::kSceneSelect, std::to_string(sceneIx)));
    }
    builder.Slider(Dresden4NodeIds::kSceneBlend,
                   "Scene Blend",
                   snapshot.sceneBlend,
                   0.0f,
                   1.0f,
                   0.001f,
                   synth::ui::Action::Named(Dresden4Actions::kSceneBlend));
}

inline bool DispatchDresden4Action(synth::AppContext* context,
                                   std::uint64_t timestamp,
                                   const synth::ui::Action& action,
                                   const std::function<void(const synth::MessageIn&)>& pushMessage)
{
    if (context == nullptr || !pushMessage)
    {
        return false;
    }

    if (action.name == Dresden4Actions::kBankSelect)
    {
        pushMessage(synth::MessageIn::SelectParamBank(timestamp, 0, ParseSize(action.value, 0)));
        return true;
    }
    if (action.name == Dresden4Actions::kSceneSelect)
    {
        pushMessage(synth::MessageIn::SceneSelect(timestamp, ParseSize(action.value, 0)));
        return true;
    }
    if (action.name == Dresden4Actions::kSceneBlend)
    {
        pushMessage(synth::MessageIn::SetSceneBlend(timestamp, ParseFloat(action.value, 0.0f)));
        return true;
    }
    if (action.name == Dresden4Actions::kEncoderDrag)
    {
        std::size_t slotIx = 0;
        std::size_t position = 0;
        float delta = 0.0f;
        if (!ParseEncoderGestureValue(action.value, slotIx, position, delta) || std::fabs(delta) < 0.001f)
        {
            return false;
        }
        pushMessage(synth::MessageIn::ParamIncDec(timestamp, slotIx, position, delta));
        return true;
    }
    if (action.name == Dresden4Actions::kEncoderPush)
    {
        std::size_t slotIx = 0;
        std::size_t position = 0;
        float delta = 0.0f;
        if (!ParseEncoderGestureValue(action.value, slotIx, position, delta))
        {
            return false;
        }
        pushMessage(synth::MessageIn::ParamPush(timestamp, slotIx, position));
        return true;
    }

    return false;
}

}  // namespace synth_dresden4
