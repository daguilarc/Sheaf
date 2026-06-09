# Main Quest State Machine

## Quest Overview

Replace the current hard-coded quest runner workflow with a configurable state
machine described in a new YAML-based language. The language and its default
configuration must be expressive enough to encode the existing main quest
workflow, including prompts, roles, transitions, review loops, and completion
behavior, without any runner Python code referencing specific workflow graphs.

For this quest, a **workflow** is the complete quest-local program executed by
the Quest Runner: state-machine definitions, nested-machine definitions,
transition conditions, issue-file declarations, profile bindings, harness/model
configuration, prompts, path variables, and workflow-owned files. The runner is a
generic interpreter for this workflow; it must not know the current main quest's
role names, issue file names, slice graph, or transition rules as Python
workflow logic.

## Goals

- Replace the current quest-local `state_execution_config.yaml` model with a
  self-contained state-machine configuration directory.
- Define the new state-machine language in YAML, with prompts and all related
  execution details stored in the configuration directory rather than embedded in
  Python.
- Encode all existing main quest workflow graphs in the new language.
- Remove the old hard-coded Python workflow implementations after their behavior
  is represented in the new configuration.
- Ensure the quest runner contains no Python code that directly references any
  specific hard-coded workflow, role graph, or existing quest lifecycle path.
- Ensure the runner has no behavior specific to the current workflows; it should
  execute only the generic state-machine configuration object.
- Represent every current runner concept needed by the workflow in the new
  configuration, including roles, harness/profile selection, prompt content,
  transition conditions, state updates, loops, issue/acceptance files, and quest
  completion.
- Implement the current main quest state machine in the new language.
- Make the new implementation the default state configuration for all newly
  created quests.
- Automatically copy the default state-machine configuration directory into each
  new quest at quest creation time.
- Upgrade older writable quest state configs from `state_execution_config.yaml`
  to the new format instead of maintaining backward compatibility in the runner.
- Treat legacy top-level quests as read-only records; do not migrate or modify
  them.
- Keep every on-disk and committed artifact format unchanged except the
  execution configuration itself (`state_execution_config.yaml` is replaced by
  the `workflow/` directory). Quest and slice `state.md` formats, issue and
  issue-response files, `thread_registry.json` keys, log naming, and the
  quest-step commit-message/snapshot format must remain byte-format-compatible
  with the current runner. This is a port of the workflow logic from Python to
  configuration, not a change to what the runner produces. See
  `07_compatibility_and_execution_semantics.md` for the full compatibility
  contract.

## Non-goals

- **No dashboard or web UI changes.** This quest must not modify dashboard or
  web UI code (`dashboard_*.py`, `agui_mapper.py`, the web frontend). Those
  components must keep working against the unchanged on-disk formats and
  unchanged commit metadata produced by the new interpreter.
- No change to observable execution behavior of the default workflow, with two
  explicitly accepted exceptions: the `QuestDocumenting -> Completed`
  docs-changed gate is dropped (the documenter still runs; the transition
  becomes unconditional), and the broken automatic reviewer commit-hash
  context is replaced by prompt guidance.
- No new workflow features beyond what the current main quest needs.

## Success Criteria

- A new quest can run using only the state-machine configuration directory and
  no hard-coded workflow graph in Python.
- All current main quest states, roles, transitions, prompts, and review loops
  are encoded in YAML.
- The old hard-coded workflow code paths are removed or made unreachable by the
  runner.
- New quests receive the default state-machine configuration automatically.
- Existing writable project-local quests can be upgraded to the new format.
- Legacy quests remain unchanged and read-only.
- A quest run by the new interpreter produces `state.md` files, issue files,
  thread-registry entries, and step commits that are byte-format-identical
  with what the current runner produces for the same transitions (modulo the
  two accepted behavior exceptions listed in Non-goals).
- Dashboards and the web UI work unchanged against quests executed by the new
  interpreter.
