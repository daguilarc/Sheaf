# Controllers UI Harness And Simulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a real JUCE standalone Controllers-page harness and model-based tests so the page can be clicked, measured, randomized, and visually refined against the actual desktop renderer.

**Architecture:** Put reusable synthetic Controllers-page state in one JUCE-owned harness helper, then use it from both tests and a small standalone app. The tests must drive real `ControllersTreeRenderer` components and pump the JUCE message loop for deferred button callbacks. The harness app must render the same renderer, not a browser mock or parallel UI.

**Tech Stack:** C++20, existing synth portable UI tree, existing JUCE backend, `projects/synth/runtime/juce_build.mk`, deterministic `std::mt19937` simulation tests.

---

### Task 1: Shared Controllers Harness Fixture

**Files:**
- Create: `projects/synth/juce/ControllersPageHarness.hpp`
- Modify: `projects/synth/apps/miniapp/Makefile`
- Test: `projects/synth/juce/ControllersPageJuceTests.cpp`

- [ ] **Step 1: Write the failing integration test that clicks real JUCE controls**

Add a test block to `projects/synth/juce/ControllersPageJuceTests.cpp` that constructs the harness fixture, clicks a real `juce::TextButton`, pumps `juce::MessageManager`, and expects the semantic/rendered tree to update after one click:

```cpp
auto* disclosure = dynamic_cast<juce::TextButton*>(
    renderer.FindByNodeId(synth::runtime_ui::NodeIds::ControllerDisclosure(0)));
Require(disclosure != nullptr, "controller disclosure is clickable");
disclosure->onClick();
juce::MessageManager::getInstance()->runDispatchLoopUntil(25);
renderer.RefreshFromSurface();
Require(renderer.FindByNodeId(synth::runtime_ui::NodeIds::SectionToggle(
            0, synth::MidiConfigSection::Encoders)) != nullptr,
        "disclosure click expands sections after one click");
```

Run:

```bash
make -C projects/synth/apps/miniapp /Users/joyo/.codex/worktrees/e1fc/Sheaf/projects/synth/apps/miniapp/build/controllers_page_juce_tests && projects/synth/apps/miniapp/build/controllers_page_juce_tests
```

Expected: fail if deferred click refresh or component rebuild is stale.

- [ ] **Step 2: Create the reusable harness fixture**

Create `projects/synth/juce/ControllersPageHarness.hpp` with:

```cpp
#pragma once

#include "ControllersPageJuce.hpp"

#include "synth/ControllersPageUI.hpp"

#include <random>
#include <string>
#include <utility>
#include <vector>

namespace synth_runtime::test {

struct ControllersHarnessState
{
    synth::MidiInstrumentConfig instrument;
    synth::MidiConnectionState connection;
    synth::MidiDeviceList devices;
    std::string status;
    int commits = 0;
};

synth::MidiControllerSlot MakeHarnessWrldBldrSlot(const char* name);
synth::MidiControllerSlot MakeHarnessLaunchpadSlot(const char* name);
synth::MidiControllerSlot MakeHarnessGenericSlot(const char* name);

class ControllersHarnessFixture
{
public:
    ControllersHarnessFixture();

    synth::runtime_ui::ControllersPageSurface MakeSurface();
    void AddDefaultDevices();
    void SyncConnectionSize();

    ControllersHarnessState state;
};

void PumpJuceMessages(int milliseconds = 25);
bool ComponentInsideParent(const juce::Component& child, const juce::Component& parent);

}  // namespace synth_runtime::test
```

Keep all implementation inline in this header so existing single-file JUCE tests can include it without changing the build library layout.

- [ ] **Step 3: Run the test and verify the helper compiles**

Run the same focused test command.

Expected: compile succeeds; stale-click assertion still reflects the current behavior until the refresh fix lands.

### Task 2: Immediate Refresh After Real Clicks

**Files:**
- Modify: `projects/synth/include/synth/ControllersPageUI.hpp`
- Modify: `projects/synth/juce/ControllersPageJuceTests.cpp`

- [ ] **Step 1: Add a failing committed-action click test**

