#pragma once

#include "synth/PortableUI.hpp"
#include "synth/PortableUIMetrics.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <functional>
#include <map>
#include <optional>
#include <string>
#include <vector>

namespace synth::ui {

using DrawFactory = std::function<std::vector<DrawCommand>(Bounds nodeExtent)>;

struct SpacingMetrics {
    float padding = 12.0f;
    float gap = 8.0f;
    float rowHeight = 24.0f;
    float labelGap = 8.0f;
};
inline constexpr SpacingMetrics kSpacing{};

struct Extent {
    enum class Mode { Fixed, Intrinsic, Fraction, Weighted };
    Mode mode = Mode::Intrinsic;
    float value = 0.0f;   // px when Fixed; 0..1 when Fraction; weight when Weighted
    float minimum = 0.0f;
    float maximum = 0.0f; // 0 means "no maximum"

    static Extent Px(float pixels);
    static Extent Intrinsic();
    static Extent Fraction(float fractionOfContentExtent);
    static Extent Weight(float weight);
    Extent& Min(float pixels);
    Extent& Max(float pixels);
};

inline Extent Extent::Px(float p)       { return Extent{Mode::Fixed, p, 0.0f, 0.0f}; }
inline Extent Extent::Intrinsic()       { return Extent{Mode::Intrinsic, 0.0f, 0.0f, 0.0f}; }
inline Extent Extent::Fraction(float f) { return Extent{Mode::Fraction, f, 0.0f, 0.0f}; }
inline Extent Extent::Weight(float w)   { return Extent{Mode::Weighted, w, 0.0f, 0.0f}; }
inline Extent& Extent::Min(float p) { minimum = p; return *this; }
inline Extent& Extent::Max(float p) { maximum = p; return *this; }

struct LayoutOptions {
    Extent main = Extent::Intrinsic();
    Extent cross = Extent::Weight(1.0f);
    float padding = kSpacing.padding;
    float gap = kSpacing.gap;
    bool wrap = false;      // Row only
    bool formGrid = false;
    // Set => this node is explicitly positioned and OUT OF FLOW.
    // Out-of-flow is a positioning mode, never a property of a node kind.
    std::optional<Bounds> explicitBounds{};
};

namespace layout_detail {

enum class Axis { Horizontal, Vertical };

inline float AxisExtent(Bounds bounds, Axis axis)
{
    return axis == Axis::Horizontal ? bounds.width : bounds.height;
}

inline float CrossExtent(Bounds bounds, Axis axis)
{
    return axis == Axis::Horizontal ? bounds.height : bounds.width;
}

inline float LeafIntrinsicExtent(const Node& node, Axis axis)
{
    const Bounds intrinsic = metrics::IntrinsicFor(node);
    return AxisExtent(intrinsic, axis);
}

inline const LayoutOptions& LayoutFor(const std::map<std::string, LayoutOptions>& layoutByNodeId,
                                      const NodeId& id,
                                      const LayoutOptions& fallback)
{
    const auto found = layoutByNodeId.find(id.value);
    return found == layoutByNodeId.end() ? fallback : found->second;
}

inline bool IsContainer(NodeKind kind)
{
    return kind == NodeKind::Root ||
           kind == NodeKind::Row ||
           kind == NodeKind::Section ||
           kind == NodeKind::ScrollArea;
}

inline Axis MainAxisFor(const Node& node)
{
    return node.kind == NodeKind::Row ? Axis::Horizontal : Axis::Vertical;
}

inline float ClampExtent(float value, const Extent& extent)
{
    value = std::max(value, extent.minimum);
    if (extent.maximum > 0.0f)
    {
        value = std::min(value, extent.maximum);
    }
    return value;
}

struct ResolvedExtent {
    float value = 0.0f;
    bool weighted = false;
    bool clamped = false;
    float weight = 0.0f;
};

inline float ResolveSimpleExtent(const Node& node,
                                 Axis axis,
                                 const Extent& extent,
                                 float contentExtent,
                                 const std::function<float(const Node&, Axis)>& intrinsicForNode)
{
    switch (extent.mode)
    {
        case Extent::Mode::Fixed:
            return extent.value;
        case Extent::Mode::Fraction:
            return contentExtent * extent.value;
        case Extent::Mode::Weighted:
            return contentExtent * std::max(0.0f, extent.value);
        case Extent::Mode::Intrinsic:
        default:
            return intrinsicForNode(node, axis);
    }
}

inline std::vector<ResolvedExtent> AllocateExtents(const std::vector<const Node*>& nodes,
                                                   const std::vector<LayoutOptions>& layouts,
                                                   Axis axis,
                                                   float containerExtent,
                                                   float padding,
                                                   float gap,
                                                   const std::function<float(const Node&, Axis)>& intrinsicForNode)
{
    std::vector<ResolvedExtent> resolved(nodes.size());
    if (nodes.empty())
    {
        return resolved;
    }

    const float contentExtent = std::max(0.0f, containerExtent - padding * 2.0f);
    const float totalGaps = gap * static_cast<float>(nodes.size() - 1);
    float nonWeighted = 0.0f;
    float totalWeight = 0.0f;

    for (std::size_t i = 0; i < nodes.size(); ++i)
    {
        const Extent& extent = layouts[i].main;
        if (extent.mode == Extent::Mode::Weighted)
        {
            resolved[i].weighted = true;
            resolved[i].weight = std::max(0.0f, extent.value);
            totalWeight += resolved[i].weight;
            continue;
        }

        float value = ResolveSimpleExtent(*nodes[i], axis, extent, contentExtent, intrinsicForNode);
        resolved[i].value = value;
        nonWeighted += value;
    }

    const float remaining = contentExtent - totalGaps - nonWeighted;
    for (std::size_t i = 0; i < nodes.size(); ++i)
    {
        if (!resolved[i].weighted)
        {
            continue;
        }
        resolved[i].value = totalWeight > 0.0f ? remaining * resolved[i].weight / totalWeight : 0.0f;
    }

    float beforeClamp = 0.0f;
    float afterClamp = 0.0f;
    float eligibleWeight = 0.0f;
    for (std::size_t i = 0; i < nodes.size(); ++i)
    {
        beforeClamp += resolved[i].value;
        const float clamped = ClampExtent(resolved[i].value, layouts[i].main);
        resolved[i].clamped = std::abs(clamped - resolved[i].value) > 0.0001f;
        resolved[i].value = clamped;
        afterClamp += clamped;
        if (resolved[i].weighted && !resolved[i].clamped)
        {
            eligibleWeight += resolved[i].weight;
        }
    }

    const float delta = beforeClamp - afterClamp;
    if (std::abs(delta) > 0.0001f && eligibleWeight > 0.0f)
    {
        for (std::size_t i = 0; i < nodes.size(); ++i)
        {
            if (!resolved[i].weighted || resolved[i].clamped)
            {
                continue;
            }
            const float adjusted = resolved[i].value + delta * resolved[i].weight / eligibleWeight;
            resolved[i].value = ClampExtent(adjusted, layouts[i].main);
        }
    }

    return resolved;
}

inline float ResolveCrossExtent(const Node& node,
                                Axis mainAxis,
                                const LayoutOptions& layout,
                                float containerCrossExtent,
                                float padding,
                                const std::function<float(const Node&, Axis)>& intrinsicForNode)
{
    const float contentExtent = std::max(0.0f, containerCrossExtent - padding * 2.0f);
    const Axis crossAxis = mainAxis == Axis::Horizontal ? Axis::Vertical : Axis::Horizontal;
    float value = 0.0f;
    switch (layout.cross.mode)
    {
        case Extent::Mode::Fixed:
            value = layout.cross.value;
            break;
        case Extent::Mode::Fraction:
            value = contentExtent * layout.cross.value;
            break;
        case Extent::Mode::Weighted:
            value = contentExtent * std::max(0.0f, layout.cross.value);
            break;
        case Extent::Mode::Intrinsic:
        default:
            value = intrinsicForNode(node, crossAxis);
            break;
    }
    return ClampExtent(value, layout.cross);
}

inline std::map<std::string, std::size_t> BuildNodeIndex(const NodeTree& tree)
{
    std::map<std::string, std::size_t> byId;
    for (std::size_t i = 0; i < tree.nodes.size(); ++i)
    {
        byId[tree.nodes[i].id.value] = i;
    }
    return byId;
}

struct Resolver {
    NodeTree& tree;
    const std::map<std::string, LayoutOptions>& layoutByNodeId;
    const std::map<std::string, DrawFactory>& drawFactories;
    std::map<std::string, std::size_t> byId;

