# Quest Runner Experiment System

## Overview

Add an experiment system to Quest Runner so a completed quest can be replayed
from an earlier state-machine step with a different execution configuration,
prompt/model choice, or other transition-table variation. An experiment is a
separate git worktree and branch, rooted at an earlier commit from the original
quest history, but its metadata and final artifacts are tracked under the
original quest on the main branch.

The two core operations are:

1. **Create experiment**: register experiment metadata on the source/main
   checkout, create an experiment branch and worktree from the commit immediately
   before the selected start step, and replace the quest's
   `state_execution_config.yaml` in the experiment worktree with the experimental
   transition config.
2. **Work with experiment**: run the experiment like a normal quest, scoped by an
   experiment id, until the configured stop condition is reached; then land the
   experiment by copying its runtime artifacts back to the source/main checkout
   instead of rebasing its code changes.

Experiments are expected to be created after the original quest is complete and
landed. Therefore the original quest worktree may no longer exist. Any CLI or API
operation that targets an experiment must use the experiment worktree, not the
quest worktree.

## Goals

- Allow operators to create named experiments for any project-local quest.
- Track all experiment metadata in the original quest directory on the source
  checkout so the main branch knows which experiments exist.
- Create experiment worktrees from a historical quest step, specifically the
  parent commit of the selected start step, so the experiment can rerun that step.
- Let each experiment provide an alternate `state_execution_config.yaml`.
- Run experiments through the existing quest runner machinery with minimal
  duplicated execution logic.
- Stop an experiment automatically when it reaches its configured workflow graph
  end condition and mark it as ready to land.
- Add CLI/API support for passing an optional experiment id to all quest-scoped
  operations that need to read or mutate quest state.
- Make agent prompts explicitly preserve and pass the current experiment id when
  working in an experiment.
- Land completed experiments by archiving logs/issues/issue responses under the
  original quest's experiment directory and pushing the experiment branch to
  remote, then deleting the local branch and worktree.
- Show completed experiment artifacts on regular quest dashboard pages.
- Show open experiment worktrees alongside main and side quests in the dashboard,
  with a Land button that invokes experiment landing.
- Add focused tests and documentation for creation, execution scoping, landing,
  and dashboard behavior.

## Non-Goals

- Do not merge, rebase, or cherry-pick experiment code changes into main.
- Do not make experiments a third quest type; they are child records of an
  existing `main` or `side` quest.
- Do not require a database or external index for experiments.
- Do not migrate legacy top-level `quests/` records into experiment support.
- Do not change normal quest creation, running, or landing behavior when no
  experiment id is provided.
- Do not delete remote experiment branches during experiment landing.

## Terminology

- **Source checkout**: the normal Sheaf checkout, usually on `main`, that holds
  the canonical quest directory and receives committed experiment metadata and
  landed artifacts.
- **Experiment worktree**: a git worktree created for one experiment. The runner
  treats this worktree as the command and git boundary while the experiment is
  open.
- **Experiment id**: the stable experiment name:
  `experiment_<projectSlug>_<mainOrSide>_<questNumber>_<experimentNumber>`.
  Example: `experiment_quest-runner_main_0_0`.
- **Experiment number**: a zero-based integer assigned within a single quest.
  The source checkout assigns the next available number by inspecting the
  original quest's `experiments/` directory.
- **Open experiment**: an experiment whose local experiment worktree exists.
- **Completed experiment**: an experiment whose experiment worktree reached the
  configured stop condition and whose state is `ExperimentComplete` or
  equivalent. It may still need to be landed.
- **Closed experiment**: an experiment that has been landed; its local worktree
  and local branch have been removed and its archived artifacts are committed
  under the original quest's `experiments/` directory.

## Experiment Directory Layout

For every quest that has experiments, create an `experiments/` directory under
that quest record on the source checkout:

```text
projects/<project>/quests/<main|side>/<number>_<slug>/
  experiments/
    0000/
      experiment.json
      notes.md
      state_execution_config.yaml
      logs/
      issues/
      issue_responses/
    0001/
      ...
```

The per-experiment directory name is the zero-padded experiment number. The
source checkout owns this directory. The experiment worktree will contain the
same quest path as normal, but the source checkout's `experiments/<number>/`
directory is the permanent archive and metadata record.

### `experiment.json`

Each experiment metadata file must include at least:

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

The exact `stop_condition` shape may follow the existing recursive state-machine
naming, but it must identify a node in the workflow graph deterministically. The
system must validate that the requested start step and stop condition are
recognizable before creating a worktree.

### `notes.md`

`notes.md` is a short human-readable note containing:

- the experiment purpose/description,
- the start step, including role or node label, such as step five
  `implementer`,
- the stop/end condition, such as `slice_completed`,
- any operator comments needed to interpret results.

### Experimental state execution config

The alternate transition config is stored as:

```text
experiments/<number>/state_execution_config.yaml
```

