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
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace synth_juce {

inline juce::Colour UiToJuceColour(synth::ui::Color color)
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

inline void PaintDrawCommand(juce::Graphics& graphics,
                             const synth::ui::DrawCommand& command,
                             juce::Rectangle<float> nodeBounds)
{
    switch (command.kind)
    {
        case synth::ui::DrawCommand::Kind::Fill:
        {
            graphics.setColour(UiToJuceColour(command.color));
            const juce::Rectangle<float> fillBounds =
                HasExplicitBounds(command.bounds) ? UiToJuceRectF(command.bounds) : nodeBounds;
            graphics.fillRect(fillBounds);
            break;
        }
        case synth::ui::DrawCommand::Kind::StrokeRect:
        {
            graphics.setColour(UiToJuceColour(command.color));
            const auto rect = UiToJuceRectF(command.bounds);
            graphics.drawRect(rect, command.strokeWidth);
            break;
        }
        case synth::ui::DrawCommand::Kind::Line:
        {
            graphics.setColour(UiToJuceColour(command.color));
            graphics.drawLine(command.from.x,
                              command.from.y,
                              command.to.x,
                              command.to.y,
                              command.strokeWidth);
            break;
        }
        case synth::ui::DrawCommand::Kind::Arc:
        {
            graphics.setColour(UiToJuceColour(command.color));
            const auto rect = UiToJuceRectF(command.bounds);
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
            const auto rect = UiToJuceRectF(command.bounds);
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
            const auto rect = HasExplicitBounds(command.bounds) ? UiToJuceRectF(command.bounds) : nodeBounds;
            graphics.fillEllipse(rect);
            break;
        }
        case synth::ui::DrawCommand::Kind::StrokeEllipse:
        {
            graphics.setColour(UiToJuceColour(command.color));
            const auto rect = UiToJuceRectF(command.bounds);
            graphics.drawEllipse(rect, command.strokeWidth);
            break;
        }
        case synth::ui::DrawCommand::Kind::FillRoundedRect:
        {
            graphics.setColour(UiToJuceColour(command.color));
            const auto rect = UiToJuceRectF(command.bounds);
            graphics.fillRoundedRectangle(rect, command.cornerRadius);
            break;
        }
        case synth::ui::DrawCommand::Kind::StrokeRoundedRect:
        {
            graphics.setColour(UiToJuceColour(command.color));
            const auto rect = UiToJuceRectF(command.bounds);
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
            path.startNewSubPath(command.points.front().x, command.points.front().y);
            for (std::size_t pointIx = 1; pointIx < command.points.size(); ++pointIx)
            {
                path.lineTo(command.points[pointIx].x, command.points[pointIx].y);
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
            path.startNewSubPath(command.points.front().x, command.points.front().y);
            for (std::size_t pointIx = 1; pointIx < command.points.size(); ++pointIx)
            {
                path.lineTo(command.points[pointIx].x, command.points[pointIx].y);
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
    explicit PortableComponent(synth::ui::Surface& surface)
        : m_surface(surface)
    {
    }

    void RefreshFromSurface()
    {
        m_tree = m_surface.BuildTree();
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

    void resized() override
    {
        LayoutControls();
    }

    void paint(juce::Graphics& graphics) override
    {
        graphics.fillAll(juce::Colour(18, 20, 22));

        for (const std::size_t nodeIndex : m_drawNodeIndices)
        {
            const synth::ui::Node& node = m_tree.nodes[nodeIndex];
            const juce::Rectangle<float> nodeBounds = ResolveNodeBounds(node).toFloat();
            graphics.saveState();
            graphics.reduceClipRegion(nodeBounds.toNearestInt());
            for (const synth::ui::DrawCommand& command : node.drawCommands)
            {
                PaintDrawCommand(graphics, command, nodeBounds);
            }
            graphics.restoreState();
        }
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

    class InteractiveDrawComponent final : public juce::Component
    {
    public:
        explicit InteractiveDrawComponent(std::function<void(const synth::ui::NodeId&, float)> dragDispatch,
                                          std::function<void(const synth::ui::NodeId&)> doubleClickDispatch)
            : dragDispatch_(std::move(dragDispatch))
            , doubleClickDispatch_(std::move(doubleClickDispatch))
        {
            setInterceptsMouseClicks(true, true);
            setPaintingIsUnclipped(true);
        }

        void SetNodeId(synth::ui::NodeId id)
        {
            id_ = std::move(id);
        }

        void paint(juce::Graphics&) override {}

        void mouseDown(const juce::MouseEvent& event) override
        {
            lastMousePosition_ = event.position;
        }

        void mouseDrag(const juce::MouseEvent& event) override
        {
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
            if (doubleClickDispatch_)
            {
                doubleClickDispatch_(id_);
            }
        }

    private:
        synth::ui::NodeId id_;
        juce::Point<float> lastMousePosition_;
        std::function<void(const synth::ui::NodeId&, float)> dragDispatch_;
        std::function<void(const synth::ui::NodeId&)> doubleClickDispatch_;
    };

    const synth::ui::Node* RootNode() const
    {
        if (m_tree.nodes.empty())
        {
            return nullptr;
        }
        return &m_tree.nodes.front();
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

    juce::Rectangle<int> ContentBounds() const
    {
        const auto local = getLocalBounds();
        if (const synth::ui::Node* root = RootNode(); root != nullptr && HasExplicitBounds(root->bounds))
        {
            return UiToJuceRect(root->bounds).constrainedWithin(local);
        }
        return local;
    }

    juce::Rectangle<int> ResolveNodeBounds(const synth::ui::Node& node) const
    {
        if (HasExplicitBounds(node.bounds))
        {
            return UiToJuceRect(node.bounds);
        }
        return {};
    }

    std::optional<std::size_t> FindNodeIndex(const synth::ui::NodeId& id) const
    {
        for (std::size_t ix = 0; ix < m_tree.nodes.size(); ++ix)
        {
            if (m_tree.nodes[ix].id == id)
            {
                return ix;
            }
        }
        return std::nullopt;
    }

    juce::Rectangle<int> DefaultSizeForKind(synth::ui::NodeKind kind) const
    {
        switch (kind)
        {
            case synth::ui::NodeKind::Slider:
                return {0, 0, kDefaultSliderWidth, kDefaultSliderHeight};
            case synth::ui::NodeKind::ComboBox:
                return {0, 0, kDefaultComboWidth, kDefaultButtonHeight};
            case synth::ui::NodeKind::TextField:
                return {0, 0, kDefaultTextFieldWidth, kDefaultButtonHeight};
            case synth::ui::NodeKind::Label:
            case synth::ui::NodeKind::StatusText:
                return {0, 0, 120, kDefaultLabelHeight};
            case synth::ui::NodeKind::Button:
            case synth::ui::NodeKind::Toggle:
            default:
                return {0, 0, kDefaultButtonWidth, kDefaultButtonHeight};
        }
    }

    int AutoLayoutStartY(const synth::ui::NodeId& rootId,
                         const juce::Rectangle<int>& rootBounds) const
    {
        int maxDrawBottom = rootBounds.getY() + kControlMargin;
        for (const std::size_t nodeIndex : m_drawNodeIndices)
        {
            const synth::ui::Node& node = m_tree.nodes[nodeIndex];
            const auto rootIt = m_nearestRootByNodeId.find(node.id.value);
            if (rootIt == m_nearestRootByNodeId.end() || rootIt->second != rootId)
            {
                continue;
            }
            if (HasExplicitBounds(node.bounds))
            {
                maxDrawBottom = std::max(maxDrawBottom,
                                         static_cast<int>(std::lround(node.bounds.y + node.bounds.height)));
            }
        }
        return maxDrawBottom + kControlGap;
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

    void DispatchCurrentNodeActionWithValue(const synth::ui::NodeId& id, std::string value)
    {
        if (const synth::ui::Node* node = FindNode(id); node != nullptr && node->action.has_value())
        {
            synth::ui::Action dispatched = *node->action;
            dispatched.value = std::move(value);
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
        m_drawNodeIndices.clear();
        m_nearestRootByNodeId.clear();

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

        for (auto& entry : nextControls)
        {
            if (entry.component->getParentComponent() != this)
            {
                addAndMakeVisible(*entry.component);
            }
        }

        for (const PortableControlEntry& entry : m_controls)
        {
            bool stillUsed = false;
            for (const PortableControlEntry& nextEntry : nextControls)
            {
                if (nextEntry.id == entry.id)
                {
                    stillUsed = true;
                    break;
                }
            }
            if (!stillUsed && entry.component != nullptr)
            {
                removeChildComponent(entry.component.get());
            }
        }

        m_controls = std::move(nextControls);
        m_controlIndexById = std::move(newIndexById);
    }

    void LayoutControls()
    {
        const synth::ui::Node* root = RootNode();
        if (root == nullptr)
        {
            return;
        }

        struct FlowCursor
        {
            juce::Rectangle<int> bounds;
            int x = 0;
            int y = 0;
            int rowHeight = 0;
        };
        std::unordered_map<std::string, FlowCursor> cursors;

        for (const synth::ui::NodeId& nodeId : m_renderedNodeIds)
        {
            const synth::ui::Node* node = FindNode(nodeId);
            if (node == nullptr || !IsRenderableKind(node->kind))
            {
                continue;
            }

            const auto controlIt = m_controlIndexById.find(node->id.value);
            if (controlIt == m_controlIndexById.end())
            {
                continue;
            }

            juce::Component& control = *m_controls[controlIt->second].component;
            juce::Rectangle<int> bounds = ResolveNodeBounds(*node);
            if (bounds.isEmpty())
            {
                const auto nearestRootIt = m_nearestRootByNodeId.find(node->id.value);
                const synth::ui::NodeId& nearestRootId =
                    nearestRootIt != m_nearestRootByNodeId.end() ? nearestRootIt->second : root->id;
                auto [cursorIt, inserted] = cursors.try_emplace(nearestRootId.value);
                FlowCursor& cursor = cursorIt->second;
                if (inserted)
                {
                    const synth::ui::Node* nearestRoot = FindNode(nearestRootId);
                    cursor.bounds = nearestRoot != nullptr && HasExplicitBounds(nearestRoot->bounds)
                                        ? UiToJuceRect(nearestRoot->bounds)
                                        : ContentBounds();
                    cursor.x = cursor.bounds.getX() + kControlMargin;
                    cursor.y = AutoLayoutStartY(nearestRootId, cursor.bounds);
                }

                bounds = DefaultSizeForKind(node->kind);
                if (cursor.x + bounds.getWidth() > cursor.bounds.getRight() - kControlMargin)
                {
                    cursor.x = cursor.bounds.getX() + kControlMargin;
                    cursor.y += cursor.rowHeight + kControlGap;
                    cursor.rowHeight = 0;
                }
                bounds.setPosition(cursor.x, cursor.y);
                cursor.x += bounds.getWidth() + kControlGap;
                cursor.rowHeight = std::max(cursor.rowHeight, bounds.getHeight());
            }
            control.setBounds(bounds);
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

            if (node->kind == synth::ui::NodeKind::Draw)
            {
                m_nearestRootByNodeId[node->id.value] = childRootId;
                if (const std::optional<std::size_t> nodeIndex = FindNodeIndex(node->id); nodeIndex.has_value())
                {
                    m_drawNodeIndices.push_back(*nodeIndex);
                }
                if (IsInteractiveDrawNode(*node))
                {
                    m_renderedNodeIds.push_back(node->id);
                }
            }
            else if (IsRenderableKind(node->kind))
            {
                m_nearestRootByNodeId[node->id.value] = childRootId;
                m_renderedNodeIds.push_back(node->id);
            }

            CollectRenderableDescendants(*node, childRootId);
        }
    }

    bool IsInteractiveDrawNode(const synth::ui::Node& node) const
    {
        return node.kind == synth::ui::NodeKind::Draw
               && (node.pointerDragAction.has_value() || node.doubleClickAction.has_value());
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
            case synth::ui::NodeKind::ScrollArea:
            {
                return std::make_unique<SemanticPanelComponent>();
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
                toggle->onClick = [this, id] {
                    DispatchCurrentNodeAction(id);
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
                    DispatchCurrentNodeActionWithValue(id, juce::String(slider->getValue()).toStdString());
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
                    synth::ui::Action dispatched = *current->action;
                    dispatched.value = current->options[static_cast<std::size_t>(selected)].id;
                    DispatchBackendAction(dispatched);
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
                editor->onReturnKey = [this, editor = editor.get(), id] {
                    DispatchCurrentNodeActionWithValue(id, editor->getText().toStdString());
                };
                editor->onFocusLost = [this, editor = editor.get(), id] {
                    DispatchCurrentNodeActionWithValue(id, editor->getText().toStdString());
                };
                return editor;
            }
            case synth::ui::NodeKind::Draw:
            {
                auto overlay = std::make_unique<InteractiveDrawComponent>(
                    [this](const synth::ui::NodeId& id, float delta) {
                        DispatchCurrentNodePointerDragAction(id, delta);
                    },
                    [this](const synth::ui::NodeId& id) {
                        DispatchCurrentNodeDoubleClickAction(id);
                    });
                overlay->SetNodeId(node.id);
                return overlay;
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
            case synth::ui::NodeKind::ScrollArea:
            {
                auto& panel = static_cast<SemanticPanelComponent&>(component);
                panel.SetSemantics(node.variant, node.selected);
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
                auto& overlay = static_cast<InteractiveDrawComponent&>(component);
                overlay.SetNodeId(node.id);
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
    std::unordered_map<std::string, synth::ui::NodeId> m_nearestRootByNodeId;
    std::vector<std::size_t> m_drawNodeIndices;
    std::vector<synth::ui::NodeId> m_renderedNodeIds;
    bool m_suppressActionDispatch = false;
};

}  // namespace synth_juce
