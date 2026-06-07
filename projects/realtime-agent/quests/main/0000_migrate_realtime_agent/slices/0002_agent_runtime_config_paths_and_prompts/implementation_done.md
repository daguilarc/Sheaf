# Implementation Complete: Agent Runtime Config Paths And Prompts

## Summary

Slice 0002 wires the realtime-agent library and CLI to Sheaf repository configuration, secrets, prompts, runtime data, and structured logs while preserving existing Realtime session behavior.

## Delivered

- **`repo_paths.ts`**: `FindRepositoryRoot`, `ResolveRepositoryPath`, and `GetDefaultRealtimeAgentPaths` for repository-relative config, secrets, prompt, SQLite, and JSONL log locations.
- **`config.ts`**: `LoadRealtimeAgentConfig` and `LoadOpenAiApiKey` reading `config/realtime-agent.json` and `config/api_keys.json` (`openai_api_key`). `OPENAI_API_KEY` removed from the CLI path.
- **`runtime_log.ts`**: JSONL runtime logging to `logs/realtime-agent/realtime-agent.jsonl` with redaction of secrets and audio payloads.
- **`cli.ts`**: Optional `--prompt-file` (defaults from config), config-driven model default, API key from `config/api_keys.json`, and runtime lifecycle logging (startup/shutdown, connection, microphone, persistence, tool failures).
- **`persistence/db.ts`**: `DEFAULT_DATABASE_PATH` resolves to `data/realtime-agent/realtime-agent.sqlite` from the repository root.
- **`config/realtime-agent.json`**: Project persistent settings at the repository root.
- **Prompt migration**: `basic_realtime_conversation_v1.md` moved to `projects/realtime-agent/prompts/system-prompts/`; top-level `prompts/` removed.

## Tests

- Added `tests/agent/config/config.test.ts` and `tests/agent/runtime_log/runtime_log.test.ts`.
- Updated CLI and persistence tests for new config/secrets/prompt defaults and paths.
- All 98 agent tests pass via `npm run test:agent` and `make -C projects/realtime-agent test-agent`.

## Validation

- `git check-ignore` confirms runtime SQLite and JSONL log paths are ignored.
- `rg` shows no stale `OPENAI_API_KEY`, `apps/realtime-agent/data`, or top-level prompt path references in agent code/tests/config.
