# Quest Schemas

This document describes the quest runtime files Conductor reads and writes now.
Where older quests still use legacy formats, the compatibility rules are called
out explicitly.

## Quest State File

Path:

```text
<quest_dir>/state.md
```

Canonical format for active v2 quests:

```markdown
# State

- global_step: 18
- machine_name: quest
- machine_path: quests/main/0002_state_machine_abstraction
- state: ExecuteSlice
- updated_at: 2026-04-01T12:00:00Z

## Tags

- active_slice: 0001_example_slice
- quest_number: 2
- quest_slug: state_machine_abstraction
- quest_type: main
```

Rules:

- The first non-empty line is `# State`.
- The state block uses `- key: value` lines.
- Allowed state keys are `global_step`, `machine_name`, `machine_path`, `state`,
  and `updated_at`.
- Quest-root normalized state always uses `machine_name: quest`.
- `global_step` is required for committed v2 top-level quest state and increments
  once per successful top-level runner step commit.
- `machine_path` is repo-relative and points to the quest directory.
- `## Tags` is required, even when empty.
- Tags are string-to-string entries.
- The runner writes `quest_type`, `quest_number`, and `quest_slug` tags.
- During `ExecuteSlice`, `tags.active_slice` is required and must be a slice
  directory name such as `0001_example_slice`.
- Outside `ExecuteSlice` and `PrepareNextSlice`, `active_slice` is omitted.

Compatibility:

- Readers also accept the legacy quest format:

```markdown
# Quest State

state: ExecuteSlice
current_slice: 1
updated_at: 2026-04-01T12:00:00Z
active_slice: 0001_example_slice
global_step: 18
```

- `read_quest_file_state` auto-detects the format by heading.
- `create_quest` still scaffolds new quests with the legacy `# Quest State`
  layout.
- Once the v2 runner commits a top-level step, it rewrites quest-root `state.md`
  in normalized form.

Supported quest filesystem states:

- `PrePlanning`
- `PhysicalPlanning`
- `ReviewPhysicalPlan`
- `ExecuteSlice`
- `QuestDocumenting`
- `Completed`
- `ExperimentComplete` (experiments only)

The quest machine also uses `PrepareNextSlice` internally, but that logical node
does not persist as a distinct quest filesystem state.

## Slice State File

Path:

```text
<slice_dir>/state.md
```

Format:

```markdown
# Slice State

state: NotStarted|Implementing|PolishingReview|PolishingFix|Done
updated_at: <ISO-8601 UTC timestamp>
```

Rules:

- Slice state files remain in the legacy key/value format.
- The first non-empty line is `# Slice State`.
- The runner persists only the filesystem states above.
- The recursive slice machine also uses logical nodes such as `SliceSetup` and
  `Completed`, but those map onto the persisted slice states rather than changing
  the file schema.

## Step Commit Metadata

Each successful top-level runner step for the canonical v2 runner creates one git
commit whose message carries recursive state-machine metadata.

Commit message shape:

```text
quest-step: 18
state-machine-path: quests/main/0002_state_machine_abstraction
node: ExecuteActiveSliceNode
state-before: ExecuteSlice
state-after: ExecuteSlice

recursive-snapshot-json:
{
  "global_step": 18,
  "snapshot": {
    "child": {
      "child": null,
      "machine_name": "slice",
      "machine_path": "quests/main/0002_state_machine_abstraction/slices/0001_example_slice",
      "node_name": "SliceImplementingNode",
      "role": "implementer",
      "state_after": "Implementing",
      "state_before": "Implementing",
      "tags": {},
      "thread_name": "repo_quest_0002_slice_0001_implementer"
    },
    "machine_name": "quest",
    "machine_path": "quests/main/0002_state_machine_abstraction",
    "node_name": "ExecuteActiveSliceNode",
    "state_after": "ExecuteSlice",
    "state_before": "ExecuteSlice",
    "tags": {
      "active_slice": "0001_example_slice",
      "quest_number": "2",
      "quest_slug": "state_machine_abstraction",
      "quest_type": "main"
    }
  }
}
```

Rules:

- `quest-step` must equal JSON `global_step`.
- Header `state-machine-path`, `node`, `state-before`, and `state-after` must match
  the root JSON snapshot.
- The JSON payload must be pretty-printed multi-line JSON after the
  `recursive-snapshot-json:` marker.
- `snapshot.child` recursively represents nested machine execution for a slice step,
  or `null` for a quest-only step.
- `role` and `thread_name` appear when the step executed an agent-backed node.
- If metadata validation fails, the runner writes
  `logs/commit_metadata_validation_*.md`, creates
  `human_intervention_request.md`, and does not commit the step.