Creation also copies this file into the experiment worktree at the quest's normal
`state_execution_config.yaml` path, replacing the original config for that
experiment only.

## Experiment Naming And Worktrees

Use deterministic names so every API, CLI command, dashboard view, and prompt can
refer to the same experiment.

- Experiment id/worktree basename:
  `experiment_<projectSlug>_<mainOrSide>_<questNumber>_<experimentNumber>`
- Worktree path:
  `<repo-parent>/.quest-worktrees/<experiment_id>/`
- Branch name:
  `experiment/<projectSlug>/<mainOrSide>/<questNumber-padded>/<experimentNumber-padded>`

The project slug should be the canonical project name already used by Quest
Runner. Quest number and experiment number may be unpadded in the id if that is
more convenient, but path ordering and branch names should use zero padding.
The implementation must document the final convention and cover it with tests.

## Create Experiment Operation

Add a REST API and CLI command for experiment creation.

Suggested REST API:

```text
POST /experiments/create
```

Suggested CLI:

```bash
scripts/quest-runner experiments create \
  --project quest-runner \
  --type main \
  --number 0 \
  --start-step 5 \
  --stop-node slice_completed \
  --notes-file /tmp/experiment-notes.md \
  --config-file /tmp/state_execution_config.yaml
```

Required behavior:

1. Resolve the original quest directory in the source checkout from `project`,
   `quest_type`, and `quest_number`.
2. Create `experiments/` if it does not exist.
3. Assign the next available experiment number by inspecting existing numeric
   subdirectories under `experiments/`.
4. Build the experiment id and branch/worktree names.
5. Find the selected start step's commit. Prefer existing step commit metadata
   if available; otherwise resolve it from the quest's `state_history.md`, step
   logs, or git history in a deterministic and test-covered way.
6. Set the experiment base commit to the parent of the selected step commit
   (`<step_commit>^`) so rerunning the experiment starts before that step.
7. Write `experiments/<number>/experiment.json`, `notes.md`, and the supplied
   `state_execution_config.yaml` on the source checkout.
8. Commit those metadata files on the source checkout with a clear message, for
   example `experiment-create: quest-runner/main/0000/0000`.
9. Create a git branch from the base commit and add an experiment worktree at the
   deterministic experiment worktree path.
10. In the experiment worktree, replace the quest's normal
    `state_execution_config.yaml` with the experimental config and ensure the
    quest state/log files correspond to the selected base commit.
11. Mark the experiment status as `open` or `running-ready` in source metadata if
    a status update is needed after successful worktree creation.
12. Return the experiment id, experiment number, worktree path, branch name, base
    commit, start step, and dashboard URL.

Creation must be atomic enough to recover from failures. If metadata is committed
but worktree creation fails, the API should return enough detail for an operator
to retry or clean up. Partial worktrees or branches should be removed when safe.

## Running Experiments

Experiments run through the existing quest execution code. The difference is
scope resolution:

- Without an experiment id, APIs and CLI commands resolve the regular quest
  worktree exactly as they do today.
- With an experiment id, APIs and CLI commands resolve the experiment worktree
  and operate on the quest directory inside that worktree.

All quest-scoped CLI commands must accept an optional experiment id. This
includes at least `run`, `advance`, `land`, issue commands, slice commands, and
any dashboard-oriented helper commands that read quest artifacts. For example:

```bash
scripts/quest-runner run \
  --project quest-runner \
  --type main \
  --number 0 \
  --experiment-id experiment_quest-runner_main_0_0
```

When an experiment id is supplied:

- the service must verify that the experiment belongs to the requested quest,
- the service must verify that the experiment worktree exists for operations that
  require an open experiment,
- `run_quest` must use the experiment worktree as the git and command boundary,
- runtime logs should be written to the quest's normal `logs/` directory inside
  the experiment worktree,
- issues and issue responses should be written to the normal issue files inside
  the experiment worktree,
- per-step commits should be created on the experiment branch.

The runner must stop when the configured stop condition is reached. At that
point it must set a distinct experiment completion state, such as
`ExperimentComplete`, without treating the quest as normally landed. This state
is what the dashboard uses to show the experiment Land button.

## Agent Prompt Requirements

When an agent is running in an experiment, injected context and role prompts must
include the current experiment id and must instruct the agent to pass it to all
Quest Runner CLI calls. Example prompt language:

> This turn is part of experiment `experiment_quest-runner_main_0_0`. When using
> `scripts/quest-runner`, pass `--experiment-id experiment_quest-runner_main_0_0`.
> Do not omit the experiment id; the original quest worktree may not exist.

If the service detects a CLI/API call from an experiment context that omits the
experiment id and the regular quest worktree is missing, the command should fail
with a clear error explaining that the experiment id is required.

## Experiment Landing

Experiment landing is separate from normal quest landing. It archives experiment
artifacts and cleans up the local experiment checkout; it does not rebase or
merge experiment code into main.

