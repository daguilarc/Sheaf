# Physical Plan: Workspace Scaffold And Package Strategy

## Objective

Create the project-local Node workspace foundation under `projects/realtime-agent/`, move source-of-truth package metadata into that project, and migrate the current realtime-agent library/CLI and VS Code extension files without changing runtime behavior yet.

Expected outcome:

- `projects/realtime-agent/` has project-owned `README.md`, `Makefile`, `package.json`, `package-lock.json`, `tsconfig.json`, `src/`, `tests/`, `docs/`, `prompts/`, and `quests/`.
- No package metadata remains under `apps/realtime-agent/` or `apps/vscode-extension/` after the migrated workspace is established.
- The chosen package strategy is implemented as project-local nested npm workspaces:
  - `projects/realtime-agent/src/agent/` is package `realtime-agent-lib`.
  - `projects/realtime-agent/src/vscode-extension/` is package `sheaf-vscode-extension`.
  - `projects/realtime-agent/package.json` is a private workspace orchestrator with the root lockfile.
- Initial project-local builds and current migrated tests can run before config, logging, docs, and root cleanup are changed in later slices.

## Package Strategy

Use nested packages inside one project-local npm workspace instead of a single package.

Rationale:

- The library public surface is package name `realtime-agent-lib` with binary `realtime-agent`.
- The VS Code extension public packaging surface is package name `sheaf-vscode-extension` with VS Code manifest fields, `main`, `contributes`, media, and `.vscodeignore`.
- A single npm package cannot preserve both package names cleanly.
- Workspaces keep one project-level `package.json` and `package-lock.json` while keeping all package-specific metadata under `projects/realtime-agent/`, not `apps/`.

Planned layout:

```text
projects/realtime-agent/
  Makefile
  package.json
  package-lock.json
  tsconfig.json
  src/
    agent/
      package.json
      tsconfig.json
      src/
    vscode-extension/
      package.json
      tsconfig.json
      tsconfig.test.json
      esbuild.config.mjs
      .vscodeignore
      media/
      src/
  tests/
    agent/
    vscode-extension/
  docs/
  prompts/
```

All committed automated tests should move to `projects/realtime-agent/tests/agent/` and `projects/realtime-agent/tests/vscode-extension/` in this slice. Configure the nested package TypeScript projects to include those test roots explicitly:

- Agent build emits package source from `src/agent/src/**`.
- Agent test build emits tests from `tests/agent/**`.
- Extension build emits bundled extension/webview output from `src/vscode-extension/src/**`.
- Extension test build emits tests from `tests/vscode-extension/**`.

## Key Files And Systems

Likely new or replaced files:

- `projects/realtime-agent/package.json`
- `projects/realtime-agent/package-lock.json`
- `projects/realtime-agent/tsconfig.json`
- `projects/realtime-agent/Makefile`
- `projects/realtime-agent/src/agent/**`
- `projects/realtime-agent/src/vscode-extension/**`
- `projects/realtime-agent/tests/agent/**`
- `projects/realtime-agent/tests/vscode-extension/**`
- `projects/realtime-agent/.gitignore` if project-local ignores are cleaner than growing the root ignore.

Likely existing files to remove after copying:

- `apps/realtime-agent/package.json`
- `apps/realtime-agent/package-lock.json`
- `apps/realtime-agent/tsconfig.json`
- `apps/realtime-agent/src/**`
- `apps/realtime-agent/test/**`
- `apps/vscode-extension/package.json`
- `apps/vscode-extension/package-lock.json`
- `apps/vscode-extension/tsconfig*.json`
- `apps/vscode-extension/esbuild.config.mjs`
- `apps/vscode-extension/.vscodeignore`
- `apps/vscode-extension/media/**`
- `apps/vscode-extension/src/**`
- `apps/vscode-extension/test/**`

Do not touch top-level `quests/`.

## Existing APIs To Reuse As-Is

Copy first with minimal path changes:

