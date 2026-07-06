# Polish File Patch Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the rough inline File page patch chooser with a polished, root-scoped, JUCE-free browser viewer model and deterministic test coverage.

**Architecture:** `FilePageSurface` remains the single portable `ui::Surface`; it owns a rootless browser model that wraps `synth::PatchBrowser` and splices browser nodes into one File page `NodeTree`. `PatchBrowser` stays the path authority, while the File page model handles browser-open state, inline status, existing-target preflight, and action dispatch; JUCE remains a renderer over semantic nodes.

**Tech Stack:** C++20, JUCE desktop backend, Sheaf synth portable UI model, OpenSpec change `polish-file-patch-browser`, `make -C projects/synth test`, `make -C projects/synth/apps/miniapp test`.

---

## File Structure

- Modify `projects/synth/include/synth/PortableUI.hpp`: add minimal generic node semantics only if needed, such as `selected`, `enabled`, and `variant`.
- Modify `projects/synth/include/synth/PatchBrowser.hpp`: keep existing root/path authority and add helper(s) for Save As new-target validation if useful.
- Modify `projects/synth/include/synth/RuntimePages.hpp`: add File page browser snapshot/model, new node IDs/actions/layout constants, new File page tree layout, and updated `FilePageSurface` dispatch.
- Modify `projects/synth/juce/PortableJuceBackend.hpp`: render generic node semantics consistently; preserve focus-safe text editing and action dispatch.
- Modify `projects/synth/juce/RuntimePagesJuce.hpp`: refresh File page host against the new tree, no `juce::FileChooser`.
- Modify `projects/synth/tests/contract_tests.cpp`: cover new `PatchBrowser` helper/edge cases if added.
- Modify `projects/synth/tests/portable_ui_tests.cpp`: cover JUCE-free File page and browser tree behavior.
- Modify `projects/synth/juce/RuntimePagesJuceTests.cpp`: cover JUCE renderer mapping and refresh for polished File page nodes.
- Create `projects/synth/juce/FilePageSimulationTests.cpp`: deterministic randomized browser/action/layout simulation.
- Modify `projects/synth/apps/miniapp/Makefile`: build and run `FilePageSimulationTests.cpp`.
- Modify `openspec/changes/polish-file-patch-browser/tasks.md`: mark OpenSpec tasks complete only after corresponding implementation, review, and verification pass.

## Task 1: Browser Model And JUCE-Free Semantics

**Files:**
- Modify: `projects/synth/include/synth/RuntimePages.hpp`
- Modify: `projects/synth/include/synth/PatchBrowser.hpp`
- Modify: `projects/synth/tests/portable_ui_tests.cpp`
- Modify: `projects/synth/tests/contract_tests.cpp`
- Modify: `openspec/changes/polish-file-patch-browser/tasks.md`

- [x] **Step 1: Write failing `PatchBrowser` contract tests**

Add/extend tests in `projects/synth/tests/contract_tests.cpp` near the existing `PatchBrowser` tests:

```cpp
{
    const std::filesystem::path root = std::filesystem::temp_directory_path() / "sheaf_patch_browser_existing_test";
    std::filesystem::remove_all(root);
    std::filesystem::create_directories(root / "ExistingPatch");
    std::ofstream(root / "ExistingFile").put('x');

    synth::PatchBrowser browser(root);
    REQUIRE_TRUE(browser.ResolveSaveAsPath("FreshPatch").has_value());
    REQUIRE_TRUE(!browser.ResolveNewSaveAsPath("ExistingPatch").has_value());
    REQUIRE_TRUE(!browser.ResolveNewSaveAsPath("ExistingFile").has_value());
    REQUIRE_TRUE(!browser.ResolveNewSaveAsPath("../Outside").has_value());

    std::filesystem::remove_all(root);
}
```

If the implementation chooses not to add `ResolveNewSaveAsPath`, write the same assertions against the chosen helper name and use that name consistently in all later steps.

- [x] **Step 2: Run the contract test and verify it fails**

Run: `make -C projects/synth build && make -C projects/synth build/contract_tests && projects/synth/build/contract_tests`

Expected: compile failure because `ResolveNewSaveAsPath` or equivalent does not exist.

