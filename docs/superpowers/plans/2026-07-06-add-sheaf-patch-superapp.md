# Sheaf Patch Superapp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `sheaf-patch` launcher app that lists registered synth apps, launches the miniapp through typed registration, and uses Sheaf Patch-specific shared config plus per-app patch roots.

**Architecture:** Add JUCE-free app manifest/registry/path helpers under `projects/synth/include/synth`, keep standalone app runtime behavior intact, and add a JUCE launcher executable under `projects/synth/apps/sheaf-patch`. The launcher owns only app selection; selected app runtime logic remains inside `synth_runtime::Runtime<App>` and the existing shell path.

**Tech Stack:** C++20, existing synth JUCE runtime, existing portable UI model, Makefiles, OpenSpec tasks under `openspec/changes/add-sheaf-patch-superapp/tasks.md`.

---

## OpenSpec Source Of Truth

Read before editing:
- `openspec/changes/add-sheaf-patch-superapp/proposal.md`
- `openspec/changes/add-sheaf-patch-superapp/design.md`
- `openspec/changes/add-sheaf-patch-superapp/specs/synth-app-runtime/spec.md`
- `openspec/changes/add-sheaf-patch-superapp/specs/synth-patch-persistence/spec.md`
- `openspec/changes/add-sheaf-patch-superapp/specs/synth-runtime-ui/spec.md`
- `openspec/changes/add-sheaf-patch-superapp/tasks.md`

Important resolved decisions:
- Sheaf Patch shared config applies only to apps launched by the Sheaf Patch superapp.
- The config path is a JSON file named `<sheaf-user-data-root>/synth/sheaf-patch/config`, anchored to the same stable Sheaf user application data root convention as MiniApp.
- Patch roots use stable app id: `<sheaf-user-data-root>/synth/sheaf-patch/patches/<stable-app-id>`.
- Hardware requirements are advisory only.
- Launcher ordering is stable app id sort order.
- Returning to launcher after launch is out of scope.

This checkout is currently detached (`HEAD (no branch)`). Do not create commits unless the coordinator explicitly asks after checking branch state.

## File Map

- Create `projects/synth/include/synth/AppRegistry.hpp`: JUCE-free manifest, hardware requirements, app id validation, registration sorting, Sheaf Patch data path resolver.
- Modify `projects/synth/include/synth/AppContext.hpp`: add `RuntimeDataPaths::FromRoots(...)` for split config/patch/log roots.
- Modify `projects/synth/tests/contract_tests.cpp`: tests for manifest validation, registry ordering, split data paths, and Sheaf Patch data paths.
- Create `projects/synth/apps/miniapp/MiniAppRegistration.hpp`: miniapp manifest and typed registration factory.
- Modify `projects/synth/Makefile`: include the new header in contract test dependencies and add `sheaf-patch` to app targets.
- Modify `projects/synth/runtime/Shell.hpp`: add launchable shell/application support that can accept explicit runtime data paths before `Runtime<App>::Start()`.
- Create `projects/synth/apps/sheaf-patch/Makefile`, `Main.cpp`, `Info.plist`, and `Launcher.hpp`: JUCE launcher executable and app list component.
- Modify `projects/synth/apps/miniapp/Makefile`: include miniapp registration header dependency.
- Modify `openspec/changes/add-sheaf-patch-superapp/tasks.md`: mark OpenSpec tasks complete only after implementation, review, and verification for the corresponding plan task.

## Task 1: JUCE-Free App Manifest, Registry, and Path Contracts

**Files:**
- Create: `projects/synth/include/synth/AppRegistry.hpp`
- Modify: `projects/synth/include/synth/AppContext.hpp`
- Modify: `projects/synth/tests/contract_tests.cpp`
- Modify: `projects/synth/Makefile`

- [ ] **Step 1: Add failing contract tests**

Add `#include "synth/AppRegistry.hpp"` to `projects/synth/tests/contract_tests.cpp`.

