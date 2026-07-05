#pragma once

// JUCE desktop backend for the Controllers page portable surface (OpenSpec
// tasks 5.5). Renders the semantic tree with improved grouping and spacing.

#include "synth/ControllersPageUI.hpp"

#include "PortableJuceBackend.hpp"
#include "Runtime.hpp"

#include <juce_gui_extra/juce_gui_extra.h>

#include <cstdint>
#include <cmath>
#include <functional>
#include <memory>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace synth_runtime {

template <synth::SynthApplication App>
class Runtime;

class ControllersTreeRenderer final : public juce::Component
{
public:
    explicit ControllersTreeRenderer(synth::runtime_ui::ControllersPageSurface& surface)
        : m_surface(surface)
    {
        m_viewport.setViewedComponent(&m_content, false);
        m_viewport.setScrollBarsShown(true, true);
        addAndMakeVisible(m_viewport);
        RefreshFromSurface();
    }

    void RefreshFromSurface()
    {
        const std::uint64_t revision = m_surface.TreeRevision();
        if (revision == m_renderedRevision)
        {
            LayoutFromTree();
            return;
        }

        m_tree = m_surface.BuildTree();
        m_renderedRevision = revision;

        for (const auto& component : m_ownedComponents)
        {
            component->removeAllChildren();
        }
        removeAllChildren();
        m_content.removeAllChildren();
        m_componentsById.clear();
        m_ownedComponents.clear();
        addAndMakeVisible(m_viewport);

        if (m_tree.nodes.empty())
        {
            m_content.removeAllChildren();
            m_content.setSize(1, 1);
            return;
        }

        const synth::ui::Node* root = &m_tree.nodes.front();
        for (const synth::ui::NodeId& childId : root->children)
        {
            if (const synth::ui::Node* child = FindNode(childId); child != nullptr)
            {
                if (child->id == synth::runtime_ui::NodeIds::kScroll)
                {
                    RebuildScrollContent(*child);
                    continue;
                }

                std::unique_ptr<juce::Component> component = CreateComponentForNode(*child);
                if (component == nullptr)
                {
                    continue;
                }
                OwnComponent(std::move(component), *this, child->id);
            }
        }

        LayoutFromTree();
    }

    juce::Component* FindByNodeId(const std::string& id)
    {
        const auto it = m_componentsById.find(id);
        if (it == m_componentsById.end())
        {
            return nullptr;
        }
        return it->second;
    }

    bool HasFocusedEditor() const
    {
        for (const auto& entry : m_componentsById)
        {
            if (entry.second != nullptr && entry.second->hasKeyboardFocus(true))
            {
                return true;
            }
        }
        return false;
    }

    void resized() override
    {
        m_viewport.setBounds(getLocalBounds());
        LayoutFromTree();
    }

private:
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

    void DispatchAction(const synth::ui::Action& action)
    {
        m_surface.DispatchAction(action);
        RefreshFromSurface();
    }

    void DispatchDeferred(const synth::ui::Action& action)
    {
        juce::Component::SafePointer<ControllersTreeRenderer> safeThis(this);
        juce::MessageManager::callAsync([safeThis, action] {
            if (safeThis == nullptr)
            {
                return;
            }
            safeThis->DispatchAction(action);
        });
    }

    void RebuildScrollContent(const synth::ui::Node& scrollNode)
    {
        m_content.removeAllChildren();
        for (const synth::ui::NodeId& childId : scrollNode.children)
        {
            if (const synth::ui::Node* child = FindNode(childId); child != nullptr)
            {
                BuildNode(*child, m_content);
            }
        }
    }

    void LayoutFromTree()
    {
        if (m_tree.nodes.empty())
        {
            return;
        }

        const synth::ui::Node* root = &m_tree.nodes.front();
        for (const synth::ui::NodeId& childId : root->children)
        {
            const synth::ui::Node* child = FindNode(childId);
            if (child == nullptr)
            {
                continue;
            }

            if (child->id == synth::runtime_ui::NodeIds::kScroll)
            {
                m_viewport.setBounds(synth_juce::UiToJuceRect(child->bounds));
                const int viewportWidth = juce::jmax(1, m_viewport.getWidth() - m_viewport.getScrollBarThickness());
                const int contentWidth = juce::jmax(
                    viewportWidth, static_cast<int>(std::ceil(child->scrollContentWidth)));
                const int contentHeight = juce::jmax(
                    1, static_cast<int>(std::ceil(child->scrollContentHeight > 0.0f ? child->scrollContentHeight
                                                                                     : child->bounds.height)));
                m_content.setSize(contentWidth, contentHeight);
                LayoutNodeChildren(*child, {0, 0}, viewportWidth);
                continue;
            }

            if (juce::Component* component = FindByNodeId(child->id.value); component != nullptr)
            {
                component->setBounds(synth_juce::UiToJuceRect(child->bounds));
            }
        }
    }

