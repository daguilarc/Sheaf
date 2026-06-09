# Snapshot Generation And Compatibility

## Goal

The workflow interpreter must continue to produce recursive quest-step snapshots
that are substantially compatible with the current hard-coded runner snapshots.
Dashboards, experiment stop conditions, logs, and commit metadata should still be
able to reason over the same core fields.

Small additions are allowed, but the core shape should remain stable.

## Current snapshot shape

Current quest-step commits include a `recursive-snapshot-json` block like this:

```json
{
  "global_step": 5,
  "snapshot": {
    "machine_name": "quest",
    "machine_path": "projects/quest-runner/quests/main/0000_experiments",
    "node_name": "ExecuteActiveSliceNode",
    "state_before": "ExecuteSlice",
    "state_after": "ExecuteSlice",
    "tags": {
      "active_slice": "0001_experiment_foundation"
    },
    "child": {
      "machine_name": "slice_0001_experiment_foundation",
      "machine_path": "projects/quest-runner/quests/main/0000_experiments/slices/0001_experiment_foundation",
      "node_name": "SliceSetupNode",
      "state_before": "SliceSetup",
      "state_after": "Implementing",
      "tags": {},
      "child": null
    }
  }
}
```

## Proposed snapshot shape

For the default workflow, the workflow interpreter generates snapshots that are
**byte-format-identical** with the current runner. The default workflow keeps
the `active_slice` variable name (so tags are unchanged) and pins legacy node
names via per-state `node_name` overrides (so node names are unchanged):

```json
{
  "global_step": 5,
  "snapshot": {
    "machine_name": "quest",
    "machine_path": "projects/quest-runner/quests/main/0000_experiments",
    "node_name": "ExecuteActiveSliceNode",
    "state_before": "ExecuteSlice",
    "state_after": "ExecuteSlice",
    "tags": {
      "active_slice": "0001_experiment_foundation"
    },
    "child": {
      "machine_name": "slice_0001_experiment_foundation",
      "machine_path": "projects/quest-runner/quests/main/0000_experiments/slices/0001_experiment_foundation",
      "node_name": "SliceSetupNode",
      "state_before": "SliceSetup",
      "state_after": "Implementing",
      "tags": {},
      "child": null
    }
  }
}
```

Differences allowed (for non-default workflows; the default workflow must not
exercise them):

- `node_name` may be the workflow state id when a workflow declares no
  `node_name` override. Example: `ExecuteSlice` instead of
  `ExecuteActiveSliceNode`.
- `tags` may include other workflow variable names chosen by the workflow.
- Additional metadata fields may be present if consumers ignore unknown fields.

Differences not allowed:

- Removing `machine_name`.
- Removing `machine_path`.
- Removing `node_name`.
- Removing `state_before`.
- Removing `state_after`.
- Removing `tags`.
- Removing `child`.
- Changing recursive child nesting semantics.
- Omitting the child snapshot when a child machine step ran.

## Snapshot generation algorithm

For each executed machine step, the workflow interpreter should generate a
snapshot from execution-local data, not by rereading git history.

### Inputs

- current machine definition
- current machine directory
- state before execution
- selected node/state definition
- workflow variable/tags before and after execution
- child snapshot, if a child machine ran
- state after transition evaluation

### Algorithm

