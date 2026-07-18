#pragma once

// JUCE adapter for synth::ui::Surface — semantic controls plus draw-command
// painting. JUCE is confined to projects/synth/juce and explicit runtime hosts.

#include "synth/PortableUI.hpp"

#include <juce_gui_basics/juce_gui_basics.h>

#include <algorithm>
#include <cmath>
#include <functional>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace synth_juce {

inline juce::Colour UiToJuceColour(synth::Color color)
{
    return juce::Colour(color.r, color.g, color.b, color.a);
}

inline juce::Rectangle<int> UiToJuceRect(const synth::ui::Bounds& bounds)
{
    return juce::Rectangle<int>(static_cast<int>(std::lround(bounds.x)),
                                static_cast<int>(std::lround(bounds.y)),
                                static_cast<int>(std::lround(bounds.width)),
                                static_cast<int>(std::lround(bounds.height)));
}

inline juce::Rectangle<float> UiToJuceRectF(const synth::ui::Bounds& bounds)
{
    return juce::Rectangle<float>(bounds.x, bounds.y, bounds.width, bounds.height);
}

inline synth::ui::Bounds JuceToUiBounds(juce::Rectangle<float> bounds)
{
    return {bounds.getX(), bounds.getY(), bounds.getWidth(), bounds.getHeight()};
}

inline juce::Justification ToJuceJustification(synth::ui::TextAlign align)
{
    switch (align)
    {
        case synth::ui::TextAlign::Center:
            return juce::Justification::centred;
        case synth::ui::TextAlign::Right:
            return juce::Justification::centredRight;
        case synth::ui::TextAlign::Left:
        default:
            return juce::Justification::centredLeft;
    }
}

inline bool HasExplicitBounds(const synth::ui::Bounds& bounds)
{
    return bounds.width > 0.0f && bounds.height > 0.0f;
}

inline bool DrawBoundsLookLocal(const synth::ui::Bounds& bounds,
                                juce::Rectangle<float> nodeBounds)
{
    return HasExplicitBounds(bounds) && bounds.x >= 0.0f && bounds.y >= 0.0f
           && bounds.x + bounds.width <= nodeBounds.getWidth()
           && bounds.y + bounds.height <= nodeBounds.getHeight();
}

inline juce::Rectangle<float> ResolveDrawBounds(const synth::ui::Bounds& bounds,
                                                juce::Rectangle<float> nodeBounds,
                                                bool nodeLocal)
{
    juce::Rectangle<float> resolved = UiToJuceRectF(bounds);
    if (nodeLocal)
    {
        resolved.translate(nodeBounds.getX(), nodeBounds.getY());
    }
    return resolved;
}

inline bool DrawPointLooksLocal(const synth::ui::Point& point,
                                juce::Rectangle<float> nodeBounds)
{
    return point.x >= 0.0f && point.y >= 0.0f && point.x <= nodeBounds.getWidth()
           && point.y <= nodeBounds.getHeight();
}

inline bool DrawCommandLooksLocal(const synth::ui::DrawCommand& command,
                                  juce::Rectangle<float> nodeBounds)
{
    switch (command.kind)
    {
        case synth::ui::DrawCommand::Kind::Fill:
            return !HasExplicitBounds(command.bounds) || DrawBoundsLookLocal(command.bounds, nodeBounds);
        case synth::ui::DrawCommand::Kind::StrokeRect:
        case synth::ui::DrawCommand::Kind::Arc:
        case synth::ui::DrawCommand::Kind::Text:
        case synth::ui::DrawCommand::Kind::FillEllipse:
        case synth::ui::DrawCommand::Kind::StrokeEllipse:
        case synth::ui::DrawCommand::Kind::FillRoundedRect:
        case synth::ui::DrawCommand::Kind::StrokeRoundedRect:
            return !HasExplicitBounds(command.bounds)
                   || DrawBoundsLookLocal(command.bounds, nodeBounds);
        case synth::ui::DrawCommand::Kind::Line:
            return DrawPointLooksLocal(command.from, nodeBounds)
                   && DrawPointLooksLocal(command.to, nodeBounds);
        case synth::ui::DrawCommand::Kind::Polyline:
        case synth::ui::DrawCommand::Kind::FillPolygon:
            return std::all_of(command.points.begin(),
                               command.points.end(),
                               [&](const synth::ui::Point& point) {
                                   return DrawPointLooksLocal(point, nodeBounds);
                               });
    }
    return false;
}

inline bool DrawCommandsLookLocal(const std::vector<synth::ui::DrawCommand>& commands,
                                  juce::Rectangle<float> nodeBounds)
{
    return std::all_of(commands.begin(),
                       commands.end(),
                       [&](const synth::ui::DrawCommand& command) {
                           return DrawCommandLooksLocal(command, nodeBounds);
                       });
}

inline juce::Point<float> ResolveDrawPoint(const synth::ui::Point& point,
                                           juce::Rectangle<float> nodeBounds,
                                           bool local)
{
    return {point.x + (local ? nodeBounds.getX() : 0.0f),
            point.y + (local ? nodeBounds.getY() : 0.0f)};
}

