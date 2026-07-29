#pragma once

#include "synth/DspScope.hpp"
#include "synth/ParameterModulation.hpp"
#include "synth/PortableUI.hpp"
#include "synth/PortableUILayout.hpp"

#include <algorithm>
#include <atomic>
#include <cassert>
#include <cmath>
#include <cstddef>
#include <functional>
#include <initializer_list>
#include <map>
#include <optional>
#include <span>
#include <string>
#include <utility>
#include <vector>

namespace synth::ui {

namespace waveform_detail {

inline float Clamp(float value, float minValue, float maxValue)
{
    return std::max(minValue, std::min(maxValue, value));
}

inline double Clamp(double value, double minValue, double maxValue)
{
    return std::max(minValue, std::min(maxValue, value));
}

inline constexpr std::size_t x_NumPoints = 1024;

inline double ScopeSampleForPoint(std::size_t point, std::size_t numXSamples)
{
    return static_cast<double>(point) * static_cast<double>(numXSamples) / static_cast<double>(x_NumPoints - 1);
}

inline bool ScopePointCrossesTransfer(std::size_t point, std::size_t numXSamples, double transferSample)
{
    if (point == 0 || transferSample <= 0.0 || transferSample >= static_cast<double>(numXSamples))
    {
        return false;
    }
    const double previousSample = ScopeSampleForPoint(point - 1, numXSamples);
    const double sample = ScopeSampleForPoint(point, numXSamples);
    return previousSample < transferSample && sample >= transferSample;
}

inline std::vector<std::vector<Point>> BuildScopePolylines(const ::synth::ScopeReader& scopeReader,
                                                           Bounds bounds,
                                                           float minY,
                                                           float maxY)
{
    std::vector<std::vector<Point>> polylines;
    if (scopeReader.Empty())
    {
        return polylines;
    }

    const float denominator = std::max(1.0e-6f, maxY - minY);
    const double transferSample = scopeReader.TransferXSample();
    std::vector<Point> current;

    for (std::size_t j = 0; j < x_NumPoints; ++j)
    {
        const double sample = ScopeSampleForPoint(j, scopeReader.NumXSamples());
        const float y = (scopeReader.Get(sample) - minY) / denominator;
        const float screenX = bounds.x + bounds.width * static_cast<float>(j) / static_cast<float>(x_NumPoints - 1);
        const float screenY = bounds.y + bounds.height * (1.0f - Clamp(y, 0.0f, 1.0f));

        if (j == 0 || ScopePointCrossesTransfer(j, scopeReader.NumXSamples(), transferSample))
        {
            if (!current.empty())
            {
                polylines.push_back(std::move(current));
                current = {};
            }
            current.push_back({screenX, screenY});
        }
        else
        {
            current.push_back({screenX, screenY});
        }
    }

    if (!current.empty())
    {
        polylines.push_back(std::move(current));
    }

    return polylines;
}

inline Bounds ScopeMarkerBounds(const ::synth::ScopeReader& scopeReader,
                                Bounds bounds,
                                float minY,
                                float maxY,
                                float radius = 3.0f)
{
    if (scopeReader.Empty() || scopeReader.NumXSamples() == 0)
    {
        return {};
    }

    const double sample = Clamp(
        scopeReader.TransferXSample() > 0.0 ? scopeReader.TransferXSample() - 1.0 : 0.0,
        0.0,
        static_cast<double>(scopeReader.NumXSamples() - 1));
    const float denominator = std::max(1.0e-6f, maxY - minY);
    const float x = bounds.x + bounds.width * static_cast<float>(sample) /
                                    static_cast<float>(scopeReader.NumXSamples() - 1);
    const float normalizedY = (scopeReader.Get(sample) - minY) / denominator;
    const float y = bounds.y + bounds.height * (1.0f - Clamp(normalizedY, 0.0f, 1.0f));
    return {x - radius, y - radius, radius * 2.0f, radius * 2.0f};
}

}  // namespace waveform_detail

namespace ScopePathMath {

inline constexpr std::size_t x_NumPoints = waveform_detail::x_NumPoints;

inline double ScopeSampleForPoint(std::size_t point, std::size_t numXSamples)
{
    return waveform_detail::ScopeSampleForPoint(point, numXSamples);
}

inline bool ScopePointCrossesTransfer(std::size_t point, std::size_t numXSamples, double transferSample)
{
    return waveform_detail::ScopePointCrossesTransfer(point, numXSamples, transferSample);
}

inline std::vector<std::vector<Point>> BuildScopePolylines(const ::synth::ScopeReader& scopeReader,
                                                           Bounds bounds,
                                                           float minY,
                                                           float maxY)
{
    return waveform_detail::BuildScopePolylines(scopeReader, bounds, minY, maxY);
}

inline Bounds ScopeMarkerBounds(const ::synth::ScopeReader& scopeReader,
                                Bounds bounds,
                                float minY,
                                float maxY,
                                float radius = 3.0f)
{
    return waveform_detail::ScopeMarkerBounds(scopeReader, bounds, minY, maxY, radius);
}

}  // namespace ScopePathMath

struct WaveformLayerDrawState
{
    bool connected = false;
    ::synth::Color scopeColor = ::synth::Color::Off;
    const ::synth::ScopeWriter* scope = nullptr;
    std::size_t scopeChannel = 0;
};

inline std::vector<DrawCommand> BuildScopeWaveformCommands(std::span<const WaveformLayerDrawState> layers,
                                                           Bounds nodeBounds,
                                                           float minY,
                                                           float maxY,
                                                           std::size_t numSamples,
                                                           bool drawMarkers)
{
    std::vector<DrawCommand> commands;

    constexpr float x_Inset = 4.0f;
    commands.push_back(DrawCommand::Fill(nodeBounds, Color::Rgb(12, 14, 16)));

    Bounds bounds{
        nodeBounds.x + x_Inset,
        nodeBounds.y + x_Inset,
        std::max(0.0f, nodeBounds.width - x_Inset * 2.0f),
        std::max(0.0f, nodeBounds.height - x_Inset * 2.0f),
    };

    commands.push_back(DrawCommand::Line(
        {bounds.x, bounds.y + bounds.height * 0.5f},
        {bounds.x + bounds.width, bounds.y + bounds.height * 0.5f},
        Color::Rgb(42, 46, 48),
        1.0f));

    for (const WaveformLayerDrawState& layer : layers)
    {
        if (!layer.connected || layer.scope == nullptr)
        {
            continue;
        }

        ::synth::ScopeReader reader(layer.scope, layer.scopeChannel, numSamples, 1);
        if (reader.Empty())
        {
            continue;
        }

        const Color waveColor = layer.scopeColor;
        const auto polylines = waveform_detail::BuildScopePolylines(reader, bounds, minY, maxY);
        for (auto& polyline : polylines)
        {
            if (!polyline.empty())
            {
                commands.push_back(DrawCommand::Polyline(std::move(polyline), waveColor, 1.4f));
            }
        }

        if (drawMarkers)
        {
            const Bounds marker = waveform_detail::ScopeMarkerBounds(reader, bounds, minY, maxY);
            if (marker.width > 0.0f)
            {
                commands.push_back(DrawCommand::FillEllipse(
                    marker,
                    ::synth::Brighten(waveColor, 0.45f)));
            }
        }
    }

    return commands;
}

template <typename LayerState>
class ScopeVisualizer final : public Visualizer
{
public:
    ScopeVisualizer(std::span<LayerState* const> layers,
                    float minY,
                    float maxY,
                    std::size_t numSamples,
                    bool drawMarkers)
        : layers_(layers.begin(), layers.end()),
          minY_(minY),
          maxY_(maxY),
          numSamples_(numSamples),
          drawMarkers_(drawMarkers)
    {}

protected:
    std::vector<DrawCommand> DrawVisible() const override
    {
        std::vector<WaveformLayerDrawState> snapshots;
        snapshots.reserve(layers_.size());
        for (const LayerState* layer : layers_)
        {
            if (layer == nullptr)
            {
                continue;
            }
            snapshots.push_back({
                .connected = layer->connected.load(std::memory_order_relaxed),
                .scopeColor = layer->scopeColor.Load(std::memory_order_relaxed),
                .scope = layer->scope.load(std::memory_order_relaxed),
                .scopeChannel = layer->scopeChannel.load(std::memory_order_relaxed),
            });
        }
        return BuildScopeWaveformCommands(snapshots, GetBounds(), minY_, maxY_, numSamples_, drawMarkers_);
    }

private:
    std::vector<LayerState*> layers_;
    float minY_ = -1.0f;
    float maxY_ = 1.0f;
    std::size_t numSamples_ = 0;
    bool drawMarkers_ = true;
};

struct ControlStyle {
    std::optional<Color> color{};
    std::optional<TextStyle> textStyle{};
    bool selected = false;
    bool enabled = true;
    std::optional<Action> action{};            // plain click
    std::optional<Action> pointerDragAction{};
    std::optional<Action> doubleClickAction{};
    std::string caption;                       // emitted as a sibling Label node
    LayoutOptions layout{};
};

class Builder {
public:
    using Children = std::function<void(Builder&)>;