- [x] **Step 3: Implement Save As new-target validation**

In `projects/synth/include/synth/PatchBrowser.hpp`, add a helper that reuses `ResolveSaveAsPath` and rejects existing targets:

```cpp
std::optional<std::filesystem::path> ResolveNewSaveAsPath(const std::string& patchName) const {
    std::optional<std::filesystem::path> candidate = ResolveSaveAsPath(patchName);
    if (!candidate.has_value()) {
        return std::nullopt;
    }
    std::error_code ec;
    if (std::filesystem::exists(*candidate, ec) || ec) {
        return std::nullopt;
    }
    return candidate;
}
```

- [x] **Step 4: Add failing JUCE-free browser model tests**

In `projects/synth/tests/portable_ui_tests.cpp`, add tests that drive `FilePageSurface` through Save As / Load flows:

```cpp
synth::runtime_ui::FilePageSurface fileSurface;
const std::filesystem::path patchRoot =
    std::filesystem::temp_directory_path() / "sheaf_portable_file_page_browser_model_test";
std::filesystem::remove_all(patchRoot);
std::filesystem::create_directories(patchRoot / "Alpha");
std::filesystem::create_directories(patchRoot / "Beta");
fileSurface.Snapshot().patchesRoot = patchRoot.string();
fileSurface.SetContentBounds({0.0f, 0.0f, 640.0f, 480.0f});

synth::ui::Action lastAction;
fileSurface.SetActionHandler([&lastAction](const synth::ui::Action& action) {
    lastAction = action;
});

fileSurface.DispatchAction(synth::ui::Action::Named(synth::runtime_ui::Actions::kFileSaveAs));
const synth::ui::NodeTree saveTree = fileSurface.BuildTree();
Require(FindNodeById(saveTree, synth::runtime_ui::NodeIds::kFileBrowser) != nullptr, "browser section visible");
Require(FindNodeById(saveTree, synth::runtime_ui::NodeIds::kFileBrowserSaveName) != nullptr, "save name field visible");

fileSurface.DispatchAction(synth::ui::Action::WithValue(synth::runtime_ui::Actions::kFileBrowserSaveName, "Alpha"));
fileSurface.DispatchAction(synth::ui::Action::Named(synth::runtime_ui::Actions::kFileBrowserConfirm));
Require(lastAction.name.empty(), "existing save target does not dispatch");
Require(fileSurface.Snapshot().browserOpen, "browser remains open after existing target");
Require(fileSurface.Snapshot().statusText.find("exists") != std::string::npos, "existing target status");

fileSurface.DispatchAction(synth::ui::Action::WithValue(synth::runtime_ui::Actions::kFileBrowserSaveName, "Gamma"));
fileSurface.DispatchAction(synth::ui::Action::Named(synth::runtime_ui::Actions::kFileBrowserConfirm));
Require(lastAction.name == synth::runtime_ui::Actions::kFileConfirmedSaveAs, "fresh save target dispatches");
Require(lastAction.value == (std::filesystem::weakly_canonical(patchRoot) / "Gamma").string(), "fresh path under root");

std::filesystem::remove_all(patchRoot);
```

Also add one assertion that a browser-open File page tree contains exactly one root node and that browser nodes are descendants of `NodeIds::kFileBrowser`.

- [x] **Step 5: Run portable tests and verify failure**

Run: `make -C projects/synth build/portable_ui_tests && projects/synth/build/portable_ui_tests`

Expected: fails because existing Save As targets still dispatch/close and the tree does not expose the new polished structure yet.

- [x] **Step 6: Implement the rootless browser model in `RuntimePages.hpp`**

Add a `PatchBrowserViewModel` or equivalent private helper in `synth::runtime_ui` that owns `PatchBrowser`, open/kind/status/save-name state, and methods:

```cpp
bool IsOpen() const;
void Open(FileBrowserKind kind, const std::filesystem::path& root, const std::string& initialSaveName);
void Close(std::string status);
bool DispatchBrowserAction(const ui::Action& action, ActionHandler dispatchOut);
void SyncSnapshot(FilePageSnapshot& snapshot) const;
```