    Node* Find(const NodeId& id)
    {
        const auto found = byId.find(id.value);
        if (found == byId.end())
        {
            return nullptr;
        }
        return &tree.nodes[found->second];
    }

    const Node* Find(const NodeId& id) const
    {
        const auto found = byId.find(id.value);
        if (found == byId.end())
        {
            return nullptr;
        }
        return &tree.nodes[found->second];
    }

    void InvokeDrawFactory(Node& node)
    {
        const auto found = drawFactories.find(node.id.value);
        if (found == drawFactories.end())
        {
            return;
        }
        node.drawCommands = found->second(Bounds{0.0f, 0.0f, node.bounds.width, node.bounds.height});
    }

    float IntrinsicFromExtent(const Node& node, const Extent& extent, Axis axis)
    {
        switch (extent.mode)
        {
            case Extent::Mode::Fixed:
                return ClampExtent(extent.value, extent);
            case Extent::Mode::Fraction:
            case Extent::Mode::Weighted:
                return ClampExtent(IntrinsicForNode(node, axis), extent);
            case Extent::Mode::Intrinsic:
            default:
                return ClampExtent(IntrinsicForNode(node, axis), extent);
        }
    }

    float IntrinsicForNode(const Node& node, Axis axis)
    {
        if (!IsContainer(node.kind))
        {
            return LeafIntrinsicExtent(node, axis);
        }

        const LayoutOptions fallback;
        const LayoutOptions& opts = LayoutFor(layoutByNodeId, node.id, fallback);
        const Axis mainAxis = MainAxisFor(node);
        float result = 0.0f;
        std::size_t inFlowCount = 0;

        for (const NodeId& childId : node.children)
        {
            const LayoutOptions childLayout = LayoutFor(layoutByNodeId, childId, fallback);
            if (childLayout.explicitBounds.has_value())
            {
                continue;
            }
            const Node* child = Find(childId);
            if (child == nullptr)
            {
                continue;
            }
            if (axis == mainAxis)
            {
                result += IntrinsicFromExtent(*child, childLayout.main, axis);
                ++inFlowCount;
            }
            else
            {
                result = std::max(result, IntrinsicFromExtent(*child, childLayout.cross, axis));
            }
        }

        if (axis == mainAxis && inFlowCount > 1)
        {
            result += opts.gap * static_cast<float>(inFlowCount - 1);
        }
        return result + opts.padding * 2.0f;
    }

