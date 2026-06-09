# Slice 0004 Implementation Complete

Moved profile execution, preamble rendering, thread identity, and harness provider configuration from hard-coded Python into workflow data and service-level config.

## Delivered

- `harness_config.py` — loads repository-root `config/quest-runner.json` harness provider mappings.
- `config/quest-runner.json` — service-level harness CLI paths (moved from packaged `default_state_execution_config.yaml`).
- `workflow_profile_execution.py` — profile execution context, preamble/task interpolation, message assembly, thread name/registry-key rendering, and workflow profile → execution profile conversion.
- `quest_runner.perform_role_harness_sequence()` — accepts workflow profile, task text, and execution context instead of hard-coded role prompts and `build_task_instruction()`.
- `quest_thread.build_spec_thread_name()` — uses workflow `thread.name_template`.
- `quest_v2_nodes` — resolves `run.profile` / `run.task` from workflow machines, service harness config, and workflow thread templates.
- `adapters.WorkflowProfileResolver` — resolves profiles from quest-local or packaged `workflow/` (alias `QuestRootRoleProfileResolver`).
- Default workflow profiles — `include_current_child_path` enabled for shared preamble `$active_child` interpolation.
- `expand_modify_path_patterns()` — supports `$quest`, `$active_child`, and `$project` alongside legacy placeholders.
- `test_workflow_profile_execution.py` — 12 tests for profiles, preamble, threads, path rules, and harness config.

All tests pass (`make test`, 435 tests).
