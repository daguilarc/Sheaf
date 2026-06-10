# Configuration

Quest Runner follows Sheaf configuration rules. Persistent configuration lives
under `config/` at the repository root; the service does not rely on environment
variables or ad hoc local config files for persistent settings.

See also [Configuration](../../../structure/configuration.md).

## Service registration

Quest Runner is registered in `config/services.json`:

```json
{
  "name": "quest-runner",
  "host": "0.0.0.0",
  "port": 9002,
  "home_path": "/dashboard",
  "command": "make quest-runner-run"
}
```

- **Port:** `9002`
- **Home path:** `/dashboard` (web UI entry point)
- **Command:** root Makefile target delegating to `projects/quest-runner/`

Service orchestration for other processes remains in `projects/conductor/`.
Quest Runner does not register or manage other services.

## CLI service discovery

The repository-root CLI at `scripts/quest-runner` uses `config/services.json` to
discover the Quest Runner service URL. It looks for the service entry named
`quest-runner`, converts host `0.0.0.0` to `localhost` for client connections,
and combines that host with the configured port.

CLI URL precedence:

1. `--base-url <url>`
2. `QUEST_RUNNER_URL`
3. `config/services.json`
4. fallback `http://localhost:9002`

See [CLI reference](cli.md).

## Project-level config file

Quest Runner can read service-level harness provider settings from
`config/quest-runner.json`. The file is optional. When present, its `harnesses`
mapping supplies provider CLI configuration for harness kinds such as `cursor`,
`codex`, and `claude_code`.

Other persistent project-wide settings should also live in
`config/quest-runner.json` per repository rules.

## Per-quest workflow config

Each quest carries its state machine, role profiles, prompts, issue-file
declarations, and path-enforcement rules in a quest-local `workflow/` directory.
New quests receive a copy of
`src/quest_runner_service/default_workflow/` at creation time.

Workflow profile files under `workflow/profiles/` specify:

- harness kind (`cursor`, `codex`, `claude_code`)
- model and timeout settings
- optional `modify.allow` / `modify.block` glob lists for path enforcement
- prompt template path, runtime context variables, and thread identity templates

The runner reverts harness changes outside allowed paths after each turn.
Harness provider CLI paths remain service-level configuration; experiments copy
and replace `workflow/`, not machine-local provider settings.

See [Workflow reference](workflow.md) for the YAML files and execution model.

Legacy writable quests may still contain the old execution-config file before
upgrade. The `scripts/quest-runner upgrade` command migrates those quests to the
`workflow/` directory and moves provider settings into service-level config when
needed.

## Runtime schema reference

Harness runtime context can expose bundled maintainer reference text from
`src/quest_runner_service/quest_docs/`, resolved by
`runtime_quest_docs_dir()` in `src/quest_runner_service/quest_runner.py`.
Quest-local workflow prompts live under `<quest_dir>/workflow/prompts/`. Both
are separate from human-facing docs under `projects/quest-runner/docs/`.

## Secrets

API keys or other secret material belong in `config/api_keys.json`, not in quest
directories or environment variables.