Use `ResolveNewSaveAsPath()` for Save As confirmation. On existing/invalid target, keep `browserOpen = true`, do not dispatch, and set status containing `"already exists"` or `"Enter a valid patch name"`. Keep `FilePageSurface` as the only `ui::Surface`.

- [x] **Step 7: Pass JUCE-free tests**

Run: `make -C projects/synth build/contract_tests build/portable_ui_tests && projects/synth/build/contract_tests && projects/synth/build/portable_ui_tests`

Expected: both binaries pass.

- [x] **Step 8: Mark matching OpenSpec tasks complete**

In `openspec/changes/polish-file-patch-browser/tasks.md`, mark tasks `1.1`, `1.2`, `1.3`, `1.4`, `4.1`, `4.2`, and `4.3` complete only if the above tests pass and the implementation matches the spec.

## Task 2: File Page Layout And Portable JUCE Rendering

**Files:**
- Modify: `projects/synth/include/synth/PortableUI.hpp`
- Modify: `projects/synth/include/synth/RuntimePages.hpp`
- Modify: `projects/synth/juce/PortableJuceBackend.hpp`
- Modify: `projects/synth/juce/RuntimePagesJuce.hpp`
- Modify: `projects/synth/juce/RuntimePagesJuceTests.cpp`
- Modify: `openspec/changes/polish-file-patch-browser/tasks.md`

- [x] **Step 1: Write failing JUCE renderer assertions**

In `projects/synth/juce/RuntimePagesJuceTests.cpp`, extend the File page section to assert:

```cpp
fileSurface.DispatchAction(synth::ui::Action::Named(synth::runtime_ui::Actions::kFileLoad));
fileSurface.SetContentBounds({0.0f, 0.0f, 760.0f, 420.0f});
fileRenderer.setSize(760, 420);
fileRenderer.RefreshFromSurface();

Require(fileRenderer.FindByNodeId(synth::runtime_ui::NodeIds::kFileBrowser) != nullptr,
        "browser viewer component renders");
Require(fileRenderer.FindByNodeId(synth::runtime_ui::NodeIds::kFileBrowserTitle) != nullptr,
        "browser title renders");
Require(fileRenderer.FindByNodeId(synth::runtime_ui::NodeIds::kFileBrowserCurrentPath) != nullptr,
        "browser path renders");
Require(fileRenderer.FindByNodeId(synth::runtime_ui::NodeIds::FileBrowserEntry(0)) != nullptr,
        "browser row renders");

juce::Component* browser = fileRenderer.FindByNodeId(synth::runtime_ui::NodeIds::kFileBrowser);
juce::Component* row = fileRenderer.FindByNodeId(synth::runtime_ui::NodeIds::FileBrowserEntry(0));
Require(browser != nullptr && row != nullptr && browser->getBounds().contains(row->getBounds()),
        "browser row is inside browser viewer bounds");
```

Add a narrow-size refresh (`360x360`) and assert the save-name field, status, and confirm/cancel controls remain within the root bounds.

- [x] **Step 2: Run JUCE runtime page tests and verify failure**

Run: `make -C projects/synth/apps/miniapp build/runtime_pages_juce_tests && projects/synth/apps/miniapp/build/runtime_pages_juce_tests`

Expected: failure because section/row nodes are not rendered by `PortableComponent` or polished bounds are not yet present.

- [x] **Step 3: Add generic portable node semantics only if needed**

In `projects/synth/include/synth/PortableUI.hpp`, add minimal fields:

```cpp
bool selected = false;
bool enabled = true;
std::string variant;
```

Use `selected` for list rows, `enabled` for disabled primary actions if needed, and `variant` values such as `"primary"`, `"secondary"`, `"list-row"`, `"danger"`, `"panel"`, and `"quiet"`. Do not add File-page-specific fields.

- [x] **Step 4: Redesign `BuildFilePageTree`**

In `projects/synth/include/synth/RuntimePages.hpp`, update File page layout to include:

- background draw node;
- header/status nodes with current patch name and patch root;
- command strip with New/Save/Save As/Load/Revert;
- idle region when browser is closed;
- full browser section when browser is open;
- stable bounds from `contentBounds_` using minimum widths and clamped text/status regions.