Add tests with these exact assertions:
```cpp
TEST_CASE(runtime_data_paths_can_split_roots) {
    const auto paths = synth::RuntimeDataPaths::FromRoots(
        "/tmp/sheaf-patch-data",
        "/tmp/sheaf-patch-data/patches/miniapp",
        "/tmp/sheaf-patch-data/logs",
        "/tmp/sheaf-patch-data/config");
    REQUIRE_TRUE(paths.dataRoot == std::filesystem::path("/tmp/sheaf-patch-data"));
    REQUIRE_TRUE(paths.patchesRoot == std::filesystem::path("/tmp/sheaf-patch-data/patches/miniapp"));
    REQUIRE_TRUE(paths.logsRoot == std::filesystem::path("/tmp/sheaf-patch-data/logs"));
    REQUIRE_TRUE(paths.configFile == std::filesystem::path("/tmp/sheaf-patch-data/config"));
}

TEST_CASE(app_manifest_validates_stable_app_id) {
    REQUIRE_TRUE(synth::IsValidSynthAppId("miniapp"));
    REQUIRE_TRUE(synth::IsValidSynthAppId("wrld-bldr"));
    REQUIRE_TRUE(!synth::IsValidSynthAppId(""));
    REQUIRE_TRUE(!synth::IsValidSynthAppId("Mini App"));
    REQUIRE_TRUE(!synth::IsValidSynthAppId("../escape"));
}

TEST_CASE(app_registry_sorts_by_stable_app_id) {
    synth::SynthAppRegistration z;
    z.manifest.appId = "zeta";
    z.manifest.displayName = "Zeta";
    synth::SynthAppRegistration a;
    a.manifest.appId = "alpha";
    a.manifest.displayName = "Alpha";
    std::vector<synth::SynthAppRegistration> apps{z, a};
    synth::SortSynthAppRegistrationsById(apps);
    REQUIRE_TRUE(apps[0].manifest.appId == "alpha");
    REQUIRE_TRUE(apps[1].manifest.appId == "zeta");
}

TEST_CASE(sheaf_patch_data_paths_use_shared_config_and_app_patch_root) {
    const auto paths = synth::SheafPatchDataPathsForApp("/tmp/sheaf-repo-data", "miniapp");
    REQUIRE_TRUE(paths.dataRoot == std::filesystem::path("/tmp/sheaf-repo-data/synth/sheaf-patch"));
    REQUIRE_TRUE(paths.configFile == std::filesystem::path("/tmp/sheaf-repo-data/synth/sheaf-patch/config"));
    REQUIRE_TRUE(paths.patchesRoot == std::filesystem::path("/tmp/sheaf-repo-data/synth/sheaf-patch/patches/miniapp"));
    REQUIRE_TRUE(paths.logsRoot == std::filesystem::path("/tmp/sheaf-repo-data/synth/sheaf-patch/logs"));
}
```

- [ ] **Step 2: Run the contract test and confirm it fails**

Run: `make -C projects/synth build/contract_tests && projects/synth/build/contract_tests`

Expected: compile fails because `synth/AppRegistry.hpp`, `RuntimeDataPaths::FromRoots`, and helper functions do not exist.

- [ ] **Step 3: Implement `RuntimeDataPaths::FromRoots`**

In `projects/synth/include/synth/AppContext.hpp`, add:
```cpp
static RuntimeDataPaths FromRoots(std::filesystem::path dataRoot,
                                  std::filesystem::path patchesRoot,
                                  std::filesystem::path logsRoot,
                                  std::filesystem::path configFile) {
    RuntimeDataPaths paths;
    paths.dataRoot = std::move(dataRoot);
    paths.patchesRoot = std::move(patchesRoot);
    paths.logsRoot = std::move(logsRoot);
    paths.configFile = std::move(configFile);
    return paths;
}
```

- [ ] **Step 4: Implement `AppRegistry.hpp`**

