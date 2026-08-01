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
#include <set>
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
                                                           Bounds nodeExtent,
                                                           float minY,
                                                           float maxY,
                                                           std::size_t numSamples,
                                                           bool drawMarkers)
{
    std::vector<DrawCommand> commands;

    constexpr float x_Inset = 4.0f;
    commands.push_back(DrawCommand::Fill({0.0f, 0.0f, nodeExtent.width, nodeExtent.height},
                                         Color::Rgb(12, 14, 16)));

    Bounds bounds{
        x_Inset,
        x_Inset,
        std::max(0.0f, nodeExtent.width - x_Inset * 2.0f),
        std::max(0.0f, nodeExtent.height - x_Inset * 2.0f),
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
        const Bounds bounds = GetBounds();
        return BuildScopeWaveformCommands(
            snapshots,
            {0.0f, 0.0f, bounds.width, bounds.height},
            minY_,
            maxY_,
            numSamples_,
            drawMarkers_);
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
    std::optional<Color> borderColor{};
    std::optional<float> borderWidth{};
    std::optional<float> cornerRadius{};
    bool selected = false;
    bool enabled = true;
    std::optional<Action> action{};            // plain click
    std::optional<Action> pointerDragAction{};
    std::optional<Action> doubleClickAction{};
    std::string caption;                       // emitted as a sibling Label node
    LayoutOptions layout{};
};

// A subtree plus the layout declarations that belong to it. This is the unit of
// splicing: NodeTree alone cannot carry LayoutOptions, and Node must not — the
// model layer knows nothing about the library's layout vocabulary (sru-51).
struct Subtree {
    NodeTree tree;
    std::map<std::string, LayoutOptions> layout;
    std::map<std::string, DrawFactory> drawFactories;
};

class Builder {
public:
    using Children = std::function<void(Builder&)>;
    using DrawFactory = synth::ui::DrawFactory;

    Builder& Root(std::string id, Bounds bounds) {
        return Root(std::move(id), bounds, {});
    }

    Builder& Root(std::string id, Bounds bounds, ControlStyle style) {
        Node node;
        node.id = NodeId(std::move(id));
        node.kind = NodeKind::Root;
        node.bounds = bounds;
        ApplyStyle(node, style);
        tree_.nodes.push_back(std::move(node));
        scopeStack_.assign(1, tree_.nodes.size() - 1);
        return *this;
    }

    // Opens a ROOTLESS subtree, the production half of the interface Splice
    // already consumes: the nodes emitted at this level become the subtree's
    // FOREST ROOTS, which Splice attaches to the host's open scope. A rootless
    // component names no root and therefore no root extent, so it carries no
    // surface size and resolves identically wherever it is mounted -- which is
    // exactly what a spliced page fragment needs and what a Root would force it
    // to invent. Pair with BuildSubtree(); Build() has nothing to resolve
    // against and asserts.
    Builder& Rootless() {
        Node scope;
        scope.id = NodeId(kRootlessScopeId);
        scope.kind = NodeKind::Section;
        tree_.nodes.push_back(std::move(scope));
        // Remembered by INDEX, not by id: a producer is free to emit a node
        // whose id happens to match the marker's, and matching by id would
        // delete it without a word.
        rootlessScopeIndex_ = tree_.nodes.size() - 1;
        scopeStack_.assign(1, *rootlessScopeIndex_);
        return *this;
    }

    // Column and Section both emit NodeKind::Section: the model has no Column
    // kind and adding one would be a wire change this change does not budget
    // for. Stacking direction is a resolver property keyed on LayoutOptions,
    // not on the node kind. Do not "fix" this.
    Builder& Column(std::string id, LayoutOptions o, const Children& c) {
        return Container(std::move(id), NodeKind::Section, o, c);
    }
    // The explicit LayoutOptions argument is the container's layout declaration;
    // ControlStyle::layout is ignored for this overload so appearance and
    // layout cannot silently disagree.
    Builder& Column(std::string id, LayoutOptions o, ControlStyle style, const Children& c) {
        style.layout = std::move(o);
        return Container(std::move(id), NodeKind::Section, std::move(style), c);
    }
    Builder& Section(std::string id, LayoutOptions o, const Children& c) {
        return Container(std::move(id), NodeKind::Section, o, c);
    }
    // The explicit LayoutOptions argument wins over ControlStyle::layout.
    Builder& Section(std::string id, LayoutOptions o, ControlStyle style, const Children& c) {
        style.layout = std::move(o);
        return Container(std::move(id), NodeKind::Section, std::move(style), c);
    }
    Builder& Row(std::string id, LayoutOptions o, const Children& c) {
        return Container(std::move(id), NodeKind::Row, o, c);
    }
    // The explicit LayoutOptions argument wins over ControlStyle::layout.
    Builder& Row(std::string id, LayoutOptions o, ControlStyle style, const Children& c) {
        style.layout = std::move(o);
        return Container(std::move(id), NodeKind::Row, std::move(style), c);
    }
    Builder& ScrollArea(std::string id, LayoutOptions o, const Children& c) {
        return Container(std::move(id), NodeKind::ScrollArea, o, c);
    }
    // The explicit LayoutOptions argument wins over ControlStyle::layout.
    Builder& ScrollArea(std::string id, LayoutOptions o, ControlStyle style, const Children& c) {
        style.layout = std::move(o);
        return Container(std::move(id), NodeKind::ScrollArea, std::move(style), c);
    }

    // Grafts a subtree. A Root node in the subtree is discarded and its
    // children attach to the currently open scope, so exactly one Root
    // survives. A ROOTLESS subtree attaches its FOREST ROOTS — the nodes not
    // named in any sibling's `children` — to the open scope; that is the shape
    // Tasks 12 and 13 produce. Grafting without attaching leaves the nodes
    // parentless, and PortableJuceBackend.hpp:664-676 throws when more than one
    // node has no parent.
    Builder& Splice(Subtree subtree) {
        assert(!scopeStack_.empty() && "Builder::Root must be called before splicing");
        std::optional<NodeId> spliceRoot;
        for (const Node& n : subtree.tree.nodes) {
            if (n.kind == NodeKind::Root) {
                assert(!spliceRoot.has_value() && "spliced subtree has more than one Root");
                spliceRoot = n.id;
            }
        }

        if (!spliceRoot.has_value()) {
            std::set<std::string> namedAsChild;
            for (const Node& n : subtree.tree.nodes) {
                for (const NodeId& child : n.children) {
                    namedAsChild.insert(child.value);
                }
            }
            for (const Node& n : subtree.tree.nodes) {
                if (namedAsChild.count(n.id.value) == 0) {
                    tree_.nodes[scopeStack_.back()].children.push_back(n.id);
                }
            }
        }

        for (Node& n : subtree.tree.nodes) {
            if (spliceRoot.has_value() && n.id == *spliceRoot) {
                for (const NodeId& child : n.children) {
                    tree_.nodes[scopeStack_.back()].children.push_back(child);
                }
                continue;
            }
            tree_.nodes.push_back(std::move(n));
        }

        for (auto& entry : subtree.layout) {
            layoutByNodeId_[entry.first] = std::move(entry.second);
        }
        for (auto& entry : subtree.drawFactories) {
            drawFactories_[entry.first] = std::move(entry.second);
        }
        return *this;
    }

    Builder& Splice(NodeTree tree) {
        return Splice(Subtree{std::move(tree), {}, {}});
    }

    Builder& Label(std::string id, std::string text, ControlStyle style) {
        Node node;
        node.id = NodeId(std::move(id));
        node.kind = NodeKind::Label;
        node.text = std::move(text);
        return FinishControl(std::move(node), std::move(style));
    }

    Builder& StatusText(std::string id, std::string text, ControlStyle style) {
        Node node;
        node.id = NodeId(std::move(id));
        node.kind = NodeKind::StatusText;
        node.text = std::move(text);
        return FinishControl(std::move(node), std::move(style));
    }

    Builder& Button(std::string id, std::string label, Action action, ControlStyle style) {
        Node node;
        node.id = NodeId(std::move(id));
        node.kind = NodeKind::Button;
        node.label = std::move(label);
        node.action = std::move(action);
        return FinishControl(std::move(node), std::move(style));
    }

    // The design's extended-parameter-object form, where the style carries the
    // actions. A control whose only gesture is a double click says so here: the
    // positional Action above cannot express the absence of a plain click, and
    // an empty action name is a wire lie, not an absence.
    Builder& Button(std::string id, std::string label, ControlStyle style) {
        Node node;
        node.id = NodeId(std::move(id));
        node.kind = NodeKind::Button;
        node.label = std::move(label);
        return FinishControl(std::move(node), std::move(style));
    }

    Builder& Toggle(std::string id, std::string label, bool checked, Action action, ControlStyle style) {
        Node node;
        node.id = NodeId(std::move(id));
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
                    ControlStyle style) {
        Node node;
        node.id = NodeId(std::move(id));
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
                      ControlStyle style) {
        std::vector<ControlOption> vectorOptions;
        vectorOptions.reserve(options.size());
        for (const auto& option : options) {
            vectorOptions.push_back(ControlOption{option.first, option.second});
        }
        return ComboBox(std::move(id),
                        std::move(label),
                        std::move(vectorOptions),
                        std::move(selectedOption),
                        std::move(action),
                        std::move(style));
    }

    Builder& ComboBox(std::string id,
                      std::string label,
                      std::vector<ControlOption> options,
                      std::string selectedOption,
                      Action action,
                      ControlStyle style) {
        Node node;
        node.id = NodeId(std::move(id));
        node.kind = NodeKind::ComboBox;
        node.label = std::move(label);
        node.options = std::move(options);
        node.selectedOption = std::move(selectedOption);
        node.action = std::move(action);
        return FinishControl(std::move(node), std::move(style));
    }

    Builder& TextField(std::string id, std::string label, std::string text, Action action, ControlStyle style) {
        Node node;
        node.id = NodeId(std::move(id));
        node.kind = NodeKind::TextField;
        node.label = std::move(label);
        node.text = std::move(text);
        node.action = std::move(action);
        return FinishControl(std::move(node), std::move(style));
    }

    Builder& Visualizer(std::string id, synth::ui::Visualizer* visualizer, ControlStyle style) {
        if (visualizer == nullptr || !visualizer->Visible()) {
            return *this;
        }
        return Draw(std::move(id), visualizer->GetBounds(), visualizer->Draw(), std::move(style));
    }

    Builder& Draw(std::string id, Bounds bounds, std::initializer_list<DrawCommand> commands, ControlStyle style) {
        return Draw(std::move(id), bounds, std::vector<DrawCommand>(commands.begin(), commands.end()), std::move(style));
    }

    Builder& Draw(std::string id, Bounds bounds, std::vector<DrawCommand> commands, ControlStyle style) {
        Node node;
        node.id = NodeId(std::move(id));
        node.kind = NodeKind::Draw;
        node.bounds = bounds;
        node.drawCommands = std::move(commands);
        style.layout.explicitBounds = bounds;
        return FinishControl(std::move(node), std::move(style));
    }

    Builder& Draw(std::string id, LayoutOptions opts, DrawFactory factory) {
        ControlStyle style;
        style.layout = std::move(opts);
        return Draw(std::move(id), std::move(factory), std::move(style));
    }

    // The in-flow Draw an app reaches for when the canvas is also interactive:
    // the factory supplies the commands from the resolved extent, the style
    // supplies the layout declaration and the actions.
    Builder& Draw(std::string id, DrawFactory factory, ControlStyle style) {
        Node node;
        node.id = NodeId(std::move(id));
        node.kind = NodeKind::Draw;
        if (style.layout.explicitBounds.has_value()) {
            node.bounds = *style.layout.explicitBounds;
        }
        ApplyStyle(node, style);
        const std::string key = node.id.value;
        layoutByNodeId_[key] = std::move(style.layout);
        drawFactories_[key] = std::move(factory);
        AppendChild(std::move(node));
        return *this;
    }

    Builder& DrawInteractive(std::string id,
                             Bounds bounds,
                             std::vector<DrawCommand> commands,
                             Action pointerDragAction,
                             std::optional<Action> doubleClickAction,
                             ControlStyle style) {
        Node node;
        node.id = NodeId(std::move(id));
        node.kind = NodeKind::Draw;
        node.bounds = bounds;
        node.drawCommands = std::move(commands);
        node.pointerDragAction = std::move(pointerDragAction);
        node.doubleClickAction = std::move(doubleClickAction);
        style.layout.explicitBounds = bounds;
        return FinishControl(std::move(node), std::move(style));
    }

    // The root extent is always an argument. There is no no-argument overload
    // reading it back off the Root node: that was the migration shim, and it
    // let a producer resolve against a surface size it had already baked into
    // its own tree, which is the compiled-in surface size sru-50 forbids.
    NodeTree Build(Bounds rootExtent) {
        assert(!rootlessScopeIndex_.has_value() &&
               "a rootless subtree has no root to resolve against; use BuildSubtree()");
        NodeTree resolved = tree_;
        if (!scopeStack_.empty()) {
            ResolveLayout(resolved, resolved.nodes[scopeStack_.front()].id, rootExtent, layoutByNodeId_, drawFactories_);
        }
        return resolved;
    }

    Subtree BuildSubtree() {
        if (!rootlessScopeIndex_.has_value()) {
            return Subtree{tree_, layoutByNodeId_, drawFactories_};
        }
        // The rootless scope marker is a builder-side handle and never part of
        // the subtree. Dropping that ONE node leaves exactly the nodes it
        // collected, and because nothing else named them as children they are
        // the forest roots Splice attaches.
        Subtree subtree{{}, layoutByNodeId_, drawFactories_};
        subtree.tree.nodes.reserve(tree_.nodes.size() - 1);
        for (std::size_t i = 0; i < tree_.nodes.size(); ++i) {
            if (i != *rootlessScopeIndex_) {
                subtree.tree.nodes.push_back(tree_.nodes[i]);
            }
        }
        return subtree;
    }

private:
    static constexpr const char* kRootlessScopeId = "synth.ui.rootless-scope";

    void ApplyStyle(Node& node, const ControlStyle& s) {
        node.color = s.color;
        node.textStyle = s.textStyle;
        node.borderColor = s.borderColor;
        node.borderWidth = s.borderWidth;
        node.cornerRadius = s.cornerRadius;
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
        ControlStyle style;
        style.layout = std::move(opts);
        return Container(std::move(id), kind, std::move(style), children);
    }

    Builder& Container(std::string id, NodeKind kind, ControlStyle style, const Children& children) {
        Node node;
        node.id = NodeId(std::move(id));
        node.kind = kind;
        if (style.layout.explicitBounds.has_value()) { node.bounds = *style.layout.explicitBounds; }
        ApplyStyle(node, style);
        const std::string key = node.id.value;
        AppendChild(std::move(node));
        layoutByNodeId_[key] = std::move(style.layout);
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
        if (style.caption.empty()) {
            if (style.layout.explicitBounds.has_value()) {
                node.bounds = *style.layout.explicitBounds;
            }
            layoutByNodeId_[node.id.value] = style.layout;
            AppendChild(std::move(node));
            return *this;
        }

        const std::string controlId = node.id.value;
        Node row;
        row.id = NodeId(controlId + ".row");
        row.kind = NodeKind::Row;
        if (style.layout.explicitBounds.has_value()) {
            row.bounds = *style.layout.explicitBounds;
        }
        AppendChild(std::move(row));
        // Author's layout applies to the flow slot occupant — the .row wrapper.
        //
        layoutByNodeId_[controlId + ".row"] = style.layout;
        LayoutOptions controlLayout;
        controlLayout.main = Extent::Weight(1.0f);
        layoutByNodeId_[controlId] = controlLayout;
        scopeStack_.push_back(tree_.nodes.size() - 1);
        ControlStyle captionStyle;
        captionStyle.textStyle = style.textStyle;
        Label(controlId + ".caption", style.caption, std::move(captionStyle));
        AppendChild(std::move(node));
        scopeStack_.pop_back();
        return *this;
    }

    NodeTree tree_;
    std::optional<std::size_t> rootlessScopeIndex_{};
    std::vector<std::size_t> scopeStack_;
    std::map<std::string, LayoutOptions> layoutByNodeId_;
    std::map<std::string, DrawFactory> drawFactories_;
};

}  // namespace synth::ui
