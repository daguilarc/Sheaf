# Slice 0008: Experiments, Cleanup, And Compatibility Verification

## Objective

Finish the migration by making experiments workflow-directory based, removing obsolete hard-coded workflow code paths, and adding compatibility tests that prove the default workflow preserves current durable formats and execution semantics.

Expected outcome: the runner no longer contains reachable hard-coded main quest workflow logic. Experiments replace/copy whole `workflow/` directories, stop conditions validate against workflow state ids and `node_name` overrides, and the full test suite verifies byte-format-compatible state, issue, thread, log, and commit artifacts.

## Key Files And Systems

- Modify `experiments.py` and experiment-related service/CLI paths.
- Remove or make unreachable:
  - `state_machine/quest_v2_definitions.py`
  - `state_machine/quest_v2_nodes.py`
  - `state_machine/quest_v2_predicates.py`
  - hard-coded branches in `v2_step_executor.py`
  - `_ROLE_MAP`, marker constants, `build_task_instruction()`, `reviewer_commit_context()`, `find_next_slice()`, `scaffold_slice_dir()`, and `apply_transition_filesystem_side_effects()` in `quest_runner.py`
  - state mappings in `legacy_quest_state_io.py` and `v2_quest_state_io.py`
  - role/scope knowledge in `quest_thread.py` and `issue_service.py`
  - `QuestState` / `SliceState` execution validation paths, retaining only a generic reserved `ExperimentComplete` constant or equivalent
- Update docs under `projects/quest-runner/docs/` and `quest_docs/` to describe `workflow/` and `--file` issue commands.
- Tests:
  - `test_experiments.py`
  - `test_experiment_lifecycle.py`
  - `test_experiment_stop_conditions.py`
  - `test_experiment_scoped_operations.py`
  - full `make -C projects/quest-runner test`

## Experiment Behavior

Experiment creation changes:

- CLI/API should accept an alternate workflow directory or archive instead of a single `state_execution_config.yaml` body.
- Source experiment metadata stores a copy of the alternate `workflow/` directory under the experiment directory.
- Experiment worktree replaces the quest-local `workflow/` directory with the alternate workflow.
- Existing `experiment.json` metadata shape remains parseable; add fields only if readers ignore unknown fields.
- Existing experiments that already have `state_execution_config.yaml` should either be upgraded through the writable quest upgrade path when opened or rejected with a clear migration error if they cannot be safely upgraded. Do not keep a hidden runner fallback to old config execution.

Stop condition validation:

- Validate `stop_node` against the loaded workflow machines:
  - logical state ids
  - `node_name` overrides
  - case-insensitive aliases currently supported, where they map to the default workflow's node names
- Validate `stop_machine_path` generically:
  - `root/quest` for top-level
  - `root/slice` or `slice` for any child slice
  - explicit repo-relative machine paths for concrete child instances
- Keep `snapshot_matches_stop_condition()` behavior over recursive snapshots.
- On stop match, write reserved top-level state `ExperimentComplete` and commit `experiment-complete-state: <id>` exactly as today.

Artifact archiving:

- Logs remain copied from `logs/*.jsonl`.
- Issues and issue responses should be archived by walking workflow-declared issue files, including concrete child matches, rather than hard-coded `physicalplan` and `polishing` paths.
- Preserve archive directory conventions:
  - `experiments/<number>/issues/`
  - `experiments/<number>/issue_responses/`
  - quest-relative paths preserved below those roots

## Cleanup Requirements

Remove old code rather than retaining fallback behavior:

- Delete packaged `default_state_execution_config.yaml` after all callers use `default_workflow/`.
- Delete packaged `roles/*.md` after prompts are copied to `default_workflow/prompts/` and no callers read package roles.
- Delete hard-coded state-machine definition/node/predicate modules or leave only thin compatibility imports if deleting would be too disruptive for import paths; no runner path may use them.
- Remove docs and tests that describe `state_execution_config.yaml` as the current default.
- Remove issue `scope` and `slice` API/CLI docs.
- Keep dashboard/web UI files unchanged.

## Compatibility Verification Matrix

Add focused tests or golden fixtures proving the default workflow preserves:

- Quest root `state.md` normalized format and tags.
- Slice `state.md` legacy persisted values.
- `state_history.md` creation behavior.
- Issue file markdown fields, including `owner_role`.
- Issue response file deterministic naming.
- `thread_registry.json` shape and default registry keys.
- Thread names sent to harness providers.
- JSONL log filename and event schema, with profile name in the `role` field.
- Quest-step commit message header lines and `recursive-snapshot-json` block.
- Recursive snapshot fields and child nesting.
- Runner result statuses and payload shapes.
- Dirty-workspace, human-intervention, no-op, and max-steps behavior.
- Experiment `ExperimentComplete` behavior.

Representative default workflow snapshot tests must cover:

- `PrePlanning` manual advance to `PhysicalPlanning`
- `PhysicalPlanning -> ReviewPhysicalPlan`
- `ReviewPhysicalPlan -> PhysicalPlanning` when issues are open
- `ReviewPhysicalPlan -> PrepareNextSlice` when accepted
- `PrepareNextSlice -> ExecuteSlice` with active child selection
- `ExecuteSlice` with child `SliceSetup -> Implementing`
- `ExecuteSlice` with child `Implementing -> PolishingReview`
- `ExecuteSlice` with child `PolishingReview -> PolishingFix`
- `ExecuteSlice` with child `PolishingFix -> PolishingReview`
- `ExecuteSlice` with child `PolishingReview -> Completed`
- `ExecuteSlice -> PrepareNextSlice` after child completion
- `PrepareNextSlice -> QuestDocumenting` with no unfinished slices
- `QuestDocumenting -> Completed`

At least one test should use the known current history example commit `89414b7` or an equivalent fixture to assert `SliceSetupNode`, `SliceSetup`, and `Implementing` appear exactly as before.

## Existing APIs To Reuse

- Reuse recursive snapshot traversal and experiment metadata read/write helpers.
- Reuse workflow loader and interpreter validation from earlier slices.
- Reuse issue-file resolver from slice 0007 for archive discovery.
- Reuse commit metadata render/parse validation.

## APIs To Extend Or Modify

- Replace experiment `--config-file` meaning. If retaining the flag name temporarily for CLI ergonomics, it must point to a workflow directory/archive and help text must say workflow, not `state_execution_config.yaml`.
- Replace `validate_state_execution_config_text()` use in experiment creation with workflow validation.
- Replace stop-node hard-coded maps from `quest_v2_definitions` with workflow machine state/node metadata.
- Introduce a generic reserved state constant for `ExperimentComplete` if removing `QuestState`.

## Validation Expectations

- Full test suite passes with no hard-coded workflow modules used by runner execution.
- `rg` checks in tests or reviewer notes should find no reachable references to:
  - `state_execution_config.yaml` as active quest config
  - `--scope physicalplan`
  - `--scope polishing`
  - hard-coded role routing maps
  - hard-coded default transition predicates
- Documentation tests or simple content checks confirm public docs describe `workflow/`, service-level harness config, and issue `--file`.
- Manual smoke verification:
  - create a new quest
  - initialize slices
  - advance from `PrePlanning`
  - run through at least one synthetic child step with marker files
  - create/respond/list issues using `--file`
  - create an experiment with alternate workflow and match a stop condition
