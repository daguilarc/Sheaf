# Issues

## Issue PL-0001

- status: open
- owner_role: polisher_reviewer
- created_at: 2026-06-10T00:19:04Z
- updated_at: 2026-06-10T00:19:04Z
- title: Public docs still describe removed state_execution_config.yaml config and --scope issue CLI as current
- details: ## What is wrong

The slice spec for 0008 requires the public docs to be migrated off
`state_execution_config.yaml` and off the issue `--scope`/`--slice` CLI, and to
describe the new `workflow/` directory and `--file` issue commands. Only
`docs/reference/cli.md` and `docs/reference/api.md` were updated. Several other
public docs still describe the removed interfaces as the current/default
mechanism:

- `docs/reference/config.md` (Per-quest execution config) states each quest
  carries `state_execution_config.yaml` and that "New quests receive a copy of
  `src/quest_runner_service/default_state_execution_config.yaml` at creation
  time." That default file was deleted in this slice, and new quests now receive
  a `workflow/` directory.
- `docs/how-to/replay-experiment.md` instructs the reader to
  `cp .../default_state_execution_config.yaml /tmp/...` (a now-deleted file),
  describes the alternate config as "valid `state_execution_config.yaml` text",
  passes it via `--config-file /tmp/state_execution_config.yaml`, and uses
  `--scope physicalplan` for the issue CLI. The experiment `--config-file` flag
  now points at a workflow directory, not config text, so these steps fail.
- `docs/how-to/run-service.md` documents
  `--config-file /tmp/state_execution_config.yaml` for experiment creation and a
  full block of `issues ... --scope physicalplan` / `--scope polishing --slice 1`
  commands. The CLI no longer accepts `--scope`/`--slice` (it uses `--file`), so
  these commands now error out at argparse.

## Why it is a problem

These are user-facing how-to and reference docs. They tell a user to run
commands that now fail: copying a deleted file, passing config YAML where a
workflow directory is expected, and using `--scope`/`--slice` flags that argparse
rejects. The slice spec explicitly lists this as in-scope work ("Update docs
under projects/quest-runner/docs/ ... to describe workflow/ and --file issue
commands", "Remove docs and tests that describe state_execution_config.yaml as
the current default", "Remove issue scope and slice API/CLI docs") and its
Validation Expectations state that searches should find no reachable references
to `--scope physicalplan`, `--scope polishing`, or `state_execution_config.yaml`
as active quest config. The compatibility test only asserts on cli.md and
api.md, so the suite passes despite the stale docs.

## What must be true to close

- `docs/reference/config.md` no longer describes `state_execution_config.yaml`
  (or the deleted `default_state_execution_config.yaml`) as the current per-quest
  execution config; it describes the `workflow/` directory instead. Any
  remaining mention of `state_execution_config.yaml` is clearly framed as a
  legacy/upgrade-only artifact, not the current default.
- `docs/how-to/replay-experiment.md` is updated to use an alternate `workflow/`
  directory (no `cp` of the deleted default config, no "config text", and a
  `--config-file` value that is a workflow directory) and uses the `--file`
  issue CLI instead of `--scope`.
- `docs/how-to/run-service.md` experiment-create example uses a workflow
  directory, and its issue CLI examples use `--file <issue_file>` instead of
  `--scope`/`--slice`.
- A repo-wide search finds no reachable references to `--scope physicalplan`,
  `--scope polishing`, or `state_execution_config.yaml` as the active/current
  quest config across `projects/quest-runner/docs/` (legacy/upgrade-only
  mentions, if any, are explicitly labeled as such).
- resolution_notes: none