    Builder& Root(std::string id, Bounds bounds) {
        Node node;
        node.id = NodeId(std::move(id));
        node.kind = NodeKind::Root;
        node.bounds = bounds;
        tree_.nodes.push_back(std::move(node));
        scopeStack_.assign(1, tree_.nodes.size() - 1);
        return *this;
    }

    // Column and Section both emit NodeKind::Section: the model has no Column
    // kind and adding one would be a wire change this change does not budget
    // for. Stacking direction is a resolver property keyed on LayoutOptions,
    // not on the node kind. Do not "fix" this.
    Builder& Column(std::string id, LayoutOptions o, const Children& c) {
        return Container(std::move(id), NodeKind::Section, o, c);
    }
    Builder& Section(std::string id, LayoutOptions o, const Children& c) {
        return Container(std::move(id), NodeKind::Section, o, c);
    }
    Builder& Row(std::string id, LayoutOptions o, const Children& c) {
        return Container(std::move(id), NodeKind::Row, o, c);
    }
    Builder& ScrollArea(std::string id, LayoutOptions o, const Children& c) {
        return Container(std::move(id), NodeKind::ScrollArea, o, c);
    }

    // Grafts an externally built subtree. A Root node in the subtree is
    // discarded and its children attach to the currently open scope, so
    // exactly one Root survives. A ROOTLESS subtree splices whole — that is
    // the shape Tasks 12 and 13 produce for the patch browser and the wizard.
    Builder& Splice(NodeTree subtree) {
        assert(!scopeStack_.empty() && "Builder::Root must be called before splicing");
        std::optional<NodeId> spliceRoot;
        for (const Node& n : subtree.nodes) {
            if (n.kind == NodeKind::Root) {
                assert(!spliceRoot.has_value() && "spliced subtree has more than one Root");
                spliceRoot = n.id;
            }
        }
        for (Node& n : subtree.nodes) {
            if (spliceRoot.has_value() && n.id == *spliceRoot) {
                for (const NodeId& child : n.children) {
                    tree_.nodes[scopeStack_.back()].children.push_back(child);
                }
                continue;
            }
            tree_.nodes.push_back(std::move(n));
        }
        return *this;
    }