    void LayoutNodeChildren(const synth::ui::Node& parent,
                            juce::Point<int> offset,
                            int hostWidth)
    {
        for (const synth::ui::NodeId& childId : parent.children)
        {
            const synth::ui::Node* child = FindNode(childId);
            if (child == nullptr)
            {
                continue;
            }

            juce::Component* component = FindByNodeId(child->id.value);
            if (component == nullptr)
            {
                continue;
            }

            auto bounds = synth_juce::UiToJuceRect(child->bounds);
            bounds.setX(offset.x + bounds.getX());
            bounds.setY(offset.y + bounds.getY());
            if (bounds.getWidth() <= 0)
            {
                bounds.setWidth(hostWidth);
            }
            component->setBounds(bounds);

            if (child->kind == synth::ui::NodeKind::Section)
            {
                LayoutNodeChildren(*child, {0, 0}, bounds.getWidth());
            }
            else if (child->kind == synth::ui::NodeKind::Row)
            {
                LayoutNodeChildren(*child, {0, 0}, bounds.getWidth());
            }
        }
    }

    void BuildNode(const synth::ui::Node& node, juce::Component& host)
    {
        std::unique_ptr<juce::Component> component = CreateComponentForNode(node);
        if (component == nullptr)
        {
            return;
        }

        juce::Component* raw = OwnComponent(std::move(component), host, node.id);

        for (const synth::ui::NodeId& childId : node.children)
        {
            if (const synth::ui::Node* child = FindNode(childId); child != nullptr)
            {
                BuildNode(*child, *raw);
            }
        }
    }

    juce::Component* OwnComponent(std::unique_ptr<juce::Component> component,
                                  juce::Component& host,
                                  const synth::ui::NodeId& nodeId)
    {
        juce::Component* raw = component.get();
        m_componentsById[nodeId.value] = raw;
        m_ownedComponents.push_back(std::move(component));
        host.addAndMakeVisible(*raw);
        return raw;
    }