inline void PaintDrawCommand(juce::Graphics& graphics,
                             const synth::ui::DrawCommand& command,
                             juce::Rectangle<float> nodeBounds,
                             bool nodeLocal)
{
    switch (command.kind)
    {
        case synth::ui::DrawCommand::Kind::Fill:
        {
            graphics.setColour(UiToJuceColour(command.color));
            const juce::Rectangle<float> fillBounds =
                HasExplicitBounds(command.bounds)
                    ? ResolveDrawBounds(command.bounds, nodeBounds, nodeLocal)
                    : nodeBounds;
            graphics.fillRect(fillBounds);
            break;
        }
        case synth::ui::DrawCommand::Kind::StrokeRect:
        {
            graphics.setColour(UiToJuceColour(command.color));
            const auto rect = ResolveDrawBounds(command.bounds, nodeBounds, nodeLocal);
            graphics.drawRect(rect, command.strokeWidth);
            break;
        }
        case synth::ui::DrawCommand::Kind::Line:
        {
            graphics.setColour(UiToJuceColour(command.color));
            const juce::Point<float> from = ResolveDrawPoint(command.from, nodeBounds, nodeLocal);
            const juce::Point<float> to = ResolveDrawPoint(command.to, nodeBounds, nodeLocal);
            graphics.drawLine(from.x,
                              from.y,
                              to.x,
                              to.y,
                              command.strokeWidth);
            break;
        }
        case synth::ui::DrawCommand::Kind::Arc:
        {
            graphics.setColour(UiToJuceColour(command.color));
            const auto rect = ResolveDrawBounds(command.bounds, nodeBounds, nodeLocal);
            juce::Path path;
            path.addCentredArc(rect.getCentreX(),
                               rect.getCentreY(),
                               rect.getWidth() * 0.5f,
                               rect.getHeight() * 0.5f,
                               0.0f,
                               command.startRadians,
                               command.endRadians,
                               true);
            graphics.strokePath(path,
                                juce::PathStrokeType(command.strokeWidth,
                                                     juce::PathStrokeType::curved,
                                                     juce::PathStrokeType::rounded));
            break;
        }
        case synth::ui::DrawCommand::Kind::Text:
        {
            const auto rect = ResolveDrawBounds(command.bounds, nodeBounds, nodeLocal);
            graphics.setColour(UiToJuceColour(command.textStyle.color));
            graphics.setFont(juce::Font(juce::FontOptions(command.textStyle.size)));
            graphics.drawText(command.text,
                              rect,
                              ToJuceJustification(command.textStyle.align),
                              false);
            break;
        }
        case synth::ui::DrawCommand::Kind::FillEllipse:
        {
            graphics.setColour(UiToJuceColour(command.color));
            const auto rect = HasExplicitBounds(command.bounds)
                                  ? ResolveDrawBounds(command.bounds, nodeBounds, nodeLocal)
                                  : nodeBounds;
            graphics.fillEllipse(rect);
            break;
        }
        case synth::ui::DrawCommand::Kind::StrokeEllipse:
        {
            graphics.setColour(UiToJuceColour(command.color));
            const auto rect = ResolveDrawBounds(command.bounds, nodeBounds, nodeLocal);
            graphics.drawEllipse(rect, command.strokeWidth);
            break;
        }
        case synth::ui::DrawCommand::Kind::FillRoundedRect:
        {
            graphics.setColour(UiToJuceColour(command.color));
            const auto rect = ResolveDrawBounds(command.bounds, nodeBounds, nodeLocal);
            graphics.fillRoundedRectangle(rect, command.cornerRadius);
            break;
        }
        case synth::ui::DrawCommand::Kind::StrokeRoundedRect:
        {
            graphics.setColour(UiToJuceColour(command.color));
            const auto rect = ResolveDrawBounds(command.bounds, nodeBounds, nodeLocal);
            graphics.drawRoundedRectangle(rect, command.cornerRadius, command.strokeWidth);
            break;
        }
        case synth::ui::DrawCommand::Kind::Polyline:
        {
            if (command.points.size() < 2)
            {
                break;
            }
            graphics.setColour(UiToJuceColour(command.color));
            juce::Path path;
            const juce::Point<float> first = ResolveDrawPoint(command.points.front(), nodeBounds, nodeLocal);
            path.startNewSubPath(first.x, first.y);
            for (std::size_t pointIx = 1; pointIx < command.points.size(); ++pointIx)
            {
                const juce::Point<float> point = ResolveDrawPoint(command.points[pointIx], nodeBounds, nodeLocal);
                path.lineTo(point.x, point.y);
            }
            graphics.strokePath(path, juce::PathStrokeType(command.strokeWidth));
            break;
        }
        case synth::ui::DrawCommand::Kind::FillPolygon:
        {
            if (command.points.size() < 3)
            {
                break;
            }
            graphics.setColour(UiToJuceColour(command.color));
            juce::Path path;
            const juce::Point<float> first = ResolveDrawPoint(command.points.front(), nodeBounds, nodeLocal);
            path.startNewSubPath(first.x, first.y);
            for (std::size_t pointIx = 1; pointIx < command.points.size(); ++pointIx)
            {
                const juce::Point<float> point = ResolveDrawPoint(command.points[pointIx], nodeBounds, nodeLocal);
                path.lineTo(point.x, point.y);
            }
            path.closeSubPath();
            graphics.fillPath(path);
            break;
        }
    }
}

struct PortableControlEntry
{
    synth::ui::NodeId id;
    synth::ui::NodeKind kind = synth::ui::NodeKind::Label;
    std::unique_ptr<juce::Component> component;
};

class PortableComponent final : public juce::Component
{
public:
    struct ResolvedNode
    {
        juce::Rectangle<int> surfaceBounds;
        std::optional<synth::ui::NodeId> parentId;
        synth::ui::NodeId nearestRootId;
    };

    explicit PortableComponent(synth::ui::Surface& surface)
        : m_surface(surface)
    {
    }

    void RefreshFromSurface()
    {
        m_tree = m_surface.BuildTree();
        ResolveTree();
        RebuildControls();
        LayoutControls();
        repaint();
    }

    juce::Component* FindByNodeId(const std::string& id)
    {
        if (const synth::ui::Node* root = RootNode(); root != nullptr && root->id.value == id)
        {
            return this;
        }
        const auto it = m_controlIndexById.find(id);
        if (it == m_controlIndexById.end())
        {
            return nullptr;
        }
        return m_controls[it->second].component.get();
    }

    juce::Rectangle<int> SurfaceBoundsForNode(const std::string& id) const
    {
        const auto resolved = m_resolvedByNodeId.find(id);
        return resolved != m_resolvedByNodeId.end() ? resolved->second.surfaceBounds
                                                    : juce::Rectangle<int>();
    }

    void resized() override
    {
        LayoutControls();
    }

    void paint(juce::Graphics& graphics) override
    {
        graphics.fillAll(juce::Colour(18, 20, 22));
    }

private:
    static constexpr int kDefaultButtonWidth = 72;
    static constexpr int kDefaultButtonHeight = 28;
    static constexpr int kDefaultSliderWidth = 140;
    static constexpr int kDefaultSliderHeight = 28;
    static constexpr int kDefaultLabelHeight = 22;
    static constexpr int kDefaultComboWidth = 160;
    static constexpr int kDefaultTextFieldWidth = 120;
    static constexpr int kControlGap = 8;
    static constexpr int kControlMargin = 12;
    static constexpr float kPointerDragSensitivity = 0.0025f;
    static constexpr float kPointerDragThreshold = 0.001f;