    Builder& Label(std::string id, std::string text, ControlStyle style = {}) {
        Node node;
        node.id = NodeId(id);
        node.kind = NodeKind::Label;
        node.text = std::move(text);
        return FinishControl(std::move(node), std::move(style));
    }

    Builder& StatusText(std::string id, std::string text, ControlStyle style = {}) {
        Node node;
        node.id = NodeId(id);
        node.kind = NodeKind::StatusText;
        node.text = std::move(text);
        return FinishControl(std::move(node), std::move(style));
    }

    Builder& Button(std::string id, std::string label, Action action, ControlStyle style = {}) {
        Node node;
        node.id = NodeId(id);
        node.kind = NodeKind::Button;
        node.label = std::move(label);
        node.action = std::move(action);
        return FinishControl(std::move(node), std::move(style));
    }

    Builder& Toggle(std::string id, std::string label, bool checked, Action action, ControlStyle style = {}) {
        Node node;
        node.id = NodeId(id);
        node.kind = NodeKind::Toggle;
        node.label = std::move(label);
        node.checked = checked;
        node.action = std::move(action);
        return FinishControl(std::move(node), std::move(style));
    }

    Builder& Slider(std::string id,
                    std::string label,
                    float value,
                    float minValue,
                    float maxValue,
                    float step,
                    Action action,
                    ControlStyle style = {}) {
        Node node;
        node.id = NodeId(id);
        node.kind = NodeKind::Slider;
        node.label = std::move(label);
        node.value = value;
        node.minValue = minValue;
        node.maxValue = maxValue;
        node.step = step;
        node.action = std::move(action);
        return FinishControl(std::move(node), std::move(style));
    }

    Builder& ComboBox(std::string id,
                      std::string label,
                      std::initializer_list<std::pair<std::string, std::string>> options,
                      std::string selectedOption,
                      Action action,
                      ControlStyle style = {}) {
        Node node;
        node.id = NodeId(id);
        node.kind = NodeKind::ComboBox;
        node.label = std::move(label);
        for (const auto& option : options) {
            node.options.push_back(ControlOption{option.first, option.second});
        }
        node.selectedOption = std::move(selectedOption);
        node.action = std::move(action);
        return FinishControl(std::move(node), std::move(style));
    }

