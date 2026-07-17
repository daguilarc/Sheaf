# Runtime Button Grids Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add runtime-owned, dynamically sized button grids with cell state, ordered input routing, polyphonic-pressure controller mappings, feedback snapshots, and Controllers-page grid button/block editing without exposing grids to synth applications.

**Architecture:** A new JUCE-free `ButtonGrid` module owns signed half-open grid topology and immutable-topology atomic UI snapshots. `MessageInBus` routes parameter and grid commands to separate managers, while an internal `RuntimeUIState` facade lets MIDI output read parameter and grid snapshots without exposing grid state through `AppContext`. Existing system-message associations continue to own press/release/feedback; a new profile-level polyphonic-pressure list is derived and hidden by the Controllers model.

**Tech Stack:** C++20, the existing JUCE-free synth static library and test harness, existing portable/JUCE Controllers UI, Make, OpenSpec.

## Global Constraints

- Grid and parameter bank/slot indices are distinct number spaces even when their numeric values match.
- Every grid range is signed and half-open: `[xmin, xmax) x [ymin, ymax)`; maxima are always exclusive and negative coordinates are valid.
- Grid and slot selection requires exact range equality; a failed selection leaves the prior selection unchanged.
- Grid/cell/UI storage is dynamically sized, but every framework allocation occurs before finalization; selection, routing, cell reads, and UI publication allocate nothing afterward.
- Cell callbacks and state queries run on the control/audio path and must be nonblocking and allocation-free.
- Grid UI snapshots preserve RGB and force `Color::a` to exactly `0` or `1`; disconnected and empty cells must explicitly publish `(off.r, off.g, off.b, 0)`, not `Color::Off`'s default alpha.
- One bounded SPSC `MessageInBus` preserves timestamp/FIFO behavior while routing parameter messages only to `ParameterManager` and grid messages only to `GridManager`.
- Polyphonic pressure recognizes status `0xA0`; matched messages use the shared timestamp source and incoming pressure byte, while unmatched and non-pressure messages pass to thru exactly once.
- The controller-profile reader accepts schema version 1 without pressure data; the writer emits schema version 2. Instrument/runtime envelopes and patch persistence do not change schema.
- Grid mappings are always momentary press/release pairs. Controllers exposes only Grid Button/Grid Block concepts, never toggle or aftertouch controls, and preserves orphan pressure entries invisibly and losslessly.
- Existing MIDI output wire bytes, caches, reset behavior, budgets, parameter behavior, and application-visible `ParameterManager::UIState` access remain unchanged.
- No application creates, exposes, or renders a grid in this change.

---

### Task 1: JUCE-free button-grid core and StateCell

**OpenSpec coverage:** 1.1-1.5.

**Files:**
- Create: `projects/synth/include/synth/AtomicColor.hpp`
- Create: `projects/synth/include/synth/ButtonGrid.hpp`
- Create: `projects/synth/src/ButtonGrid.cpp`
- Create: `projects/synth/tests/button_grid_tests.cpp`
- Modify: `projects/synth/include/synth/ParameterModulation.hpp`
- Modify: `projects/synth/Makefile`
- Modify: `projects/synth/runtime/juce_build.mk`
- Modify: `projects/synth/browser/Makefile`

**Interfaces:**
- Produces: `GridRange`, `Cell`, `NoFlash`, `BoolFlash`, `Flash<State>`, `StateCell<State, FlashPolicy>`, `Grid`, `GridSlot`, and `GridManager`.
- Produces: `GridManager::CreateUIState()` as the topology-freezing boundary and `GridManager::PopulateUIState(UIState&)` as an allocation-free publisher.
- Preserves: the existing `AtomicColor` API by moving it byte-for-byte into a focused header shared by parameter and grid snapshots.

- [ ] **Step 1: Add the grid test target and write the failing topology tests**

Add `BUTTON_GRID_TEST_BIN := $(BUILD_DIR)/button_grid_tests`, add `src/ButtonGrid.cpp`/`build/ButtonGrid.o` to `SRC`/`OBJ`, add an explicit compile rule, and include the new binary in `test`. Add `ButtonGrid.cpp` and the new headers to the shared JUCE `SYNTH_SRC`/`SYNTH_HEADERS` lists and the browser `CORE_SOURCES` list so all existing runtime surfaces link the same core. In `button_grid_tests.cpp`, use the repository's local `TEST_CASE`/`REQUIRE_*` style to assert:

```cpp
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
```

Also create two equal-range slots and prove selecting/routing one does not affect the other.

- [ ] **Step 2: Run the new target to verify the RED state**

Run: `make -C projects/synth build/button_grid_tests`

Expected: compilation fails because `synth/ButtonGrid.hpp` and its interfaces do not exist.

- [ ] **Step 3: Implement range, topology, routing, and freeze contracts**

Implement these public shapes in `ButtonGrid.hpp`; definitions that are not templates belong in `ButtonGrid.cpp`:

```cpp
class GridRange {
public:
    static std::optional<GridRange> Create(int xmin, int xmax, int ymin, int ymax);
    int XMin() const; int XMax() const; int YMin() const; int YMax() const;
    std::size_t Width() const; std::size_t Height() const; std::size_t CellCount() const;
    bool Contains(int x, int y) const;
    std::optional<std::size_t> IndexOf(int x, int y) const;
    bool operator==(const GridRange&) const = default;
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

class Grid {
public:
    explicit Grid(GridRange range);
    bool RegisterCell(int x, int y, std::unique_ptr<Cell> cell);
    const GridRange& Range() const;
};

class GridManager {
public:
    struct UIState;
    std::optional<std::size_t> CreateGrid(GridRange range);
    std::optional<std::size_t> CreateSlot(GridRange range);
    Grid* GridAt(std::size_t); const Grid* GridAt(std::size_t) const;
    GridSlot* SlotAt(std::size_t); const GridSlot* SlotAt(std::size_t) const;
    bool SelectGridForSlot(std::size_t slotIx, std::size_t gridIx);
    void HandlePress(std::size_t slotIx, int x, int y, std::uint8_t velocity);
    void HandleRelease(std::size_t slotIx, int x, int y);
    void HandlePressureChange(std::size_t slotIx, int x, int y, std::uint8_t pressure);
    std::unique_ptr<UIState> CreateUIState();
    void PopulateUIState(UIState&) const;
    bool Finalized() const;
};
```

Use checked subtraction/multiplication before converting to `size_t`. Store cells in one dense `std::vector<std::unique_ptr<Cell>>`, slots/grids behind `unique_ptr` so object addresses remain stable, and selected grids as non-owning pointers or stable indices. Topology mutations after `CreateUIState()` must throw `std::logic_error` before changing state; invalid external selection/routing returns false or no-ops. `PopulateUIState` must construct a fresh packed color for every coordinate and always overwrite `a`, including disconnected and empty paths.

- [ ] **Step 4: Add StateCell RED tests, then port the useful SmartGrid behavior**

Test every mode and flash policy using non-owned stack state. Implement:

```cpp
struct NoFlash { bool IsFlashing() const { return false; } };
class BoolFlash {
public:
    explicit BoolFlash(const bool* value) : value_(value) {}
    bool IsFlashing() const { return *value_; }
private: const bool* value_;
};
template<class State> class Flash {
public:
    Flash(const State* value, State flashingValue)
        : value_(value), flashingValue_(std::move(flashingValue)) {}
    bool IsFlashing() const { return *value_ == flashingValue_; }
private: const State* value_; State flashingValue_;
};
```

`StateCell<State, FlashPolicy>` stores a non-owning `State*`, `onState`, `offState`, normal and flashing on/off colors, a policy by value, and `Mode { Toggle, Momentary, SetOnly, ShowOnly }`. `GetOnOff()` is exactly `*state == onState`; `GetColor()` consults flash only for palette selection; pressure stays the base no-op.

- [ ] **Step 5: Prove packed publication and post-finalization stability**

Add tests for `(10,20,30,1)`, `(10,20,30,0)`, explicit alpha-zero empty/disconnected publication, stale clearing after a compatible switch, negative-coordinate lookup, rejected late mutation, stable `Grid*`/`GridSlot*` addresses, and unchanged vector capacities/storage addresses across selection/routing/publication. Use the established capacity/pointer-stability pattern rather than inventing global allocation interception.

- [ ] **Step 6: Run focused tests and commit**

Run: `make -C projects/synth build/button_grid_tests build/parameter_modulation_tests && projects/synth/build/button_grid_tests && projects/synth/build/parameter_modulation_tests`

Expected: both binaries exit 0 with pristine output.