- Agent library public exports from `apps/realtime-agent/src/index.ts`.
- CLI entry point and command behavior in `apps/realtime-agent/src/cli.ts`.
- Realtime transport, event router, session config, agent loop, response queue, stdout logger, tool registry, audio input, and persistence modules.
- VS Code extension activation, commands, session controller, session wiring, config helpers, status bar, chat model/webview, freshness services, prompts, and VS Code tool modules.
- Existing Node test suites for both packages.
- `esbuild.config.mjs` bundling with `vscode`, `better-sqlite3`, and `naudiodon` externalized.

## APIs To Extend Or Modify Later

Leave runtime semantics intact in this slice except for import/build paths required by the move. Later slices own:

- `OPENAI_API_KEY` replacement with `config/api_keys.json`.
- `config/realtime-agent.json` loading.
- default prompt path changes.
- default SQLite data path changes.
- structured runtime logs under `logs/realtime-agent/`.
- extension secret/config resolution changes.
- root Makefile forwarding and legacy target removal.

## Implementation Notes

Root workspace package:

- Mark `projects/realtime-agent/package.json` as `"private": true`.
- Define `"workspaces": ["src/agent", "src/vscode-extension"]`.
- Add scripts:
  - `build`: run agent build then extension build.
  - `test`: run agent tests then extension tests.
  - `build:agent`, `test:agent`, `build:vscode-extension`, `test:vscode-extension`.
  - `clean`: remove generated `dist`, `out`, `.test-dist`, nested `node_modules`, and root `node_modules`.
- Generate `package-lock.json` from the root workspace install.

Agent package:

- Preserve package name `realtime-agent-lib`.
- Preserve binary name `realtime-agent`.
- Update `main`, `types`, `exports`, and `bin` to match its nested build output from `src/agent`.
- Keep Node 20 support.
- Keep native runtime dependencies `better-sqlite3`, `naudiodon`, and `ws`.

VS Code extension package:

- Preserve package name `sheaf-vscode-extension`, command ids, view ids, keybindings, configuration ids, and media paths.
- Replace stale `prebuild` and `realtime-agent-lib` references:
  - `prebuild` should use `npm run build --workspace realtime-agent-lib` from the project root or be removed if the root build orders packages.
  - `realtime-agent-lib` dependency should point to the project-local `src/agent` package using workspace installation or `file:../agent`, never `file:../realtime-agent` and never any `apps/` path.
- Keep `better-sqlite3` and `naudiodon` available to the extension package so native module packaging/rebuild workflows still work.
- Keep `.vscodeignore`, `media/sheaf.svg`, and webview assets in the extension package.

Test command modernization:

- Replace the extension's shell-specific `node --test $(find ...)` command with a Node script or npm script that discovers compiled `.test.js` files using Node APIs. This avoids adding new unsupported shell assumptions.
- The agent's current explicit `node --test dist/test/...` command can remain initially, but update paths for the new project layout. If tests move to `tests/agent`, configure TypeScript output so the runner can execute them without relying on shell glob expansion.

## Validation

- `npm install --prefix projects/realtime-agent`
- `npm run build --prefix projects/realtime-agent`
- `npm run test:agent --prefix projects/realtime-agent`
- `npm run test:vscode-extension --prefix projects/realtime-agent`
- `make -C projects/realtime-agent build`
- `make -C projects/realtime-agent test`
- `node -e "import('realtime-agent-lib').catch((error)=>{ console.error(error); process.exit(1); })"` from a workspace context where dependencies are installed.
- Static checks:
  - `rg "file:\\.\\./realtime-agent|apps/realtime-agent|apps/vscode-extension" projects/realtime-agent/package.json projects/realtime-agent/src -S` should not find stale package/build references after path rewrites.
  - `find apps/realtime-agent apps/vscode-extension -maxdepth 2 -type f` should show no package metadata or source-of-truth implementation files once this slice removes the old app package files.
  - `git diff --name-only -- quests` should remain empty.