In `ControllersPageJuceTests.cpp`, expand controller 0 and the Encoders section, click the first add-single button through the real `juce::TextButton`, pump messages, and assert that the rendered mapping-row count increases without requiring any external MIDI/controller event:

```cpp
const auto beforeRows = fixture.state.instrument.controllers[0].config.wrldBldr.encoderInput.turns.size();
auto* addSingle = dynamic_cast<juce::TextButton*>(
    renderer.FindByNodeId(synth::runtime_ui::NodeIds::GroupAddSingle(
        0, synth::MidiConfigSection::Encoders, 0)));
Require(addSingle != nullptr, "encoder add-single button is clickable");
addSingle->onClick();
synth_runtime::test::PumpJuceMessages();
renderer.RefreshFromSurface();
Require(fixture.state.instrument.controllers[0].config.wrldBldr.encoderInput.turns.size() == beforeRows + 1,
        "add-single click mutates instrument immediately");
Require(renderer.FindByNodeId(synth::runtime_ui::NodeIds::MappingRow(
            0, synth::MidiConfigSection::Encoders, beforeRows)) != nullptr,
        "add-single click renders new row immediately");
```

Expected: fail if `DispatchAction()` rebuilds from the old view model before `RefreshOnTick()` consumes `m_dirty`.

- [ ] **Step 2: Fix the source of stale refresh**

Update `ControllersPageSurface::DispatchAction()` so actions that mark the page dirty synchronously rebuild the view model before the tree revision used by the renderer is consumed:

```cpp
void DispatchAction(const ui::Action& action) override
{
    HandleAction(action);
    RefreshOnTick();
    ++m_treeRevision;
    if (m_outerHandler_)
    {
        m_outerHandler_(action);
    }
}
```

Do not bypass the existing focus guard; `RefreshOnTick()` already respects it.

- [ ] **Step 3: Verify red-green**

Run the focused JUCE test. Then temporarily revert only the `DispatchAction()` change and verify the committed-action click test fails; restore the fix and verify it passes again.

### Task 3: Deterministic State-Machine Simulation Test

**Files:**
- Create: `projects/synth/juce/ControllersPageSimulationTests.cpp`
- Modify: `projects/synth/apps/miniapp/Makefile`

- [ ] **Step 1: Add the simulation test target to the Makefile**

Add:

```make
CONTROLLERS_PAGE_SIM_TEST_SRC := $(SYNTH_ROOT)/juce/ControllersPageSimulationTests.cpp
CONTROLLERS_PAGE_SIM_TEST := $(BUILD_DIR)/controllers_page_simulation_tests

$(CONTROLLERS_PAGE_SIM_TEST): $(CONTROLLERS_PAGE_SIM_TEST_SRC) $(SYNTH_SRC) $(SYNTH_HEADERS) $(SYNTH_JUCE_HEADERS) $(JUCE_MODULE_OBJ) $(JUCE_C_MODULE_OBJ) | $(BUILD_DIR)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $(CONTROLLERS_PAGE_SIM_TEST_SRC) $(SYNTH_SRC) $(JUCE_MODULE_OBJ) $(JUCE_C_MODULE_OBJ) -o $@ $(LDFLAGS_DARWIN)
```

and include `$(CONTROLLERS_PAGE_SIM_TEST)` in the `test` prerequisites and commands.

- [ ] **Step 2: Write the simulator**

Create a deterministic test that seeds `std::mt19937 rng(0x5EAF2026)`, creates a `ControllersHarnessFixture`, and for 250 steps chooses among:

- toggle any controller config
- toggle any visible section
- click a visible add-single button
- click a visible add-block button
- click a visible delete button
- change a visible combo-box to a different option

After every step, call `PumpJuceMessages()`, `surface.RefreshOnTick()`, `renderer.RefreshFromSurface()`, then verify:

- every controller in `state.instrument.controllers` has a rendered row
- every visible node has a matching JUCE component
- every child component is inside its parent row/section unless the parent is the scroll content
- no two sibling components with positive area overlap unexpectedly in a row header
- every `ComboBox` has at least one item and selected index is either valid or intentionally empty
- the add-controller row remains present

- [ ] **Step 3: Run the simulator and record seed on failure**