Commit: `git add projects/synth/include/synth/AtomicColor.hpp projects/synth/include/synth/ButtonGrid.hpp projects/synth/include/synth/ParameterModulation.hpp projects/synth/src/ButtonGrid.cpp projects/synth/tests/button_grid_tests.cpp projects/synth/Makefile projects/synth/runtime/juce_build.mk projects/synth/browser/Makefile && git commit -m "feat(synth): add runtime button grid core"`

### Task 2: Grid MessageIn variants and shared-bus routing

**OpenSpec coverage:** 2.1-2.4.

**Files:**
- Modify: `projects/synth/include/synth/ParameterModulation.hpp`
- Modify: `projects/synth/src/ParameterModulation.cpp`
- Modify: `projects/synth/include/synth/MidiController.hpp`
- Modify: `projects/synth/src/MidiController.cpp`
- Modify: `projects/synth/include/synth/MidiConfigBlocks.hpp`
- Modify: `projects/synth/src/MidiConfigBlocks.cpp`
- Modify: `projects/synth/src/MidiConfigViewModel.cpp`
- Modify: `projects/synth/tests/parameter_modulation_tests.cpp`
- Modify: `projects/synth/tests/instrument_tests.cpp`
- Modify: `projects/synth/tests/blocks_tests.cpp`
- Modify: `projects/synth/tests/viewmodel_tests.cpp`

**Interfaces:**
- Consumes: Task 1 `GridManager` routing methods.
- Produces: `MessageIn::GridPress`, `GridRelease`, `GridPressureChange`, and `SelectGrid`; a new grid-manager setter on the existing source-compatible `MessageInBus(ParameterManager*, capacity)`.

- [ ] **Step 1: Write failing construction, JSON, and semantic-field tests**

Add all four enum cases and tests that require these exact factories and fields:

```cpp
auto press = MessageIn::GridPress(11, 1, -1, 7, 100);
auto release = MessageIn::GridRelease(12, 1, -1, 7);
auto pressure = MessageIn::GridPressureChange(13, 1, -1, 7, 64);
auto select = MessageIn::SelectGrid(14, 2, 5);
```

The message carries `gridSlotIx`, `gridIx`, signed `gridX/gridY`, and `std::uint8_t velocity`; pressure uses the same byte storage but JSON/type descriptions call it pressure where appropriate. Round-trip all fields and reject negative/out-of-range JSON velocity values rather than truncating.

- [ ] **Step 2: Run focused tests to verify RED**

Run: `make -C projects/synth build/parameter_modulation_tests build/instrument_tests`

Expected: compilation fails on missing grid factories/types.

- [ ] **Step 3: Extend factories, exhaustive switches, JSON, descriptions, equality, and sort semantics**

Append new enum values so every existing numeric declaration order remains stable. Update every `switch (MessageIn::Type)` found by `rg`, including `MessageInTypeName`, JSON read/write, view-model descriptions, output evaluation defaults, test oracles, and `SystemMessageSortKey`. JSON keys are `gridSlot`, `grid`, `x`, `y`, and `velocity`; release omits velocity and event messages omit grid. Preserve every existing JSON representation byte-for-byte.

- [ ] **Step 4: Extend one queue to dispatch both manager families**

Keep the current positional-capacity constructor exactly intact, so existing calls such as `MessageInBus(&manager, 16)` and the zero-capacity edge `MessageInBus(&manager, 0)` remain unambiguous and source-compatible. Add only explicit manager setters:

```cpp
explicit MessageInBus(ParameterManager* parameters = nullptr,
                      std::size_t capacity = 16384);
void SetParameterManager(ParameterManager* manager);
void SetGridManager(GridManager* manager);
void SetManager(ParameterManager* manager); // existing compatibility alias
```

The constructor continues to bind only the parameter manager. Engine construction and new dual-manager tests call `SetGridManager` before any producer can push. `Apply` must send only parameter cases to `ParameterManager`, only grid cases to `GridManager`, and keep missing managers/invalid external targets nonthrowing. Add interleaved timestamp/FIFO tests and equal numeric parameter/grid slot namespace isolation.

- [ ] **Step 5: Extend the deterministic message oracle and invalid-input matrix**

Update the seeded state-machine oracle in `parameter_modulation_tests.cpp` so grid selections and three cell events are generated alongside parameter messages. Compare callback logs and selected-grid indices, include missing managers/slots/grids and signed out-of-range coordinates, and retain the bounded queue's existing timestamp visibility rules.

