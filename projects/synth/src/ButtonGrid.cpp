#include "synth/ButtonGrid.hpp"

#include <cstdint>
#include <limits>
#include <stdexcept>
#include <utility>

namespace synth {

GridRange::GridRange(int xmin, int xmax, int ymin, int ymax, std::size_t width,
                     std::size_t height, std::size_t cellCount)
    : xmin_(xmin),
      xmax_(xmax),
      ymin_(ymin),
      ymax_(ymax),
      width_(width),
      height_(height),
      cellCount_(cellCount) {}

std::optional<GridRange> GridRange::Create(int xmin, int xmax, int ymin, int ymax) {
    if (xmax <= xmin || ymax <= ymin) {
        return std::nullopt;
    }

    const std::int64_t width = static_cast<std::int64_t>(xmax) - static_cast<std::int64_t>(xmin);
    const std::int64_t height = static_cast<std::int64_t>(ymax) - static_cast<std::int64_t>(ymin);
    if (width > std::numeric_limits<std::int64_t>::max() / height) {
        return std::nullopt;
    }
    const std::int64_t cellCount = width * height;
    if (static_cast<std::uint64_t>(cellCount) > std::numeric_limits<std::size_t>::max()) {
        return std::nullopt;
    }

    return GridRange(xmin, xmax, ymin, ymax, static_cast<std::size_t>(width),
                     static_cast<std::size_t>(height), static_cast<std::size_t>(cellCount));
}

int GridRange::XMin() const { return xmin_; }
int GridRange::XMax() const { return xmax_; }
int GridRange::YMin() const { return ymin_; }
int GridRange::YMax() const { return ymax_; }
std::size_t GridRange::Width() const { return width_; }
std::size_t GridRange::Height() const { return height_; }
std::size_t GridRange::CellCount() const { return cellCount_; }

bool GridRange::Contains(int x, int y) const {
    return x >= xmin_ && x < xmax_ && y >= ymin_ && y < ymax_;
}

std::optional<std::size_t> GridRange::IndexOf(int x, int y) const {
    if (!Contains(x, y)) {
        return std::nullopt;
    }
    const std::size_t xOffset = static_cast<std::size_t>(
        static_cast<std::int64_t>(x) - static_cast<std::int64_t>(xmin_));
    const std::size_t yOffset = static_cast<std::size_t>(
        static_cast<std::int64_t>(y) - static_cast<std::int64_t>(ymin_));
    return yOffset * width_ + xOffset;
}

Grid::UIState::UIState(GridRange stateRange)
    : range(stateRange), colors(stateRange.CellCount()) {}

Grid::Grid(GridRange range) : range_(range), cells_(range.CellCount()) {}

bool Grid::RegisterCell(int x, int y, std::unique_ptr<Cell> cell) {
    if (finalized_) {
        throw std::logic_error("button-grid topology is finalized");
    }
    const auto index = range_.IndexOf(x, y);
    if (!index.has_value() || cell == nullptr || cells_[*index] != nullptr) {
        return false;
    }
    cells_[*index] = std::move(cell);
    return true;
}

const GridRange& Grid::Range() const { return range_; }

Cell* Grid::CellAt(int x, int y) {
    const auto index = range_.IndexOf(x, y);
    return index.has_value() ? cells_[*index].get() : nullptr;
}

const Cell* Grid::CellAt(int x, int y) const {
    const auto index = range_.IndexOf(x, y);
    return index.has_value() ? cells_[*index].get() : nullptr;
}

const Cell* Grid::CellAt(std::size_t index) const {
    return index < cells_.size() ? cells_[index].get() : nullptr;
}

void Grid::Finalize() { finalized_ = true; }

GridSlot::GridSlot(GridRange range) : range_(range) {}
const GridRange& GridSlot::Range() const { return range_; }
Grid* GridSlot::SelectedGrid() { return selectedGrid_; }
const Grid* GridSlot::SelectedGrid() const { return selectedGrid_; }

std::optional<std::size_t> GridManager::CreateGrid(GridRange range) {
    if (finalized_) {
        throw std::logic_error("button-grid topology is finalized");
    }
    grids_.push_back(std::make_unique<Grid>(range));
    return grids_.size() - 1;
}

std::optional<std::size_t> GridManager::CreateSlot(GridRange range) {
    if (finalized_) {
        throw std::logic_error("button-grid topology is finalized");
    }
    slots_.push_back(std::make_unique<GridSlot>(range));
    return slots_.size() - 1;
}

Grid* GridManager::GridAt(std::size_t index) {
    return index < grids_.size() ? grids_[index].get() : nullptr;
}

const Grid* GridManager::GridAt(std::size_t index) const {
    return index < grids_.size() ? grids_[index].get() : nullptr;
}

GridSlot* GridManager::SlotAt(std::size_t index) {
    return index < slots_.size() ? slots_[index].get() : nullptr;
}

const GridSlot* GridManager::SlotAt(std::size_t index) const {
    return index < slots_.size() ? slots_[index].get() : nullptr;
}

bool GridManager::SelectGridForSlot(std::size_t slotIx, std::size_t gridIx) {
    GridSlot* const slot = SlotAt(slotIx);
    Grid* const grid = GridAt(gridIx);
    if (slot == nullptr || grid == nullptr || slot->Range() != grid->Range()) {
        return false;
    }
    slot->selectedGrid_ = grid;
    return true;
}

void GridManager::HandlePress(std::size_t slotIx, int x, int y, std::uint8_t velocity) {
    GridSlot* const slot = SlotAt(slotIx);
    Cell* const cell = slot != nullptr && slot->SelectedGrid() != nullptr
                           ? slot->SelectedGrid()->CellAt(x, y)
                           : nullptr;
    if (cell != nullptr) {
        cell->OnPress(velocity);
    }
}

void GridManager::HandleRelease(std::size_t slotIx, int x, int y) {
    GridSlot* const slot = SlotAt(slotIx);
    Cell* const cell = slot != nullptr && slot->SelectedGrid() != nullptr
                           ? slot->SelectedGrid()->CellAt(x, y)
                           : nullptr;
    if (cell != nullptr) {
        cell->OnRelease();
    }
}

void GridManager::HandlePressureChange(std::size_t slotIx, int x, int y,
                                       std::uint8_t pressure) {
    GridSlot* const slot = SlotAt(slotIx);
    Cell* const cell = slot != nullptr && slot->SelectedGrid() != nullptr
                           ? slot->SelectedGrid()->CellAt(x, y)
                           : nullptr;
    if (cell != nullptr) {
        cell->OnPressureChange(pressure);
    }
}

std::unique_ptr<GridManager::UIState> GridManager::CreateUIState() {
    if (finalized_) {
        throw std::logic_error("button-grid topology is already finalized");
    }

    std::vector<std::unique_ptr<Grid::UIState>> slotStates;
    slotStates.reserve(slots_.size());
    for (const auto& slot : slots_) {
        slotStates.push_back(std::make_unique<Grid::UIState>(slot->Range()));
    }

    for (const auto& grid : grids_) {
        grid->Finalize();
    }
    finalized_ = true;
    return std::unique_ptr<UIState>(new UIState(std::move(slotStates)));
}

void GridManager::PopulateUIState(UIState& state) const {
    if (!finalized_) {
        throw std::logic_error("button-grid topology is not finalized");
    }
    if (state.slots.size() != slots_.size()) {
        throw std::logic_error("button-grid UI state does not match manager topology");
    }

    for (std::size_t slotIx = 0; slotIx < slots_.size(); ++slotIx) {
        const GridSlot& slot = *slots_[slotIx];
        Grid::UIState& slotState = *state.slots[slotIx];
        if (slotState.range != slot.Range() || slotState.colors.size() != slot.Range().CellCount()) {
            throw std::logic_error("button-grid UI slot does not match manager topology");
        }

        const Grid* const grid = slot.SelectedGrid();
        for (std::size_t cellIx = 0; cellIx < slotState.colors.size(); ++cellIx) {
            Color published = Color::Off;
            published.a = 0;
            const Cell* const cell = grid != nullptr ? grid->CellAt(cellIx) : nullptr;
            if (cell != nullptr) {
                published = cell->GetColor();
                published.a = cell->GetOnOff() ? 1 : 0;
            }
            slotState.colors[cellIx].Store(published);
        }
    }
}

bool GridManager::Finalized() const { return finalized_; }

}  // namespace synth