    class ScopedDispatchSuppression
    {
    public:
        explicit ScopedDispatchSuppression(bool& suppressed)
            : suppressed_(suppressed)
            , previous_(suppressed)
        {
            suppressed_ = true;
        }

        ~ScopedDispatchSuppression()
        {
            suppressed_ = previous_;
        }

        ScopedDispatchSuppression(const ScopedDispatchSuppression&) = delete;
        ScopedDispatchSuppression& operator=(const ScopedDispatchSuppression&) = delete;

    private:
        bool& suppressed_;
        bool previous_ = false;
    };

    class SemanticPanelComponent final : public juce::Component
    {
    public:
        void SetSemantics(std::string variant, bool selected)
        {
            variant_ = std::move(variant);
            selected_ = selected;
            repaint();
        }

        void paint(juce::Graphics& graphics) override
        {
            if (variant_.empty() || variant_ == "quiet" || variant_ == "panel")
            {
                return;
            }

            if (selected_)
            {
                graphics.setColour(juce::Colour(53, 80, 96));
            }
            else if (variant_ == "list-row")
            {
                graphics.setColour(juce::Colour(34, 39, 44));
            }
            else
            {
                graphics.setColour(juce::Colour(30, 34, 38));
            }
            graphics.fillRoundedRectangle(getLocalBounds().toFloat(), 5.0f);
        }

    private:
        std::string variant_;
        bool selected_ = false;
    };

    class PortableScrollAreaComponent final : public juce::Component
    {
    public:
        PortableScrollAreaComponent()
        {
            viewport_.setViewedComponent(&content_, false);
            viewport_.setScrollBarsShown(true, true);
            addAndMakeVisible(viewport_);
        }

        juce::Component& ContentComponent() noexcept
        {
            return content_;
        }

        juce::Viewport& Viewport() noexcept
        {
            return viewport_;
        }

        void SetSemantics(std::string variant, bool selected)
        {
            content_.SetSemantics(std::move(variant), selected);
        }

        void SetContentExtent(int width, int height)
        {
            declaredContentWidth_ = width;
            declaredContentHeight_ = height;
            UpdateContentSize();
        }

        void resized() override
        {
            viewport_.setBounds(getLocalBounds());
            UpdateContentSize();
        }

    private:
        void UpdateContentSize()
        {
            const juce::Point<int> viewPosition = viewport_.getViewPosition();
            viewport_.setViewPosition(0, 0);
            content_.setSize(std::max(getWidth(), declaredContentWidth_),
                             std::max(getHeight(), declaredContentHeight_));
            viewport_.setViewPosition(viewPosition);
        }

        SemanticPanelComponent content_;
        juce::Viewport viewport_;
        int declaredContentWidth_ = 0;
        int declaredContentHeight_ = 0;
    };

    class SemanticTextButton final : public juce::TextButton
    {
    public:
        using juce::TextButton::TextButton;

        std::function<void()> onDoubleClick;

        void mouseDoubleClick(const juce::MouseEvent& event) override
        {
            if (onDoubleClick)
            {
                onDoubleClick();
                return;
            }
            juce::TextButton::mouseDoubleClick(event);
        }
    };

    class RetainedDrawComponent final : public juce::Component
    {
    public:
        explicit RetainedDrawComponent(std::function<void(const synth::ui::NodeId&, float)> dragDispatch,
                                       std::function<void(const synth::ui::NodeId&)> doubleClickDispatch)
            : dragDispatch_(std::move(dragDispatch))
            , doubleClickDispatch_(std::move(doubleClickDispatch))
        {
            setPaintingIsUnclipped(true);
        }

        void SetNode(synth::ui::NodeId id,
                     std::vector<synth::ui::DrawCommand> commands,
                     juce::Rectangle<float> surfaceBounds,
                     bool acceptsDrag,
                     bool acceptsDoubleClick)
        {
            id_ = std::move(id);
            commands_ = std::move(commands);
            surfaceBounds_ = surfaceBounds;
            commandsAreNodeLocal_ = DrawCommandsLookLocal(commands_, surfaceBounds_);
            acceptsDrag_ = acceptsDrag;
            acceptsDoubleClick_ = acceptsDoubleClick;
            setInterceptsMouseClicks(acceptsDrag_ || acceptsDoubleClick_, false);
            repaint();
        }

        void paint(juce::Graphics& graphics) override
        {
            graphics.saveState();
            graphics.addTransform(juce::AffineTransform::translation(
                -surfaceBounds_.getX(), -surfaceBounds_.getY()));
            for (const synth::ui::DrawCommand& command : commands_)
            {
                PaintDrawCommand(graphics, command, surfaceBounds_, commandsAreNodeLocal_);
            }
            graphics.restoreState();
        }

        void mouseDown(const juce::MouseEvent& event) override
        {
            if (acceptsDrag_)
            {
                lastMousePosition_ = event.position;
            }
        }

        void mouseDrag(const juce::MouseEvent& event) override
        {
            if (!acceptsDrag_)
            {
                return;
            }
            const auto deltaPoint = event.position - lastMousePosition_;
            const float delta = (deltaPoint.x - deltaPoint.y) * kPointerDragSensitivity;
            if (std::abs(delta) < kPointerDragThreshold)
            {
                return;
            }
            if (dragDispatch_)
            {
                dragDispatch_(id_, delta);
            }
            lastMousePosition_ = event.position;
        }

        void mouseDoubleClick(const juce::MouseEvent&) override
        {
            if (acceptsDoubleClick_ && doubleClickDispatch_)
            {
                doubleClickDispatch_(id_);
            }
        }

    private:
        synth::ui::NodeId id_;
        std::vector<synth::ui::DrawCommand> commands_;
        juce::Rectangle<float> surfaceBounds_;
        bool commandsAreNodeLocal_ = true;
        juce::Point<float> lastMousePosition_;
        std::function<void(const synth::ui::NodeId&, float)> dragDispatch_;
        std::function<void(const synth::ui::NodeId&)> doubleClickDispatch_;
        bool acceptsDrag_ = false;
        bool acceptsDoubleClick_ = false;
    };

    const synth::ui::Node* RootNode() const
    {
        if (!m_rootNodeId.has_value())
        {
            return nullptr;
        }
        return FindNode(*m_rootNodeId);
    }

