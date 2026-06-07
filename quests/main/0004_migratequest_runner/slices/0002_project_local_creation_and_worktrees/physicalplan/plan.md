# Physical Plan: Project-Local Creation And Worktrees

## Objective

Change quest creation and discovery primitives from repository-root `quests/` to canonical project-local `projects/<project>/quests/`, add deterministic project identity to quest data, and create the quest worktree immediately after the quest record is created on the currently checked-out branch.

Expected outcome:

- `POST /create_quest` internals can create `projects/<project>/quests/<main|side>/<number>_<slug>/`.
- Quest numbering is scoped by `(project, quest_type)`.
- Top-level legacy `quests/` is ignored by quest discovery helpers.
- Quest metadata includes deterministic owning project identity.
- New quest creation creates a worktree whose name and path are deterministically derived from project and quest identity.
- If worktree creation fails, the implementation rolls back the newly created quest record and any partially created worktree.

## Deterministic Data Model Decisions

Project identity should be both derived and persisted:

- Canonical source: quest path under `projects/<project>/quests/`.
- Persisted metadata: extend `QuestMeta` with `project: str`.
- Reader compatibility: when reading older metadata without `project`, derive it from the path if the quest is under `projects/<project>/quests/`; reject project-local reads if neither metadata nor path can identify a project.
- Writer behavior: always write `"project": "<project>"` in new `meta.json`.

Worktree convention:

- Worktree name: `<project>_<quest_type>_<quest_number:04d>_<quest_slug>`.
- Worktree branch: `quest/<worktree_name>`, created from the currently checked-out source branch after the quest scaffold commit described below.
- Slug normalization: reuse `normalize_slug` for quest slug; validate `project` as an existing directory name under `projects/` using the same conservative character set as quest slugs or a stricter `^[A-Za-z0-9][A-Za-z0-9_-]*$`.
- Worktree base directory: sibling to the source Sheaf checkout parent under `.quest-worktrees/`, specifically `<source_repo_parent>/.quest-worktrees/<worktree_name>`.
- Persisted value: no absolute worktree path is required in quest metadata; derive from source repo root and quest metadata every time. API responses may include the derived `worktree_name` and `worktree_path`.

This convention includes owning project and quest identity, is stable across runner components, and avoids creating worktrees inside the source checkout.

## Key Files And Systems

Likely affected files:

- `projects/quest-runner/src/quest_runner_service/quest_types.py`
- `projects/quest-runner/src/quest_runner_service/quest_fs.py`
- `projects/quest-runner/src/quest_runner_service/quest_service.py`
- `projects/quest-runner/src/quest_runner_service/worktrees.py` or equivalent new helper module
- `projects/quest-runner/src/quest_runner_service/default_state_execution_config.yaml`
- `projects/quest-runner/tests/test_quest_fs.py`
- `projects/quest-runner/tests/test_quest_service.py`
- New focused tests such as `test_project_quest_model.py` and `test_worktrees.py`

## Existing APIs To Reuse As-Is

- Reuse `normalize_slug`, `_resolve_repo`, `_is_git_repo`, `utc_now_iso`, and current quest skeleton writing behavior.
- Reuse `quest_fs.write_quest_state`, `write_quest_meta`, `write_thread_registry`, and execution config parsing/writing behavior.
- Reuse current rollback pattern in `QuestService.create_quest`.

## APIs To Extend Or Modify

- Extend `QuestMeta` with `project: str`; update `read_quest_meta` and `write_quest_meta` accordingly.
- Replace `_next_quest_number(repo_path, quest_type)` with `_next_quest_number(repo_path, project, quest_type)` scanning `repo_path / "projects" / project / "quests" / quest_type`.
- Replace `quest_fs.find_quest_dir(repo_path, quest_type, quest_number)` with a project-aware API:
  - `project_quest_root(repo_root, project) -> Path`
  - `find_quest_dir(repo_root, project, quest_type, quest_number) -> Path | None`
  - `list_quest_dirs(repo_root, project, quest_type) -> list[Path]`
  - `iter_project_quest_roots(repo_root) -> list[ProjectQuestRoot]`
- Keep legacy helper names only if all call sites are updated in the same slice or covered by compatibility wrappers that require an explicit project argument.
- Add worktree helpers:
  - `quest_worktree_name(project, quest_type, quest_number, quest_slug) -> str`
  - `quest_worktree_path(source_repo_root, meta) -> Path`
  - `create_quest_worktree(source_repo_root, meta) -> Path`
  - `worktree_exists(source_repo_root, meta) -> bool`

## Implementation Notes

Creation flow:

1. Resolve and validate the source Sheaf checkout root.
2. Require the source checkout to be on a named branch and clean before creation. Return a clear validation error if it is detached or dirty; this prevents the API from committing unrelated user work.
3. Validate `project` exists at `projects/<project>/` and has or can create `quests/`.
4. Validate `quest_type`, `name`, and optional `slug`.
5. Compute next number from `projects/<project>/quests/<quest_type>/`.
6. Create the quest directory and files on the currently checked-out branch in the source checkout.
7. Write `meta.json` with `project`, `quest_type`, `quest_number`, `quest_slug`, `quest_name`, `created_at`, and `created_by`.
8. Copy the default execution config, but update default `modify_block`/`modify_allow` patterns if they currently assume top-level `quests/**`; path rules must use project-local quest paths via `$currentQuest` and `$currentSlice`.
9. Stage only the newly-created quest record path and create a scoped commit on the current branch, for example `quest-create: <project>/<quest_type>/<number>_<slug>`. This commit is required so the immediately-created worktree contains the quest record and starts clean.
10. Create the deterministic git worktree with a deterministic quest branch from that commit, for example `git worktree add -b quest/<worktree_name> <worktree_path> HEAD`. The implementation must not switch branches in the source checkout.
11. Return `project`, `quest_dir`, `worktree_name`, `worktree_branch`, `worktree_path`, and the quest-create commit in the API/service result.

Rollback must remove the quest directory and partially created worktree on failure before the quest-create commit. After the quest-create commit succeeds, failures must not rewrite history automatically; instead, remove the partial worktree/branch when safe and return a clear error that names the committed quest record requiring human cleanup. Do not touch unrelated worktrees or branches.

Discovery must never scan top-level `quests/`. Tests should create both `quests/main/0000_legacy` and `projects/example/quests/main/0000_modern` and assert only the project-local quest is returned.

## Validation

- Unit tests for project-local creation file set, metadata project field, per-project/per-type numbering, and legacy exclusion.
- Unit tests for deterministic worktree name and path.
- Integration-style tests using temporary git repositories for create-quest worktree creation from the current branch.
- Tests that create-quest refuses dirty or detached source checkouts.
- Tests that the quest-create commit contains only the new project-local quest record path and that the new worktree starts clean.
- Tests for rollback when worktree creation fails.
- Tests for metadata reader compatibility when `project` is absent but path is project-local.
- Run `make -C projects/quest-runner test`.
