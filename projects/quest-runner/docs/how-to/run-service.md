# Run the Quest Runner service

## Start the service

From the project directory:

```bash
cd projects/quest-runner
make run
```

From the repository root:

```bash
make quest-runner-run
```

Both invoke `start_quest_runner.sh`, which:

- ensures the project virtualenv exists
- sets `PYTHONPATH` to `projects/quest-runner/src`
- runs `python -m quest_runner_service --port 9002` from the repository root

## Verify health

```bash
curl -s http://localhost:9002/health
```

Expected shape:

```json
{
  "healthy": true,
  "uptime": 12.34
}
```

## Open the dashboard

```text
http://localhost:9002/dashboard
```

The dashboard lists projects with project-local quests under `projects/*/quests/`.
Legacy top-level `quests/` records are not shown.

Select a project, open a quest, and use the overview **Run quest** button to
execute through `POST /run_quest` when the quest worktree exists and the quest is
idle.

## CLI workflows

The repository-root CLI wraps the same REST APIs:

```bash
scripts/quest-runner --help
scripts/quest-runner create --project quest-runner --type side --name "CLI"
scripts/quest-runner run --project quest-runner --type side --number 0 --max-steps 25
scripts/quest-runner advance --project quest-runner --type side --number 0
scripts/quest-runner land --project quest-runner --type side --number 0
```

`advance` and `land` are human-operated recovery and integration workflows. Use
`advance` after manual fix-ups while the quest is stopped; use `land` when quest work
is ready to integrate back onto the target branch.

## Issue CLI

Agents and humans should use the issue CLI instead of editing issue markdown files
directly:

```bash
scripts/quest-runner issues list --project quest-runner --type side --number 0 --scope physicalplan
scripts/quest-runner issues read QP-0001 --project quest-runner --type side --number 0 --scope physicalplan
scripts/quest-runner issues create --project quest-runner --type side --number 0 --scope physicalplan --title "Title" --body "Details"
scripts/quest-runner issues edit QP-0001 --project quest-runner --type side --number 0 --scope physicalplan --status completed
scripts/quest-runner issues respond QP-0001 --project quest-runner --type side --number 0 --scope physicalplan --outcome Fixed --explanation "Done"
scripts/quest-runner issues list --project quest-runner --type side --number 0 --scope polishing --slice 1
```

Run `scripts/quest-runner issues --help` for the full command surface. Use `--json`
for automation.

## Service logs

Process logs are written under:

```text
logs/quest-runner/
  quest-runner.log
  quest_runner_stdout.log
  quest_runner_stderr.log
```

Quest step logs remain inside each quest directory; they are not streamed
through Quest Runner HTTP APIs.

## Stop the service

Send a clean shutdown request:

```bash
curl -X POST http://localhost:9002/exit
```

When Quest Runner is managed through Conductor's service registry, Conductor uses
this endpoint during coordinated shutdown. Quest Runner itself does not manage
other services.

## Registration

Quest Runner is registered in `config/services.json` with port `9002` and
`home_path` `/dashboard`. See [Configuration](../reference/config.md).

## API reference

REST endpoints and status codes: [API reference](../reference/api.md).