- [ ] **Step 6: Run focused tests and commit**

Run: `make -C projects/synth build/button_grid_tests build/parameter_modulation_tests build/instrument_tests build/blocks_tests build/viewmodel_tests && projects/synth/build/button_grid_tests && projects/synth/build/parameter_modulation_tests && projects/synth/build/instrument_tests && projects/synth/build/blocks_tests && projects/synth/build/viewmodel_tests`

Expected: all binaries exit 0.

Commit: `git add projects/synth/include/synth/ParameterModulation.hpp projects/synth/src/ParameterModulation.cpp projects/synth/include/synth/MidiController.hpp projects/synth/src/MidiController.cpp projects/synth/include/synth/MidiConfigBlocks.hpp projects/synth/src/MidiConfigBlocks.cpp projects/synth/src/MidiConfigViewModel.cpp projects/synth/tests/parameter_modulation_tests.cpp projects/synth/tests/instrument_tests.cpp projects/synth/tests/blocks_tests.cpp projects/synth/tests/viewmodel_tests.cpp && git commit -m "feat(synth): route button grid messages"`

### Task 3: Runtime ownership, global UI facade, and grid feedback lookup

**OpenSpec coverage:** 3.1-3.3 and 5.1-5.3.

**Files:**
- Create: `projects/synth/include/synth/RuntimeUIState.hpp`
- Modify: `projects/synth/include/synth/Engine.hpp`
- Modify: `projects/synth/include/synth/MidiController.hpp`
- Modify: `projects/synth/src/MidiController.cpp`
- Modify: `projects/synth/tests/engine_tests.cpp`
- Modify: `projects/synth/tests/instrument_tests.cpp`
- Modify: `projects/synth/tests/rig_tests.cpp`
- Modify: `projects/synth/tests/miniapp_system_tests.cpp`
- Modify: `projects/synth/Makefile`

**Interfaces:**
- Consumes: Task 1 grid manager/UI state and Task 2 dual-manager buses.
- Produces: internal `RuntimeUIState { ParameterManager::UIState* parameters; GridManager::UIState* grids; }` passed to MIDI profile/output construction.
- Preserves: `AppContext::uiState` remains a `ParameterManager::UIState*`; no grid pointer is added to `AppContext`.

- [ ] **Step 1: Write failing engine-lifetime and facade tests**

Require exactly one `Engine::GridManagerForTest()` (or an equivalently narrow test accessor), both buses to route grids, `context.uiState` to equal the facade's parameter member, facade/member addresses to remain stable, and grid UI topology to be finalized before the first `CreateMidiControllerProfile`. Add a destruction probe cell proving callbacks stop and cells die after processor shutdown.

- [ ] **Step 2: Add the facade and engine ownership in dependency order**

Implement:

```cpp
struct RuntimeUIState {
    ParameterManager::UIState* parameters = nullptr;
    GridManager::UIState* grids = nullptr;
};
```

Declare `GridManager gridManager_` immediately after `ParameterManager manager_`; both managers therefore outlive the buses that point at them. Keep the existing bus initializer arguments (`uiBus_(&manager_)`, `midiBus_(&manager_)`) and call `uiBus_.SetGridManager(&gridManager_)` plus `midiBus_.SetGridManager(&gridManager_)` in the `Engine` constructor body before publishing either bus through `AppContext`. In the later snapshot/processor member group, use this exact declaration order:

```cpp
std::unique_ptr<ParameterManager::UIState> uiState_;
std::unique_ptr<GridManager::UIState> gridUIState_;
RuntimeUIState runtimeUIState_;
std::vector<MidiControllerProfileResult> midiProcessors_;
```

C++ destroys these in reverse order, so processors that hold `RuntimeUIState*` die first, then the facade, then both owned snapshots; the buses legitimately outlive snapshots because they point only to managers, not UI state. During `Initialize`, after app initialization but before the first MIDI rebuild/audio/UI activity, create the parameter UI state, call `gridManager_.CreateUIState()`, bind both into the stable facade, and keep `context_.uiState` pointing only at the parameter state. On each existing throttled UI publication, populate both snapshots.

- [ ] **Step 3: Convert MIDI constructors to the facade without changing encoder behavior**

