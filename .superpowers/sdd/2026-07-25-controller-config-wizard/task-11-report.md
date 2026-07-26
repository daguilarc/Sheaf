# Task 11 report — portable wizard session and chooser routing

## Red evidence

Added the portable Controllers-page session/chooser tests before production routing, then ran:

```sh
make -C projects/synth build/controllers_page_ui_tests && \
  projects/synth/build/controllers_page_ui_tests
```

Exit: `2` (expected red). The test compilation failed because
`ControllersPageSurface::OpenExisting` did not exist. The new test also
specified the absent launch/form/chooser nodes, unique direct route, form
dispatch, refresh behavior, and Back/Cancel contract.

## Implementation summary

- Added a single `WizardSession` owned by `ControllersPageSurface`, with the
  requested candidate-or-record target, wizard, form, warning, and status.
- Added portable `runtime.controllers.wizard.*` workflow ids/actions for a
  disabled Configuration Wizard launch, refreshable chooser, session form,
  Back/Cancel, Submit, and new-candidate Ignore.
- Routed one available candidate directly to `OpenCandidate(0)`; multiple
  candidates open a deterministic endpoint-labelled chooser. Refreshing the
  chooser removes disappeared candidates and displays an empty explanation.
- Kept the form as the only owner of entered values; discovery refresh cannot
  replace an open form. Back and Cancel discard the session without a commit.
- Added generic runtime-shell action routing for the new page actions and
  controller-wizard form action prefix. No renderer gains wizard policy.
- Submit and Ignore are rendered but intentionally do not commit or revalidate
  in this task; Task 12 owns those behaviors.

## Green verification

```sh
make -C projects/synth build/controllers_page_ui_tests build/portable_ui_tests \
  build/runtime_main_component_tests && \
  projects/synth/build/controllers_page_ui_tests && \
  projects/synth/build/portable_ui_tests && \
  projects/synth/build/runtime_main_component_tests && \
  make -C projects/synth check-ui-boundary && \
  git diff --check
```

Exit: `0`.

- `controllers_page_ui_tests passed`
- `portable_ui_tests` exited `0`
- all 17 `runtime_main_component_tests` cases passed
- `check-ui-boundary` and `git diff --check` exited `0`

## Self-review

- The list, chooser, and form are mutually exclusive portable trees, so an
  open form cannot expose another launch control that could replace its state.
- Candidate matching remains in cached discovery; page code only consumes a
  supplied discovery snapshot and a registry factory id.
- Existing-record sessions are identified by their opaque persisted wizard id
  and omit Ignore. New-candidate sessions retain Ignore as a secondary action.
- The runtime action-prefix routing is generic and contains no Twister,
  validation, generation, matching, or blacklist behavior.

## Commit

Final amended commit: `feat(synth-ui): add portable controller wizard session`.

## Concerns

Submit/Ignore controls intentionally remain non-committing until Task 12 adds
the required current-snapshot revalidation and atomic persistence path.

## Fix round 1 — stable chooser identity and deferred navigation

### Red evidence

Added regressions that retain both chooser actions before discovery refresh,
then remove the first candidate. The stale first action must not open the
remaining candidate; the stale second action must still open that same
candidate. The test also requires all structural wizard navigation actions to
request deferred dispatch.

```sh
make -C projects/synth build/controllers_page_ui_tests && \
  projects/synth/build/controllers_page_ui_tests
```

Exit: `134` (expected red). The new regression failed with `stale chooser
action does not silently open a different candidate`, confirming that the
previous positional action value reinterpreted candidate A's old index as
candidate B after refresh.

### Root cause and change

- Chooser nodes/actions previously carried vector indexes, which are visual
  positions rather than candidate identities. Refresh could remove/reorder a
  candidate between click delivery and dispatch.
- Each candidate now has a node/action-safe, delimiter-unambiguous token:
  lowercase hex encodings of its exact wizard id, input identifier, and output
  identifier joined by `_` (which cannot occur in hex). Dispatch resolves this
  token by exact lookup in the current discovery snapshot. A missing token
  keeps the chooser open and displays an explanatory status.
- JUCE's `PortableJuceBackend` calls `m_surface.DispatchAction(action)`
  synchronously from the button `onClick` callback. Structural navigation can
  therefore replace the clicked control during the next refresh. Added Wizard
  Open, Choose, Back, and Cancel to `NeedsDeferredDispatch`; Submit/Ignore
  remain out of scope for Task 12.

### Green verification

```sh
make -C projects/synth build/controllers_page_ui_tests build/portable_ui_tests \
  build/runtime_main_component_tests && \
  projects/synth/build/controllers_page_ui_tests && \
  projects/synth/build/portable_ui_tests && \
  projects/synth/build/runtime_main_component_tests && \
  make -C projects/synth check-ui-boundary && \
  git diff --check
```