Ensure the browser model contributes rootless nodes under `NodeIds::kFileBrowser`; do not add a second root node.

- [x] **Step 5: Update `PortableJuceBackend` rendering**

In `projects/synth/juce/PortableJuceBackend.hpp`:

- include interactive children of `Row` and `Section`, not only root children, or flatten traversal while preserving absolute bounds;
- create a lightweight component for `Row`/`Section` if needed so tests can find `NodeIds::kFileBrowser`;
- map `node.selected`, `node.enabled`, and `node.variant` to JUCE colors/enabled state for buttons/labels/text fields;
- keep text fields focus-safe: do not overwrite focused text during refresh.

- [x] **Step 6: Ensure File page host stays behavior-free**

In `projects/synth/juce/RuntimePagesJuce.hpp`, keep host callbacks as dispatch endpoints only. Do not add `juce::FileChooser`. If `Runtime<App>::SavePatchAs` still returns `void`, no change is required because existing-target rejection is in the portable browser model.

- [x] **Step 7: Pass renderer tests**

Run: `make -C projects/synth/apps/miniapp build/runtime_pages_juce_tests && projects/synth/apps/miniapp/build/runtime_pages_juce_tests`

Expected: `RuntimePagesJuceTests passed`.

- [x] **Step 8: Mark matching OpenSpec tasks complete**

Mark tasks `2.1`, `2.2`, `2.3`, `2.4`, `3.1`, `3.2`, `3.3`, and `5.1` complete only after the JUCE renderer tests pass.

## Task 3: Deterministic File Page Simulation

**Files:**
- Create: `projects/synth/juce/FilePageSimulationTests.cpp`
- Modify: `projects/synth/apps/miniapp/Makefile`
- Modify: `openspec/changes/polish-file-patch-browser/tasks.md`

- [x] **Step 1: Add the simulation test target**

Modify `projects/synth/apps/miniapp/Makefile`:

```make
FILE_PAGE_SIM_TEST_SRC := $(SYNTH_ROOT)/juce/FilePageSimulationTests.cpp
FILE_PAGE_SIM_TEST := $(BUILD_DIR)/file_page_simulation_tests

$(FILE_PAGE_SIM_TEST): $(FILE_PAGE_SIM_TEST_SRC) $(SYNTH_SRC) $(SYNTH_HEADERS) $(SYNTH_JUCE_HEADERS) $(JUCE_MODULE_OBJ) $(JUCE_C_MODULE_OBJ) | $(BUILD_DIR)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $(FILE_PAGE_SIM_TEST_SRC) $(SYNTH_SRC) $(JUCE_MODULE_OBJ) $(JUCE_C_MODULE_OBJ) -o $@ $(LDFLAGS_DARWIN)

test: check-juce $(GEOMETRY_TEST) $(PORTABLE_BACKEND_TEST) $(MINIAPP_PARITY_TEST) $(RUNTIME_PAGES_TEST) $(CONTROLLERS_PAGE_JUCE_TEST) $(CONTROLLERS_PAGE_SIM_TEST) $(FILE_PAGE_SIM_TEST)
	$(GEOMETRY_TEST)
	$(PORTABLE_BACKEND_TEST)
	$(MINIAPP_PARITY_TEST)
	$(RUNTIME_PAGES_TEST)
	$(CONTROLLERS_PAGE_JUCE_TEST)
	$(CONTROLLERS_PAGE_SIM_TEST)
	$(FILE_PAGE_SIM_TEST)
```

Keep the existing targets in the same order and add the new test at the end.

- [x] **Step 2: Create failing simulation test skeleton**

Create `projects/synth/juce/FilePageSimulationTests.cpp` with:

