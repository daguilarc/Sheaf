# Slice 0003 Implementation Complete

Implemented the generic workflow interpreter for the default quest and slice machines.

## Delivered

- `workflow_paths.py` — path variables (`$quest`, `$project`, `$machine`, `$active_child`), brace interpolation (`{now}`, workflow vars), collection child listing, and absolute-path rejection.
- `workflow_conditions.py` — boolean composition, file/issue/variable/collection/child-result conditions.
- `workflow_actions.py` — file actions, variable actions, and `select_child` with spec-accurate strictly-after semantics.
- `workflow_interpreter.py` — `WorkflowStateMachine`, `WorkflowMachineLoader`, `WorkflowExecutionResult`, and `ExecutionMode` (automated vs manual with `manual_only` / `stay` / `stop` handling and injectable run-profile callback).
- `test_workflow_interpreter.py` — 24 tests covering every default-workflow transition listed in the physical plan, plus migrated predicate coverage and execution-mode behavior.
- `WorkflowStateIo.machine_key_for_dir()` public helper and Makefile test registration.

All new and related tests pass (`tests.test_workflow_interpreter`, `tests.test_workflow_state_io`, `tests.test_workflow_config`, `tests.test_quest_v2_predicates`).
