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

## Project-level config file

There is no `config/quest-runner.json` today. The service resolves the source
Sheaf repository from the installed package location and binds to port `9002`
via CLI defaults in `src/quest_runner_service/__main__.py`.

If project-wide Quest Runner settings are added later, they should live in
`config/quest-runner.json` per repository rules.

## Per-quest execution config

Each quest carries its own harness and path-enforcement settings in
`state_execution_config.yaml` inside the quest directory. New quests receive a
copy of `src/quest_runner_service/default_state_execution_config.yaml` at
creation time.

Role profiles in that file specify:

- harness kind (`cursor`, `codex`, `claude_code`)
- model and timeout settings
- optional `modify_allow` / `modify_block` glob lists for path enforcement

Version `2` configs enable per-role path rules. The runner reverts harness
changes outside allowed paths after each turn.

## Runtime schema reference

Role prompts load quest workflow and schema reference text from
`src/quest_runner_service/quest_docs/`, resolved by
`runtime_quest_docs_dir()` in `src/quest_runner_service/quest_runner.py`.
This is separate from human-facing docs under `projects/quest-runner/docs/`.

## Secrets

API keys or other secret material belong in `config/api_keys.json`, not in quest
directories or environment variables.
