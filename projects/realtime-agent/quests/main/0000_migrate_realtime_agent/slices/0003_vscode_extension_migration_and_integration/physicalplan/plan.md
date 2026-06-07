# Physical Plan: VS Code Extension Migration And Integration

## Objective

Finish migrating the Sheaf VS Code extension into the realtime-agent project, update it to consume the project-local `realtime-agent-lib`, align extension configuration with Sheaf repository config rules, and preserve all editor-facing behavior.

Expected outcome:

- `projects/realtime-agent/src/vscode-extension/` builds and tests as package `sheaf-vscode-extension`.
- The extension depends on `realtime-agent-lib` from the project-local `src/agent` workspace package.
- VS Code API key resolution order is:
  1. VS Code Secret Storage.
  2. `config/api_keys.json` when the extension runs in a Sheaf repository workspace.
  3. `sheaf.realtime.openAiApiKey` setting as explicit backwards compatibility.
- The extension keeps SQLite session storage in VS Code global storage as an intentional editor-host exception, documented and tested.
- Extension runtime logs write to `logs/realtime-agent/` when a Sheaf repository workspace is available, while VS Code Output Channel logging remains available for editor visibility.
- Existing activity bar, commands, keybindings, manual turn behavior, tools, freshness context, status bar, chat model, and error bubbles are preserved.

## Key Files And Systems

Likely affected files:

- `projects/realtime-agent/src/vscode-extension/package.json`
- `projects/realtime-agent/src/vscode-extension/esbuild.config.mjs`
- `projects/realtime-agent/src/vscode-extension/tsconfig*.json`
- `projects/realtime-agent/src/vscode-extension/.vscodeignore`
- `projects/realtime-agent/src/vscode-extension/media/sheaf.svg`
- `projects/realtime-agent/src/vscode-extension/src/config.ts`
- `projects/realtime-agent/src/vscode-extension/src/configCore.ts`
- `projects/realtime-agent/src/vscode-extension/src/sessionController.ts`
- `projects/realtime-agent/src/vscode-extension/src/sessionWiring.ts`
- `projects/realtime-agent/src/vscode-extension/src/log.ts`
- `projects/realtime-agent/src/vscode-extension/src/prompts.ts`
- `projects/realtime-agent/src/vscode-extension/src/chat/**`
- `projects/realtime-agent/src/vscode-extension/src/freshness/**`
- `projects/realtime-agent/src/vscode-extension/src/tools/**`
- `projects/realtime-agent/tests/vscode-extension/**`

## Existing APIs To Reuse As-Is

- VS Code command ids:
  - `sheaf.realtime.toggleSession`
  - `sheaf.realtime.commitAndRespond`
- User-visible command titles:
  - `Sheaf: Toggle Realtime Session`
  - `Sheaf: Commit Audio And Request Response`
- Keybindings:
  - `F16`
  - `F20`
- View container and view id:
  - `sheafContainer`
  - `sheaf.chatView`
- Manual-turn session APIs from `realtime-agent-lib`.
- Existing extension `SessionController` lifecycle shape and dependency injection seams.
- VS Code-native tool implementations and validation policy:
  - `code_read`
  - `list_files`
  - `rgrep`
  - `read_visible_range`
  - `set_cursor_position`
  - `move_visible_range`
  - `modifyFile`
- Chat model, webview event handling, summaries, freshness coordinator, status bar, and test helpers.

## APIs To Extend Or Modify

Config resolution:

- Extend `ResolveOpenAiApiKey` to accept `{ secretValue, repoConfigValue, settingValue }` in priority order.
- Remove `process.env.OPENAI_API_KEY` from extension key resolution.
- Add a testable repository config resolver that can find a Sheaf repository root from VS Code workspace folders. It should look for `config/api_keys.json` and the expected project path rather than assuming the extension folder is the workspace root.
- Parse `openai_api_key` from `config/api_keys.json`, matching slice 2.
- Keep `sheaf.realtime.openAiApiKey` setting as last-resort compatibility and update package description so it does not mention environment variables.

Extension data path decision:

- Keep session SQLite under `context.globalStorageUri.fsPath/realtime-agent.sqlite3`.
- Rationale: VS Code extension global storage is scoped by extension identity and host, survives workspace changes correctly, and avoids writing editor-host state into a repository when the extension is run against arbitrary user workspaces.
- When running inside a Sheaf repository workspace, runtime logs and config lookup use repository `logs/` and `config/`, but the extension session database remains VS Code-owned state.
- Tests must assert the global-storage path is used even when a repo config root exists.

Runtime logging:

- Extend extension logging so session start, stop, unexpected end, config lookup failures, prompt resolution failures, persistence initialization failures, and tool dispatch failures are written as structured JSONL under `logs/realtime-agent/` when a repo root is detected.
- Keep existing Output Channel behavior for immediate VS Code user visibility.
- Do not log API keys, raw audio frames, or full file contents from tools.

Build integration:

- Ensure esbuild resolves the migrated `realtime-agent-lib` package.
- Keep `better-sqlite3` and `naudiodon` external in the extension bundle so native modules are resolved from `node_modules`.
- Confirm `main` still points to the generated extension host entry (`out/extension.js`).
- Confirm webview assets are copied to `out/webview/`.

## Validation

Automated tests:

- Config:
  - prefers Secret Storage over repo `config/api_keys.json`.
  - prefers repo `config/api_keys.json` over `sheaf.realtime.openAiApiKey`.
  - does not use `OPENAI_API_KEY`.
  - reports missing key with message naming Secret Storage, `config/api_keys.json`, and the compatibility setting.
- Session lifecycle:
  - starts manual-turn sessions with project-local `realtime-agent-lib`.
  - uses `commitAudioAndCreateResponse` for the commit command.
  - shuts down microphone, session, and database on stop/deactivation.
  - records unexpected end as an error bubble/status transition.
- Data/log paths:
  - database path remains `globalStoragePath/realtime-agent.sqlite3`.
  - structured logs use `logs/realtime-agent/` when a Sheaf repo root is present.
- Chat and webview:
  - event summaries and error bubbles remain stable.
  - webview event handling still reduces transcript, assistant text, tool, context, and error events.
- Tools:
  - path policy keeps workspace confinement.
  - read/search/navigation tools use VS Code editor/workspace APIs.
  - `modifyFile` validates exact target text and context before applying edits.
  - tool dispatcher wiring preserves the `sheaf VS Code` call set.
- Freshness:
  - file, viewport, cursor, and tab-change freshness behavior remains covered.
  - agent-caused mutations are suppressed.

Commands:

- `npm run build:vscode-extension --prefix projects/realtime-agent`
- `npm run test:vscode-extension --prefix projects/realtime-agent`
- `make -C projects/realtime-agent build-vscode-extension`
- `make -C projects/realtime-agent test-vscode-extension`

Manual smoke notes for implementers:

- Open `projects/realtime-agent/src/vscode-extension` in VS Code or launch the extension package from the project workspace.
- Start an Extension Development Host.
- Verify the Activity Bar `Sheaf` container and `Realtime Chat` view.
- Press `F16` to start/stop and `F20` to commit/respond.
- Exercise one read tool, one navigation tool, and one `modifyFile` edit.

Static checks:

- `rg "OPENAI_API_KEY|file:\\.\\./realtime-agent|apps/realtime-agent|apps/vscode-extension" projects/realtime-agent/src/vscode-extension projects/realtime-agent/tests/vscode-extension -S` should show no active stale assumptions.
- `rg "globalStoragePath|globalStorageUri" projects/realtime-agent/src/vscode-extension projects/realtime-agent/docs -S` should show the intentional storage exception in code and docs.
