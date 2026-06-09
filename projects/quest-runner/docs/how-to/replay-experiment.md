# Replay a quest as an experiment

Experiments let an operator rerun an existing quest from an earlier v2
state-machine step with a different `state_execution_config.yaml`. The replay
runs in its own git worktree and branch. Landing an experiment archives its
runtime artifacts under the parent quest; it does not merge or rebase experiment
code onto `main`.

Use this workflow after the parent quest exists on the source checkout and the
step you want to replay has a v2 step commit.

## Prerequisites

- Quest Runner is running; see [Run the service](run-service.md).
- The source checkout is a git repository on a named branch.
- The source checkout is clean before creating or landing an experiment.
- The parent quest exists under `projects/<project>/quests/<main|side>/`.
- The selected start step can be resolved from v2 step commit metadata or
  compatible `state_history.md` data.
- The alternate execution config is valid `state_execution_config.yaml` text.

## Create the experiment

Prepare a notes file and an alternate execution config:

```bash
cat > /tmp/experiment-notes.md <<'EOF'
Try a different implementer profile for slice execution.
EOF

cp projects/quest-runner/src/quest_runner_service/default_state_execution_config.yaml \
  /tmp/state_execution_config.yaml
```

Create the experiment:

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

Creation writes and commits:

```text
projects/<project>/quests/<type>/<number>_<slug>/experiments/<experiment>/experiment.json
projects/<project>/quests/<type>/<number>_<slug>/experiments/<experiment>/notes.md
projects/<project>/quests/<type>/<number>_<slug>/experiments/<experiment>/state_execution_config.yaml
```

It also creates an experiment branch and worktree. The experiment id and
worktree basename use:

```text
experiment_<project>_<type>_<questNumber>_<experimentNumber>
```

The branch uses:

```text
experiment/<project>/<type>/<questNumber:04d>/<experimentNumber:04d>
```

## How start-step replay works

The selected `--start-step` resolves to that step's commit. Quest Runner creates
the experiment branch and worktree at the parent of that commit:

```text
<step_commit>^
```

Starting from the parent lets the experiment execute the selected step again
with the alternate execution config. The source archive records both
`step_commit` and `base_commit` in `experiment.json`.

## Run experiment-scoped commands

Pass `--experiment-id` on every quest-scoped CLI call while working in the
experiment:

```bash
scripts/quest-runner run \
  --project quest-runner \
  --type main \
  --number 0 \
  --experiment-id experiment_quest-runner_main_0_0
```

The same rule applies to operator and issue commands:

```bash
scripts/quest-runner advance \
  --project quest-runner \
  --type main \
  --number 0 \
  --experiment-id experiment_quest-runner_main_0_0

scripts/quest-runner issues list \
  --project quest-runner \
  --type main \
  --number 0 \
  --scope physicalplan \
  --experiment-id experiment_quest-runner_main_0_0
```

When `--experiment-id` is present, Quest Runner uses the experiment worktree as
the checkout, git, log, and issue-file boundary. Agent prompts also include the
current experiment id and tell agents to pass it to `scripts/quest-runner`.

If the parent quest worktree no longer exists and a command omits
`--experiment-id`, Quest Runner fails the command with an error explaining that
the experiment id is required.

## Use the dashboard

Open experiments appear in the dashboard project snapshot alongside main and
side quest rows. Selecting an experiment adds `experiment_id` to the dashboard
URL and resolves details from the experiment worktree.

The experiment overview shows metadata such as:

- experiment id and number
- parent quest identity
- description
- status
- start step
- stop condition
- branch and worktree path

When a normal quest has landed experiments, its overview includes a landed
experiments section. The archived detail endpoint exposes copied logs, issues,
issue responses, and the remote branch when present.

## Complete and land

An experiment stops when its configured stop condition is reached. The quest
state in the experiment worktree becomes `ExperimentComplete`, and source
metadata status becomes `experiment_complete`.

Land the experiment after it reaches that state:

```bash
scripts/quest-runner experiments land \
  --project quest-runner \
  --type main \
  --number 0 \
  --experiment-id experiment_quest-runner_main_0_0
```

You can also use:

```bash
scripts/quest-runner land \
  --project quest-runner \
  --type main \
  --number 0 \
  --experiment-id experiment_quest-runner_main_0_0
```

With `--experiment-id`, the CLI routes to experiment landing instead of normal
quest landing.

Landing does the following:

1. Verifies the experiment worktree exists and the quest state is
   `ExperimentComplete`.
2. Verifies source metadata status is `experiment_complete`.
3. Verifies the source checkout is clean.
4. Copies JSONL step logs into `experiments/<number>/logs/`.
5. Copies quest and slice issue files into `experiments/<number>/issues/`.
6. Copies issue response files into
   `experiments/<number>/issue_responses/`.
7. Pushes the experiment branch to `origin`.
8. Removes the local experiment worktree and local branch after the push
   succeeds.
9. Updates `experiment.json` with `landed` metadata and commits the archive on
   the source checkout.

Experiment landing keeps the remote branch for later inspection and does not
integrate experiment code changes into the target branch.

## Recovery notes

| Failure | Behavior and recovery |
| --- | --- |
| Source checkout dirty during create | Creation fails before metadata is written. Commit or discard source changes, then retry. |
| Source checkout dirty during land | Landing fails before archive commit or cleanup. Commit or discard source changes, then retry. |
| Metadata committed but worktree creation failed | The API response includes the metadata commit, branch name, experiment directory, and worktree path for cleanup or retry. |
| Experiment command omits `--experiment-id` | The command targets the normal quest worktree. If that worktree is gone, rerun with `--experiment-id`. |
| Stop-condition metadata update finds dirty source checkout | The runner writes a human intervention request. Clean up or commit source checkout changes, then continue. |
| Landing push fails | The local experiment branch and worktree are preserved. Fix remote access and retry landing. |
| Landing archive copy fails | The experiment is not marked landed. Fix the filesystem problem and retry landing. |

See [Quest lifecycle](../explanation/lifecycle.md#experiments),
[Runtime files](../reference/runtime-files.md#experiment-metadata), and
[Dashboard](../reference/dashboard.md#experiments-on-the-overview-page) for the
canonical lifecycle, schema, and UI references.