Change `CreateMidiControllerProfile` and system-output processor construction to accept `RuntimeUIState*`. Encoder `MidiOutProcessor` still stores only `state->parameters`; `SystemMessageOutputInfo` stores the facade. Update all three concrete system-output constructors—`SystemCcMidiOutProcessor`, `WrldBldrSystemMidiOutProcessor`, and `LaunchpadGridMidiOutProcessor`—and keep direct legacy constructors accepting `ParameterManager::UIState*` where existing tests/API require them, implemented as delegating compatibility overloads rather than duplicated behavior.

- [ ] **Step 4: Add grid feedback evaluation from the snapshot only**

For `GridPress`, `GridRelease`, and `GridPressureChange` feedback messages, validate slot and signed coordinate through immutable `GridManager::UIState` range metadata, atomically load one packed color, return `{Color::Rgb(r,g,b), a != 0}`, and return off/false for every missing/disconnected case. Do not access `GridManager`, `Grid`, or `Cell` from output code.

- [ ] **Step 5: Lock existing output protocols with regression tests**

Add connected on/off/negative/missing grid cases, then run existing WRLD.Bldr, Launchpad, generic/monochrome output cases byte-for-byte. Explicitly cover cache suppression, reset behavior, color budgets, and all non-grid bank/scene/gesture/modifier feedback.

- [ ] **Step 6: Run focused integration tests and commit**

Run: `make -C projects/synth build/engine_tests build/instrument_tests build/rig_tests build/miniapp_system_tests && projects/synth/build/engine_tests && projects/synth/build/instrument_tests && projects/synth/build/rig_tests && projects/synth/build/miniapp_system_tests`

Expected: all binaries exit 0; existing apps still initialize without defining a grid.

Commit: `git add projects/synth/include/synth/RuntimeUIState.hpp projects/synth/include/synth/Engine.hpp projects/synth/include/synth/MidiController.hpp projects/synth/src/MidiController.cpp projects/synth/tests/engine_tests.cpp projects/synth/tests/instrument_tests.cpp projects/synth/tests/rig_tests.cpp projects/synth/tests/miniapp_system_tests.cpp projects/synth/Makefile && git commit -m "feat(synth): own grid runtime UI state"`

### Task 4: Polyphonic-pressure input and backward-readable profile persistence

**OpenSpec coverage:** 4.1-4.5.

**Files:**
- Modify: `projects/synth/include/synth/MidiController.hpp`
- Modify: `projects/synth/src/MidiController.cpp`
- Modify: `projects/synth/include/synth/MidiConfigBlocks.hpp`
- Modify: `projects/synth/src/MidiConfigBlocks.cpp`
- Modify: `projects/synth/tests/instrument_tests.cpp`
- Modify: `projects/synth/tests/blocks_tests.cpp`
- Modify: `projects/synth/tests/rig_tests.cpp`

**Interfaces:**
- Produces: `BasicMidi::PolyPressure`, `IsPolyPressure`, and pressure accessor.
- Produces: `MidiNoteAddress`, `PolyphonicPressureMapping`, `PolyphonicPressureMidiInConfig`, and `PolyphonicPressureMidiInProcessor`.
- Extends: `MidiControllerProfileConfig::pressureInput` and profile schema 1 -> 2.

- [ ] **Step 1: Write BasicMidi and processor RED tests**

Require:

```cpp
auto midi = BasicMidi::PolyPressure(9, 3, 42, 88);
REQUIRE_TRUE(midi.IsPolyPressure());
REQUIRE_TRUE(midi.Channel() == 3);
REQUIRE_TRUE(midi.GetNote() == 42);
REQUIRE_TRUE(midi.GetPressure() == 88);
```

Reject malformed shorter messages and distinguish `0xA0` from channel pressure `0xD0`, note, CC, pitch bend, and realtime statuses. Test exact address matching, duplicate-address config rejection, timestamp/pressure stamping, matched consumption, unmatched/non-pressure thru exactly once, and no-thru behavior.

- [ ] **Step 2: Implement pressure config and processor**

Use these value types:

```cpp
struct MidiNoteAddress {
    std::uint8_t channel = 0;
    std::uint8_t note = 0;
    bool operator==(const MidiNoteAddress&) const = default;
};
struct PolyphonicPressureMapping {
    MidiNoteAddress address;
    MessageIn pressure;
    bool operator==(const PolyphonicPressureMapping&) const = default;
};
struct PolyphonicPressureMidiInConfig {
    std::vector<PolyphonicPressureMapping> mappings;
};
```

