# Implementation Accepted: Agent Runtime Config Paths And Prompts

Slice 0002 is accepted. The implementation matches the physical plan and slice spec.

## Verified

- **Config & secrets**: `config.ts` loads `config/realtime-agent.json` (merging
  defaults, ENOENT-tolerant) and reads `openai_api_key` from `config/api_keys.json`
  with an actionable error referencing the file. `OPENAI_API_KEY` is fully removed
  from the CLI path.
- **Repo paths**: `repo_paths.ts` resolves repository root and the standard config,
  secrets, prompt, SQLite, and JSONL log locations.
- **Runtime logging**: `runtime_log.ts` writes JSONL to `logs/realtime-agent/` with
  redaction of secret-like keys and audio payload fields; `cli.ts` logs startup,
  shutdown, connection lifecycle, microphone, persistence, and tool-dispatch events.
- **CLI**: `--prompt-file` optional (config default fallback), `--context-file`
  required, `--list-input-devices` independent of config/key, model default from
  config with `--model` override.
- **Database**: `DEFAULT_DATABASE_PATH` resolves under `data/realtime-agent/` from
  the repository root; `RealtimeAgentDb.open({ path, ensureDirectory })` preserved.
- **Prompt migration**: prompt moved to
  `projects/realtime-agent/prompts/system-prompts/`; top-level `prompts/` removed.
- **Ignore rules**: runtime SQLite and JSONL logs are git-ignored.

## Issues

- PI-0001 (committed `crash.log` artifact): resolved and closed. The file is no
  longer tracked or present, and `projects/realtime-agent/.gitignore` now ignores
  `crash.log`.

## Notes

- Non-blocking: `runtime_log.ts` redacts audio payload keys
  (`pcmBase64`/`audio`/`frame`), but only the api_key redaction path has explicit
  test coverage. Minor gap, not a defect.
- The `scripts/quest-runner issues` CLI was unavailable during this review (all
  invocations blocked); issue tracking was recorded directly in the documented
  file format per the workflow fallback.
