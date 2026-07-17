#include "synth/ButtonGrid.hpp"

#ifdef JUCE_MAJOR_VERSION
#error "synth core tests must not see JUCE headers"
#endif

#include <climits>
#include <cstddef>
#include <cstdint>
#include <exception>
#include <iostream>
#include <memory>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <vector>

namespace {

struct TestCase {
    const char* name;
    void (*fn)();
};

std::vector<TestCase>& Registry() {
    static std::vector<TestCase> tests;
    return tests;
}

struct Register {
    Register(const char* name, void (*fn)()) {
        Registry().push_back({name, fn});
    }
};

#define TEST_CASE(name) \
    void name(); \
    Register reg_##name(#name, &name); \
    void name()

#define REQUIRE_TRUE(expr) \
    do { \
        if (!(expr)) { \
            std::ostringstream oss; \
            oss << __FILE__ << ":" << __LINE__ << " requirement failed: " #expr; \
            throw std::runtime_error(oss.str()); \
        } \
    } while (false)

struct RecordingCell final : synth::Cell {
    void OnPress(std::uint8_t velocity) override {
        ++presses;
        lastVelocity = velocity;
    }

    synth::Color GetColor() const override { return synth::Color::Off; }
    bool GetOnOff() const override { return false; }

    int presses = 0;
    std::uint8_t lastVelocity = 0;
};

struct FullRecordingCell final : synth::Cell {
    void OnPress(std::uint8_t velocity) override {
        events.push_back('p');
        lastValue = velocity;
    }
    void OnRelease() override { events.push_back('r'); }
    void OnPressureChange(std::uint8_t pressure) override {
        events.push_back('a');
        lastValue = pressure;
    }

    synth::Color GetColor() const override { return color; }
    bool GetOnOff() const override { return on; }