1. Read current machine state before executing the node.
2. Resolve the current state definition from the workflow machine YAML.
3. Record:
   - `machine_name`
   - `machine_path`
   - `node_name` (the state's `node_name` override, or the state id)
   - `state_before` (logical state name, after `persisted_as` mapping)
   - `tags`
4. Execute `actions`, `run`, and `child` according to the grammar.
5. If a child machine runs, capture the child machine's recursive snapshot.
6. Evaluate transitions and choose `state_after`.
7. Persist the new state and updated tags.
8. Return:

```json
{
  "machine_name": "...",
  "machine_path": "...",
  "node_name": "...",
  "state_before": "...",
  "state_after": "...",
  "tags": {},
  "child": null
}
```

9. The top-level step commit wraps this snapshot with `global_step` exactly as the
   current runner does.

## Field definitions

- `global_step`: monotonically increasing quest step number.
- `machine_name`: workflow machine name for the top-level machine; for child
  collections, use `<machine>_<child_id>` to preserve current readability, for
  example `slice_0001_foundation`.
- `machine_path`: repo-relative path to the machine instance directory.
- `node_name`: workflow state/node id that executed.
- `state_before`: state value before execution.
- `state_after`: state value after transition evaluation.
- `tags`: persisted workflow variables relevant to the machine, plus the
  runner-provided quest identity tags on the top-level machine. For the
  default quest workflow this includes `active_slice` while a slice is active,
  matching current history.
- `child`: recursive child snapshot when a child machine was run, otherwise
  `null`.

## Compatibility comparison procedure

To compare the new workflow implementation against the current runner:

1. Select representative current commits from git history.
2. Extract their `recursive-snapshot-json` commit-message blocks.
3. Run the same quest state transition through the workflow interpreter in a test
   fixture.
4. Normalize old and new snapshots.
5. Compare required fields and recursive structure.

### Suggested representative current snapshots

Use current git history examples that include each important step type:

- `PrePlanning` manual advance to `PhysicalPlanning`.
- `PhysicalPlanning` to `ReviewPhysicalPlan`.
- `ReviewPhysicalPlan` to `PhysicalPlanning` when issues are open.
- `ReviewPhysicalPlan` to `PrepareNextSlice` when accepted.
- `PrepareNextSlice` to `ExecuteSlice` with active child selection.
- `ExecuteSlice` with child `SliceSetup` to `Implementing`.
- `ExecuteSlice` with child `Implementing` to `PolishingReview`.
- `ExecuteSlice` with child `PolishingReview` to `PolishingFix`.
- `ExecuteSlice` with child `PolishingFix` to `PolishingReview`.
- `ExecuteSlice` with child `PolishingReview` to `Completed`.
- `ExecuteSlice` to `PrepareNextSlice` after child completion.
- `PrepareNextSlice` to `QuestDocumenting` when no unfinished slices remain.
- `QuestDocumenting` to `Completed`.

A known current example for child setup is commit `89414b7`, whose child snapshot
contains `node_name: SliceSetupNode`, `state_before: SliceSetup`, and
`state_after: Implementing`.

## Normalization for comparison

Because the default workflow pins legacy node names via `node_name` overrides
and keeps the `active_slice` tag name, snapshots from the new interpreter
should compare **equal without normalization** against current history for the
default workflow. Tests should compare them directly.

A normalization map is still useful as test tooling for workflows that omit
`node_name` overrides (state ids instead of class names):

```json
{
  "PrePlanningGateNode": "PrePlanning",
  "PhysicalPlanningNode": "PhysicalPlanning",
  "ReviewPhysicalPlanNode": "ReviewPhysicalPlan",
  "PrepareNextSliceNode": "PrepareNextSlice",
  "ExecuteActiveSliceNode": "ExecuteSlice",
  "QuestDocumentingNode": "QuestDocumenting",
  "SliceSetupNode": "SliceSetup",
  "SliceImplementingNode": "Implementing",
  "SlicePolishingReviewNode": "PolishingReview",
  "SlicePolishingFixNode": "PolishingFix",
  "SliceCompletedNode": "Completed",
  "CompletedGateNode": "Completed"
}
```

No tag normalization is needed: the default workflow's active variable is named
`active_slice`, matching existing history.

After normalization (where applicable), snapshots should match on:

- recursive shape
- machine path
- machine identity semantics
- executed node semantics
- state before
- state after
- active child identity
- child snapshot presence/absence

## Test requirements

Add focused tests that verify:

- workflow-generated snapshots include all required fields;
- child-machine execution produces nested child snapshots;
- top-level no-child states produce `child: null`;
- `ExecuteSlice` snapshots include the child step result;
- terminal-state snapshots remain parseable by experiment stop conditions;
- default-workflow snapshots are byte-format-identical with representative
  current-history snapshots (same node names, same tags, no normalization);
- old hard-coded snapshot examples normalize to the new workflow snapshot shape
  when a workflow omits `node_name` overrides;
- commit metadata rendering and parsing continue to round-trip with the new
  snapshots;
- dashboards and experiment stop-condition code ignore additional snapshot fields.

## Acceptance requirement

The implementation is not acceptable if the new workflow interpreter loses the
recursive snapshot structure. Experiments and dashboards must be able to continue
using snapshots as the durable description of what state-machine step occurred.
