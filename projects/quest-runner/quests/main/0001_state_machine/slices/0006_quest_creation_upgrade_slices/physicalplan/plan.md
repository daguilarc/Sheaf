# Slice 0006: Quest Creation, Upgrade, And Slice Scaffolding

## Objective

Make `workflow/` the default quest execution configuration for new quests, provide an upgrade path for writable project-local quests with `state_execution_config.yaml`, and generalize `slices init` to use workflow collection scaffold actions.

Expected outcome: newly created quests contain a copied workflow directory rather than `state_execution_config.yaml`; existing writable project-local quests can be upgraded in place; legacy top-level quests are not modified; slice initialization preserves current CLI behavior while deriving scaffold files from the workflow collection declaration.

## Key Files And Systems

- Modify `quest_service.py`:
  - `create_quest()`
  - `initialize_slices()`
  - experiment mutable checkout handling where it assumes `state_execution_config.yaml`
- Modify `cli.py` only as needed for `slices init --collection`.
- Add upgrade helpers in a new module such as `workflow_upgrade.py` or within `quest_service.py`.
- Modify `quest_fs.py` config helpers to prefer `workflow/` and stop requiring `state_execution_config.yaml` for writable quests.
- Tests:
  - `test_quest_creation.py`
  - `test_quest_service_api.py`
  - `test_migration_validation.py`
  - `test_cli.py`
  - new `test_workflow_upgrade.py`

## Quest Creation Behavior

New quest creation must:

- Copy packaged `default_workflow/` to `<quest_dir>/workflow/`.
- Write initial quest root `state.md` using entry machine initial state from workflow (`PrePlanning` for default).
- Write normalized `# State` / `## Tags` root state with:
  - `state: PrePlanning`
  - `machine_name: quest`
  - `machine_path` repo-relative quest path
  - `global_step: 0`
  - current timestamp
  - quest identity tags
- Apply top-level `workflow.yaml` `scaffold` actions once at quest creation. For default this creates `physicalplan_issues.md` with `# Issues\n`.
- Continue creating:
  - `state_history.md`
  - `meta.json`
  - `thread_registry.json`
  - `specs/.gitkeep`
  - `slices/.gitkeep`
- Stop copying `default_state_execution_config.yaml`.
- Return `created_files` with `workflow/` entries and without `state_execution_config.yaml`.

The on-disk issue, history, registry, and state formats must remain compatible with current dashboard readers.

## Writable Quest Upgrade Behavior

Provide an explicit service/CLI upgrade path, and also make runner startup detect and upgrade writable project-local quests before execution if they still have `state_execution_config.yaml` and no `workflow/`.

Upgrade applies only to project-local quests under `projects/<project>/quests/...`.

Upgrade steps:

1. Confirm the quest is writable and not a legacy top-level quest.
2. Load old `state_execution_config.yaml`.
3. Copy packaged `default_workflow/` to `<quest_dir>/workflow/`.
4. Port profile customizations:
   - old `profiles.<role>.harness` to `workflow/profiles/<role>.yaml`
   - old `model`
   - old `reasoning_effort`
   - old `idle_timeout_seconds`
   - old `modify_allow` / `modify_block`, with placeholders renamed:
     - `$currentQuest -> $quest`
     - `$currentSlice -> $active_child`
     - `$currentProject -> $project`
5. Move old `harnesses` config out of the quest:
   - merge it into repository-root `config/quest-runner.json` under `harnesses`
   - do not store it in `workflow/`
   - if the target config already has a provider key, preserve the existing service-level value and report that the quest-local provider was skipped
6. Delete `state_execution_config.yaml`.
7. Leave `state.md`, slice `state.md`, issue files, issue-response files, logs, and `thread_registry.json` untouched.
8. If quest root `state.md` is still in pre-normalized `# Quest State` format, rewrite it to the normalized format through workflow-aware state I/O, preserving state, active slice, current global step, timestamp semantics, and quest identity tags.

A quest in `QuestDocumenting` resumes and completes on the next step because the docs gate is intentionally gone.

Legacy top-level quests outside `projects/<project>/quests`:

- are treated as read-only records
- are not upgraded
- are not modified by runner startup
- can still be read by dashboard/filesystem readers where currently supported

## Slice Initialization Behavior

Keep the existing command shape:

```text
scripts/quest-runner slices init --project <project> --type <main|side> --number <n> --count <count> --slug <slug> ...
```

Add optional:

```text
--collection <name>
```

Rules:

- If omitted and the workflow declares exactly one collection, use it.
- If omitted and multiple collections exist, return a clear validation error.
- New child directories are created under the root of the collection `path` glob. For default `slices/*`, create under `slices/`.
- Directory names keep current `NNNN_slug` convention.
- Existing numbering and slug normalization behavior stays the same.
- Scaffold files come from collection `scaffold` actions, not Python hard-coded file writes.
- For default workflow, collection scaffold actions are exactly:
  - `physicalplan/`
  - `state.md` with exact content `"# Slice State\n\nstate: NotStarted\nupdated_at: {now}\n"` after `{now}` interpolation
  - `state_history.md` with exact content `"# State Transition History\n\n"`
  - `polishing_issues.md` with exact content `"# Issues\n"`
  - `notes/`
- Return payload keeps existing fields (`slice_number`, `slice_slug`, `directory_name`, `slice_dir`, `created_files`) and may include `collection`.
- For the default workflow, `created_files` is intentionally updated to report every created scaffold entry in order:
  - `physicalplan`
  - `state.md`
  - `state_history.md`
  - `polishing_issues.md`
  - `notes`

This unifies the two current divergent scaffold paths. It preserves current committed slice-init bytes for tracked files, including the two trailing newlines in `state_history.md`; it intentionally adds empty `notes/` to `slices init` and lets `SliceSetup` repair a missing `physicalplan/`.

## Existing APIs To Reuse

- Reuse `normalize_slug()`, quest worktree creation, metadata writing, and scaffold commit flow.
- Reuse action execution from slice 0003 for creation and collection scaffolds.
- Reuse workflow loader from slice 0001.
- Reuse `WorkflowStateIo` from slice 0002 for normalized state conversion.

## APIs To Extend Or Modify

- Replace `MissingDefaultExecutionConfig` with a workflow-oriented error or broaden it to cover missing packaged default workflow.
- Replace config validation calls for experiment and quest creation with workflow validation where relevant.
- Remove `state_execution_config.yaml` from creation docs/tests in favor of `workflow/`.
- Add upgrade result reporting for:
  - copied workflow files
  - deleted old config
  - profile overrides ported
  - harness provider config merged/skipped
  - normalized state rewrite performed

## Validation Expectations

- New quest creation tests assert:
  - `workflow/` exists with all default files
  - no `state_execution_config.yaml`
  - root `state.md` is normalized with `global_step: 0`
  - `physicalplan_issues.md` comes from workflow scaffold
  - dashboard/project quest listing still reads the quest
- Upgrade tests cover:
  - basic old config to workflow conversion
  - profile customization migration
  - placeholder renames
  - harness config merge to `config/quest-runner.json`
  - pre-normalized root state rewrite
  - legacy top-level quest is not modified
- Slice init tests cover default collection, explicit collection, multiple-collection error, exact default scaffold files and byte content, `created_files` order including `notes`, rollback on failure, and experiment worktree operation.