Suggested REST API:

```text
POST /experiments/land
```

Suggested CLI:

```bash
scripts/quest-runner experiments land \
  --project quest-runner \
  --type main \
  --number 0 \
  --experiment-id experiment_quest-runner_main_0_0
```

Required behavior:

1. Resolve and validate the experiment metadata on the source checkout.
2. Verify that the experiment worktree exists and is in the experiment completed
   state, unless an explicit operator override is added.
3. Copy all JSONL files created during the experiment from the experiment
   worktree into:

   ```text
   experiments/<number>/logs/
   ```

   Preserve filenames and enough relative path information to avoid collisions.
4. Copy any issues created or modified during the experiment into:

   ```text
   experiments/<number>/issues/
   ```

5. Copy any issue responses created during the experiment into:

   ```text
   experiments/<number>/issue_responses/
   ```

6. Update `experiment.json` status to `landed` and record landed timestamp,
   pushed remote branch, and source commit if useful.
7. Push the experiment branch to the configured remote using the unique
   experiment branch name. The remote branch must remain available for later
   inspection.
8. Remove the local experiment worktree.
9. Delete the local experiment branch after the remote push succeeds.
10. Commit the copied artifacts and metadata update on the source checkout, for
    example `experiment-land: quest-runner/main/0000/0000`.
11. Return copied file counts, remote branch name, source commit hash, and the
    dashboard URL for the archived experiment.

If pushing the branch fails, do not delete the local branch or worktree. If
copying artifacts fails, do not mark the experiment landed. Errors must be clear
and actionable.

## Dashboard And Web UI

### Completed experiments on regular quest pages

For regular quest pages, add an optional experiments section or page when the
quest has an `experiments/` directory. This view is for closed/landed
experiments archived on the source checkout.

It must show:

- experiment id, number, description, start step, stop condition, status, and
  creation/landing timestamps,
- agent runs from JSONL files under `experiments/<number>/logs/`,
- issues archived under `experiments/<number>/issues/`,
- issue responses archived under `experiments/<number>/issue_responses/`,
- links to the remote experiment branch when available.

### Open experiments in quest panes

The existing dashboard panes list main quests and side quests. Add open
experiments to the dashboard as separate visible items. An experiment is open if
its experiment worktree exists. Because an experiment worktree has the normal
quest structure, the dashboard may populate its detail panes by reading the
experiment worktree as if it were a regular quest, while clearly labeling it as
an experiment.

Open experiment entries must show at least:

- experiment id,
- parent project/type/quest number,
- description,
- current state,
- start step and stop condition,
- worktree path or branch if useful to operators.

If an open experiment is in the experiment completed state, its UI entry must
show a Land button. That button must call experiment landing, not the existing
normal quest rebasing land flow.

## Data And API Design Requirements

- Add experiment-aware path resolution in a centralized module rather than
  scattering path logic across CLI, API, issue service, runner, and dashboard
  code.
- Treat experiment id validation as part of request validation. An experiment id
  must resolve to exactly one experiment metadata record and must match the
  supplied quest identity.
- Keep normal quest APIs backward-compatible when `experiment_id` is absent.
- For experiment APIs, include both the parent quest identity and experiment id
  in request/response payloads.
- Prefer explicit status values such as `created`, `open`,
  `experiment_complete`, `landed`, and `failed` over inferring all status from
  files, while still using worktree existence to distinguish open from closed for
  dashboard purposes.
- Document the experiment metadata schema in the Quest Runner docs.

## Testing Requirements

Add focused automated tests for:

- experiment id, branch, and worktree naming,
- assigning the next available experiment number,
- creating the `experiments/<number>/` metadata files,
- resolving a start step to its commit and base commit,
- creating a worktree from the parent of the selected step commit,
- swapping in the experimental `state_execution_config.yaml`,
- CLI request payloads with and without `--experiment-id`,
- API validation that experiment id matches the supplied quest,
- failure when an experiment-scoped command omits experiment id and no regular
  quest worktree exists,
- stopping at the configured stop condition and marking `ExperimentComplete` (or
  the final chosen state name),
- experiment landing copying JSONL logs, issues, and issue responses into the
  source checkout archive,
- experiment landing pushing the remote branch and not deleting local state if
  the push fails,
- deleting the local worktree and local branch only after successful archival and
  push,
- dashboard data for archived completed experiments,
- dashboard data for open experiment worktrees,
- the experiment Land button choosing experiment landing instead of normal quest
  landing.

## Documentation Requirements

Update Quest Runner documentation to describe:

- experiment concepts and lifecycle,
- metadata and directory layout,
- create/run/land CLI examples,
- how start-step replay works from `<step_commit>^`,
- how agents should preserve and pass `--experiment-id`,
- dashboard behavior for open and closed experiments,
- operational recovery notes for failed create or land operations.