```cpp
#include "RuntimePagesJuce.hpp"
#include "synth/RuntimePages.hpp"

#include <filesystem>
#include <iostream>
#include <random>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

void Require(bool condition, const std::string& label) {
    if (!condition) {
        throw std::runtime_error(label);
    }
}

const synth::ui::Node* FindNode(const synth::ui::NodeTree& tree, const synth::ui::NodeId& id) {
    for (const synth::ui::Node& node : tree.nodes) {
        if (node.id == id) {
            return &node;
        }
    }
    return nullptr;
}

void VerifyTree(const synth::runtime_ui::FilePageSurface& surface, const std::filesystem::path& root) {
    const synth::ui::NodeTree tree = surface.BuildTree();
    int rootCount = 0;
    for (const synth::ui::Node& node : tree.nodes) {
        if (node.kind == synth::ui::NodeKind::Root) {
            ++rootCount;
        }
    }
    Require(rootCount == 1, "file page tree has exactly one root");
    if (surface.Snapshot().browserOpen) {
        Require(FindNode(tree, synth::runtime_ui::NodeIds::kFileBrowser) != nullptr, "browser exists when open");
        for (const auto& entry : surface.Snapshot().browserEntries) {
            Require(entry.relativePath.find("..") == std::string::npos, "browser entry stays relative");
        }
    }
    (void)root;
}

void VerifyRenderer(synth_juce::PortableComponent& renderer, const synth::runtime_ui::FilePageSurface& surface) {
    renderer.RefreshFromSurface();
    if (surface.Snapshot().browserOpen) {
        juce::Component* browser = renderer.FindByNodeId(synth::runtime_ui::NodeIds::kFileBrowser);
        Require(browser != nullptr, "browser component renders");
        Require(renderer.getLocalBounds().contains(browser->getBounds()), "browser component inside root");
    }
}

}  // namespace

int main() {
    juce::ScopedJuceInitialiser_GUI juce;
    constexpr std::uint32_t kSeed = 0xF11E2026;
    std::mt19937 rng(kSeed);

    const std::filesystem::path root =
        std::filesystem::temp_directory_path() / "sheaf_file_page_simulation_test";
    std::filesystem::remove_all(root);
    std::filesystem::create_directories(root / "Alpha");
    std::filesystem::create_directories(root / "Beta" / "Nested");

    synth::runtime_ui::FilePageSurface surface;
    surface.Snapshot().patchesRoot = root.string();
    surface.SetContentBounds({0.0f, 0.0f, 760.0f, 420.0f});

    std::vector<synth::ui::Action> dispatched;
    surface.SetActionHandler([&dispatched](const synth::ui::Action& action) {
        dispatched.push_back(action);
    });

    synth_juce::PortableComponent renderer(surface);
    renderer.setSize(760, 420);

    for (int step = 0; step < 180; ++step) {
        std::vector<synth::ui::Action> actions;
        actions.push_back(synth::ui::Action::Named(synth::runtime_ui::Actions::kFileSave));
        actions.push_back(synth::ui::Action::Named(synth::runtime_ui::Actions::kFileSaveAs));
        actions.push_back(synth::ui::Action::Named(synth::runtime_ui::Actions::kFileLoad));
        if (surface.Snapshot().browserOpen) {
            actions.push_back(synth::ui::Action::Named(synth::runtime_ui::Actions::kFileBrowserCancel));
            actions.push_back(synth::ui::Action::Named(synth::runtime_ui::Actions::kFileBrowserConfirm));
            actions.push_back(synth::ui::Action::Named(synth::runtime_ui::Actions::kFileBrowserParent));
            actions.push_back(synth::ui::Action::WithValue(synth::runtime_ui::Actions::kFileBrowserSaveName, "Fresh" + std::to_string(step)));
            actions.push_back(synth::ui::Action::WithValue(synth::runtime_ui::Actions::kFileBrowserSaveName, "Alpha"));
            for (std::size_t ix = 0; ix < surface.Snapshot().browserEntries.size(); ++ix) {
                actions.push_back(synth::ui::Action::WithValue(synth::runtime_ui::Actions::kFileBrowserSelect, std::to_string(ix)));
                actions.push_back(synth::ui::Action::WithValue(synth::runtime_ui::Actions::kFileBrowserOpen, std::to_string(ix)));
            }
        }

        std::uniform_int_distribution<std::size_t> pick(0, actions.size() - 1);
        const std::size_t beforeDispatch = dispatched.size();
        surface.DispatchAction(actions[pick(rng)]);

        for (std::size_t ix = beforeDispatch; ix < dispatched.size(); ++ix) {
            const std::filesystem::path dispatchedPath(dispatched[ix].value);
            Require(dispatchedPath.empty() || dispatchedPath.string().find(root.string()) == 0,
                    "dispatched path remains under root");
        }

        if (step % 7 == 0) {
            renderer.setSize(360, 360);
            surface.SetContentBounds({0.0f, 0.0f, 360.0f, 360.0f});
        } else {
            renderer.setSize(760, 420);
            surface.SetContentBounds({0.0f, 0.0f, 760.0f, 420.0f});
        }
        VerifyTree(surface, root);
        VerifyRenderer(renderer, surface);
    }

    std::filesystem::remove_all(root);
    std::cout << "FilePageSimulationTests passed seed=0x" << std::hex << kSeed << "\n";
    return 0;
}
```

