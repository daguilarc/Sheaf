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
      workflow/
      specs/
      slices/
      logs/
      threads/
```

## Slice scaffold

Physical planners initialize slices through:

```bash
scripts/quest-runner slices init --project <project> --type <main|side> --number <n> --count <count> --slug <slug> ...
```

Each initialized slice directory is named `<number>_<slug>` and contains:

```text
slices/
  0001_example/
    physicalplan/
    state.md
    state_history.md
    polishing_issues.md
```

The initializer leaves `physicalplan/` empty. The physical planner writes the
actual plan markdown files after the scaffold exists.

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

## Experiment layout

Experiments are child records of an existing main or side quest. The source
checkout owns experiment metadata and archives:

```text
projects/<project>/quests/<type>/<number>_<slug>/
  experiments/
    0000/
      experiment.json
      notes.md
      workflow/
      logs/
      issues/
      issue_responses/
```

The numeric experiment directory is zero-padded. `experiment.json`, `notes.md`,
and the alternate `workflow/` directory are committed on the source checkout
when the experiment is created. `logs/`, `issues/`, and `issue_responses/` are
populated when the experiment is landed.

The experiment worktree uses a deterministic basename:

```text
experiment_<project>_<type>_<questNumber>_<experimentNumber>
```

It lives beside other Quest Runner worktrees:

```text
<repo-parent>/.quest-worktrees/<experiment_id>/
```

The branch name is:

```text
experiment/<project>/<type>/<questNumber:04d>/<experimentNumber:04d>
```

The worktree contains the normal quest directory layout and is the git,
command, issue, and log boundary while the experiment is open. The source
checkout remains the permanent metadata and archive boundary. See
[Runtime files](runtime-files.md#experiment-metadata) for the metadata schema
and [Replay a quest as an experiment](../how-to/replay-experiment.md) for the
operator workflow.

## Legacy top-level quests

The repository may still contain legacy records at:

```text
quests/
  main|side/
    <number>_<slug>/
```

These paths remain on disk but are intentionally excluded from Quest Runner
discovery, dashboard listing, and execution. They are not migrated by this
service.

## Runtime schema docs

Bundled quest runtime schema reference for maintainers lives at
`src/quest_runner_service/quest_docs/`. Human-facing project docs link here but
do not duplicate that content.

Issue markdown files under each quest directory remain the storage format. Agents
normally use `scripts/quest-runner issues ...` instead of editing those files
directly.

The quest-local `workflow/` directory stores the executable state-machine
configuration. See [Workflow reference](workflow.md) for its layout and grammar.
