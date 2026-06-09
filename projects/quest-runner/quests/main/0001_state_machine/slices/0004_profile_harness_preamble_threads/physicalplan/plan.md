# Slice 0004: Profiles, Harnesses, Preamble, And Threads

## Objective

Move role/profile execution details, prompt lookup, runtime preamble text, thread naming, and path-rule expansion from hard-coded Python into workflow profile and preamble configuration.

Expected outcome: when an interpreter state has a `run` block, the runner executes the declared workflow profile using generic profile data, `workflow/prompts/*.md`, `workflow/preamble.md`, profile thread templates, and service-level harness provider configuration. No Python code should infer behavior from role names.

## Key Files And Systems

- Modify `quest_runner.py` around `perform_role_harness_sequence()` so it accepts a workflow profile execution context and task text instead of a hard-coded role/task mapping.
- Modify `quest_thread.py`:
  - replace `build_spec_thread_name()` role checks with workflow `thread.name_template`
  - replace `role_thread_key()` usage with `thread.registry_key_template`
  - replace `build_role_prompt()` and `build_runtime_context()` hard-coded text with workflow prompt/preamble rendering
- Modify `state_machine/adapters.py` to resolve workflow profiles instead of `state_execution_config.yaml`.
- Add `projects/quest-runner/src/quest_runner_service/harness_config.py` or equivalent service-level loader.
- Add repository-root `config/quest-runner.json` support for harness provider config:
  - top-level `harnesses` mapping
  - provider keys such as `cursor`, `codex`, `claude_code`
  - provider config objects passed unchanged to `create_harness()`
- Tests:
  - `test_harness_quest_thread_core.py`
  - `test_worktree_execution_path.py`
  - new `test_workflow_profile_execution.py`

## Profile Execution Behavior

For a workflow state with:

```yaml
run:
  profile: implementer
  task: |
    ...
```

the runner must:

- Resolve `profile` from `workflow.yaml`.
- Load the base prompt from the profile's `prompt` path.
- Render `workflow/preamble.md` if declared.
- Render `run.task`.
- Assemble message exactly in the current structural order:
  - first round: profile prompt, then `---`, then rendered preamble, then `Task:`, then rendered task
  - later rounds: rendered preamble, then `Task:`, then rendered task
- Continue logging the prompt through the same JSONL `sheaf.prompt` event schema.
- Use the profile name in the log `role` field for compatibility with current role names in the default workflow.
- Apply post-harness modify allow/block rules from `profile.modify`.
- Keep dirty-workspace validation, revert/follow-up behavior, captured outputs, and log file naming unchanged.

The default workflow profile names intentionally match current role names, so log filenames remain `logs/step_NNNN_<profile>.jsonl`.

## Preamble Rendering

Implement interpolation for the shared preamble template:

- Always expose:
  - `$quest`
  - `$project`
  - `$machine`
  - `{quest_type}`
  - `{quest_number}`
  - `{quest_slug}`
  - `{quest_name}`
  - `{profile}`
  - `{active_slice}`
- Expose only when enabled by profile `runtime_context`:
  - `$active_child` through `include_current_child_path`
  - `$log_dir` through `include_log_directory`
  - `$thread_registry` through `include_thread_registry_path`
  - `$reference_docs` through `include_reference_docs_path`
- Expose `{experiment_guidance}` as a runner-rendered string:
  - empty outside experiments
  - includes experiment id and instruction to pass `--experiment-id <id>` inside experiments

A template referencing a variable not exposed to that profile is a workflow validation or rendering error. Do not silently substitute an empty string except for variables explicitly documented as empty when absent, such as `$active_child` for quest-scoped profiles with the toggle enabled.

The default workflow sets `include_reference_docs_path: true` on every profile because the shared default preamble always references `$reference_docs`. The default preamble text must match spec `08_agent_preamble.md`, including issue commands that use `--file`.

## Thread Identity

Implement template rendering for:

- `thread.scope`: support `quest` and `child` initially
- `thread.name_template`
- `thread.registry_key_template`

Template metadata:

- `{repo}`
- `{quest_number}`
- `{profile}`
- `{collection}`
- `{child_id}`
- `{child_number}` parsed from the child's four-digit directory prefix

Default workflow must produce exactly current thread names and registry keys:

- quest-scoped: `<repo>_quest_<quest_number:04d>_<profile>` with key `<profile>`
- child-scoped: `<repo>_quest_<quest_number:04d>_slice_<child_number:04d>_<profile>` with key `slice_<child_number>_<profile>`

This preserves existing `thread_registry.json` shape and resumes upgraded quests on existing provider threads.

## Harness Provider Config

Implement service-level harness config lookup:

- Read repository-root `config/quest-runner.json` if present.
- Expected shape:

```json
{
  "harnesses": {
    "cursor": {"cli_path": "/path/to/cursor-agent"},
    "claude_code": {"cli_path": "/path/to/claude"},
    "codex": {}
  }
}
```

- If missing, use an empty config mapping; harnesses that require `cli_path` fail through existing harness validation.
- The workflow profile references only `harness: cursor` or similar provider keys.
- Do not copy provider config into `workflow/`, quests, or experiments.

When upgrading this repository's current default, move the `harnesses` mapping currently in `default_state_execution_config.yaml` into `config/quest-runner.json`.

## Existing APIs To Reuse

- Reuse `create_harness()` and existing harness classes unchanged.
- Reuse `perform_role_harness_sequence()` internals where possible: logging, message send, path-rule enforcement, follow-up messages, and captured outputs should not be rewritten unnecessarily.
- Reuse `read_thread_registry()` and `write_thread_registry()` without changing the JSON shape.
- Reuse `runtime_quest_docs_dir()` as the value for `$reference_docs`.

## APIs To Extend Or Modify

- Introduce a generic `WorkflowProfile` runtime object separate from old `ExecutionProfile`.
- Replace `QuestRootRoleProfileResolver.ResolveRoleProfile(state_machine_dir, role)` with a workflow resolver keyed by profile name and quest-local workflow directory.
- Replace `_ROLE_MAP`, `_SLICE_SCOPED_THREAD_ROLES`, `build_task_instruction()`, and `reviewer_commit_context()` call sites with workflow `run.profile`, `thread.*`, and `run.task`.
- Keep reviewer commit-hash context removed; do not reintroduce it in Python or workflow data.

## Validation Expectations

- Tests assert default profile parsing reproduces current harness/model/timeout/modify rules after placeholder migration.
- Tests assert first-round and later-round message assembly structure.
- Tests assert rendered default preamble contains `--file physicalplan_issues.md` and `$active_child/polishing_issues.md`, not `--scope`.
- Tests assert quest-scoped and child-scoped thread names and registry keys match current values.
- Tests assert profile path allow/block interpolation maps:
  - `$quest`
  - `$active_child`
  - `$project`
- Tests assert unknown template variables fail loudly.
- Tests assert `$reference_docs` renders only when `include_reference_docs_path` is enabled.
- Existing harness execution tests pass with injected harness config fixtures.