- [x] **Step 3: Run simulation target and verify failure/compile gaps**

Run: `make -C projects/synth/apps/miniapp build/file_page_simulation_tests && projects/synth/apps/miniapp/build/file_page_simulation_tests`

Expected: initial failure may be compile or invariant failure until Task 2 rendering changes are fully integrated.

- [x] **Step 4: Complete simulation invariants**

Refine `FilePageSimulationTests.cpp` so it verifies:

- no save/load dispatch outside root;
- invalid names, existing Save As targets, unreadable roots, and missing load selections do not dispatch callbacks;
- cancel closes browser without dispatch;
- first Save with `hasCurrentPatch == false` opens Save As;
- every visible semantic control has an expected JUCE component kind;
- browser rows and primary/cancel controls stay inside parent/root bounds across `760x420` and `360x360`.

- [x] **Step 5: Pass simulation and miniapp JUCE tests**

Run: `make -C projects/synth/apps/miniapp test`

Expected: all miniapp JUCE tests pass, including `FilePageSimulationTests passed seed=0xf11e2026`.

- [x] **Step 6: Mark matching OpenSpec tasks complete**

Mark tasks `5.2`, `5.3`, and `5.4` complete only after the simulation target is part of `make -C projects/synth/apps/miniapp test` and passes.

## Task 4: Final Verification And OpenSpec Sync

**Files:**
- Modify: `openspec/changes/polish-file-patch-browser/tasks.md`

- [x] **Step 1: Run OpenSpec validation**

Run: `openspec validate polish-file-patch-browser --strict`

Expected: `Change 'polish-file-patch-browser' is valid`.

- [x] **Step 2: Run JUCE-free synth tests**

Run: `make -C projects/synth test`

Expected: all listed JUCE-free binaries pass, including `contract_tests` and `portable_ui_tests`.

- [x] **Step 3: Run JUCE runtime/page/simulation tests**

Run: `make -C projects/synth/apps/miniapp test`

Expected: all JUCE tests pass, including `runtime_pages_juce_tests` and `file_page_simulation_tests`.

- [x] **Step 4: Run UI boundary check explicitly**

Run: `make -C projects/synth check-ui-boundary`

Expected: no boundary violations; JUCE-free headers still compile without JUCE leakage.

- [x] **Step 5: Mark final OpenSpec verification tasks complete**

In `openspec/changes/polish-file-patch-browser/tasks.md`, mark tasks `6.1`, `6.2`, `6.3`, and `6.4` complete only if the commands above pass. If a command cannot run because of missing local JUCE or environment setup, leave the task unchecked and record the skip/failure in the final status instead.

- [x] **Step 6: Inspect final diff**

Run: `git status --short` and `git diff --stat`

Expected: only files in this plan and OpenSpec task checkboxes changed. No unrelated user changes reverted.

## Spec Coverage Self-Review

- `sru-6`: Task 2 implements page header/status/command layout; Task 1 preserves Save/Save As/Load routing; Task 4 verifies.
- `sru-13`: Task 1 implements root-scoped browser behavior, existing-target preflight, empty/error states; Task 3 simulates.
- `sru-16`: Task 1 implements rootless model; Task 2 splices one tree and renders in JUCE; Task 3 verifies one-root and bounds behavior.
- `sru-17`: Task 3 implements deterministic simulation; Task 4 runs it through the miniapp JUCE test target.
- OpenSpec tasks map to plan tasks and are updated only after implementation plus verification.