    const synth::ui::Node* FindNode(const synth::ui::NodeId& id) const
    {
        for (const synth::ui::Node& node : m_tree.nodes)
        {
            if (node.id == id)
            {
                return &node;
            }
        }
        return nullptr;
    }

    juce::Rectangle<int> DefaultSizeForNode(const synth::ui::Node& node,
                                            int availableWidth) const
    {
        switch (node.kind)
        {
            case synth::ui::NodeKind::Slider:
                return {0, 0, kDefaultSliderWidth, kDefaultSliderHeight};
            case synth::ui::NodeKind::ComboBox:
                return {0, 0, kDefaultComboWidth, kDefaultButtonHeight};
            case synth::ui::NodeKind::TextField:
                return {0, 0, kDefaultTextFieldWidth, kDefaultButtonHeight};
            case synth::ui::NodeKind::Label:
            case synth::ui::NodeKind::StatusText:
            {
                const std::string& text = node.text.empty() ? node.label : node.text;
                const int width = static_cast<int>(std::lround(text.size() * 6.5 + 12.0));
                return {0, 0, std::min(availableWidth, std::max(120, width)), kDefaultLabelHeight};
            }
            case synth::ui::NodeKind::Button:
            {
                const int width = static_cast<int>(std::lround(node.label.size() * 6.5 + 24.0));
                return {0, 0, std::max(kDefaultButtonWidth, width), kDefaultButtonHeight};
            }
            case synth::ui::NodeKind::Toggle:
            {
                const int width = static_cast<int>(std::lround(node.label.size() * 6.5 + 25.0));
                return {0, 0, std::max(kDefaultButtonWidth, width), kDefaultButtonHeight};
            }
            default:
                return {0, 0, kDefaultButtonWidth, kDefaultButtonHeight};
        }
    }

    void ResolveTree()
    {
        m_parentByNodeId.clear();
        m_nearestRootByNodeId.clear();
        m_resolvedByNodeId.clear();
        m_rootNodeId.reset();

        std::unordered_map<std::string, const synth::ui::Node*> nodesById;
        nodesById.reserve(m_tree.nodes.size());
        for (const synth::ui::Node& node : m_tree.nodes)
        {
            if (!nodesById.emplace(node.id.value, &node).second)
            {
                throw std::runtime_error("duplicate node id in portable JUCE frame: " + node.id.value);
            }
        }

        std::optional<std::string> multipleParentError;
        for (const synth::ui::Node& node : m_tree.nodes)
        {
            for (const synth::ui::NodeId& childId : node.children)
            {
                if (nodesById.find(childId.value) == nodesById.end())
                {
                    throw std::runtime_error("unknown child node in portable JUCE frame: " + childId.value);
                }
                const auto existing = m_parentByNodeId.find(childId.value);
                if (existing != m_parentByNodeId.end() && existing->second != node.id)
                {
                    if (!multipleParentError.has_value())
                    {
                        multipleParentError = "node " + childId.value + " has multiple parents";
                    }
                }
                else
                {
                    m_parentByNodeId[childId.value] = node.id;
                }
            }
        }

        std::vector<const synth::ui::Node*> roots;
        for (const synth::ui::Node& node : m_tree.nodes)
        {
            if (m_parentByNodeId.find(node.id.value) == m_parentByNodeId.end())
            {
                roots.push_back(&node);
            }
        }
        if (!m_tree.nodes.empty() && roots.size() != 1)
        {
            throw std::runtime_error("portable JUCE frame requires one parentless root, found "
                                     + std::to_string(roots.size()));
        }
        if (!roots.empty() && roots.front()->kind != synth::ui::NodeKind::Root)
        {
            throw std::runtime_error("parentless portable JUCE node must be a root");
        }

        std::unordered_map<std::string, int> validationState;
        std::function<void(const synth::ui::Node&)> validate = [&](const synth::ui::Node& node) {
            const int state = validationState[node.id.value];
            if (state == 1)
            {
                throw std::runtime_error("cycle in portable JUCE frame at " + node.id.value);
            }
            if (state == 2)
            {
                return;
            }
            validationState[node.id.value] = 1;
            for (const synth::ui::NodeId& childId : node.children)
            {
                validate(*nodesById.at(childId.value));
            }
            validationState[node.id.value] = 2;
        };
        for (const synth::ui::Node& node : m_tree.nodes)
        {
            validate(node);
        }
        if (multipleParentError.has_value())
        {
            throw std::runtime_error(*multipleParentError);
        }
        if (roots.empty())
        {
            return;
        }

        m_rootNodeId = roots.front()->id;
        std::function<void(const synth::ui::Node&, const synth::ui::NodeId&)> assignNearestRoot =
            [&](const synth::ui::Node& node, const synth::ui::NodeId& nearestRootId) {
                const synth::ui::NodeId nextRootId =
                    node.kind == synth::ui::NodeKind::Root ? node.id : nearestRootId;
                m_nearestRootByNodeId[node.id.value] = nextRootId;
                for (const synth::ui::NodeId& childId : node.children)
                {
                    assignNearestRoot(*nodesById.at(childId.value), nextRootId);
                }
            };
        assignNearestRoot(*roots.front(), roots.front()->id);

        for (const synth::ui::Node& node : m_tree.nodes)
        {
            const auto parent = m_parentByNodeId.find(node.id.value);
            m_resolvedByNodeId[node.id.value] = {
                UiToJuceRect(node.bounds),
                parent == m_parentByNodeId.end() ? std::optional<synth::ui::NodeId>()
                                                 : std::optional<synth::ui::NodeId>(parent->second),
                m_nearestRootByNodeId.at(node.id.value)};
        }

        std::unordered_map<std::string, int> explicitVisitState;
        for (const synth::ui::Node& node : m_tree.nodes)
        {
            if (HasExplicitBounds(node.bounds) || node.kind == synth::ui::NodeKind::Root)
            {
                ResolveExplicitNode(node, explicitVisitState);
            }
        }

        struct FlowCursor
        {
            int x = 0;
            int y = 0;
            int rowHeight = 0;
            int right = 0;
            int availableWidth = 0;
        };
        std::unordered_map<std::string, FlowCursor> cursors;
        for (const synth::ui::Node& node : m_tree.nodes)
        {
            if (HasExplicitBounds(node.bounds) || node.kind == synth::ui::NodeKind::Root)
            {
                continue;
            }

            const synth::ui::NodeId& nearestRootId = m_nearestRootByNodeId.at(node.id.value);
            const synth::ui::Node* nearestRoot = nodesById.at(nearestRootId.value);
            auto [cursorIt, inserted] = cursors.try_emplace(nearestRootId.value);
            FlowCursor& cursor = cursorIt->second;
            if (inserted)
            {
                const juce::Rectangle<int> rootBounds = m_resolvedByNodeId.at(nearestRootId.value).surfaceBounds;
                int maxDrawBottom = rootBounds.getY() + kControlMargin;
                for (const synth::ui::Node& candidate : m_tree.nodes)
                {
                    if (candidate.kind == synth::ui::NodeKind::Draw
                        && m_nearestRootByNodeId.at(candidate.id.value) == nearestRootId
                        && HasExplicitBounds(candidate.bounds))
                    {
                        maxDrawBottom = std::max(
                            maxDrawBottom,
                            static_cast<int>(std::lround(candidate.bounds.y + candidate.bounds.height)));
                    }
                }
                cursor.x = rootBounds.getX() + kControlMargin;
                cursor.y = maxDrawBottom + kControlGap;
                cursor.right = rootBounds.getRight() - kControlMargin;
                cursor.availableWidth = std::max(0, rootBounds.getWidth() - kControlMargin * 2);
            }

            juce::Rectangle<int> bounds = DefaultSizeForNode(node, cursor.availableWidth);
            if (cursor.x + bounds.getWidth() > cursor.right && cursor.rowHeight > 0)
            {
                const juce::Rectangle<int> rootBounds = m_resolvedByNodeId.at(nearestRoot->id.value).surfaceBounds;
                cursor.x = rootBounds.getX() + kControlMargin;
                cursor.y += cursor.rowHeight + kControlGap;
                cursor.rowHeight = 0;
            }
            bounds.setPosition(cursor.x, cursor.y);
            m_resolvedByNodeId.at(node.id.value).surfaceBounds = bounds;
            cursor.x += bounds.getWidth() + kControlGap;
            cursor.rowHeight = std::max(cursor.rowHeight, bounds.getHeight());
        }
    }