Exit: `0`; `controllers_page_ui_tests` passed, `portable_ui_tests` exited
successfully, all 17 runtime-main cases passed, and both static checks passed.

```sh
make -C projects/synth/apps/miniapp \
  /Users/joyo/Sheaf/.claude/worktrees/add-controller-config-wizard/projects/synth/apps/miniapp/build/controllers_page_simulation_tests && \
  /Users/joyo/Sheaf/.claude/worktrees/add-controller-config-wizard/projects/synth/apps/miniapp/build/controllers_page_simulation_tests
```

Exit: `0`; JUCE Controllers-page simulations passed. The release compile emits
the existing unrelated `ControllerWizard.cpp` unused-variable warning.

### Fix commit

`fix(synth-ui): stabilize wizard chooser routing`

## Fix round 2 — defer production JUCE structural refreshes

### Root cause and red evidence

`ControllersPageSurface::NeedsDeferredDispatch` was only consulted by a JUCE
simulation. The actual JUCE path was synchronous:

`SemanticTextButton::onClick` → `PortableComponent::DispatchCurrentNodeAction`
→ `RuntimeMainComponent::DispatchAction` → MainPane action handler
→ `PortableComponent::RefreshFromSurface` → `RebuildControls`.

That last step can delete the clicked control before its `onClick` callback
returns. Added a real `RuntimeShellSession` JUCE regression that checks the
shared deferred classification for existing structural actions plus Wizard
Open/Choose/Back/Cancel, clicks the production Controllers Back button, then
requires the clicked node to remain rendered until the queued refresh flushes.

```sh
make -C projects/synth/apps/miniapp \
  /Users/joyo/Sheaf/.claude/worktrees/add-controller-config-wizard/projects/synth/apps/miniapp/build/runtime_shell_session_tests && \
  /Users/joyo/Sheaf/.claude/worktrees/add-controller-config-wizard/projects/synth/apps/miniapp/build/runtime_shell_session_tests
```

Exit: `2` (expected red): the regression first failed to compile because the
production `MainPane` exposed neither the shared deferred-refresh classifier
nor queued-refresh state/flush seam. Before the fix, its existing synchronous
handler would have removed the Controllers Back node immediately after click.

### Change

- `RuntimeMainComponent::NeedsDeferredDispatch` now delegates to the portable
  Controllers surface classification; `MainPane` consumes it in the real JUCE
  action handler.
- Structural actions still dispatch exactly once immediately, but their
  renderer rebuild is coalesced and posted through `juce::MessageManager::callAsync`.
  A `juce::Component::SafePointer<MainPane>` makes the callback harmless after
  host teardown; a rejected queue post never falls back to destructive
  synchronous rebuilding.
- The shared classification covers the pre-existing structural actions,
  Controllers Back, Available Configure, and Wizard Open/Choose/Back/Cancel.
  Submit/Ignore remain Task 12 behavior.
- Replaced `ControllersPageSimulationTests`' hand-maintained deferred action
  list with `surface.NeedsDeferredDispatch(action)` to prevent drift.

### Green verification

```sh
make -C projects/synth build/controllers_page_ui_tests build/portable_ui_tests \
  build/runtime_main_component_tests && \
  projects/synth/build/controllers_page_ui_tests && \
  projects/synth/build/portable_ui_tests && \
  projects/synth/build/runtime_main_component_tests && \
  make -C projects/synth check-ui-boundary && \
  git diff --check
```

Exit: `0`; portable Controllers tests passed, all 17 runtime-main cases
passed, and static checks passed.

```sh
make -C projects/synth/apps/miniapp \
  /Users/joyo/Sheaf/.claude/worktrees/add-controller-config-wizard/projects/synth/apps/miniapp/build/runtime_shell_session_tests \
  /Users/joyo/Sheaf/.claude/worktrees/add-controller-config-wizard/projects/synth/apps/miniapp/build/controllers_page_simulation_tests && \
  /Users/joyo/Sheaf/.claude/worktrees/add-controller-config-wizard/projects/synth/apps/miniapp/build/runtime_shell_session_tests && \
  /Users/joyo/Sheaf/.claude/worktrees/add-controller-config-wizard/projects/synth/apps/miniapp/build/controllers_page_simulation_tests
```

Exit: `0`; the runtime-shell regression and both deterministic Controllers
simulations passed. Their release compiles retain the pre-existing unrelated
`ControllerWizard.cpp` unused-variable warning.

### Deferred minor

`m_wizardChooserStatus` still persists across chooser close/reopen. This does
not overlap the production deferral mechanism and remains deferred for a
later targeted chooser-state cleanup.

### Fix commit

`fix(synth-ui): defer structural controller refreshes`