`SetConfig` validates unique addresses and that every target is `GridPressureChange`; leave the prior config intact on failure. The processor stamps `NextTimestamp()` and the incoming byte into a copy of the mapped target, pushes it, and consumes only a successfully matched poly-pressure message.

- [ ] **Step 3: Insert pressure into the existing profile thru chain**

Add `std::optional<PolyphonicPressureMidiInConfig> pressureInput` to the profile. Build pressure-only and mixed encoder/analog/system/pressure profiles with one shared bus/timestamp provider. Follow the existing `input` plus owned `inputThru` chain order and prove each incoming message reaches thru no more than once.

- [ ] **Step 4: Implement schema 2 JSON with schema 1 reads**

Introduce `kMidiControllerProfileSchema = "synth.midiControllerProfileConfig"` and `kMidiControllerProfileSchemaVersion = 2` beside the existing MIDI schema constants, then add JSON overloads for note addresses, mappings, and config. `ToJSON(MidiControllerProfileConfig)` writes that schema/version and a pressure field when configured. `FromJSON` accepts versions 1 and 2; version 1 or absent pressure yields an empty optional/list while preserving all existing data. Reject wrong types, out-of-range bytes, duplicate addresses, and non-pressure targets. Nested instrument/runtime round trips must pass without changing their schema constants or patch JSON.

- [ ] **Step 5: Normalize and compare pressure mappings canonically**

Sort pressure mappings by `(target.gridSlotIx, target.gridX, target.gridY, address.channel, address.note)` with a stable final ordering for exact duplicates. Extend profile equality/test helpers and kind validation without changing encoder/analog/system ordering.

- [ ] **Step 6: Run focused persistence/processor tests and commit**

Run: `make -C projects/synth build/instrument_tests build/blocks_tests build/rig_tests && projects/synth/build/instrument_tests && projects/synth/build/blocks_tests && projects/synth/build/rig_tests`

Expected: all binaries exit 0, including explicit version-1 fixtures and version-2 round trips.

Commit: `git add projects/synth/include/synth/MidiController.hpp projects/synth/src/MidiController.cpp projects/synth/include/synth/MidiConfigBlocks.hpp projects/synth/src/MidiConfigBlocks.cpp projects/synth/tests/instrument_tests.cpp projects/synth/tests/blocks_tests.cpp projects/synth/tests/rig_tests.cpp && git commit -m "feat(synth): map polyphonic grid pressure"`

### Task 5: Pure grid-button/block expansion and reconstruction

**OpenSpec coverage:** 6.1-6.3.

**Files:**
- Modify: `projects/synth/include/synth/MidiConfigBlocks.hpp`
- Modify: `projects/synth/src/MidiConfigBlocks.cpp`
- Modify: `projects/synth/tests/blocks_tests.cpp`

**Interfaces:**
- Consumes: Task 4 pressure mappings and existing WRLD.Bldr/Launchpad address conversion helpers.
- Produces: `GridButton`, `GridBlock`, atomic paired expansion, exact-pair reconstruction, and orphan-pressure sidecar results.

- [ ] **Step 1: Write failing singleton/block expansion tests**

Define a `GridButton` with kind, one kind-specific signed physical `(x,y)` address, `gridSlotIx`, and output feedback; it has no second logical-coordinate field because that same `(x,y)` is the grid target. Define `GridBlock` with the one shared physical/logical range `[startX,endX) x [startY,endY)` and a grid slot. Test `[0,8) x [-1,7)` yields exactly 64 system associations and 64 pressure mappings, every physical `(x,y)` is copied directly to the message target, all releases are present, and no toggle field exists.

- [ ] **Step 2: Implement all-or-nothing expansion**

Expose:

```cpp
struct GridMappingExpansion {
    std::vector<MidiControllerSystemMessageAssociation> systemMessages;
    std::vector<PolyphonicPressureMapping> pressureMappings;
};
bool ExpandGridButton(const GridButton&, GridMappingExpansion&, std::string* reason = nullptr);
bool ExpandGridBlock(const GridBlock&, GridMappingExpansion&, std::string* reason = nullptr);
```