    juce::Rectangle<int> ResolveExplicitNode(const synth::ui::Node& node,
                                             std::unordered_map<std::string, int>& visitState)
    {
        const int state = visitState[node.id.value];
        if (state == 1)
        {
            throw std::runtime_error("cycle resolving portable JUCE bounds at " + node.id.value);
        }
        if (state == 2)
        {
            return m_resolvedByNodeId.at(node.id.value).surfaceBounds;
        }
        visitState[node.id.value] = 1;

        juce::Rectangle<int> bounds = UiToJuceRect(node.bounds);
        const auto parent = m_parentByNodeId.find(node.id.value);
        if (parent != m_parentByNodeId.end() && node.kind != synth::ui::NodeKind::Root)
        {
            const synth::ui::Node* parentNode = FindNode(parent->second);
            if (parentNode == nullptr)
            {
                throw std::runtime_error("missing parent while resolving portable JUCE bounds");
            }
            const juce::Rectangle<int> parentBounds = ResolveExplicitNode(*parentNode, visitState);
            if (ExplicitBoundsAreParentLocal(node, *parentNode))
            {
                bounds.translate(parentBounds.getX(), parentBounds.getY());
            }
        }

        m_resolvedByNodeId.at(node.id.value).surfaceBounds = bounds;
        visitState[node.id.value] = 2;
        return bounds;
    }

    bool ExplicitBoundsAreParentLocal(const synth::ui::Node& node,
                                      const synth::ui::Node& parent) const
    {
        const float parentWidth = parent.kind == synth::ui::NodeKind::ScrollArea
                                      ? std::max(parent.bounds.width, parent.scrollContentWidth)
                                      : parent.bounds.width;
        const float parentHeight = parent.kind == synth::ui::NodeKind::ScrollArea
                                       ? std::max(parent.bounds.height, parent.scrollContentHeight)
                                       : parent.bounds.height;
        return node.bounds.x >= 0.0f && node.bounds.y >= 0.0f
               && node.bounds.x + node.bounds.width <= parentWidth
               && node.bounds.y + node.bounds.height <= parentHeight;
    }

    juce::Component* SemanticHostFor(const ResolvedNode& resolved)
    {
        std::optional<synth::ui::NodeId> parentId = resolved.parentId;
        while (parentId.has_value())
        {
            const auto control = m_controlIndexById.find(parentId->value);
            if (control != m_controlIndexById.end()
                && IsSemanticHostKind(m_controls[control->second].kind))
            {
                juce::Component* host = m_controls[control->second].component.get();
                if (m_controls[control->second].kind == synth::ui::NodeKind::ScrollArea)
                {
                    auto& scroll = static_cast<PortableScrollAreaComponent&>(*host);
                    return &scroll.ContentComponent();
                }
                return host;
            }
            const auto parentResolved = m_resolvedByNodeId.find(parentId->value);
            parentId = parentResolved != m_resolvedByNodeId.end()
                           ? parentResolved->second.parentId
                           : std::optional<synth::ui::NodeId>();
        }
        return this;
    }

    static bool IsSemanticHostKind(synth::ui::NodeKind kind)
    {
        return kind == synth::ui::NodeKind::Row || kind == synth::ui::NodeKind::Section
               || kind == synth::ui::NodeKind::ScrollArea;
    }

    juce::Rectangle<int> HostLocalBounds(const ResolvedNode& resolved,
                                         const juce::Component& host) const
    {
        juce::Rectangle<int> bounds = host.getLocalArea(this, resolved.surfaceBounds);
        for (const juce::Component* ancestor = &host; ancestor != nullptr;
             ancestor = ancestor->getParentComponent())
        {
            if (const auto* viewport = dynamic_cast<const juce::Viewport*>(ancestor))
            {
                bounds.translate(-viewport->getViewPositionX(), -viewport->getViewPositionY());
            }
        }
        return bounds;
    }

    void DispatchBackendAction(const synth::ui::Action& action)
    {
        if (m_suppressActionDispatch)
        {
            return;
        }
        m_surface.DispatchAction(action);
    }

