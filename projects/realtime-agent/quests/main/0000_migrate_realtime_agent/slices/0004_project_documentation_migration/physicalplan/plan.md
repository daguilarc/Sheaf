# Physical Plan: Project Documentation Migration

## Objective

Rewrite the useful realtime-agent and VS Code extension documentation into `projects/realtime-agent/docs/` using the repository documentation model, and update project README material so it describes the migrated current state only.

Expected outcome:

- `projects/realtime-agent/README.md` is a concise project entry point.
- `projects/realtime-agent/docs/README.md` is the project documentation index.
- Reference docs cover CLI, library API, VS Code extension behavior, configuration, data, logs, and testing.
- Explanation docs cover architecture, session lifecycle, turn model, persistence, tool dispatch, and freshness model.
- How-to docs cover building, running the CLI, launching the extension, and handling native module rebuilds.
- Docs use project-local paths and do not point readers at `apps/`, top-level realtime docs, or top-level realtime prompts.

## Source Documentation Inventory

Rewrite useful content from:

- `docs/operations/REALTIME_AGENT.md`
- `docs/architecture/VSCODE_EXTENSION.md`
- `docs/architecture/ARCHITECTURE.md`
- `docs/product/PRD.md`
- `docs/product/ROADMAP.md`
- `docs/testing/TEST_STRATEGY.md`
- `apps/realtime-agent/README.md`
- `apps/vscode-extension/README.md`

Do not copy stale text verbatim. Convert it into current-state docs that refer to:

- `projects/realtime-agent/`
- `projects/realtime-agent/src/agent/`
- `projects/realtime-agent/src/vscode-extension/`
- `projects/realtime-agent/prompts/`
- `config/realtime-agent.json`
- `config/api_keys.json`
- `data/realtime-agent/`
- `logs/realtime-agent/`
- root `make realtime-agent-*` commands after slice 5, or direct project Make targets if slice 5 has not landed yet.

The current top-level `docs/renderer constraints.md` is not realtime-agent documentation. Assign it to the `web` project in slice 5 cleanup as `projects/web/docs/reference/renderer-constraints.md`, because it describes client rendering responsibilities rather than realtime-agent behavior.

## Key Files And Systems

Likely affected files:

- `projects/realtime-agent/README.md`
- `projects/realtime-agent/docs/README.md`
- `projects/realtime-agent/docs/reference/cli.md`
- `projects/realtime-agent/docs/reference/api.md`
- `projects/realtime-agent/docs/reference/vscode-extension.md`
- `projects/realtime-agent/docs/reference/config.md`
- `projects/realtime-agent/docs/reference/data.md`
- `projects/realtime-agent/docs/reference/logs.md`
- `projects/realtime-agent/docs/reference/testing.md`
- `projects/realtime-agent/docs/how-to/build-and-test.md`
- `projects/realtime-agent/docs/how-to/run-cli.md`
- `projects/realtime-agent/docs/how-to/launch-vscode-extension.md`
- `projects/realtime-agent/docs/how-to/rebuild-native-modules.md`
- `projects/realtime-agent/docs/explanation/architecture.md`
- `projects/realtime-agent/docs/explanation/session-lifecycle.md`
- `projects/realtime-agent/docs/explanation/turn-model.md`
- `projects/realtime-agent/docs/explanation/persistence.md`
- `projects/realtime-agent/docs/explanation/tool-dispatch.md`
- `projects/realtime-agent/docs/explanation/freshness.md`

Likely old files removed in slice 5 after docs are migrated:

- `docs/operations/REALTIME_AGENT.md`
- `docs/architecture/VSCODE_EXTENSION.md`
- root realtime-specific product/roadmap/testing docs if all useful content has moved.
- app-local READMEs under `apps/`.

## Existing APIs To Reuse As-Is

Documentation should link to or name the current code surfaces rather than invent new concepts:

- Agent CLI: `ParseCliArgs`, `RunCli`, `StartCliRuntime`.
- Library exports from `realtime-agent-lib`.
- Persistence: `RealtimeAgentDb`, session/event repositories, SQLite migrations.
- Realtime transport, event routing, session config, response queue, tool registry/dispatch, stdout logger, audio input.
- Extension activation, command ids, keybindings, chat webview, session controller, status bar, tools, path policy, freshness coordinator.
- Repository structure docs:
  - `structure/docs-structure.md`
  - `structure/configuration.md`
  - `structure/logs-and-data.md`
  - `structure/makefile.md`

## Documentation Plan

`projects/realtime-agent/README.md`:

- State what the project contains: Realtime library/CLI and Sheaf VS Code extension.
- List the short build/test commands.
- Link to `docs/README.md`.
- Mention no service process is registered.

`docs/README.md`:

- Index reference, how-to, and explanation docs.
- Link to repository-wide structure docs for shared rules.

Reference docs:

- `reference/cli.md`
  - binary name `realtime-agent`
  - arguments: `--prompt-file`, `--context-file`, `--model`, `--tool`, `--input-device`, `--list-input-devices`, `--safety-identifier`
  - default prompt lookup
  - text-output-only behavior
  - server-VAD behavior
  - structured stdout event output
  - input device listing/selection
- `reference/api.md`
  - public `realtime-agent-lib` exports
  - session start config and dependency injection seams
  - Realtime event callback shape
  - manual turn APIs
  - tool registry and dispatch contracts
- `reference/vscode-extension.md`
  - activity bar container, chat view, commands, keybindings
  - settings and Secret Storage/config resolution
  - status bar behavior
  - chat bubble/event summary behavior
  - VS Code tool list and path/write policy
- `reference/config.md`
  - `config/realtime-agent.json` schema
  - `config/api_keys.json` use of `openai_api_key`
  - no new env dependencies
  - extension priority order and compatibility setting
- `reference/data.md`
  - CLI SQLite path under `data/realtime-agent/`
  - extension global storage exception and rationale
  - generated data ignored by git
- `reference/logs.md`
  - JSONL runtime log path under `logs/realtime-agent/`
  - logged event categories
  - secret/audio redaction policy
- `reference/testing.md`
  - project and root Make targets
  - npm workspace test scripts
  - what automated tests cover
  - manual live microphone and Extension Development Host smoke checks.

How-to docs:

- Build/test the project from root and project directory.
- Run the CLI with config files, default prompt, context file, selected model/device/tools, and live API key config.
- Launch the VS Code extension in an Extension Development Host.
- Rebuild or reinstall native modules for `better-sqlite3` and `naudiodon` when Node/Electron ABI changes.

Explanation docs:

- `architecture.md`: relationship between the CLI/library and extension, project layout, no service process.
- `session-lifecycle.md`: startup, connection, audio capture, shutdown, unexpected close.
- `turn-model.md`: server-VAD CLI flow and manual extension flow.
- `persistence.md`: session/event storage, outgoing audio append filtering, extension storage exception.
- `tool-dispatch.md`: queueing, tool-call parsing, errors, follow-up response scheduling.
- `freshness.md`: editor observation model, mutation suppression, context pushes.

## Validation

- `rg "apps/realtime-agent|apps/vscode-extension|docs/operations/REALTIME_AGENT|docs/architecture/VSCODE_EXTENSION|top-level prompts|OPENAI_API_KEY" projects/realtime-agent/README.md projects/realtime-agent/docs -S` should not find stale active instructions. Historical references are allowed only when explicitly labeled as migration provenance, but preferred docs should avoid them.
- `rg "projects/realtime-agent/prompts/system-prompts/basic_realtime_conversation_v1.md|config/realtime-agent.json|config/api_keys.json|data/realtime-agent|logs/realtime-agent" projects/realtime-agent/docs projects/realtime-agent/README.md -S` should show the new canonical paths.
- `make -C projects/realtime-agent test` should still pass after docs-only changes.
- Manual review docs against `structure/docs-structure.md`:
  - docs describe current state.
  - reference docs state exact contracts.
  - how-to docs are task-oriented.
  - explanation docs avoid backlog language.