    std::unique_ptr<juce::Component> CreateComponentForNode(const synth::ui::Node& node)
    {
        switch (node.kind)
        {
            case synth::ui::NodeKind::Button:
            {
                auto button = std::make_unique<juce::TextButton>(node.label);
                if (node.action.has_value())
                {
                    const synth::ui::Action action = *node.action;
                    if (action.name == synth::runtime_ui::Actions::kAddController)
                    {
                        button->onClick = [this] {
                            std::string name;
                            std::string kindId = "wrldbldr";
                            if (juce::Component* nameField = FindByNodeId(synth::runtime_ui::NodeIds::kAddName);
                                nameField != nullptr)
                            {
                                name = static_cast<juce::TextEditor*>(nameField)->getText().toStdString();
                            }
                            if (juce::Component* kindField = FindByNodeId(synth::runtime_ui::NodeIds::kAddKind);
                                kindField != nullptr)
                            {
                                const auto* combo = static_cast<juce::ComboBox*>(kindField);
                                const int selected = combo->getSelectedItemIndex();
                                if (selected >= 0)
                                {
                                    const auto options = synth::runtime_ui::ControllersLayout::BuildAddControllerKindOptions();
                                    if (selected < static_cast<int>(options.size()))
                                    {
                                        kindId = options[static_cast<std::size_t>(selected)].id;
                                    }
                                }
                            }
                            m_surface.SetAddControllerDraft(name, kindId);
                            DispatchDeferred(synth::ui::Action::Named(synth::runtime_ui::Actions::kAddController));
                        };
                    }
                    else if (m_surface.NeedsDeferredDispatch(action))
                    {
                        button->onClick = [this, action] { DispatchDeferred(action); };
                    }
                    else
                    {
                        button->onClick = [this, action] { DispatchAction(action); };
                    }
                }
                return button;
            }
            case synth::ui::NodeKind::Label:
            case synth::ui::NodeKind::StatusText:
            {
                auto label = std::make_unique<juce::Label>();
                label->setColour(juce::Label::textColourId, juce::Colours::white);
                label->setJustificationType(juce::Justification::centredLeft);
                label->setText(node.text.empty() ? node.label : node.text, juce::dontSendNotification);
                if (node.kind == synth::ui::NodeKind::StatusText)
                {
                    label->setColour(juce::Label::textColourId, juce::Colours::lightgrey);
                }
                return label;
            }
            case synth::ui::NodeKind::ComboBox:
            {
                auto combo = std::make_unique<juce::ComboBox>();
                combo->setTextWhenNothingSelected(node.label);
                for (int ix = 0; ix < static_cast<int>(node.options.size()); ++ix)
                {
                    combo->addItem(node.options[static_cast<std::size_t>(ix)].label, ix + 1);
                }
                for (int ix = 0; ix < static_cast<int>(node.options.size()); ++ix)
                {
                    if (node.options[static_cast<std::size_t>(ix)].id == node.selectedOption)
                    {
                        combo->setSelectedId(ix + 1, juce::dontSendNotification);
                        break;
                    }
                }
                if (node.action.has_value())
                {
                    const synth::ui::NodeId nodeId = node.id;
                    const synth::ui::Action action = *node.action;
                    combo->onChange = [this, combo = combo.get(), nodeId, action] {
                        const synth::ui::Node* current = FindNode(nodeId);
                        if (current == nullptr || !current->action.has_value())
                        {
                            return;
                        }
                        const int selected = combo->getSelectedItemIndex();
                        if (selected < 0 || selected >= static_cast<int>(current->options.size()))
                        {
                            return;
                        }
                        synth::ui::Action dispatched = action;
                        const std::string& optionId = current->options[static_cast<std::size_t>(selected)].id;
                        if (action.name == synth::runtime_ui::Actions::kEndpointSelect)
                        {
                            dispatched.value = action.value + ":" + optionId;
                        }
                        else if (action.name == synth::runtime_ui::Actions::kVariantSelect)
                        {
                            dispatched.value = action.value + ":" + optionId;
                        }
                        else if (action.name == synth::runtime_ui::Actions::kMappingFieldCommit)
                        {
                            dispatched.value = action.value + ":" + optionId;
                        }
                        else
                        {
                            dispatched.value = optionId;
                        }
                        if (m_surface.NeedsDeferredDispatch(dispatched))
                        {
                            DispatchDeferred(dispatched);
                        }
                        else
                        {
                            DispatchAction(dispatched);
                        }
                    };
                }
                return combo;
            }
            case synth::ui::NodeKind::TextField:
            {
                auto editor = std::make_unique<juce::TextEditor>();
                editor->setText(node.text, juce::dontSendNotification);
                editor->setSelectAllWhenFocused(true);
                if (!node.label.empty())
                {
                    editor->setTextToShowWhenEmpty(node.label, juce::Colours::grey);
                }
                if (node.action.has_value())
                {
                    const synth::ui::Action action = *node.action;
                    auto committed = std::make_shared<bool>(false);
                    editor->onTextChange = [committed] { *committed = false; };
                    auto commit = [this, editor = editor.get(), action, committed] {
                        if (*committed)
                        {
                            return;
                        }
                        *committed = true;
                        synth::ui::Action dispatched = action;
                        dispatched.value = action.value + ":" + editor->getText().toStdString();
                        if (m_surface.NeedsDeferredDispatch(dispatched))
                        {
                            DispatchDeferred(dispatched);
                        }
                        else
                        {
                            DispatchAction(dispatched);
                        }
                    };
                    editor->onReturnKey = [commit, editor = editor.get()] {
                        commit();
                        editor->giveAwayKeyboardFocus();
                    };
                    editor->onFocusLost = commit;
                }
                return editor;
            }
            case synth::ui::NodeKind::Toggle:
            {
                auto toggle = std::make_unique<juce::ToggleButton>(node.label);
                toggle->setToggleState(node.checked, juce::dontSendNotification);
                if (node.action.has_value())
                {
                    const synth::ui::Action action = *node.action;
                    toggle->onClick = [this, toggle = toggle.get(), action] {
                        synth::ui::Action dispatched = action;
                        dispatched.value = action.value + ":" + (toggle->getToggleState() ? "1" : "0");
                        if (m_surface.NeedsDeferredDispatch(dispatched))
                        {
                            DispatchDeferred(dispatched);
                        }
                        else
                        {
                            DispatchAction(dispatched);
                        }
                    };
                }
                return toggle;
            }
            case synth::ui::NodeKind::Draw:
            {
                class DrawNode final : public juce::Component
                {
                public:
                    explicit DrawNode(std::vector<synth::ui::DrawCommand> commands)
                        : m_commands(std::move(commands))
                    {
                    }

                    void paint(juce::Graphics& graphics) override
                    {
                        const juce::Rectangle<float> bounds = getLocalBounds().toFloat();
                        for (const synth::ui::DrawCommand& command : m_commands)
                        {
                            synth_juce::PaintDrawCommand(graphics, command, bounds);
                        }
                    }

                private:
                    std::vector<synth::ui::DrawCommand> m_commands;
                };
                return std::make_unique<DrawNode>(node.drawCommands);
            }
            case synth::ui::NodeKind::Row:
            case synth::ui::NodeKind::Section:
            case synth::ui::NodeKind::ScrollArea:
            {
                class GroupHost final : public juce::Component
                {
                public:
                    explicit GroupHost(synth::ui::NodeKind kind, std::string caption)
                        : m_kind(kind)
                        , m_caption(std::move(caption))
                    {
                        if (m_kind == synth::ui::NodeKind::Section)
                        {
                            setOpaque(true);
                        }
                    }

                    void paint(juce::Graphics& graphics) override
                    {
                        if (m_kind == synth::ui::NodeKind::Section)
                        {
                            graphics.fillAll(juce::Colour(28, 30, 34));
                            graphics.setColour(juce::Colours::darkgrey);
                            graphics.drawRect(getLocalBounds(), 1);
                        }
                        else if (m_kind == synth::ui::NodeKind::Row && !m_caption.empty())
                        {
                            graphics.setColour(juce::Colours::darkgrey);
                            graphics.fillRect(0, 0, getWidth(), 1);
                            graphics.setColour(juce::Colours::lightgrey);
                            graphics.setFont(juce::Font(juce::FontOptions(13.0f, juce::Font::bold)));
                            graphics.drawText(m_caption, 4, 2, getWidth() - 8, 16, juce::Justification::centredLeft);
                        }
                    }

                private:
                    synth::ui::NodeKind m_kind;
                    std::string m_caption;
                };
                return std::make_unique<GroupHost>(node.kind, node.label);
            }
            default:
                return std::make_unique<juce::Component>();
        }
    }