    void DispatchCurrentNodeAction(const synth::ui::NodeId& id)
    {
        if (const synth::ui::Node* node = FindNode(id); node != nullptr && node->action.has_value())
        {
            DispatchBackendAction(*node->action);
        }
    }

    void DispatchCurrentNodeActionWithAppendedValue(const synth::ui::NodeId& id,
                                                    std::string value)
    {
        if (const synth::ui::Node* node = FindNode(id); node != nullptr && node->action.has_value())
        {
            synth::ui::Action dispatched = *node->action;
            if (!dispatched.value.empty())
            {
                dispatched.value += ':';
            }
            dispatched.value += value;
            DispatchBackendAction(dispatched);
        }
    }

    void DispatchCurrentNodePointerDragAction(const synth::ui::NodeId& id, float delta)
    {
        const synth::ui::Node* node = FindNode(id);
        if (node == nullptr || !node->pointerDragAction.has_value())
        {
            return;
        }
        synth::ui::Action dispatched = *node->pointerDragAction;
        const std::string deltaValue = std::to_string(delta);
        if (dispatched.value.empty())
        {
            dispatched.value = deltaValue;
        }
        else
        {
            const std::size_t lastColon = dispatched.value.rfind(':');
            if (lastColon != std::string::npos)
            {
                dispatched.value = dispatched.value.substr(0, lastColon + 1) + deltaValue;
            }
            else
            {
                dispatched.value = deltaValue;
            }
        }
        DispatchBackendAction(dispatched);
    }

    void DispatchCurrentNodeDoubleClickAction(const synth::ui::NodeId& id)
    {
        if (const synth::ui::Node* node = FindNode(id); node != nullptr && node->doubleClickAction.has_value())
        {
            DispatchBackendAction(*node->doubleClickAction);
        }
    }

    void RebuildControls()
    {
        const synth::ui::Node* root = RootNode();
        if (root == nullptr)
        {
            m_controls.clear();
            m_controlIndexById.clear();
            return;
        }

        std::unordered_map<std::string, std::size_t> oldIndexById = m_controlIndexById;
        std::unordered_map<std::string, std::size_t> newIndexById;
        std::vector<PortableControlEntry> nextControls;
        nextControls.reserve(m_controls.size());

        m_renderedNodeIds.clear();
        CollectRenderableDescendants(*root, root->id);

        for (const synth::ui::NodeId& nodeId : m_renderedNodeIds)
        {
            const synth::ui::Node* node = FindNode(nodeId);
            if (node == nullptr || !IsRenderableKind(node->kind))
            {
                continue;
            }

            const auto existing = oldIndexById.find(node->id.value);
            if (existing != oldIndexById.end() && existing->second < m_controls.size()
                && m_controls[existing->second].kind == node->kind)
            {
                PortableControlEntry entry = std::move(m_controls[existing->second]);
                UpdateControlFromNode(*entry.component, *node);
                nextControls.push_back(std::move(entry));
                newIndexById[node->id.value] = nextControls.size() - 1;
                oldIndexById.erase(existing);
                continue;
            }

            PortableControlEntry entry;
            entry.id = node->id;
            entry.kind = node->kind;
            entry.component = CreateControlForNode(*node);
            UpdateControlFromNode(*entry.component, *node);
            nextControls.push_back(std::move(entry));
            newIndexById[node->id.value] = nextControls.size() - 1;
        }

        m_controls = std::move(nextControls);
        m_controlIndexById = std::move(newIndexById);

        for (const synth::ui::NodeId& nodeId : m_renderedNodeIds)
        {
            const auto controlIt = m_controlIndexById.find(nodeId.value);
            const auto resolvedIt = m_resolvedByNodeId.find(nodeId.value);
            if (controlIt == m_controlIndexById.end() || resolvedIt == m_resolvedByNodeId.end())
            {
                continue;
            }

            juce::Component& component = *m_controls[controlIt->second].component;
            juce::Component* host = SemanticHostFor(resolvedIt->second);
            if (host == nullptr)
            {
                host = this;
            }
            const bool hadKeyboardFocus = component.hasKeyboardFocus(true);
            juce::Component::SafePointer<juce::Component> safeComponent(&component);
            if (component.getParentComponent() != host)
            {
                host->addAndMakeVisible(component);
            }
            component.setBounds(HostLocalBounds(resolvedIt->second, *host));
            component.toFront(false);
            if (hadKeyboardFocus && safeComponent != nullptr
                && !safeComponent->hasKeyboardFocus(true))
            {
                safeComponent->grabKeyboardFocus();
            }
        }
    }

    void LayoutControls()
    {
        for (const synth::ui::NodeId& nodeId : m_renderedNodeIds)
        {
            const auto controlIt = m_controlIndexById.find(nodeId.value);
            const auto resolvedIt = m_resolvedByNodeId.find(nodeId.value);
            if (controlIt == m_controlIndexById.end() || resolvedIt == m_resolvedByNodeId.end())
            {
                continue;
            }

            juce::Component& control = *m_controls[controlIt->second].component;
            juce::Component* host = control.getParentComponent();
            if (host != nullptr)
            {
                control.setBounds(HostLocalBounds(resolvedIt->second, *host));
            }
        }
    }

    void CollectRenderableDescendants(const synth::ui::Node& parent,
                                      const synth::ui::NodeId& nearestRootId)
    {
        for (const synth::ui::NodeId& childId : parent.children)
        {
            const synth::ui::Node* node = FindNode(childId);
            if (node == nullptr)
            {
                continue;
            }

            const synth::ui::NodeId& childRootId =
                node->kind == synth::ui::NodeKind::Root ? node->id : nearestRootId;

            if (IsRenderableKind(node->kind))
            {
                m_renderedNodeIds.push_back(node->id);
            }

            CollectRenderableDescendants(*node, childRootId);
        }
    }

    static bool IsRenderableKind(synth::ui::NodeKind kind)
    {
        switch (kind)
        {
            case synth::ui::NodeKind::Row:
            case synth::ui::NodeKind::Section:
            case synth::ui::NodeKind::ScrollArea:
            case synth::ui::NodeKind::Label:
            case synth::ui::NodeKind::StatusText:
            case synth::ui::NodeKind::Button:
            case synth::ui::NodeKind::Toggle:
            case synth::ui::NodeKind::Slider:
            case synth::ui::NodeKind::ComboBox:
            case synth::ui::NodeKind::TextField:
            case synth::ui::NodeKind::Draw:
                return true;
            default:
                return false;
        }
    }