Create `projects/synth/include/synth/AppRegistry.hpp` with:
```cpp
#pragma once

#include "synth/AppConcepts.hpp"

#include <algorithm>
#include <cctype>
#include <filesystem>
#include <functional>
#include <string>
#include <utility>
#include <vector>

namespace synth {

struct SynthHardwareRequirements {
    int minEncoders = 0;
};

struct SynthAppManifest {
    std::string appId;
    std::string displayName;
    std::string author;
    std::string category;
    SynthHardwareRequirements hardware;
};

struct SynthAppRegistration {
    SynthAppManifest manifest;
    std::function<void(RuntimeDataPaths)> launch;
};

inline bool IsValidSynthAppId(std::string_view id) {
    if (id.empty()) {
        return false;
    }
    for (unsigned char ch : id) {
        const bool valid = std::islower(ch) || std::isdigit(ch) || ch == '-';
        if (!valid) {
            return false;
        }
    }
    return id.find("..") == std::string_view::npos;
}

inline void SortSynthAppRegistrationsById(std::vector<SynthAppRegistration>& apps) {
    std::sort(apps.begin(), apps.end(), [](const auto& lhs, const auto& rhs) {
        return lhs.manifest.appId < rhs.manifest.appId;
    });
}

inline RuntimeDataPaths SheafPatchDataPathsForApp(std::filesystem::path dataRoot,
                                                  std::string_view stableAppId) {
    const std::filesystem::path root = std::move(dataRoot) / "synth" / "sheaf-patch";
    return RuntimeDataPaths::FromRoots(root,
                                       root / "patches" / std::string(stableAppId),
                                       root / "logs",
                                       root / "config");
}

template <SynthApplication App, typename LaunchFn>
SynthAppRegistration MakeSynthAppRegistration(SynthAppManifest manifest, LaunchFn&& launchFn) {
    return SynthAppRegistration{std::move(manifest), std::function<void(RuntimeDataPaths)>(std::forward<LaunchFn>(launchFn))};
}

}  // namespace synth
```

Adjust the implementation if the compiler requires a clearer conversion for `std::function<void(RuntimeDataPaths)>`.

- [ ] **Step 5: Add Makefile dependency**

In `projects/synth/Makefile`, add `include/synth/AppRegistry.hpp` to the `$(CONTRACT_TEST_BIN)` dependency list.

- [ ] **Step 6: Verify Task 1**

Run: `make -C projects/synth build/contract_tests && projects/synth/build/contract_tests`

Expected: contract test binary builds and every test prints `[PASS]`.

OpenSpec tasks covered after review: 1.1, part of 1.2, 3.1, part of 3.2.

## Task 2: Typed Miniapp Registration and Runtime Launch Helper

**Files:**
- Create: `projects/synth/apps/miniapp/MiniAppRegistration.hpp`
- Modify: `projects/synth/runtime/Shell.hpp`
- Modify: `projects/synth/apps/miniapp/Makefile`
- Modify: `projects/synth/Makefile`
- Test: `projects/synth/tests/miniapp_system_tests.cpp`

- [ ] **Step 1: Add tests for miniapp registration metadata**

Add `#include "MiniAppRegistration.hpp"` to `projects/synth/tests/miniapp_system_tests.cpp`.

Add:
```cpp
TEST_CASE(miniapp_registration_declares_launcher_metadata) {
    const auto registration = synth_miniapp::MakeMiniAppRegistration([](synth::RuntimeDataPaths) {});
    REQUIRE_TRUE(registration.manifest.appId == "miniapp");
    REQUIRE_TRUE(registration.manifest.displayName == "Mini App");
    REQUIRE_TRUE(!registration.manifest.author.empty());
    REQUIRE_TRUE(registration.manifest.category == "test");
    REQUIRE_TRUE(registration.manifest.hardware.minEncoders > 0);
    REQUIRE_TRUE(static_cast<bool>(registration.launch));
}
```

- [ ] **Step 2: Run the target and confirm it fails**

Run: `make -C projects/synth build test`

Expected: compile fails because `MiniAppRegistration.hpp` does not exist.

- [ ] **Step 3: Add miniapp registration header**

Create `projects/synth/apps/miniapp/MiniAppRegistration.hpp`:
```cpp
#pragma once

#include "MiniApp.hpp"
#include "synth/AppRegistry.hpp"

#include <utility>

namespace synth_miniapp {

inline synth::SynthAppManifest MiniAppManifest() {
    return synth::SynthAppManifest{
        .appId = "miniapp",
        .displayName = "Mini App",
        .author = "Sheaf",
        .category = "test",
        .hardware = synth::SynthHardwareRequirements{.minEncoders = 16},
    };
}

template <typename LaunchFn>
synth::SynthAppRegistration MakeMiniAppRegistration(LaunchFn&& launchFn) {
    return synth::MakeSynthAppRegistration<MiniApp>(MiniAppManifest(), std::forward<LaunchFn>(launchFn));
}

}  // namespace synth_miniapp
```

- [ ] **Step 4: Add launch helper in `Shell.hpp`**