- On a noop top-level step with no filesystem changes, the runner skips the commit
  and does not increment `global_step`.

Compatibility:

- Older quests may still rely on `state_history.md` and older transition commit
  titles.
- Dashboard history readers merge commit metadata with `state_history.md` and prefer
  metadata when the same commit appears in both sources.

## Issue Response Files

Responder-written records of how open reviewer issues were handled. These files are
separate from reviewer-owned issue lists (`physicalplan_issues.md`,
`polishing_issues.md`, `integration_test_issues.md`).

Paths:

```text
<quest_dir>/physicalplan_issue_responses.md
<quest_dir>/integration_test_issue_responses.md
<slice_dir>/polishing_issue_responses.md
```

Write authority:

- `physicalplan_issue_responses.md`: `physical_planner` only.
- `polishing_issue_responses.md`: `polisher` only for the current slice.
- `integration_test_issue_responses.md`: `integration_test_polisher` only.

Read authority:

- `physical_plan_reviewer` must read `physicalplan_issue_responses.md` when
  verifying open physical plan issues.
- `polisher_reviewer` must read `polishing_issue_responses.md` when verifying open
  polishing issues.
- `integration_tester` must read `integration_test_issue_responses.md` when
  verifying open integration test issues.

Reviewers must not create, edit, or delete entries in response files.

Full normative schema: [`schemas/issue-responses.md`](schemas/issue-responses.md).

## Issue Files

Paths:

```text
<quest_dir>/physicalplan_issues.md
<quest_dir>/integration_test_issues.md
<slice_dir>/polishing_issues.md
```

Format:

```markdown
# Issues

## Issue QP-0001

- status: open|completed
- owner_role: physical_plan_reviewer|polisher_reviewer
- created_at: <ISO-8601 UTC timestamp>
- updated_at: <ISO-8601 UTC timestamp>
- title: <short title>
- details: <markdown text>
- resolution_notes: <markdown text or none>
```

Rules:

- `status` may only be `open` or `completed`.
- Reviewer roles are the only roles allowed to mark issues `completed`.
- `details` and `resolution_notes` may span multiple lines.
- `resolution_notes: none` means the field is unset.

## State History Files

Paths:

```text
<quest_dir>/state_history.md
<slice_dir>/state_history.md
```

Format:

```markdown
# State Transition History

## 2026-03-29T00:00:00Z

- previous_state: <state name>
- next_state: <state name>
- commit: <git commit hash>
- thread_name: <thread name or none>
- notes: <short summary>
```

Current behavior:

- `create_quest` still scaffolds quest-root `state_history.md`.
- Slice scaffolding still creates slice `state_history.md`.
- The canonical v2 runner does not append new transition rows for top-level step
  history.
- Older quests and older runner paths may still contain authoritative history rows,
  and dashboard readers continue to support them.

## Thread Registry

Path:

```text
<quest_dir>/thread_registry.json
```

Format:

```json
{
  "implementer": {
    "thread_name": "myrepo_quest_0002_slice_0001_implementer",
    "harness_kind": "cursor",
    "provider_thread_id": "provider-thread-id",
    "pass_id": 0,
    "round_count": 3,
    "created_at": "2026-03-29T00:00:00Z",
    "last_used_at": "2026-03-29T00:00:00Z"
  }
}
```

Current naming:

- Quest-scoped v2 roles use `<repo>_quest_<quest_number:04d>_<role>`.
- Slice-scoped v2 roles use
  `<repo>_quest_<quest_number:04d>_slice_<slice_number:04d>_<role>`.
- Older threads may still use the legacy slug-based pattern
  `<repo>_quest_<quest_slug>_<role>_0`.

## Execution Config

Path:

```text
<quest_dir>/state_execution_config.yaml
```

Shape:

```yaml
version: 2
harnesses:
  claude_code:
    cli_path: /path/to/claude
profiles:
  implementer:
    harness: cursor
    model: composer-2.5
    reasoning_effort: high
    idle_timeout_seconds: 3600
    modify_allow:
      - "$currentQuest/human_intervention_request.md"
      - "$currentSlice/implementation_done.md"
      - "$currentSlice/notes/**"
    modify_block:
      - "**"
```

Rules:

- `profiles` keys are role names.
- Allowed harness values are `codex`, `cursor`, and `claude_code`.
- `reasoning_effort` is optional. When present, it must be a string.
- `version: 2` adds optional per-profile `modify_allow` and `modify_block`
  repo-root-relative glob lists.
- `modify_allow` and `modify_block` may use only `$currentQuest`,
  `$currentSlice`, and `$currentProject`.