    static juce::Colour TextColourForNode(const synth::ui::Node& node)
    {
        if (!node.enabled)
        {
            return juce::Colour(125, 132, 138);
        }
        if (node.variant == "danger")
        {
            return juce::Colour(255, 160, 148);
        }
        if (node.variant == "quiet" || node.variant == "muted")
        {
            return juce::Colour(178, 188, 196);
        }
        if (node.variant == "muted-title")
        {
            return juce::Colour(194, 202, 208);
        }
        return juce::Colours::white;
    }

    static juce::Colour ButtonColourForNode(const synth::ui::Node& node)
    {
        if (!node.enabled)
        {
            return juce::Colour(45, 49, 53);
        }
        if (node.selected)
        {
            return juce::Colour(54, 91, 110);
        }
        if (node.variant == "primary")
        {
            return juce::Colour(57, 106, 127);
        }
        if (node.variant == "list-row")
        {
            return juce::Colour(34, 39, 44);
        }
        return juce::Colour(42, 47, 52);
    }

    static bool ComboOptionsMatch(const juce::ComboBox& combo, const std::vector<synth::ui::ControlOption>& options)
    {
        if (combo.getNumItems() != static_cast<int>(options.size()))
        {
            return false;
        }

        for (int ix = 0; ix < static_cast<int>(options.size()); ++ix)
        {
            const synth::ui::ControlOption& option = options[static_cast<std::size_t>(ix)];
            if (combo.getItemId(ix) != ix + 1 || combo.getItemText(ix) != juce::String(option.label))
            {
                return false;
            }
        }

        return true;
    }

    static void RebuildComboOptions(juce::ComboBox& combo, const std::vector<synth::ui::ControlOption>& options)
    {
        combo.clear(juce::dontSendNotification);
        for (int ix = 0; ix < static_cast<int>(options.size()); ++ix)
        {
            combo.addItem(options[static_cast<std::size_t>(ix)].label, ix + 1);
        }
    }

    std::unique_ptr<juce::Component> CreateControlForNode(const synth::ui::Node& node)
    {
        switch (node.kind)
        {
            case synth::ui::NodeKind::Label:
            case synth::ui::NodeKind::StatusText:
            {
                auto label = std::make_unique<juce::Label>();
                label->setJustificationType(juce::Justification::centredLeft);
                return label;
            }
            case synth::ui::NodeKind::Row:
            case synth::ui::NodeKind::Section:
            {
                return std::make_unique<SemanticPanelComponent>();
            }
            case synth::ui::NodeKind::ScrollArea:
            {
                return std::make_unique<PortableScrollAreaComponent>();
            }
            case synth::ui::NodeKind::Button:
            {
                auto button = std::make_unique<SemanticTextButton>();
                button->setButtonText(node.label);
                const synth::ui::NodeId id = node.id;
                button->onClick = [this, id] {
                    DispatchCurrentNodeAction(id);
                };
                button->onDoubleClick = [this, id] {
                    DispatchCurrentNodeDoubleClickAction(id);
                };
                return button;
            }
            case synth::ui::NodeKind::Toggle:
            {
                auto toggle = std::make_unique<juce::ToggleButton>(node.label);
                const synth::ui::NodeId id = node.id;
                toggle->onClick = [this, toggle = toggle.get(), id] {
                    DispatchCurrentNodeActionWithAppendedValue(
                        id, toggle->getToggleState() ? "1" : "0");
                };
                ScopedDispatchSuppression suppress(m_suppressActionDispatch);
                toggle->setToggleState(node.checked, juce::dontSendNotification);
                return toggle;
            }
            case synth::ui::NodeKind::Slider:
            {
                auto slider = std::make_unique<juce::Slider>();
                slider->setRange(node.minValue, node.maxValue, node.step);
                slider->setTextBoxStyle(juce::Slider::TextBoxBelow, false, 56, 18);
                if (!node.label.empty())
                {
                    slider->setName(node.label);
                }
                const synth::ui::NodeId id = node.id;
                slider->onValueChange = [this, slider = slider.get(), id] {
                    if (m_suppressActionDispatch)
                    {
                        return;
                    }
                    DispatchCurrentNodeActionWithAppendedValue(
                        id, juce::String(slider->getValue()).toStdString());
                };
                ScopedDispatchSuppression suppress(m_suppressActionDispatch);
                slider->setValue(node.value, juce::dontSendNotification);
                return slider;
            }
            case synth::ui::NodeKind::ComboBox:
            {
                auto combo = std::make_unique<juce::ComboBox>();
                if (!node.label.empty())
                {
                    combo->setTextWhenNothingSelected(node.label);
                }
                int selectedIndex = -1;
                for (int ix = 0; ix < static_cast<int>(node.options.size()); ++ix)
                {
                    const synth::ui::ControlOption& option = node.options[static_cast<std::size_t>(ix)];
                    combo->addItem(option.label, ix + 1);
                    if (option.id == node.selectedOption)
                    {
                        selectedIndex = ix + 1;
                    }
                }
                const synth::ui::NodeId id = node.id;
                combo->onChange = [this, combo = combo.get(), id] {
                    if (m_suppressActionDispatch)
                    {
                        return;
                    }
                    const synth::ui::Node* current = FindNode(id);
                    if (current == nullptr || !current->action.has_value())
                    {
                        return;
                    }
                    const int selected = combo->getSelectedItemIndex();
                    if (selected < 0 || selected >= static_cast<int>(current->options.size()))
                    {
                        return;
                    }
                    DispatchCurrentNodeActionWithAppendedValue(
                        id, current->options[static_cast<std::size_t>(selected)].id);
                };
                ScopedDispatchSuppression suppress(m_suppressActionDispatch);
                if (selectedIndex > 0)
                {
                    combo->setSelectedId(selectedIndex, juce::dontSendNotification);
                }
                return combo;
            }
            case synth::ui::NodeKind::TextField:
            {
                auto editor = std::make_unique<juce::TextEditor>();
                editor->setText(node.text);
                if (!node.label.empty())
                {
                    editor->setTextToShowWhenEmpty(node.label, juce::Colours::grey);
                }
                const synth::ui::NodeId id = node.id;
                auto textCommitted = std::make_shared<bool>(false);
                const auto commitText = [this, editor = editor.get(), id, textCommitted] {
                    if (*textCommitted)
                    {
                        return;
                    }
                    *textCommitted = true;
                    DispatchCurrentNodeActionWithAppendedValue(id, editor->getText().toStdString());
                };
                editor->onTextChange = [textCommitted] {
                    *textCommitted = false;
                };
                editor->onReturnKey = [editor = editor.get(), commitText] {
                    commitText();
                    editor->giveAwayKeyboardFocus();
                };
                editor->onFocusLost = [commitText] {
                    commitText();
                };
                return editor;
            }
            case synth::ui::NodeKind::Draw:
            {
                auto draw = std::make_unique<RetainedDrawComponent>(
                    [this](const synth::ui::NodeId& id, float delta) {
                        DispatchCurrentNodePointerDragAction(id, delta);
                    },
                    [this](const synth::ui::NodeId& id) {
                        DispatchCurrentNodeDoubleClickAction(id);
                    });
                return draw;
            }
            default:
                return std::make_unique<juce::Component>();
        }
    }

