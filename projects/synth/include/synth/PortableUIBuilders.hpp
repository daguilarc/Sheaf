#pragma once

#include "synth/PortableUI.hpp"

#include <cassert>
#include <cstddef>
#include <initializer_list>
#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace synth::ui {

class Builder {
public:
    Builder& Root(std::string id, Bounds bounds) {
        Node node;
        node.id = NodeId(std::move(id));
        node.kind = NodeKind::Root;
        node.bounds = bounds;
        tree_.nodes.push_back(std::move(node));
        rootIndex_ = tree_.nodes.size() - 1;
        return *this;
    }

    Builder& Label(std::string id, std::string text) {
        Node node;
        node.id = NodeId(std::move(id));
        node.kind = NodeKind::Label;
        node.text = std::move(text);
        AppendChild(node);
        return *this;
    }

    Builder& StatusText(std::string id, std::string text) {
        Node node;
        node.id = NodeId(std::move(id));
        node.kind = NodeKind::StatusText;
        node.text = std::move(text);
        AppendChild(node);
        return *this;
    }

    Builder& Button(std::string id, std::string label, Action action) {
        Node node;
        node.id = NodeId(std::move(id));
        node.kind = NodeKind::Button;
        node.label = std::move(label);
        node.action = std::move(action);
        AppendChild(node);
        return *this;
    }

    Builder& Toggle(std::string id, std::string label, bool checked, Action action) {
        Node node;
        node.id = NodeId(std::move(id));
        node.kind = NodeKind::Toggle;
        node.label = std::move(label);
        node.checked = checked;
        node.action = std::move(action);
        AppendChild(node);
        return *this;
    }

    Builder& Slider(std::string id,
                    std::string label,
                    float value,
                    float minValue,
                    float maxValue,
                    float step,
                    Action action) {
        Node node;
        node.id = NodeId(std::move(id));
        node.kind = NodeKind::Slider;
        node.label = std::move(label);
        node.value = value;
        node.minValue = minValue;
        node.maxValue = maxValue;
        node.step = step;
        node.action = std::move(action);
        AppendChild(node);
        return *this;
    }

    Builder& ComboBox(std::string id,
                      std::string label,
                      std::initializer_list<std::pair<std::string, std::string>> options,
                      std::string selectedOption,
                      Action action) {
        Node node;
        node.id = NodeId(std::move(id));
        node.kind = NodeKind::ComboBox;
        node.label = std::move(label);
        for (const auto& option : options) {
            node.options.push_back(ControlOption{option.first, option.second});
        }
        node.selectedOption = std::move(selectedOption);
        node.action = std::move(action);
        AppendChild(node);
        return *this;
    }

    Builder& TextField(std::string id, std::string label, std::string text, Action action) {
        Node node;
        node.id = NodeId(std::move(id));
        node.kind = NodeKind::TextField;
        node.label = std::move(label);
        node.text = std::move(text);
        node.action = std::move(action);
        AppendChild(node);
        return *this;
    }

    Builder& Draw(std::string id, Bounds bounds, std::initializer_list<DrawCommand> commands) {
        return Draw(std::move(id), bounds, std::vector<DrawCommand>(commands.begin(), commands.end()));
    }

    Builder& Draw(std::string id, Bounds bounds, std::vector<DrawCommand> commands) {
        Node node;
        node.id = NodeId(std::move(id));
        node.kind = NodeKind::Draw;
        node.bounds = bounds;
        node.drawCommands = std::move(commands);
        AppendChild(node);
        return *this;
    }

    Builder& DrawInteractive(std::string id,
                             Bounds bounds,
                             std::vector<DrawCommand> commands,
                             Action pointerDragAction,
                             std::optional<Action> doubleClickAction = std::nullopt) {
        Node node;
        node.id = NodeId(std::move(id));
        node.kind = NodeKind::Draw;
        node.bounds = bounds;
        node.drawCommands = std::move(commands);
        node.pointerDragAction = std::move(pointerDragAction);
        node.doubleClickAction = std::move(doubleClickAction);
        AppendChild(node);
        return *this;
    }

    NodeTree Build() {
        return tree_;
    }

private:
    void AppendChild(Node node) {
        assert(!tree_.nodes.empty() && "Builder::Root must be called before adding child nodes");
        const NodeId childId = node.id;
        tree_.nodes.push_back(std::move(node));
        tree_.nodes[rootIndex_].children.push_back(childId);
    }

    NodeTree tree_;
    std::size_t rootIndex_ = 0;
};

}  // namespace synth::ui
