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

    int AutoLayoutStartY() const
    {
        int maxDrawBottom = kControlMargin;
        for (const std::size_t nodeIndex : m_drawNodeIndices)
        {
            const synth::ui::Node& node = m_tree.nodes[nodeIndex];
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
        CollectRenderableDescendants(*root);

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
        const juce::Rectangle<int> content = ContentBounds();
        int flowX = content.getX() + kControlMargin;
        int flowY = content.getY() + AutoLayoutStartY();
        int rowHeight = 0;

        const synth::ui::Node* root = RootNode();
        if (root == nullptr)
        {
            return;
        }

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
                bounds = DefaultSizeForKind(node->kind);
                if (flowX + bounds.getWidth() > content.getRight() - kControlMargin)
                {
                    flowX = content.getX() + kControlMargin;
                    flowY += rowHeight + kControlGap;
                    rowHeight = 0;
                }
                bounds.setPosition(flowX, flowY);
                flowX += bounds.getWidth() + kControlGap;
                rowHeight = std::max(rowHeight, bounds.getHeight());
            }
            control.setBounds(bounds);
        }
    }

    void CollectRenderableDescendants(const synth::ui::Node& parent)
    {
        for (const synth::ui::NodeId& childId : parent.children)
        {
            const synth::ui::Node* node = FindNode(childId);
            if (node == nullptr)
            {
                continue;
            }

            if (node->kind == synth::ui::NodeKind::Draw)
            {
                if (const std::optional<std::size_t> nodeIndex = FindNodeIndex(node->id); nodeIndex.has_value())
                {
                    m_drawNodeIndices.push_back(*nodeIndex);
                }
            }
            else if (IsRenderableKind(node->kind))
            {
                m_renderedNodeIds.push_back(node->id);
            }

            CollectRenderableDescendants(*node);
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
            default:
                break;
        }
    }

    synth::ui::Surface& m_surface;
    synth::ui::NodeTree m_tree;
    std::vector<PortableControlEntry> m_controls;
    std::unordered_map<std::string, std::size_t> m_controlIndexById;
    std::vector<std::size_t> m_drawNodeIndices;
    std::vector<synth::ui::NodeId> m_renderedNodeIds;
    bool m_suppressActionDispatch = false;
};

}  // namespace synth_juce
