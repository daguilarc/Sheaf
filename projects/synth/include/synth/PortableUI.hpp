#pragma once

#include "synth/Color.hpp"

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
        Text,
        FillEllipse,
        StrokeEllipse,
        FillRoundedRect,
        StrokeRoundedRect,
        Polyline,
        FillPolygon
    };
    Kind kind = Kind::Fill;
    Bounds bounds{};
    Point from{};
    Point to{};
    Color color{};
    float strokeWidth = 1.0f;
    float startRadians = 0.0f;
    float endRadians = 0.0f;
    float cornerRadius = 0.0f;
    std::string text;
    TextStyle textStyle{};
    std::vector<Point> points{};

    static DrawCommand Fill(Color color);
    static DrawCommand Fill(Bounds bounds, Color color);
    static DrawCommand StrokeRect(Bounds bounds, Color color, float strokeWidth);
    static DrawCommand Line(Point from, Point to, Color color, float strokeWidth);
    static DrawCommand Arc(Bounds bounds, float startRadians, float endRadians, Color color, float strokeWidth);
    static DrawCommand Text(Bounds bounds, std::string text, TextStyle style);
    static DrawCommand FillEllipse(Bounds bounds, Color color);
    static DrawCommand StrokeEllipse(Bounds bounds, Color color, float strokeWidth);
    static DrawCommand FillRoundedRect(Bounds bounds, float cornerRadius, Color color);
    static DrawCommand StrokeRoundedRect(Bounds bounds, float cornerRadius, Color color, float strokeWidth);
    static DrawCommand Polyline(std::vector<Point> points, Color color, float strokeWidth);
    static DrawCommand FillPolygon(std::vector<Point> points, Color color);
};

class Visualizer {
public:
    Visualizer() = default;
    virtual ~Visualizer() = default;
    Visualizer(const Visualizer&) = delete;
    Visualizer& operator=(const Visualizer&) = delete;
    Visualizer(Visualizer&&) = delete;
    Visualizer& operator=(Visualizer&&) = delete;

    void SetBounds(Bounds bounds) { bounds_ = bounds; }
    const Bounds& GetBounds() const { return bounds_; }
    void SetVisible(bool visible) { visible_ = visible; }
    bool Visible() const { return visible_; }
    virtual bool WantsEncoderFrame() const noexcept { return true; }

    std::vector<DrawCommand> Draw() const
    {
        if (!visible_)
        {
            return {};
        }
        return DrawVisible();
    }

protected:
    virtual std::vector<DrawCommand> DrawVisible() const = 0;

private:
    Bounds bounds_{};
    bool visible_ = true;
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
    bool selected = false;
    bool enabled = true;
    float value = 0.0f;
    float minValue = 0.0f;
    float maxValue = 1.0f;
    float step = 0.001f;
    float scrollContentWidth = 0.0f;
    float scrollContentHeight = 0.0f;
    std::vector<ControlOption> options;
    std::string selectedOption;
    std::string variant;
    std::optional<Action> action;
    std::optional<Action> pointerDragAction;
    std::optional<Action> doubleClickAction;
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

inline DrawCommand DrawCommand::Fill(Bounds bounds, Color color) {
    DrawCommand command;
    command.kind = Kind::Fill;
    command.bounds = bounds;
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

inline DrawCommand DrawCommand::FillEllipse(Bounds bounds, Color color) {
    DrawCommand command;
    command.kind = Kind::FillEllipse;
    command.bounds = bounds;
    command.color = color;
    return command;
}

inline DrawCommand DrawCommand::StrokeEllipse(Bounds bounds, Color color, float strokeWidth) {
    DrawCommand command;
    command.kind = Kind::StrokeEllipse;
    command.bounds = bounds;
    command.color = color;
    command.strokeWidth = strokeWidth;
    return command;
}

inline DrawCommand DrawCommand::FillRoundedRect(Bounds bounds, float cornerRadius, Color color) {
    DrawCommand command;
    command.kind = Kind::FillRoundedRect;
    command.bounds = bounds;
    command.cornerRadius = cornerRadius;
    command.color = color;
    return command;
}

inline DrawCommand DrawCommand::StrokeRoundedRect(Bounds bounds, float cornerRadius, Color color, float strokeWidth) {
    DrawCommand command;
    command.kind = Kind::StrokeRoundedRect;
    command.bounds = bounds;
    command.cornerRadius = cornerRadius;
    command.color = color;
    command.strokeWidth = strokeWidth;
    return command;
}

inline DrawCommand DrawCommand::Polyline(std::vector<Point> points, Color color, float strokeWidth) {
    DrawCommand command;
    command.kind = Kind::Polyline;
    command.points = std::move(points);
    command.color = color;
    command.strokeWidth = strokeWidth;
    return command;
}

inline DrawCommand DrawCommand::FillPolygon(std::vector<Point> points, Color color) {
    DrawCommand command;
    command.kind = Kind::FillPolygon;
    command.points = std::move(points);
    command.color = color;
    return command;
}

}  // namespace synth::ui