    void UpdateControlFromNode(juce::Component& component, const synth::ui::Node& node)
    {
        ScopedDispatchSuppression suppress(m_suppressActionDispatch);
        component.setEnabled(node.enabled);
        component.setAlpha(node.enabled ? 1.0f : 0.58f);
        switch (node.kind)
        {
            case synth::ui::NodeKind::Row:
            case synth::ui::NodeKind::Section:
            {
                auto& panel = static_cast<SemanticPanelComponent&>(component);
                panel.SetSemantics(node.variant, node.selected);
                break;
            }
            case synth::ui::NodeKind::ScrollArea:
            {
                auto& scroll = static_cast<PortableScrollAreaComponent&>(component);
                scroll.SetSemantics(node.variant, node.selected);
                scroll.SetContentExtent(static_cast<int>(std::lround(node.scrollContentWidth)),
                                        static_cast<int>(std::lround(node.scrollContentHeight)));
                break;
            }
            case synth::ui::NodeKind::Label:
            case synth::ui::NodeKind::StatusText:
            {
                auto& label = static_cast<juce::Label&>(component);
                label.setText(node.text.empty() ? node.label : node.text, juce::dontSendNotification);
                label.setColour(juce::Label::textColourId, TextColourForNode(node));
                if (node.variant == "title" || node.variant == "muted-title")
                {
                    label.setFont(juce::Font(juce::FontOptions(18.0f)));
                }
                else
                {
                    label.setFont(juce::Font(juce::FontOptions(13.0f)));
                }
                break;
            }
            case synth::ui::NodeKind::Button:
            {
                auto& button = static_cast<juce::TextButton&>(component);
                button.setButtonText(node.label);
                button.setColour(juce::TextButton::buttonColourId, ButtonColourForNode(node));
                button.setColour(juce::TextButton::buttonOnColourId, ButtonColourForNode(node).brighter(0.14f));
                button.setColour(juce::TextButton::textColourOffId, TextColourForNode(node));
                button.setColour(juce::TextButton::textColourOnId, juce::Colours::white);
                break;
            }
            case synth::ui::NodeKind::Toggle:
            {
                auto& toggle = static_cast<juce::ToggleButton&>(component);
                toggle.setButtonText(node.label);
                toggle.setToggleState(node.checked, juce::dontSendNotification);
                break;
            }
            case synth::ui::NodeKind::Slider:
            {
                auto& slider = static_cast<juce::Slider&>(component);
                slider.setRange(node.minValue, node.maxValue, node.step);
                if (!slider.isMouseButtonDown(true))
                {
                    slider.setValue(node.value, juce::dontSendNotification);
                }
                break;
            }
            case synth::ui::NodeKind::ComboBox:
            {
                auto& combo = static_cast<juce::ComboBox&>(component);
                if (!ComboOptionsMatch(combo, node.options))
                {
                    RebuildComboOptions(combo, node.options);
                }
                for (int ix = 0; ix < static_cast<int>(node.options.size()); ++ix)
                {
                    if (node.options[static_cast<std::size_t>(ix)].id == node.selectedOption)
                    {
                        combo.setSelectedId(ix + 1, juce::dontSendNotification);
                        break;
                    }
                }
                break;
            }
            case synth::ui::NodeKind::TextField:
            {
                auto& editor = static_cast<juce::TextEditor&>(component);
                editor.setColour(juce::TextEditor::backgroundColourId, juce::Colour(22, 25, 28));
                editor.setColour(juce::TextEditor::textColourId, TextColourForNode(node));
                editor.setColour(juce::TextEditor::outlineColourId, juce::Colour(72, 84, 94));
                if (!editor.hasKeyboardFocus(true) && editor.getText() != juce::String(node.text))
                {
                    editor.setText(node.text, juce::dontSendNotification);
                }
                break;
            }
            case synth::ui::NodeKind::Draw:
            {
                auto& draw = static_cast<RetainedDrawComponent&>(component);
                juce::Rectangle<float> drawSurfaceBounds =
                    m_resolvedByNodeId.at(node.id.value).surfaceBounds.toFloat();
                if (HasExplicitBounds(node.bounds))
                {
                    drawSurfaceBounds.setWidth(node.bounds.width);
                    drawSurfaceBounds.setHeight(node.bounds.height);
                }
                draw.SetNode(node.id,
                             node.drawCommands,
                             drawSurfaceBounds,
                             node.pointerDragAction.has_value(),
                             node.doubleClickAction.has_value());
                break;
            }
            default:
                break;
        }
    }

    synth::ui::Surface& m_surface;
    synth::ui::NodeTree m_tree;
    std::vector<PortableControlEntry> m_controls;
    std::unordered_map<std::string, std::size_t> m_controlIndexById;
    std::unordered_map<std::string, synth::ui::NodeId> m_parentByNodeId;
    std::unordered_map<std::string, synth::ui::NodeId> m_nearestRootByNodeId;
    std::unordered_map<std::string, ResolvedNode> m_resolvedByNodeId;
    std::optional<synth::ui::NodeId> m_rootNodeId;
    std::vector<synth::ui::NodeId> m_renderedNodeIds;
    bool m_suppressActionDispatch = false;
};

}  // namespace synth_juce
