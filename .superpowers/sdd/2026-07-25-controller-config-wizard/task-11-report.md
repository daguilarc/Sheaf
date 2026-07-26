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
