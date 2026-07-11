# Task 1 Report: Portable Composite Surface And Validation

## Result

- Status: `DONE`
- Commit: `6baaa8332504bce3d2d442be9894f124d9f23b1a`
- Commit message: `feat(synth): add portable runtime main component`
- Commit scope: exactly the three Task 1 files; the pre-existing dirty browser
  files were not edited, staged, or committed.

## Implementation

- Added the JUCE-free `RuntimeMainServices` concept and
  `RuntimeMainComponent<App, Services>` portable surface.
- Composed `runtime.main.root`, the active app/runtime-page tree, and the
  complete sidebar tree. A 900x560 app produces 996x560 intrinsic bounds; the
  app remains at the origin and every sidebar node is translated by x=900.
- Reused `SidebarSurface`, `AudioPageSurface`, `FilePageSurface`,
  `ControllersPageSurface`, `RuntimePageBackSavesConfiguration`, and
  `RollingMax256`.
- Wired Audio, Controllers, and File navigation and exact action-name
  ownership. Unknown `runtime.*` actions stay reserved; unknown non-runtime
  actions route to `App::PortableSurface()`.
- Added refresh delegation for Audio/File snapshots, Controllers surface, and
  rolling deadline display.
- Added app-tree validation for positive configured root bounds, unique node
  IDs, known child references, cycles, one parentless root, exactly-once
  reachability, and the reserved `runtime.*` namespace.
- Added the focused test binary to the synth Makefile and to the synth `test`
  aggregate.

## TDD Evidence

### RED 1: Missing Production Surface

Command:

```text
make -C projects/synth build/runtime_main_component_tests
```

Observed result: exit 2. Make reported:

```text
No rule to make target `include/synth/RuntimeMainComponent.hpp', needed by
`build/runtime_main_component_tests'.
```

This was the expected failure after adding the first geometry, navigation,
routing, save-policy, and refresh tests while leaving the production header
absent.

### GREEN 1: Composite And Routing

Commands:

```text
make -C projects/synth build/runtime_main_component_tests
projects/synth/build/runtime_main_component_tests
```

Observed result: the target compiled with `-Wall -Wextra -Wpedantic` and the
first six cases passed:

- `TestCompositeBoundsPreserveAppAndAddSidebar`
- `TestSidebarOpensEachPageAndBackRestoresApp`
- `TestAppActionsRouteOnlyToAppSurface`
- `TestRuntimeActionsRouteOnlyToOwningPageOrServices`
- `TestBackFromConfigurationPageSavesRuntimeConfiguration`
- `TestRefreshUpdatesRuntimePageModelsAndRollingDeadline`

### RED 2: Missing Validation

Commands:

```text
make -C projects/synth build/runtime_main_component_tests
projects/synth/build/runtime_main_component_tests
```

Observed result: build succeeded, then the binary exited 1. The six existing
cases remained PASS and all five malformed-tree cases reported
`invalid tree was accepted`:

- `TestRejectsRootSizeMismatch`
- `TestRejectsDuplicateNodeIds`
- `TestRejectsUnknownChild`
- `TestRejectsCycle`
- `TestRejectsAppRuntimeNamespace`

### GREEN 2: Validation

Commands:

```text
make -C projects/synth build/runtime_main_component_tests build/portable_ui_tests
projects/synth/build/runtime_main_component_tests
projects/synth/build/portable_ui_tests
```

Observed result: build exited 0 with no warnings, all 11 focused cases passed,
and `portable_ui_tests` exited 0.

## Final Verification

- `make -C projects/synth build/runtime_main_component_tests build/portable_ui_tests`
  exited 0.
- `projects/synth/build/runtime_main_component_tests` exited 0 with 11 PASS
  lines and no failures.
- `projects/synth/build/portable_ui_tests` exited 0.
- `projects/synth/build/controllers_page_ui_tests` printed
  `controllers_page_ui_tests passed` and exited 0.
- `projects/synth/build/contract_tests` printed 18 PASS cases and exited 0.
- `make -C projects/synth check-ui-boundary` exited 0.
- `git diff --check` for the three Task 1 paths exited 0.

## Changed Files

- `projects/synth/include/synth/RuntimeMainComponent.hpp`
- `projects/synth/tests/runtime_main_component_tests.cpp`
- `projects/synth/Makefile`

## Self-Review

- The public interface matches the Task 1 brief, including the services
  concept signatures and all required component methods.
- Runtime dispatch uses explicit action-name sets rather than broad prefix
  routing, preventing unknown reserved actions from leaking to a page or app.
- App validation runs before app-tree composition and reports each required
  diagnostic substring: `configured bounds`, `duplicate node id`,
  `unknown child`, `cycle`, and `reserved runtime namespace`.
- The graph checks reject disconnected/multiply-parented nodes in addition to
  the five named malformed cases, satisfying exactly-once reachability.
- Root normalization guarantees the active app root is the second composite
  node even if a conforming app returns its sole parentless root later in its
  flat node vector.
- The header has no JUCE dependency, and both the focused source guard and the
  repository UI-boundary check confirm that constraint.
- The commit was inspected with `git show --stat`; it contains only the owned
  Makefile, header, and test source.

## Concerns

- No Task 1 correctness concerns remain from self-review or verification.
- Full synth `make test` was not run; verification covered the focused binary,
  the explicitly required neighboring portable UI binary, Controllers page
  tests, contract tests, and the UI-boundary check.
- The worktree still contains pre-existing dirty browser files owned by later
  tasks. They remain outside commit `6baaa833`.

## Fix Review Findings

### Result

- Status: `DONE`
- Commit: `b3137502b9913af541d2fbc62bc4efadef3c677e`
- Commit message: `fix(synth): make runtime main component lifetime safe`

### RED Evidence

After adding four compile-time lifetime assertions, this command exited 2:

```text
make -C projects/synth build/runtime_main_component_tests
```

The compiler reported failed assertions for
`!std::is_copy_constructible_v<MainComponent>` and
`!std::is_move_constructible_v<MainComponent>`. Copy and move assignment were
already unavailable incidentally because the component stores references.

### GREEN Evidence

These commands exited 0 after explicitly deleting all four copy/move
operations:

```text
make -C projects/synth build/runtime_main_component_tests build/portable_ui_tests
projects/synth/build/runtime_main_component_tests
projects/synth/build/portable_ui_tests
```

The runtime component binary printed 13 PASS cases, including the new direct
disconnected-graph and multiply-parented diamond-graph diagnostics. The
portable UI binary exited 0 with no output.

### Files Changed

- `projects/synth/include/synth/RuntimeMainComponent.hpp`
- `projects/synth/tests/runtime_main_component_tests.cpp`
- `projects/synth/Makefile`

### Self-Review

- Copy construction, copy assignment, move construction, and move assignment
  are explicitly deleted, so callbacks that capture `this` cannot outlive the
  address at which they were wired.
- The malformed-tree suite directly covers disconnected and diamond graphs
  while preserving the existing diagnostic substrings.
- Validation retains one global cycle DFS, then uses the acyclic graph
  invariants to prove reachability without the redundant second traversal.
- The focused Make rule now names `MidiConfigViewModel.hpp`, which is directly
  included by `RuntimeMainComponent.hpp`.
- The commit contains only the three owned Task 1 implementation paths; dirty
  browser files were not staged or changed.
