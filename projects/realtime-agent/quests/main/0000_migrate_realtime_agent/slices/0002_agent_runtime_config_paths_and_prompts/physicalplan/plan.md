# Physical Plan: Agent Runtime Config Paths And Prompts

## Objective

Change the migrated realtime-agent library and CLI to use Sheaf project configuration, secrets, prompt, log, and runtime data locations while preserving the existing Realtime session behavior.

Expected outcome:

- Realtime CLI loads persistent settings from `config/realtime-agent.json`.
- CLI secrets are loaded from `config/api_keys.json`; `OPENAI_API_KEY` is no longer required or documented as the normal config source.
- Default prompt lookup resolves to `projects/realtime-agent/prompts/system-prompts/basic_realtime_conversation_v1.md`.
- Runtime SQLite data defaults to `data/realtime-agent/realtime-agent.sqlite`, independent of compiled output paths.
- Structured runtime logs go to `logs/realtime-agent/` without replacing structured event stdout output.
- Agent tests cover config, secrets, prompt, data, logs, and preserved runtime behavior.

## Key Files And Systems

Likely affected files:

- `config/realtime-agent.json`
- `config/api_keys.example.json`
- `.gitignore`
- `projects/realtime-agent/prompts/system-prompts/basic_realtime_conversation_v1.md`
- `projects/realtime-agent/src/agent/src/cli.ts`
- `projects/realtime-agent/src/agent/src/persistence/db.ts`
- `projects/realtime-agent/src/agent/src/index.ts`
- `projects/realtime-agent/src/agent/src/types.ts`
- new `projects/realtime-agent/src/agent/src/repo_paths.ts`
- new `projects/realtime-agent/src/agent/src/config.ts`
- new `projects/realtime-agent/src/agent/src/runtime_log.ts`
- `projects/realtime-agent/tests/agent/**`

Likely old files to remove after copying prompt assets:

- `prompts/system-prompts/basic_realtime_conversation_v1.md`, if no unrelated top-level prompt assets remain.

## Existing APIs To Reuse As-Is

- `ParseCliArgs`, `RunCli`, and `StartCliRuntime` should remain the main CLI test seams.
- `RealtimeAgentDb.open`, `resolveDatabasePath`, and persistence repositories should remain the database API, with default path resolution changed.
- `logEventLine` should continue to print protocol/event JSON lines to stdout and continue filtering outgoing audio appends.
- `BuildToolCallSet`, `FindUnknownToolNames`, `ParseToolNameArguments`, response queue behavior, event routing, session config, Realtime client behavior, microphone device listing/selection, and fake dependency injection remain the core behavior to preserve.

## APIs To Extend Or Modify

Add testable repository path helpers:

- `FindRepositoryRoot(startPath?: string): string | undefined`
- `ResolveRepositoryPath(relativePath: string, root?: string): string`
- `GetDefaultRealtimeAgentPaths(root?: string)` returning:
  - `config/realtime-agent.json`
  - `config/api_keys.json`
  - `projects/realtime-agent/prompts/system-prompts/basic_realtime_conversation_v1.md`
  - `data/realtime-agent/realtime-agent.sqlite`
  - `logs/realtime-agent/realtime-agent.jsonl`

Add config/secrets loading:

- `LoadRealtimeAgentConfig(options)` reads `config/realtime-agent.json` when present and merges defaults.
- `LoadOpenAiApiKey(options)` reads `config/api_keys.json`.
- Use the existing flat key `openai_api_key` from `config/api_keys.example.json` for the OpenAI key. Do not introduce a new secret shape unless implementation finds an existing canonical parser requiring it.
- No new CLI `--api-key` option. Secrets stay in `config/api_keys.json`.
- `OPENAI_API_KEY` fallback should be removed from the normal CLI path. If implementation keeps it temporarily for backwards compatibility, it must log a compatibility warning, test that `config/api_keys.json` is preferred, and mark the fallback for removal in slice 5. Preferred implementation is removal.

Define `config/realtime-agent.json` fields:

```json
{
  "model": "gpt-realtime-2",
  "data_dir": "data/realtime-agent",
  "database_path": "data/realtime-agent/realtime-agent.sqlite",
  "logs_dir": "logs/realtime-agent",
  "default_prompt_file": "projects/realtime-agent/prompts/system-prompts/basic_realtime_conversation_v1.md",
  "updated_at": "2026-06-07T00:00:00Z",
  "version": 1
}
```

The model value is a default only; `--model` continues to override it for a CLI run. Runtime options such as `--context-file`, `--input-device`, `--tool`, and `--safety-identifier` remain command-line options rather than persistent secrets.

CLI argument behavior:

- Keep `--context-file` required.
- Keep `--prompt-file` accepted.
- If `--prompt-file` is omitted, use `default_prompt_file` from `config/realtime-agent.json`, falling back to the project-local default prompt path above.
- Keep `--list-input-devices` independent from API key/config requirements.
- Preserve `--tool`, `--input-device`, `--model`, and `--safety-identifier`.

Structured runtime logs:

- Add JSONL runtime logging separate from `stdout_logger.ts`.
- Create `logs/realtime-agent/` on demand.
- Log at least:
  - CLI startup and shutdown.
  - selected model and turn mode.
  - prompt and context load failures.
  - Realtime connection lifecycle.
  - microphone setup and capture failures.
  - persistence initialization failures.
  - tool dispatch failures.
- Do not log raw audio frame payloads or API keys.

Database path:

- Replace `DEFAULT_DATABASE_PATH` computation from package/build location with repository-root-based `data/realtime-agent/realtime-agent.sqlite`.
- Keep `RealtimeAgentDb.open({ path, ensureDirectory })` override behavior for tests and extension use.

## Prompt Migration

- Move `prompts/system-prompts/basic_realtime_conversation_v1.md` to `projects/realtime-agent/prompts/system-prompts/basic_realtime_conversation_v1.md`.
- Update CLI examples, tests, README references, and docs to the project-local path in slice 4.
- Verify whether top-level `prompts/` contains any non-realtime prompt assets before deletion. Current inventory shows only this realtime prompt, so this slice may remove the top-level `prompts/` directory after the move.

## Validation

Automated tests:

- CLI argument parsing:
  - accepts `--prompt-file`.
  - uses configured default prompt when `--prompt-file` is absent.
  - requires `--context-file`.
  - reports unknown tools.
  - `--list-input-devices` does not require config or API key.
- Config/secrets:
  - loads model/default prompt/database/log paths from `config/realtime-agent.json`.
  - loads `openai_api_key` from `config/api_keys.json`.
  - preferred config key path works without `OPENAI_API_KEY`.
  - missing key produces an actionable usage error that references `config/api_keys.json`.
- Runtime paths:
  - `DEFAULT_DATABASE_PATH` points under `data/realtime-agent/`.
  - runtime log path points under `logs/realtime-agent/`.
  - database directory creation still works.
- Preserved behavior:
  - SQLite migrations and repositories.
  - Realtime client event routing.
  - session config for server-VAD and manual modes.
  - response queue behavior.
  - tool registry and dispatch.
  - microphone device selection.
  - stdout event filtering.

Commands:

- `npm run test:agent --prefix projects/realtime-agent`
- `make -C projects/realtime-agent test-agent`
- `git check-ignore data/realtime-agent/realtime-agent.sqlite logs/realtime-agent/realtime-agent.jsonl`
- `rg "OPENAI_API_KEY|apps/realtime-agent/data|prompts/system-prompts/basic_realtime_conversation_v1.md" projects/realtime-agent/src/agent projects/realtime-agent/tests/agent config -S` should only show intentional compatibility text if a temporary fallback remains.
