#pragma once

// JUCE-free UI model, layout, snapshots, and action routing for Braid 4.

#include "Braid4Core.hpp"
#include "Braid4Draw.hpp"

#include "synth/AppContext.hpp"
#include "synth/EncoderDraw.hpp"
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
#include <span>
#include <string>
#include <vector>

namespace synth_braid4 {

namespace Braid4NodeIds {

inline constexpr const char* kRoot = "braid4.root";
inline constexpr const char* kBackground = "braid4.background";
inline constexpr const char* kTitle = "braid4.title";
inline constexpr const char* kBankBraid = "braid4.bank.braid";
inline constexpr const char* kBankMatrix = "braid4.bank.matrix";
inline constexpr const char* kBankLfo = "braid4.bank.lfo";
inline constexpr const char* kBankLfoMatrix = "braid4.bank.lfo_matrix";
inline constexpr const char* kSceneBlend = "braid4.scene.blend";

inline std::string VcoScope(std::size_t index)
{
    return "braid4.scope.vco." + std::to_string(index);
}

inline std::string LfoScope(std::size_t index)
{
    return "braid4.scope.lfo." + std::to_string(index);
}

inline std::string Encoder(std::size_t index)
{
    return "braid4.encoder." + std::to_string(index);
}

inline std::string SceneButton(std::size_t sceneIx)
{
    return "braid4.scene." + std::to_string(sceneIx);
}

}  // namespace Braid4NodeIds

namespace Braid4Actions {

inline constexpr const char* kBankSelect = "braid4.bank.select";
inline constexpr const char* kSceneSelect = "braid4.scene.select";
inline constexpr const char* kSceneBlend = "braid4.scene.blend";
inline constexpr const char* kEncoderDrag = "braid4.encoder.drag";
inline constexpr const char* kEncoderPush = "braid4.encoder.push";

}  // namespace Braid4Actions

// A cell grid is an app-side component: it declares rows and cells and the
// resolver decides every extent from the region it is given, so no cell
// geometry is computed here (sru-53).
inline void EmitBraid4CellGrid(synth::ui::Builder& builder,
                               const std::string& id,
                               std::size_t cellCount,
                               std::size_t columns,
                               float gap,
                               const std::function<void(synth::ui::Builder&, std::size_t)>& emitCell)
{
    synth::ui::LayoutOptions grid;
    grid.main = synth::ui::Extent::Weight(1.0f);
    grid.padding = 0.0f;
    grid.gap = gap;

    builder.Column(id, grid, [&](synth::ui::Builder& builder) {
        for (std::size_t index = 0; index < cellCount; index += columns)
        {
            builder.Row(id + ".row." + std::to_string(index / columns),
                        grid,
                        [&](synth::ui::Builder& builder) {
                            for (std::size_t column = 0; column < columns && index + column < cellCount;
                                 ++column)
                            {
                                emitCell(builder, index + column);
                            }
                        });
        }
    });
}

inline synth::ui::LayoutOptions Braid4CellLayout()
{
    synth::ui::LayoutOptions cell;
    cell.main = synth::ui::Extent::Weight(1.0f);
    return cell;
}

struct Braid4EncoderGridLayout
{
    static constexpr std::size_t kEncoderCount = 16;
    static constexpr std::size_t kColumns = 4;
    static constexpr float kGap = 8.0f;

    static void Emit(synth::ui::Builder& builder,
                     const std::string& id,
                     const std::function<void(synth::ui::Builder&, std::size_t)>& emitCell)
    {
        EmitBraid4CellGrid(builder, id, kEncoderCount, kColumns, kGap, emitCell);
    }
};

struct Braid4ScopeGridLayout
{
    static constexpr std::size_t kScopeCount = 4;
    static constexpr std::size_t kColumns = 2;
    static constexpr float kGap = 14.0f;

