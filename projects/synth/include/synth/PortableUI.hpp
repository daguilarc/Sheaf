#pragma once

#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace synth::ui {

inline constexpr bool kPortableUiUsesJuce = false;

struct NodeId {
    std::string value;
    NodeId() = default;
    explicit NodeId(std::string v) : value(std::move(v)) {}
    NodeId(const char* v) : value(v) {}
    friend bool operator==(const NodeId&, const NodeId&) = default;
};

struct Point {
    float x = 0.0f;
    float y = 0.0f;
};

struct Bounds {
    float x = 0.0f;
    float y = 0.0f;
    float width = 0.0f;
    float height = 0.0f;
};

struct Color {
    std::uint8_t r = 0;
    std::uint8_t g = 0;
    std::uint8_t b = 0;
    std::uint8_t a = 255;
    static constexpr Color Rgb(std::uint8_t red, std::uint8_t green, std::uint8_t blue) {
        return Color{red, green, blue, 255};
    }
    static constexpr Color Rgba(std::uint8_t red, std::uint8_t green, std::uint8_t blue, std::uint8_t alpha) {
        return Color{red, green, blue, alpha};
    }
};

enum class TextAlign {
    Left,
    Center,
    Right
};

struct TextStyle {
    float size = 14.0f;
    Color color = Color::Rgb(255, 255, 255);
    TextAlign align = TextAlign::Left;
};

struct Action {
    std::string name;
    std::string value;
    static Action Named(std::string actionName) {
        return Action{std::move(actionName), {}};
    }
    static Action WithValue(std::string actionName, std::string actionValue) {
        return Action{std::move(actionName), std::move(actionValue)};
    }
};

struct ControlOption {
    std::string id;
    std::string label;
};

struct DrawCommand {
    enum class Kind {
        Fill,
        StrokeRect,
        Line,
        Arc,
        Text
    };
    Kind kind = Kind::Fill;
    Bounds bounds{};
    Point from{};
    Point to{};
    Color color{};
    float strokeWidth = 1.0f;
    float startRadians = 0.0f;
    float endRadians = 0.0f;
    std::string text;
    TextStyle textStyle{};

    static DrawCommand Fill(Color color);
    static DrawCommand StrokeRect(Bounds bounds, Color color, float strokeWidth);
    static DrawCommand Line(Point from, Point to, Color color, float strokeWidth);
    static DrawCommand Arc(Bounds bounds, float startRadians, float endRadians, Color color, float strokeWidth);
    static DrawCommand Text(Bounds bounds, std::string text, TextStyle style);
};

enum class NodeKind {
    Root,
    Row,
    Section,
    ScrollArea,
    Label,
    Button,
    Toggle,
    Slider,
    ComboBox,
    TextField,
    StatusText,
    Draw
};

struct Node {
    NodeId id;
    NodeKind kind = NodeKind::Label;
    Bounds bounds{};
    std::string label;
    std::string text;
    bool checked = false;
    float value = 0.0f;
    float minValue = 0.0f;
    float maxValue = 1.0f;
    float step = 0.001f;
    std::vector<ControlOption> options;
    std::string selectedOption;
    std::optional<Action> action;
    std::vector<NodeId> children;
    std::vector<DrawCommand> drawCommands;
};

struct NodeTree {
    std::vector<Node> nodes;
};

class Surface {
public:
    using ActionHandler = std::function<void(const Action&)>;
    virtual ~Surface() = default;
    virtual NodeTree BuildTree() = 0;
    // DispatchAction is the authoritative route for backend-originated UI
    // actions. SetActionHandler registers an optional observer hook; it must
    // not duplicate the surface's own action routing.
    virtual void SetActionHandler(ActionHandler handler) = 0;
    virtual void DispatchAction(const Action& action) = 0;
};

inline DrawCommand DrawCommand::Fill(Color color) {
    DrawCommand command;
    command.kind = Kind::Fill;
    command.color = color;
    return command;
}

inline DrawCommand DrawCommand::StrokeRect(Bounds bounds, Color color, float strokeWidth) {
    DrawCommand command;
    command.kind = Kind::StrokeRect;
    command.bounds = bounds;
    command.color = color;
    command.strokeWidth = strokeWidth;
    return command;
}

inline DrawCommand DrawCommand::Line(Point from, Point to, Color color, float strokeWidth) {
    DrawCommand command;
    command.kind = Kind::Line;
    command.from = from;
    command.to = to;
    command.color = color;
    command.strokeWidth = strokeWidth;
    return command;
}

inline DrawCommand DrawCommand::Arc(Bounds bounds, float startRadians, float endRadians, Color color, float strokeWidth) {
    DrawCommand command;
    command.kind = Kind::Arc;
    command.bounds = bounds;
    command.startRadians = startRadians;
    command.endRadians = endRadians;
    command.color = color;
    command.strokeWidth = strokeWidth;
    return command;
}

inline DrawCommand DrawCommand::Text(Bounds bounds, std::string text, TextStyle style) {
    DrawCommand command;
    command.kind = Kind::Text;
    command.bounds = bounds;
    command.text = std::move(text);
    command.textStyle = style;
    return command;
}

}  // namespace synth::ui