    synth::runtime_ui::ControllersPageSurface& m_surface;
    synth::ui::NodeTree m_tree;
    juce::Viewport m_viewport;
    juce::Component m_content;
    std::unordered_map<std::string, juce::Component*> m_componentsById;
    std::vector<std::unique_ptr<juce::Component>> m_ownedComponents;
    std::uint64_t m_renderedRevision = 0;
};

template <synth::SynthApplication App>
class ControllersPageHost final : public juce::Component
{
public:
    explicit ControllersPageHost(Runtime<App>& runtime)
        : m_runtime(runtime)
        , m_surface(MakeCallbacks())
        , m_renderer(m_surface)
    {
        addAndMakeVisible(m_renderer);

        m_surface.SetFocusGuard([this] { return m_renderer.HasFocusedEditor(); });

        m_runtime.SetMidiProcessorsRebuiltHook([this] { m_surface.MarkDirty(); });

        m_surface.MarkDirty();
        RefreshOnTick();
    }

    ~ControllersPageHost() override
    {
        m_runtime.SetMidiProcessorsRebuiltHook({});
    }

    ControllersPageHost(const ControllersPageHost&) = delete;
    ControllersPageHost& operator=(const ControllersPageHost&) = delete;

    void RefreshOnTick()
    {
        m_surface.SetEnumerateDevices(m_runtime.MidiConnections().EnumerateNow());
        m_surface.RefreshOnTick();
        m_renderer.RefreshFromSurface();
        resized();
    }

    void resized() override
    {
        const auto area = getLocalBounds();
        m_surface.SetContentBounds(synth_juce::JuceToUiBounds(area.toFloat()));
        m_renderer.setBounds(area);
        m_renderer.RefreshFromSurface();
    }

    std::function<void()> onBack;

private:
    synth::runtime_ui::ControllersPageCallbacks MakeCallbacks()
    {
        synth::runtime_ui::ControllersPageCallbacks callbacks;
        callbacks.instrumentSnapshot = [this] { return m_runtime.GetEngine().InstrumentSnapshot(); };
        callbacks.connectionState = [this] { return m_runtime.MidiConnections().State(); };
        callbacks.enumerateDevices = [this] { return m_runtime.MidiConnections().EnumerateNow(); };
        callbacks.commitInstrument = [this](synth::MidiInstrumentConfig out) {
            m_runtime.GetEngine().EditInstrument(
                [&](synth::MidiInstrumentConfig& inst) { inst = std::move(out); });
            m_surface.MarkDirty();
        };
        callbacks.setStatus = [](std::string) {};
        callbacks.onBack = [this] {
            if (onBack)
            {
                onBack();
            }
        };
        return callbacks;
    }

    Runtime<App>& m_runtime;
    synth::runtime_ui::ControllersPageSurface m_surface;
    ControllersTreeRenderer m_renderer;
};

}  // namespace synth_runtime