Build into scratch vectors, validate the entire rectangle and every derived note/address first, detect duplicate physical addresses and overflow, then append both vectors together. System entries use `GridPress`, `GridRelease`, and `GridPress(..., 0)` feedback; pressure entries use `GridPressureChange(..., 0)` templates. Use exclusive-end traversal with x varying fastest.

- [ ] **Step 3: Write reconstruction RED tests**

Cover exact pair recognition, maximal rectangles, negative/descending physical runs supported by existing kinds, broken-run splitting, duplicate handling, shuffled canonical input, expansion/reconstruction equality, and an orphan pressure mapping that remains byte-for-byte equal after an unrelated expansion.

- [ ] **Step 4: Implement exact pairing and maximal coalescing**

Only hide a pressure mapping when physical address, grid slot, signed coordinates, and message types exactly match one system association's press/release/feedback. Return reconstructed visible rows plus a separate `orphanPressureMappings` vector. Coalesce only uniform adjacent coordinates into maximal rectangles using the same deterministic row-major rule as expansion; single cells stay `GridButton` rows. Never discard or rewrite unmatched/duplicate pressure entries.

- [ ] **Step 5: Run pure-model tests and commit**

Run: `make -C projects/synth build/blocks_tests && projects/synth/build/blocks_tests`

Expected: the binary exits 0 without JUCE headers.

Commit: `git add projects/synth/include/synth/MidiConfigBlocks.hpp projects/synth/src/MidiConfigBlocks.cpp projects/synth/tests/blocks_tests.cpp && git commit -m "feat(synth): model grid mapping blocks"`

### Task 6: Controllers view model, portable tree, and JUCE presentation

**OpenSpec coverage:** 6.4-6.6.

**Files:**
- Modify: `projects/synth/include/synth/MidiConfigViewModel.hpp`
- Modify: `projects/synth/src/MidiConfigViewModel.cpp`
- Modify: `projects/synth/include/synth/ControllersPageUI.hpp`
- Modify: `projects/synth/runtime/ControllersPage.hpp`
- Modify: `projects/synth/juce/ControllersPageJuce.hpp`
- Modify: `projects/synth/tests/viewmodel_tests.cpp`
- Modify: `projects/synth/tests/controllers_page_ui_tests.cpp`
- Modify: `projects/synth/juce/ControllersPageJuceTests.cpp`
- Modify: `projects/synth/juce/ControllersPageSimulationTests.cpp`

**Interfaces:**
- Consumes: Task 5 visible grid rows/blocks plus orphan sidecar.
- Adds: a new `SectionPresentation::hiddenPressureMappings` sidecar so visible grid rows own paired system+pressure data while unmatched pressure entries stay hidden; the current struct has no sidecar precedent.
- Produces: Grid Button/Grid Block fields, labels, add/edit/delete actions, and renderer nodes; produces no aftertouch line item.

- [ ] **Step 1: Write failing view-model session tests**

Open a System Messages section containing exact grid pairs and orphans. Require stable Grid Button/Grid Block row identity through `Rebuild`, add/add-block/edit/delete/reopen, atomic refusal of invalid signed rectangles/duplicates, and preservation of unrelated orphan pressure mappings. Include separate WRLD.Bldr and Launchpad cases.

- [ ] **Step 2: Extend the presentation model and flush path**

Add `RowGroup::Grid`, numeric fields for target grid slot and signed start/end coordinates, and `PresentationRowData`/block alternatives for `GridButton`/`GridBlock`. `SectionPresentation` owns `hiddenPressureMappings`. On open, reconstruct exact pairs and sidecar once; on flush, expand all visible grid rows into scratch system/pressure vectors, append hidden pressure entries unchanged, normalize the profile, validate duplicates/kind support, and commit the full profile atomically. Deleting a visible grid row removes only its derived entries; editing rebuilds the pair together.

- [ ] **Step 3: Add Grid Button/Grid Block actions and labels**

Return Grid as an addable system-section group only for WRLD.Bldr and Launchpad. Add-single creates a valid one-cell mapping; add-block creates a valid two-cell half-open block. Labels and headers use `Grid Button`, `Grid Block`, `Grid Slot`, `X Min`, `X Max`, `Y Min`, and `Y Max`. Do not add pressure/note/status/toggle fields or catalogs.

- [ ] **Step 4: Extend the portable tree and JUCE renderer**