Add a helper class that constructs `Runtime<App>`, applies explicit paths before `Start()`, owns the matching `ShellComponent<App>`, and wires the repaint hook. Add it in `projects/synth/runtime/Shell.hpp` after `ShellComponent<App>` and before `ShellApplication<App>`:
```cpp
template <synth::SynthApplication App>
class RuntimeShellSession {
public:
    explicit RuntimeShellSession(std::optional<synth::RuntimeDataPaths> paths = std::nullopt) {
        runtime_ = std::make_unique<Runtime<App>>();
        if (paths.has_value()) {
            runtime_->SetRuntimeDataPathsForTesting(std::move(*paths));
        }
        runtime_->Start();
        shell_ = std::make_unique<ShellComponent<App>>(*runtime_);
        runtime_->SetRepaintHook([shell = shell_.get()] { shell->RepaintAll(); });
    }

    ~RuntimeShellSession() {
        if (runtime_) {
            runtime_->SetRepaintHook({});
        }
    }

    RuntimeShellSession(const RuntimeShellSession&) = delete;
    RuntimeShellSession& operator=(const RuntimeShellSession&) = delete;
    RuntimeShellSession(RuntimeShellSession&&) = delete;
    RuntimeShellSession& operator=(RuntimeShellSession&&) = delete;

    juce::Component& Component() { return *shell_; }
    Runtime<App>& GetRuntime() { return *runtime_; }

private:
    std::unique_ptr<Runtime<App>> runtime_;
    std::unique_ptr<ShellComponent<App>> shell_;
};
```

Refactor `ShellApplication<App>::initialise` to use `RuntimeShellSession<App>` internally or leave the existing standalone app path as-is if the new session helper is used only by the Sheaf Patch launcher. If refactoring standalone, preserve this ordering:
```cpp
void StartRuntimeAndWindow(std::optional<synth::RuntimeDataPaths> paths) {
    runtime_ = std::make_unique<Runtime<App>>();
    if (paths.has_value()) {
        runtime_->SetRuntimeDataPathsForTesting(std::move(*paths));
    }
    runtime_->Start();
    const synth::RuntimeConfig config = App::Config();
    window_ = std::make_unique<MainWindow>(juce::String(config.appName), config.uiWidth, config.uiHeight, *runtime_);
}
```

- [ ] **Step 5: Update header dependencies**

Add `MiniAppRegistration.hpp` to `projects/synth/apps/miniapp/Makefile` `APP_HEADERS`.

- [ ] **Step 6: Verify Task 2**

Run: `make -C projects/synth build test`

Expected: core and JUCE-free tests pass.

OpenSpec tasks covered after review: 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, part of 2.4.

## Task 3: Sheaf Patch Launcher App and UI

**Files:**
- Create: `projects/synth/apps/sheaf-patch/Makefile`
- Create: `projects/synth/apps/sheaf-patch/Info.plist`
- Create: `projects/synth/apps/sheaf-patch/Main.cpp`
- Create: `projects/synth/apps/sheaf-patch/Launcher.hpp`
- Modify: `projects/synth/Makefile`

- [ ] **Step 1: Add launcher app skeleton**

Create `projects/synth/apps/sheaf-patch/Makefile` modeled after miniapp:
```make
APP_DIR := $(patsubst %/,%,$(dir $(abspath $(lastword $(MAKEFILE_LIST)))))

APP_NAME := SheafPatch
APP_BUILD_DIR := $(APP_DIR)/build
APP_SOURCES := $(APP_DIR)/Main.cpp
APP_INFO_PLIST := $(APP_DIR)/Info.plist

include $(APP_DIR)/../../runtime/juce_build.mk

APP_HEADERS := $(APP_DIR)/Launcher.hpp $(APP_DIR)/../miniapp/MiniAppRegistration.hpp
$(APP): $(APP_HEADERS)
```

Create `Info.plist` by copying the miniapp plist and changing bundle executable/name to `SheafPatch`.

- [ ] **Step 2: Implement launcher UI**

Create `Launcher.hpp` with a `juce::Component` that:
- takes a vector of `synth::SynthAppRegistration`
- sorts by stable app id
- renders one row per app with display name, author, category, and `minEncoders`
- exposes row click handlers that invoke the registration launch callable
- does not create Back/Home controls

Use ordinary JUCE labels/buttons. Keep the visual plain and compact; this is a launcher utility, not a marketing page.

- [ ] **Step 3: Wire miniapp selection**

In `Main.cpp`, build the registry with `synth_miniapp::MakeMiniAppRegistration(...)`. The launch lambda should compute:
```cpp
const auto paths = synth::SheafPatchDataPathsForApp("data", registration.manifest.appId);
```
and pass those explicit paths to the selected app launch helper.