Run:

```bash
make -C projects/synth/apps/miniapp /Users/joyo/.codex/worktrees/e1fc/Sheaf/projects/synth/apps/miniapp/build/controllers_page_simulation_tests && projects/synth/apps/miniapp/build/controllers_page_simulation_tests
```

Expected: pass with seed `0x5EAF2026`; on failure, output step number, action name, node id, and seed.

### Task 4: Standalone JUCE Controllers Harness App

**Files:**
- Create: `projects/synth/apps/controllers_harness/Main.cpp`
- Create: `projects/synth/apps/controllers_harness/Makefile`
- Create: `projects/synth/apps/controllers_harness/Info.plist`
- Create: `projects/synth/apps/controllers_harness/README.md`

- [ ] **Step 1: Create the app skeleton**

Use a plain `juce::JUCEApplication` that owns a window containing:

- `ControllersPageSurface`
- `ControllersTreeRenderer`
- a small top toolbar with scenario reset buttons
- synthetic state from `ControllersHarnessFixture`

The renderer must be the same `ControllersTreeRenderer` used by the miniapp page.

- [ ] **Step 2: Add measurement overlay/status**

Add a status line above the renderer showing:

- controller count
- rendered component count
- last action
- last invariant error, or `OK`

This gives visible feedback while iterating.

- [ ] **Step 3: Build and launch**

Run:

```bash
make -C projects/synth/apps/controllers_harness
open /Users/joyo/.codex/worktrees/e1fc/Sheaf/projects/synth/apps/controllers_harness/build/ControllersHarness.app
```

Expected: a desktop app opens with the real controllers page and synthetic controllers/devices.

### Task 5: First Visual/UX Polish Pass Driven By Measurements

**Files:**
- Modify: `projects/synth/include/synth/ControllersPageUI.hpp`
- Modify: `projects/synth/juce/ControllersPageJuce.hpp`
- Modify tests from Tasks 2-3

- [ ] **Step 1: Add layout invariants before styling changes**

Add helper assertions used by both JUCE tests:

- minimum row height for clickable controls
- endpoint combo widths remain positive
- add-row controls fit at 900px width
- expanded section body has nonzero height and no clipped first row

- [ ] **Step 2: Improve page readability conservatively**

Make only measured changes:

- keep controller rows compact but give clear spacing
- make section headers visually distinct from mapping rows
- keep add/delete affordances aligned
- avoid nested-card styling and avoid adding decorative UI

- [ ] **Step 3: Run harness and tests after each small edit**

For every visual edit, run:

```bash
make -C projects/synth/apps/miniapp test
make -C projects/synth/apps/controllers_harness
```

Then inspect the harness manually and record any remaining rough spots.

### Task 6: Final Verification

**Files:**
- Update: `openspec/changes/decouple-synth-ui-from-juce/tasks.md`
- Update: `projects/synth/apps/controllers_harness/README.md`

- [ ] **Step 1: Run all verification**

Run:

```bash
make -C projects/synth test
make -C projects/synth/apps/miniapp test
make -C projects/synth/apps/miniapp
make -C projects/synth/apps/controllers_harness
openspec validate decouple-synth-ui-from-juce --type change --strict
git diff --check
```

- [ ] **Step 2: Mark OpenSpec manual smoke coverage**

Only check OpenSpec task 6.5 after the harness launches and the controllers page can be clicked through synthetic expand/add/delete/edit paths without stale UI.

- [ ] **Step 3: Commit**

Commit with:

```bash
git add docs/superpowers/plans/2026-07-05-controllers-ui-harness-and-simulation.md \
  projects/synth/include/synth/ControllersPageUI.hpp \
  projects/synth/juce/ControllersPageHarness.hpp \
  projects/synth/juce/ControllersPageJuce.hpp \
  projects/synth/juce/ControllersPageJuceTests.cpp \
  projects/synth/juce/ControllersPageSimulationTests.cpp \
  projects/synth/apps/miniapp/Makefile \
  projects/synth/apps/controllers_harness \
  openspec/changes/decouple-synth-ui-from-juce/tasks.md
git commit -m "test(synth): add controllers UI harness"
```