    void ResolveNode(Node& node, bool isRoot)
    {
        InvokeDrawFactory(node);
        if (!IsContainer(node.kind))
        {
            return;
        }
        ResolveContainer(node, isRoot);
    }

    void ResolveContainer(Node& container, bool isRoot)
    {
        const LayoutOptions rootLayout{
            .main = Extent::Intrinsic(),
            .cross = Extent::Weight(1.0f),
            .padding = 0.0f,
            .gap = 0.0f,
            .wrap = false,
            .formGrid = false,
            .explicitBounds = std::nullopt,
        };
        const LayoutOptions fallback;
        const LayoutOptions& opts = isRoot ? rootLayout : LayoutFor(layoutByNodeId, container.id, fallback);
        const Axis mainAxis = MainAxisFor(container);

        std::vector<Node*> inFlow;
        std::vector<const Node*> inFlowConst;
        std::vector<LayoutOptions> childLayouts;
        std::vector<Node*> outOfFlow;

        for (const NodeId& childId : container.children)
        {
            Node* child = Find(childId);
            if (child == nullptr)
            {
                continue;
            }
            LayoutOptions childLayout = LayoutFor(layoutByNodeId, childId, fallback);
            if (childLayout.explicitBounds.has_value())
            {
                child->bounds = *childLayout.explicitBounds;
                outOfFlow.push_back(child);
                continue;
            }
            inFlow.push_back(child);
            inFlowConst.push_back(child);
            childLayouts.push_back(childLayout);
        }

        const auto intrinsicForNode = [this](const Node& node, Axis axis) {
            return IntrinsicForNode(node, axis);
        };
        const auto mainExtents = AllocateExtents(inFlowConst,
                                                 childLayouts,
                                                 mainAxis,
                                                 AxisExtent(container.bounds, mainAxis),
                                                 opts.padding,
                                                 opts.gap,
                                                 intrinsicForNode);

        const float containerCross = CrossExtent(container.bounds, mainAxis);
        float mainCursor = opts.padding;
        float crossCursor = opts.padding;
        float lineCrossExtent = 0.0f;
        float maxMain = opts.padding;

        for (std::size_t i = 0; i < inFlow.size(); ++i)
        {
            Node& child = *inFlow[i];
            const float mainExtent = mainExtents[i].value;
            const float crossExtent =
                ResolveCrossExtent(child, mainAxis, childLayouts[i], containerCross, opts.padding, intrinsicForNode);

            if (container.kind == NodeKind::Row && opts.wrap && mainCursor > opts.padding &&
                mainCursor + mainExtent > std::max(opts.padding, AxisExtent(container.bounds, Axis::Horizontal) - opts.padding))
            {
                maxMain = std::max(maxMain, mainCursor - opts.gap);
                mainCursor = opts.padding;
                crossCursor += lineCrossExtent + opts.gap;
                lineCrossExtent = 0.0f;
            }

            if (mainAxis == Axis::Horizontal)
            {
                child.bounds = {mainCursor, crossCursor, mainExtent, crossExtent};
            }
            else
            {
                child.bounds = {crossCursor, mainCursor, crossExtent, mainExtent};
            }
            mainCursor += mainExtent + opts.gap;
            lineCrossExtent = std::max(lineCrossExtent, crossExtent);
            ResolveNode(child, false);
        }

        if (container.kind == NodeKind::Row && opts.wrap)
        {
            maxMain = std::max(maxMain, mainCursor > opts.padding ? mainCursor - opts.gap : opts.padding);
            container.bounds.width = std::max(container.bounds.width, maxMain + opts.padding);
            container.bounds.height = std::max(container.bounds.height, crossCursor + lineCrossExtent + opts.padding);
        }

        for (Node* child : outOfFlow)
        {
            ResolveNode(*child, false);
        }

        if (opts.formGrid)
        {
            ApplyFormGrid(container, opts);
        }
    }

