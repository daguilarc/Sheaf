# Quest directory layout

Quest Runner treats project-local quests as canonical. Discovery scans
`projects/*/quests/` and ignores the legacy top-level `quests/` directory.

Implementation: `src/quest_runner_service/quest_fs.py`.

## Canonical layout

```text
projects/<project>/quests/
  main|side/
    <number>_<slug>/
      meta.json
      state.md
      state_history.md
      thread_registry.json
      physicalplan_issues.md
      state_execution_config.yaml
      specs/
      slices/
      logs/
      threads/
```

## Project identity

Each quest record includes a `project` field in `meta.json`. When the field is
missing on disk, the runner derives it from the path segment immediately after
`projects/`.

Quest numbering is scoped by project and quest type. For example,
`projects/web/quests/main/0000_a/` and
`projects/quest-runner/quests/main/0000_b/` can both exist.

## Metadata shape

`meta.json` fields:

| Field | Description |
| --- | --- |
| `project` | Owning Sheaf project name |
| `quest_type` | `main` or `side` |
| `quest_number` | Zero-based number within project and type |
| `quest_slug` | Normalized slug from the quest name |
| `quest_name` | Original human-readable name |
| `created_at` | ISO-8601 UTC timestamp |
| `created_by` | Optional creator identifier |

## Worktree naming

When a quest is created, Quest Runner immediately creates a git worktree named:

```text
<project>_<quest_type>_<number>_<slug>
```

Example: `example_main_0000_my_quest`.

Worktrees live beside the source repository:

```text
<repo-parent>/.quest-worktrees/<worktree_name>/
```

The worktree uses branch `quest/<worktree_name>`.

All runner components resolve the same worktree identity from project and quest
metadata. `run_quest` executes in the worktree checkout, not the source Sheaf
checkout.

See [Quest lifecycle](../explanation/lifecycle.md) for creation and execution flow.

## Legacy top-level quests

The repository may still contain legacy records at:

```text
quests/
  main|side/
    <number>_<slug>/
```

These paths remain on disk but are intentionally excluded from Quest Runner
discovery, dashboard listing, and execution. They are not migrated by this
service. A future quest may migrate individual legacy records into project-local
layout.

## Runtime schema docs

Bundled quest runtime schema reference for maintainers lives at
`src/quest_runner_service/quest_docs/`. Human-facing project docs link here but
do not duplicate that content.

Issue markdown files under each quest directory remain the storage format. Agents
normally use `scripts/quest-runner issues ...` instead of editing those files
directly.