If the final implementation needs a repository-root-aware anchor, use `juce::File::getCurrentWorkingDirectory().getChildFile("data")` for the local app target while keeping the product-relative layout from the spec.

- [ ] **Step 4: Add Makefile target**

In `projects/synth/Makefile`:
- define `SHEAF_PATCH_DIR := $(APPS_DIR)/sheaf-patch`
- add `sheaf-patch` to `.PHONY`
- implement:
```make
sheaf-patch:
	$(MAKE) -C $(SHEAF_PATCH_DIR)
```
- update `apps:` to build both miniapp and sheaf-patch.

- [ ] **Step 5: Add launcher tests or harness**

Add a small JUCE test target under `projects/synth/apps/sheaf-patch/Makefile`. Test that:
- miniapp row exists
- category text is `test`
- min encoder text is visible
- app activation invokes launch callback without checking hardware
- app ordering is by stable app id

If the JUCE test target cannot link in this environment, stop and report the linker output before substituting a weaker JUCE-free test; do not silently drop launcher UI coverage.

- [ ] **Step 6: Verify Task 3**

Run:
- `make -C projects/synth sheaf-patch`
- `make -C projects/synth apps`

Expected: both app targets build.

OpenSpec tasks covered after review: 4.1, 4.2, 4.3, 4.4, 4.5.

## Task 4: Path Behavior, Integration Verification, and OpenSpec Task Sync

**Files:**
- Modify `projects/synth/tests/contract_tests.cpp`.
- Modify `openspec/changes/add-sheaf-patch-superapp/tasks.md`.

- [ ] **Step 1: Add/verify path behavior tests**

Ensure tests cover:
```cpp
REQUIRE_TRUE(synth::SheafPatchDataPathsForApp("data", "miniapp").configFile ==
             std::filesystem::path("data/synth/sheaf-patch/config"));
REQUIRE_TRUE(synth::SheafPatchDataPathsForApp("data", "miniapp").patchesRoot ==
             std::filesystem::path("data/synth/sheaf-patch/patches/miniapp"));
REQUIRE_TRUE(synth::RuntimeDataPaths::FromDataRoot("/tmp/standalone").configFile ==
             std::filesystem::path("/tmp/standalone/config.json"));
```

- [ ] **Step 2: Run full synth verification**

Run:
- `make -C projects/synth build test`
- `make -C projects/synth miniapp`
- `make -C projects/synth sheaf-patch`
- `make -C projects/synth/apps/miniapp test`

Expected: all commands exit 0. If JUCE is unavailable, stop and report the exact missing dependency output.

- [ ] **Step 3: Optional manual smoke test**

If GUI launch is available in the environment, run the SheafPatch app bundle and verify:
- first screen is launcher
- miniapp row appears
- selecting miniapp starts the app
- no launcher Back/Home exists after launch

If GUI launch is not practical, report this as unverified instead of marking task 5.4 complete.

- [ ] **Step 4: Mark OpenSpec tasks**

Only after code, review, and verification, update `openspec/changes/add-sheaf-patch-superapp/tasks.md` checkboxes:
- Mark 1.1-1.4 after Task 1/2 review passes.
- Mark 2.1-2.4 after Task 2 review passes.
- Mark 3.1-3.5 after Task 4 path verification passes.
- Mark 4.1-4.5 after Task 3 review passes.
- Mark 5.1-5.4 only for verification actually performed.

- [ ] **Step 5: Final status**

Run:
- `openspec instructions apply --change "add-sheaf-patch-superapp" --json`
- `git status --short`

Expected: OpenSpec progress reflects completed tasks; git status shows only intentional files and pre-existing unrelated untracked files are not modified.

## Review Protocol

For each task:
1. Dispatch a Codex implementer via `plugins/xagent/scripts/xagent run --harness codex --subagent "<task prompt>"`.
2. Verify the implementer diff locally.
3. Dispatch a Claude Opus spec reviewer via `plugins/xagent/scripts/xagent run --harness claude_code --model opus --subagent "<spec review prompt>"`.
4. Dispatch a Claude Opus code-quality reviewer via `plugins/xagent/scripts/xagent run --harness claude_code --model opus --subagent "<code review prompt>"`.
5. Fix and re-review any Critical or Important findings before moving to the next task.

Do not dispatch implementation subagents in parallel. The planned tasks touch overlapping synth headers/build files.