    Builder& TextField(std::string id, std::string label, std::string text, Action action, ControlStyle style = {}) {
        Node node;
        node.id = NodeId(id);
        node.kind = NodeKind::TextField;
        node.label = std::move(label);
        node.text = std::move(text);
        node.action = std::move(action);
        return FinishControl(std::move(node), std::move(style));
    }

    Builder& Visualizer(std::string id, synth::ui::Visualizer* visualizer, ControlStyle style = {}) {
        if (visualizer == nullptr || !visualizer->Visible()) {
            return *this;
        }
        return Draw(std::move(id), visualizer->GetBounds(), visualizer->Draw(), std::move(style));
    }

    Builder& Draw(std::string id, Bounds bounds, std::initializer_list<DrawCommand> commands, ControlStyle style = {}) {
        return Draw(std::move(id), bounds, std::vector<DrawCommand>(commands.begin(), commands.end()), std::move(style));
    }

    Builder& Draw(std::string id, Bounds bounds, std::vector<DrawCommand> commands, ControlStyle style = {}) {
        Node node;
        node.id = NodeId(id);
        node.kind = NodeKind::Draw;
        node.bounds = bounds;
        node.drawCommands = std::move(commands);
        return FinishControl(std::move(node), std::move(style));
    }

    Builder& DrawInteractive(std::string id,
                             Bounds bounds,
                             std::vector<DrawCommand> commands,
                             Action pointerDragAction,
                             std::optional<Action> doubleClickAction = std::nullopt,
                             ControlStyle style = {}) {
        Node node;
        node.id = NodeId(id);
        node.kind = NodeKind::Draw;
        node.bounds = bounds;
        node.drawCommands = std::move(commands);
        node.pointerDragAction = std::move(pointerDragAction);
        node.doubleClickAction = std::move(doubleClickAction);
        return FinishControl(std::move(node), std::move(style));
    }

    NodeTree Build() {
        return tree_;
    }

private:
    void ApplyStyle(Node& node, const ControlStyle& s) {
        node.color = s.color;
        node.textStyle = s.textStyle;
        node.selected = s.selected;
        node.enabled = s.enabled;
        if (s.action.has_value())            { node.action = s.action; }
        if (s.pointerDragAction.has_value()) { node.pointerDragAction = s.pointerDragAction; }
        if (s.doubleClickAction.has_value()) { node.doubleClickAction = s.doubleClickAction; }
    }

    void AppendChild(Node node) {
        assert(!scopeStack_.empty() && "Builder::Root must be called before adding child nodes");
        const NodeId childId = node.id;
        tree_.nodes.push_back(std::move(node));
        tree_.nodes[scopeStack_.back()].children.push_back(childId);
    }

    Builder& Container(std::string id, NodeKind kind, LayoutOptions opts, const Children& children) {
        Node node;
        node.id = NodeId(std::move(id));
        node.kind = kind;
        if (opts.explicitBounds.has_value()) { node.bounds = *opts.explicitBounds; }
        const std::string key = node.id.value;
        AppendChild(std::move(node));
        layoutByNodeId_[key] = opts;
        scopeStack_.push_back(tree_.nodes.size() - 1);
        if (children) { children(*this); }
        scopeStack_.pop_back();
        return *this;
    }

    // Caption id convention (Task 11 Audio page + Task 14 Playwright):
    // A non-empty ControlStyle::caption emits Label "<controlId>.caption" before
    // the control, wrapping both in an implicit Row "<controlId>.row" so the
    // form grid sees a label cell and a control cell.
    Builder& FinishControl(Node node, ControlStyle style) {
        ApplyStyle(node, style);
        if (style.layout.explicitBounds.has_value()) {
            node.bounds = *style.layout.explicitBounds;
        }
        layoutByNodeId_[node.id.value] = style.layout;
        if (style.caption.empty()) {
            AppendChild(std::move(node));
            return *this;
        }

        const std::string controlId = node.id.value;
        Node row;
        row.id = NodeId(controlId + ".row");
        row.kind = NodeKind::Row;
        AppendChild(std::move(row));
        layoutByNodeId_[controlId + ".row"] = LayoutOptions{};
        scopeStack_.push_back(tree_.nodes.size() - 1);
        Label(controlId + ".caption", style.caption);
        AppendChild(std::move(node));
        scopeStack_.pop_back();
        return *this;
    }

    NodeTree tree_;
    std::vector<std::size_t> scopeStack_;
    std::map<std::string, LayoutOptions> layoutByNodeId_;
};

}  // namespace synth::ui