- `$currentProject` resolves to the repo-relative project directory for the
  current quest, such as `projects/example`.
- When both lists match the same path, allow wins.
- The runner refuses to invoke a harness when the target repository working tree is
  not fully clean, including untracked files.
- After each harness turn, the runner compares the repository to the pre-turn
  snapshot, reverts changes outside the role's allowed paths, records those reverts
  in the step log, and sends a follow-up in the same thread telling the agent to
  continue within its allowed paths.
- `version: 1` configs keep legacy behavior: no path-rule enforcement and empty
  parsed allow/block lists.

## Experiment Metadata

Path:

```text
<quest_dir>/experiments/<number>/experiment.json
```

`<number>` is the zero-padded experiment number (`0000`, `0001`, …).

Required fields:

```json
{
  "experiment_id": "experiment_quest-runner_main_0_0",
  "experiment_number": 0,
  "project": "quest-runner",
  "quest_type": "main",
  "quest_number": 0,
  "quest_slug": "experiments",
  "description": "Try a different implementer model for slice execution.",
  "start_step": {
    "global_step": 5,
    "role": "implementer",
    "step_log": "logs/step_0005_implementer.jsonl",
    "step_commit": "<commit-for-step-5>",
    "base_commit": "<parent-of-step-5>"
  },
  "stop_condition": {
    "machine_path": "root/slice",
    "node_name": "slice_completed"
  },
  "worktree_name": "experiment_quest-runner_main_0_0",
  "branch_name": "experiment/quest-runner/main/0000/0000",
  "status": "created",
  "created_at": "2026-06-08T00:00:00Z",
  "created_by": "operator"
}
```

Optional fields:

- `completed_at` — ISO-8601 UTC timestamp when the stop condition was reached
- `landed_at` — ISO-8601 UTC timestamp when the experiment was landed
- `remote_branch` — pushed experiment branch name on the remote

Archived artifact paths (populated on the source checkout after landing):

```text
<quest_dir>/experiments/<number>/logs/
<quest_dir>/experiments/<number>/issues/
<quest_dir>/experiments/<number>/issue_responses/
```

Status values:

- `created` — metadata written; worktree may not exist yet
- `open` — experiment worktree exists and is runnable
- `experiment_complete` — stop condition reached; ready to land
- `landed` — artifacts archived on the source checkout; local worktree removed
- `failed` — terminal failure state

Naming conventions:

- Experiment id / worktree basename:
  `experiment_<project>_<quest_type>_<quest_number>_<experiment_number>`
  (quest and experiment numbers are unpadded in the id)
- Experiment directory name: four-digit padded experiment number
- Branch name:
  `experiment/<project>/<quest_type>/<quest_number:04d>/<experiment_number:04d>`
- Worktree path:
  `<repo-parent>/.quest-worktrees/<experiment_id>/`

Path-like fields such as `start_step.step_log` and `stop_condition.machine_path`
are stored as repo-relative strings.

## ExperimentComplete Quest State

When an experiment reaches its stop condition, quest-root `state.md` persists
`ExperimentComplete`. This is separate from normal quest `Completed` and from
metadata status `experiment_complete` on the source checkout.

## Human Intervention Request

Path:

```text
<quest_dir>/human_intervention_request.md
```

Minimum content:

```markdown
# Human intervention requested

**Reason:** <short reason>

<details>
```

Presence of this file blocks further automatic quest progress until a human resolves
the condition.

## Implementer Completion Marker

Path:

```text
<slice_dir>/implementation_done.md
```

Purpose:

- Signals that the implementer believes the full current slice plan is complete.
- The runner advances out of `Implementing` only when this file exists.

## Physical Plan Acceptance Marker

Path:

```text
<quest_dir>/physicalplan_accepted.md
```

Purpose:

- Signals that `physical_plan_reviewer` found no remaining open physical plan issues
  and accepts the quest-level plan review.
- The runner advances out of `ReviewPhysicalPlan` only when this file exists and
  `physicalplan_issues.md` has no open entries.

## Integration Test Issues

Path:

```text
<quest_dir>/integration_test_issues.md
```

Purpose:

- Records integration test bugs and blockers found after all slices complete.
- The runner routes from `IntegrationTesting` to `IntegrationTestPolishing` while
  this file has open entries, and routes to `QuestDocumenting` when no open entries
  remain.

## Implementation Acceptance Marker

Path:

```text
<slice_dir>/implementation_accepted.md
```

Purpose:

- Signals that `polisher_reviewer` found no remaining open polishing issues and
  accepts the current slice implementation.
- The runner advances the slice to logical completion only when this file exists and
  `polishing_issues.md` has no open entries.
