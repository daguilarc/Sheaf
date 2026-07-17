#pragma once

#include "synth/ButtonGrid.hpp"
#include "synth/ParameterModulation.hpp"

namespace synth {

// Stable runtime-owned facade for immutable-topology UI snapshots. Applications
// continue to receive only ParameterManager::UIState through AppContext.
struct RuntimeUIState {
    ParameterManager::UIState* parameters = nullptr;
    GridManager::UIState* grids = nullptr;
};

}  // namespace synth