    std::vector<Node*> InFlowChildrenOf(const Node& row)
    {
        const LayoutOptions fallback;
        std::vector<Node*> result;
        for (const NodeId& childId : row.children)
        {
            const LayoutOptions& layout = LayoutFor(layoutByNodeId, childId, fallback);
            if (layout.explicitBounds.has_value())
            {
                continue;
            }
            Node* child = Find(childId);
            if (child != nullptr)
            {
                result.push_back(child);
            }
        }
        return result;
    }

    void ApplyFormGrid(Node& container, const LayoutOptions& opts)
    {
        float labelColumnWidth = 0.0f;
        std::vector<Node*> rows;
        for (const NodeId& childId : container.children)
        {
            Node* row = Find(childId);
            if (row == nullptr || row->kind != NodeKind::Row)
            {
                continue;
            }
            const auto cells = InFlowChildrenOf(*row);
            // Participation is structural: the first two in-flow children of a
            // row are the label/control cells, so producers cannot forget a
            // per-node form-grid marker.
            if (cells.size() < 2)
            {
                continue;
            }
            rows.push_back(row);
            labelColumnWidth = std::max(labelColumnWidth, cells[0]->bounds.width);
        }

        const float controlOffset = opts.padding + labelColumnWidth + kSpacing.labelGap;
        for (Node* row : rows)
        {
            auto cells = InFlowChildrenOf(*row);
            cells[0]->bounds.x = opts.padding;
            cells[0]->bounds.width = labelColumnWidth;
            cells[1]->bounds.x = controlOffset;
            cells[1]->bounds.width = std::max(0.0f, row->bounds.width - controlOffset - opts.padding);
            ResolveNode(*cells[1], false);
        }
    }
};

}  // namespace layout_detail

inline void ResolveLayout(NodeTree& tree,
                          const NodeId& rootId,
                          Bounds rootExtent,
                          const std::map<std::string, LayoutOptions>& layoutByNodeId,
                          const std::map<std::string, DrawFactory>& drawFactories)
{
    layout_detail::Resolver resolver{
        .tree = tree,
        .layoutByNodeId = layoutByNodeId,
        .drawFactories = drawFactories,
        .byId = layout_detail::BuildNodeIndex(tree),
    };
    Node* root = resolver.Find(rootId);
    if (root == nullptr)
    {
        return;
    }
    root->bounds = rootExtent;
    resolver.ResolveNode(*root, true);
}

}  // namespace synth::ui