    static void Emit(synth::ui::Builder& builder,
                     const std::string& id,
                     const std::function<void(synth::ui::Builder&, std::size_t)>& emitCell)
    {
        EmitBraid4CellGrid(builder, id, kScopeCount, kColumns, kGap, emitCell);
    }
};

// Only the surface extent survives: every region inside it is now resolved by
// the standard application layout (sru-53).
struct Braid4PageLayout
{
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
};

struct Braid4UiSnapshot
{
    float sceneBlend = 0.0f;
    std::size_t leftScene = 0;
    std::size_t rightScene = 1;
    std::size_t selectedBank = 0;
    std::vector<synth::ui::EncoderDrawState> encoders;
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

inline Braid4UiSnapshot SnapshotUiState(const synth::AppContext* context)
{
    Braid4UiSnapshot snapshot;
    snapshot.encoders.resize(Braid4EncoderGridLayout::kEncoderCount);

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
    if (uiState.bankCapacity > 2 && uiState.banks[2].selected.load(std::memory_order_relaxed))
    {
        snapshot.selectedBank = 2;
    }
    if (uiState.bankCapacity > 3 && uiState.banks[3].selected.load(std::memory_order_relaxed))
    {
        snapshot.selectedBank = 3;
    }

    if (uiState.slotCapacity == 0)
    {
        return snapshot;
    }

    const synth::BankSlot::UIState& slotState = uiState.slots[0];
    for (std::size_t ix = 0; ix < snapshot.encoders.size(); ++ix)
    {
        if (ix >= slotState.cellCapacity)
        {
            continue;
        }

        snapshot.encoders[ix] = synth::ui::EncoderDrawStateFromParameter(slotState.cells[ix]);
    }
    return snapshot;
}

inline Braid4ScopeDrawState ScopeDrawStateFromCore(const Braid4Core& core, std::size_t scopeIx)
{
    Braid4ScopeDrawState state;
    if (scopeIx >= Braid4Core::kOscillatorCount)
    {
        return state;
    }

    const auto& vco = core.VcoUiState().vcos[scopeIx];
    synth::ui::WaveformLayerDrawState layer;
    layer.connected = vco.connected.load(std::memory_order_relaxed);
    layer.scopeColor = vco.scopeColor.Load(std::memory_order_relaxed);
    layer.scope = vco.scope.load(std::memory_order_relaxed);
    layer.scopeChannel = vco.scopeChannel.load(std::memory_order_relaxed);
    state.layers.push_back(layer);
    return state;
}

inline Braid4ScopeDrawState LfoScopeDrawStateFromCore(const Braid4Core& core, std::size_t scopeIx)
{
    Braid4ScopeDrawState state;
    if (scopeIx >= Braid4Core::kOscillatorCount)
    {
        return state;
    }

    const auto& lfo = core.LfoUiState().vcos[scopeIx];
    synth::ui::WaveformLayerDrawState layer;
    layer.connected = lfo.connected.load(std::memory_order_relaxed);
    layer.scopeColor = lfo.scopeColor.Load(std::memory_order_relaxed);
    layer.scope = lfo.scope.load(std::memory_order_relaxed);
    layer.scopeChannel = lfo.scopeChannel.load(std::memory_order_relaxed);
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

inline constexpr const char* kBayControlsId = "braid4.bay.controls";

inline void AppendBraid4BayControls(synth::ui::Builder& builder, const Braid4UiSnapshot& snapshot)
{
    builder.Button(Braid4NodeIds::kBankBraid,
                   snapshot.selectedBank == 0 ? "Braid Bank *" : "Braid Bank",
                   synth::ui::Action::WithValue(Braid4Actions::kBankSelect, "0"), {});
    builder.Button(Braid4NodeIds::kBankMatrix,
                   snapshot.selectedBank == 1 ? "Matrix Bank *" : "Matrix Bank",
                   synth::ui::Action::WithValue(Braid4Actions::kBankSelect, "1"), {});
    builder.Button(Braid4NodeIds::kBankLfo,
                   snapshot.selectedBank == 2 ? "LFO Bank *" : "LFO Bank",
                   synth::ui::Action::WithValue(Braid4Actions::kBankSelect, "2"), {});
    builder.Button(Braid4NodeIds::kBankLfoMatrix,
                   snapshot.selectedBank == 3 ? "LFO Matrix *" : "LFO Matrix",
                   synth::ui::Action::WithValue(Braid4Actions::kBankSelect, "3"), {});
    for (std::size_t sceneIx = 0; sceneIx < 2; ++sceneIx)
    {
        builder.Button(Braid4NodeIds::SceneButton(sceneIx),
                       SceneButtonLabel(sceneIx, snapshot.leftScene, snapshot.rightScene),
                       synth::ui::Action::WithValue(Braid4Actions::kSceneSelect, std::to_string(sceneIx)), {});
    }
    synth::ui::ControlStyle sceneBlendStyle;
    sceneBlendStyle.caption = "Scene Blend";
    builder.Slider(Braid4NodeIds::kSceneBlend,
                   "",
                   snapshot.sceneBlend,
                   0.0f,
                   1.0f,
                   0.001f,
                   synth::ui::Action::Named(Braid4Actions::kSceneBlend),
                   sceneBlendStyle);
}

// Every semantic control Braid 4 presents outside its scope slots and encoder
// region lives in the widget bay, on one wrapping row that flows onto as many
// lines as its extent needs (sru-53).
inline void AppendBraid4Controls(synth::ui::Builder& builder, const Braid4UiSnapshot& snapshot)
{
    synth::ui::LayoutOptions controls;
    controls.padding = 0.0f;
    controls.wrap = true;
    builder.Row(kBayControlsId, controls, [&snapshot](synth::ui::Builder& builder) {
        AppendBraid4BayControls(builder, snapshot);
    });
}

inline bool DispatchBraid4Action(synth::AppContext* context,
                                   std::uint64_t timestamp,
                                   const synth::ui::Action& action,
                                   const std::function<void(const synth::MessageIn&)>& pushMessage)
{
    if (context == nullptr || !pushMessage)
    {
        return false;
    }

    if (action.name == Braid4Actions::kBankSelect)
    {
        pushMessage(synth::MessageIn::SelectParamBank(timestamp, 0, ParseSize(action.value, 0)));
        return true;
    }
    if (action.name == Braid4Actions::kSceneSelect)
    {
        pushMessage(synth::MessageIn::SceneSelect(timestamp, ParseSize(action.value, 0)));
        return true;
    }
    if (action.name == Braid4Actions::kSceneBlend)
    {
        pushMessage(synth::MessageIn::SetSceneBlend(timestamp, ParseFloat(action.value, 0.0f)));
        return true;
    }
    if (action.name == Braid4Actions::kEncoderDrag)
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
    if (action.name == Braid4Actions::kEncoderPush)
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

}  // namespace synth_braid4