Route the existing generic mapping actions through the new group/fields, preserve stable node IDs and scrolling, and render signed integer editors for bounds/slot. Add structural assertions that a pressure-bearing profile contains Grid Button/Grid Block visible text and contains no `aftertouch`, `polyphonic pressure`, MIDI status, or standalone note field (case-insensitive).

- [ ] **Step 5: Extend deterministic simulations and JUCE harness coverage**

Add a seeded independent oracle that performs at least 250 mixed add/edit/delete/open/close/save/reload operations. After each accepted operation assert one exact pressure mapping per visible grid cell and byte-for-byte equality of hidden orphans. Add negative bounds, invalid atomic commits, mixed legacy system rows, row identity, JSON reload, and scroll reachability to the JUCE simulation/harness.

- [ ] **Step 6: Run headless and JUCE-focused tests and commit**

Run: `make -C projects/synth build/viewmodel_tests build/controllers_page_ui_tests build/blocks_tests && projects/synth/build/viewmodel_tests && projects/synth/build/controllers_page_ui_tests && projects/synth/build/blocks_tests`

Then run: `make -C projects/synth/apps/miniapp test`

Expected: headless binaries and JUCE harness tests exit 0; rendered text never exposes pressure mechanics.

Commit: `git add projects/synth/include/synth/MidiConfigViewModel.hpp projects/synth/src/MidiConfigViewModel.cpp projects/synth/include/synth/ControllersPageUI.hpp projects/synth/runtime/ControllersPage.hpp projects/synth/juce/ControllersPageJuce.hpp projects/synth/tests/viewmodel_tests.cpp projects/synth/tests/controllers_page_ui_tests.cpp projects/synth/juce/ControllersPageJuceTests.cpp projects/synth/juce/ControllersPageSimulationTests.cpp && git commit -m "feat(synth): edit grid mappings in controllers"`

### Task 7: Documentation, full verification, and OpenSpec completion

**OpenSpec coverage:** 7.1-7.4 and every deferred checkbox from Tasks 1-6.

**Files:**
- Modify: `projects/synth/docs/coverage.md`
- Modify: `projects/synth/README.md`
- Modify: `openspec/changes/add-runtime-button-grids/tasks.md`
- Modify only if verification exposes stale wiring: `projects/synth/Makefile`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: traceable capability documentation, complete verification evidence, and checked OpenSpec tasks.

- [ ] **Step 1: Update architecture and coverage documentation**

Document `ButtonGrid`, independent slot namespaces, finalization/realtime contract, `RuntimeUIState`, four grid `MessageIn` variants, profile schema 2 pressure data, exact derived Controllers pairing/orphan preservation, unchanged output protocols, and the explicit non-goal that applications do not expose grids yet. Add test-binary references beside each contract.

- [ ] **Step 2: Run all focused feature suites**

Run every binary touched above plus the Controllers JUCE harness. Expected: all exit 0 with no warnings/noise. Confirm the button-grid allocation test uses capacity/storage-address stability and that output golden-byte assertions are unchanged rather than regenerated.

- [ ] **Step 3: Run the complete synth and boundary checks**

Run: `make -C projects/synth test`

Run: `make -C projects/synth check-ui-boundary`

Run the controllers harness test target and any app build target whose dependency wiring changed. Expected: all exit 0.

- [ ] **Step 4: Audit normative coverage and validate OpenSpec**

For every scenario in the four delta specs, cite at least one test name/file in the task report. Run:

```bash
openspec validate add-runtime-button-grids --type change --strict --no-interactive
openspec status --change add-runtime-button-grids --json
rg -n "T[B]D|T[O]DO|implement la[t]er|fill i[n]" openspec/changes/add-runtime-button-grids docs/superpowers/plans/2026-07-16-add-runtime-button-grids.md
git diff --check
```

Expected: strict validation succeeds, placeholder scan has no matches, and `git diff --check` is silent.

- [ ] **Step 5: Mark OpenSpec tasks complete only from verified evidence and commit**

Change each implemented `- [ ]` to `- [x]` only after its mapped task review and covering tests are recorded. Leave application-level grid exposure documented as out of scope, not incomplete work.

Commit: `git add projects/synth/docs/coverage.md projects/synth/README.md openspec/changes/add-runtime-button-grids/tasks.md projects/synth/Makefile && git commit -m "docs(synth): verify runtime button grids"`