    std::vector<char> events;
    std::uint8_t lastValue = 0;
    synth::Color color = synth::Color::Rgb(10, 20, 30);
    bool on = false;
};

template<class Exception, class Function>
void RequireThrows(Function&& function) {
    bool threw = false;
    try {
        function();
    } catch (const Exception&) {
        threw = true;
    }
    REQUIRE_TRUE(threw);
}

TEST_CASE(grid_range_is_checked_signed_half_open_and_row_major) {
    const auto range = synth::GridRange::Create(0, 8, -1, 7);
    REQUIRE_TRUE(range.has_value());
    REQUIRE_TRUE(range->Width() == 8);
    REQUIRE_TRUE(range->Height() == 8);
    REQUIRE_TRUE(range->CellCount() == 64);
    REQUIRE_TRUE(range->Contains(0, -1));
    REQUIRE_TRUE(range->Contains(7, 6));
    REQUIRE_TRUE(!range->Contains(8, 6));
    REQUIRE_TRUE(!range->Contains(7, 7));
    REQUIRE_TRUE(range->IndexOf(0, -1) == std::optional<std::size_t>(0));
    REQUIRE_TRUE(range->IndexOf(7, -1) == std::optional<std::size_t>(7));
    REQUIRE_TRUE(range->IndexOf(0, 0) == std::optional<std::size_t>(8));
    REQUIRE_TRUE(!synth::GridRange::Create(0, 0, 0, 1).has_value());
    REQUIRE_TRUE(!synth::GridRange::Create(0, 1, 4, 4).has_value());
    REQUIRE_TRUE(!synth::GridRange::Create(INT_MIN, INT_MAX, INT_MIN, INT_MAX).has_value());
}

TEST_CASE(equal_range_slots_keep_selection_and_routing_independent) {
    synth::GridManager manager;
    const auto range = synth::GridRange::Create(0, 8, -1, 7);
    REQUIRE_TRUE(range.has_value());

    const auto grid0 = manager.CreateGrid(*range);
    const auto grid1 = manager.CreateGrid(*range);
    const auto slot0 = manager.CreateSlot(*range);
    const auto slot1 = manager.CreateSlot(*range);
    REQUIRE_TRUE(grid0 == std::optional<std::size_t>(0));
    REQUIRE_TRUE(grid1 == std::optional<std::size_t>(1));
    REQUIRE_TRUE(slot0 == std::optional<std::size_t>(0));
    REQUIRE_TRUE(slot1 == std::optional<std::size_t>(1));

    auto first = std::make_unique<RecordingCell>();
    auto second = std::make_unique<RecordingCell>();
    RecordingCell* const firstObserved = first.get();
    RecordingCell* const secondObserved = second.get();
    REQUIRE_TRUE(manager.GridAt(*grid0)->RegisterCell(2, -1, std::move(first)));
    REQUIRE_TRUE(manager.GridAt(*grid1)->RegisterCell(2, -1, std::move(second)));
    REQUIRE_TRUE(manager.SelectGridForSlot(*slot0, *grid0));
    REQUIRE_TRUE(manager.SelectGridForSlot(*slot1, *grid1));

    manager.HandlePress(*slot0, 2, -1, 101);
    REQUIRE_TRUE(firstObserved->presses == 1);
    REQUIRE_TRUE(firstObserved->lastVelocity == 101);
    REQUIRE_TRUE(secondObserved->presses == 0);

    manager.HandlePress(*slot1, 2, -1, 77);
    REQUIRE_TRUE(firstObserved->presses == 1);
    REQUIRE_TRUE(secondObserved->presses == 1);
    REQUIRE_TRUE(secondObserved->lastVelocity == 77);
}

TEST_CASE(grid_routing_calls_each_callback_and_ignores_invalid_targets) {
    synth::GridManager manager;
    const auto range = synth::GridRange::Create(-2, 1, -1, 1);
    const auto incompatibleRange = synth::GridRange::Create(-2, 2, -1, 1);
    REQUIRE_TRUE(range.has_value());
    REQUIRE_TRUE(incompatibleRange.has_value());
    const auto grid = manager.CreateGrid(*range);
    const auto incompatibleGrid = manager.CreateGrid(*incompatibleRange);
    const auto slot = manager.CreateSlot(*range);

    auto cell = std::make_unique<FullRecordingCell>();
    FullRecordingCell* const observed = cell.get();
    REQUIRE_TRUE(manager.GridAt(*grid)->RegisterCell(-2, -1, std::move(cell)));
    REQUIRE_TRUE(!manager.GridAt(*grid)->RegisterCell(-2, -1, std::make_unique<FullRecordingCell>()));
    REQUIRE_TRUE(!manager.GridAt(*grid)->RegisterCell(1, -1, std::make_unique<FullRecordingCell>()));
    REQUIRE_TRUE(!manager.SelectGridForSlot(*slot, *incompatibleGrid));
    REQUIRE_TRUE(manager.SlotAt(*slot)->SelectedGrid() == nullptr);
    REQUIRE_TRUE(manager.SelectGridForSlot(*slot, *grid));

    manager.HandlePress(*slot, -2, -1, 100);
    manager.HandlePressureChange(*slot, -2, -1, 64);
    manager.HandleRelease(*slot, -2, -1);
    REQUIRE_TRUE(observed->events == std::vector<char>({'p', 'a', 'r'}));
    REQUIRE_TRUE(observed->lastValue == 64);

    manager.HandlePress(*slot, -1, -1, 99);
    manager.HandlePress(*slot, 1, -1, 99);
    manager.HandlePress(99, -2, -1, 99);
    REQUIRE_TRUE(observed->events == std::vector<char>({'p', 'a', 'r'}));
    REQUIRE_TRUE(!manager.SelectGridForSlot(99, *grid));
    REQUIRE_TRUE(!manager.SelectGridForSlot(*slot, 99));
    REQUIRE_TRUE(manager.SlotAt(*slot)->SelectedGrid() == manager.GridAt(*grid));
}

TEST_CASE(state_cell_modes_follow_toggle_momentary_set_only_and_show_only_contracts) {
    using Cell = synth::StateCell<int>;
    const synth::Color off = synth::Color::Rgb(1, 2, 3);
    const synth::Color on = synth::Color::Rgb(4, 5, 6);

    int toggleState = 0;
    Cell toggle(off, on, &toggleState, 7, 0, Cell::Mode::Toggle);
    REQUIRE_TRUE(toggle.GetColor() == off);
    REQUIRE_TRUE(!toggle.GetOnOff());
    toggle.OnPress(100);
    REQUIRE_TRUE(toggleState == 7);
    REQUIRE_TRUE(toggle.GetColor() == on);
    REQUIRE_TRUE(toggle.GetOnOff());
    toggle.OnRelease();
    REQUIRE_TRUE(toggleState == 7);
    toggle.OnPressureChange(12);
    REQUIRE_TRUE(toggleState == 7);
    toggle.OnPress(1);
    REQUIRE_TRUE(toggleState == 0);

    int momentaryState = 0;
    Cell momentary(off, on, &momentaryState, 7, 0, Cell::Mode::Momentary);
    momentary.OnPress(1);
    REQUIRE_TRUE(momentaryState == 7);
    momentary.OnRelease();
    REQUIRE_TRUE(momentaryState == 0);

    int setOnlyState = 0;
    Cell setOnly(off, on, &setOnlyState, 7, 0, Cell::Mode::SetOnly);
    setOnly.OnPress(1);
    setOnly.OnRelease();
    REQUIRE_TRUE(setOnlyState == 7);

    int showOnlyState = 0;
    Cell showOnly(off, on, &showOnlyState, 7, 0, Cell::Mode::ShowOnly);
    showOnly.OnPress(1);
    showOnly.OnPressureChange(127);
    showOnly.OnRelease();
    REQUIRE_TRUE(showOnlyState == 0);
}

TEST_CASE(state_cell_flash_policies_choose_palette_without_changing_on_off) {
    const synth::Color off = synth::Color::Rgb(1, 2, 3);
    const synth::Color on = synth::Color::Rgb(4, 5, 6);
    const synth::Color flashingOff = synth::Color::Rgb(7, 8, 9);
    const synth::Color flashingOn = synth::Color::Rgb(10, 11, 12);

    bool state = true;
    bool flashing = false;
    using BoolCell = synth::StateCell<bool, synth::BoolFlash>;
    BoolCell boolCell(off, on, flashingOff, flashingOn, &state, synth::BoolFlash(&flashing), true,
                      false, BoolCell::Mode::ShowOnly);
    REQUIRE_TRUE(boolCell.GetColor() == on);
    REQUIRE_TRUE(boolCell.GetOnOff());
    flashing = true;
    REQUIRE_TRUE(boolCell.GetColor() == flashingOn);
    REQUIRE_TRUE(boolCell.GetOnOff());
    state = false;
    REQUIRE_TRUE(boolCell.GetColor() == flashingOff);
    REQUIRE_TRUE(!boolCell.GetOnOff());

    int displayedState = 3;
    int flashingState = 9;
    using EqualityCell = synth::StateCell<int, synth::Flash<int>>;
    EqualityCell equalityCell(off, on, flashingOff, flashingOn, &displayedState,
                              synth::Flash<int>(&flashingState, 9), 3, 0,
                              EqualityCell::Mode::ShowOnly);
    REQUIRE_TRUE(equalityCell.GetColor() == flashingOn);
    REQUIRE_TRUE(equalityCell.GetOnOff());
    flashingState = 8;
    REQUIRE_TRUE(equalityCell.GetColor() == on);
    REQUIRE_TRUE(equalityCell.GetOnOff());
}

TEST_CASE(state_cell_observes_but_does_not_own_stack_state) {
    int state = 0;
    bool flashing = false;
    {
        using Cell = synth::StateCell<int, synth::BoolFlash>;
        Cell cell(synth::Color::Off, synth::Color::White, synth::Color::Grey, synth::Color::Red,
                  &state, synth::BoolFlash(&flashing), 1, 0, Cell::Mode::Toggle);
        cell.OnPress(1);
        REQUIRE_TRUE(state == 1);
    }
    state = 4;
    flashing = true;
    REQUIRE_TRUE(state == 4);
    REQUIRE_TRUE(flashing);
}

TEST_CASE(ui_publication_packs_on_off_and_clears_empty_disconnected_and_stale_cells) {
    synth::GridManager manager;
    const auto range = synth::GridRange::Create(-1, 1, 2, 3);
    REQUIRE_TRUE(range.has_value());
    const auto populatedGrid = manager.CreateGrid(*range);
    const auto emptyGrid = manager.CreateGrid(*range);
    const auto connectedSlot = manager.CreateSlot(*range);
    const auto disconnectedSlot = manager.CreateSlot(*range);
    REQUIRE_TRUE(disconnectedSlot == std::optional<std::size_t>(1));

    auto onCell = std::make_unique<FullRecordingCell>();
    onCell->on = true;
    auto offCell = std::make_unique<FullRecordingCell>();
    offCell->on = false;
    REQUIRE_TRUE(manager.GridAt(*populatedGrid)->RegisterCell(-1, 2, std::move(onCell)));
    REQUIRE_TRUE(manager.GridAt(*populatedGrid)->RegisterCell(0, 2, std::move(offCell)));
    REQUIRE_TRUE(manager.SelectGridForSlot(*connectedSlot, *populatedGrid));

    auto ui = manager.CreateUIState();
    REQUIRE_TRUE(manager.Finalized());
    REQUIRE_TRUE(ui->slots.size() == 2);
    REQUIRE_TRUE(ui->slots[0]->range == *range);
    REQUIRE_TRUE(ui->slots[0]->colors.size() == 2);
    manager.PopulateUIState(*ui);
    REQUIRE_TRUE(ui->slots[0]->colors[0].Load() == synth::Color::Rgba(10, 20, 30, 1));
    REQUIRE_TRUE(ui->slots[0]->colors[1].Load() == synth::Color::Rgba(10, 20, 30, 0));
    REQUIRE_TRUE(ui->slots[1]->colors[0].Load() == synth::Color::Rgba(0, 0, 0, 0));
    REQUIRE_TRUE(ui->slots[1]->colors[1].Load() == synth::Color::Rgba(0, 0, 0, 0));

    REQUIRE_TRUE(manager.SelectGridForSlot(*connectedSlot, *emptyGrid));
    manager.PopulateUIState(*ui);
    REQUIRE_TRUE(ui->slots[0]->colors[0].Load() == synth::Color::Rgba(0, 0, 0, 0));
    REQUIRE_TRUE(ui->slots[0]->colors[1].Load() == synth::Color::Rgba(0, 0, 0, 0));
}

TEST_CASE(finalization_rejects_late_topology_and_runtime_operations_keep_storage_stable) {
    synth::GridManager manager;
    const auto range = synth::GridRange::Create(-3, -1, 4, 5);
    REQUIRE_TRUE(range.has_value());
    const auto firstGrid = manager.CreateGrid(*range);
    const auto firstSlot = manager.CreateSlot(*range);
    synth::Grid* const stableGrid = manager.GridAt(*firstGrid);
    synth::GridSlot* const stableSlot = manager.SlotAt(*firstSlot);

    for (int ix = 0; ix < 32; ++ix) {
        REQUIRE_TRUE(manager.CreateGrid(*range).has_value());
        REQUIRE_TRUE(manager.CreateSlot(*range).has_value());
    }
    REQUIRE_TRUE(manager.GridAt(*firstGrid) == stableGrid);
    REQUIRE_TRUE(manager.SlotAt(*firstSlot) == stableSlot);

    auto cell = std::make_unique<FullRecordingCell>();
    FullRecordingCell* const observed = cell.get();
    REQUIRE_TRUE(stableGrid->RegisterCell(-3, 4, std::move(cell)));
    REQUIRE_TRUE(manager.SelectGridForSlot(*firstSlot, *firstGrid));
    auto ui = manager.CreateUIState();

    const std::size_t slotCapacity = ui->slots.capacity();
    const auto* const slotStorage = ui->slots.data();
    const std::size_t colorCapacity = ui->slots[*firstSlot]->colors.capacity();
    const auto* const colorStorage = ui->slots[*firstSlot]->colors.data();

    RequireThrows<std::logic_error>([&] { manager.CreateGrid(*range); });
    RequireThrows<std::logic_error>([&] { manager.CreateSlot(*range); });
    RequireThrows<std::logic_error>([&] {
        stableGrid->RegisterCell(-2, 4, std::make_unique<FullRecordingCell>());
    });
    REQUIRE_TRUE(manager.GridAt(*firstGrid) == stableGrid);
    REQUIRE_TRUE(manager.SlotAt(*firstSlot) == stableSlot);

    manager.HandlePress(*firstSlot, -3, 4, 123);
    manager.HandlePressureChange(*firstSlot, -3, 4, 45);
    manager.HandleRelease(*firstSlot, -3, 4);
    manager.PopulateUIState(*ui);
    REQUIRE_TRUE(observed->events == std::vector<char>({'p', 'a', 'r'}));
    REQUIRE_TRUE(ui->slots.capacity() == slotCapacity);
    REQUIRE_TRUE(ui->slots.data() == slotStorage);
    REQUIRE_TRUE(ui->slots[*firstSlot]->colors.capacity() == colorCapacity);
    REQUIRE_TRUE(ui->slots[*firstSlot]->colors.data() == colorStorage);
}

}  // namespace

int main() {
    int failed = 0;
    for (const auto& test : Registry()) {
        try {
            test.fn();
            std::cout << "[PASS] " << test.name << "\n";
        } catch (const std::exception& ex) {
            ++failed;
            std::cerr << "[FAIL] " << test.name << ": " << ex.what() << "\n";
        }
    }
    return failed == 0 ? 0 : 1;
}
