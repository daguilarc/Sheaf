#pragma once

#include <cstddef>
#include <cstdint>
#include <memory>
#include <optional>
#include <utility>
#include <vector>

#include "synth/AtomicColor.hpp"
#include "synth/Color.hpp"

namespace synth {

class GridRange {
public:
    static std::optional<GridRange> Create(int xmin, int xmax, int ymin, int ymax);

    int XMin() const;
    int XMax() const;
    int YMin() const;
    int YMax() const;
    std::size_t Width() const;
    std::size_t Height() const;
    std::size_t CellCount() const;
    bool Contains(int x, int y) const;
    std::optional<std::size_t> IndexOf(int x, int y) const;

    bool operator==(const GridRange&) const = default;

private:
    GridRange(int xmin, int xmax, int ymin, int ymax, std::size_t width,
              std::size_t height, std::size_t cellCount);

    int xmin_;
    int xmax_;
    int ymin_;
    int ymax_;
    std::size_t width_;
    std::size_t height_;
    std::size_t cellCount_;
};

class Cell {
public:
    virtual ~Cell() = default;
    virtual void OnPress(std::uint8_t) {}
    virtual void OnRelease() {}
    virtual void OnPressureChange(std::uint8_t) {}
    virtual Color GetColor() const = 0;
    virtual bool GetOnOff() const = 0;
};

struct NoFlash {
    bool IsFlashing() const { return false; }
};

class BoolFlash {
public:
    explicit BoolFlash(const bool* value) : value_(value) {}
    bool IsFlashing() const { return *value_; }

private:
    const bool* value_;
};

template<class State>
class Flash {
public:
    Flash(const State* value, State flashingValue)
        : value_(value), flashingValue_(std::move(flashingValue)) {}
    bool IsFlashing() const { return *value_ == flashingValue_; }

private:
    const State* value_;
    State flashingValue_;
};

template<class State, class FlashPolicy = NoFlash>
class StateCell final : public Cell {
public:
    enum class Mode {
        Toggle,
        Momentary,
        SetOnly,
        ShowOnly,
    };

    StateCell(Color offColor, Color onColor, Color offFlashColor, Color onFlashColor,
              State* state, FlashPolicy flashPolicy, State onState, State offState, Mode mode)
        : offColor_(offColor),
          onColor_(onColor),
          offFlashColor_(offFlashColor),
          onFlashColor_(onFlashColor),
          state_(state),
          flashPolicy_(std::move(flashPolicy)),
          onState_(std::move(onState)),
          offState_(std::move(offState)),
          mode_(mode) {}

    StateCell(Color offColor, Color onColor, State* state, State onState,
              State offState = State{}, Mode mode = Mode::Toggle)
        : StateCell(offColor, onColor, onColor, offColor, state, FlashPolicy{},
                    std::move(onState), std::move(offState), mode) {}

    void OnPress(std::uint8_t) override {
        switch (mode_) {
        case Mode::Toggle:
            *state_ = *state_ == onState_ ? offState_ : onState_;
            break;
        case Mode::Momentary:
        case Mode::SetOnly:
            *state_ = onState_;
            break;
        case Mode::ShowOnly:
            break;
        }
    }

    void OnRelease() override {
        if (mode_ == Mode::Momentary) {
            *state_ = offState_;
        }
    }

    Color GetColor() const override {
        if (flashPolicy_.IsFlashing()) {
            return GetOnOff() ? onFlashColor_ : offFlashColor_;
        }
        return GetOnOff() ? onColor_ : offColor_;
    }

    bool GetOnOff() const override { return *state_ == onState_; }

private:
    Color offColor_;
    Color onColor_;
    Color offFlashColor_;
    Color onFlashColor_;
    State* state_;
    FlashPolicy flashPolicy_;
    State onState_;
    State offState_;
    Mode mode_;
};

class GridManager;

class Grid {
public:
    struct UIState {
        explicit UIState(GridRange range);

        const GridRange range;
        std::vector<AtomicColor> colors;
    };

    explicit Grid(GridRange range);

    bool RegisterCell(int x, int y, std::unique_ptr<Cell> cell);
    const GridRange& Range() const;

private:
    friend class GridManager;

    Cell* CellAt(int x, int y);
    const Cell* CellAt(int x, int y) const;
    const Cell* CellAt(std::size_t index) const;
    void Finalize();

    GridRange range_;
    std::vector<std::unique_ptr<Cell>> cells_;
    bool finalized_ = false;
};

class GridSlot {
public:
    explicit GridSlot(GridRange range);

    const GridRange& Range() const;
    Grid* SelectedGrid();
    const Grid* SelectedGrid() const;

private:
    friend class GridManager;

    GridRange range_;
    Grid* selectedGrid_ = nullptr;
};

class GridManager {
public:
    struct UIState;

    std::optional<std::size_t> CreateGrid(GridRange range);
    std::optional<std::size_t> CreateSlot(GridRange range);
    Grid* GridAt(std::size_t index);
    const Grid* GridAt(std::size_t index) const;
    GridSlot* SlotAt(std::size_t index);
    const GridSlot* SlotAt(std::size_t index) const;
    bool SelectGridForSlot(std::size_t slotIx, std::size_t gridIx);
    void HandlePress(std::size_t slotIx, int x, int y, std::uint8_t velocity);
    void HandleRelease(std::size_t slotIx, int x, int y);
    void HandlePressureChange(std::size_t slotIx, int x, int y, std::uint8_t pressure);
    std::unique_ptr<UIState> CreateUIState();
    void PopulateUIState(UIState&) const;
    bool Finalized() const;

private:
    std::vector<std::unique_ptr<Grid>> grids_;
    std::vector<std::unique_ptr<GridSlot>> slots_;
    bool finalized_ = false;
};

struct GridManager::UIState {
    const std::vector<std::unique_ptr<Grid::UIState>> slots;

private:
    friend class GridManager;
    explicit UIState(std::vector<std::unique_ptr<Grid::UIState>> slotStates)
        : slots(std::move(slotStates)) {}
};

}  // namespace synth
