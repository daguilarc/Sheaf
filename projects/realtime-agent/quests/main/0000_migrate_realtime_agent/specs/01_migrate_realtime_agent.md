# Quest Zero: Migrate Realtime Agent

## Quest Overview

Migrate the realtime agent and the Sheaf VS Code extension out of the legacy
top-level application, documentation, and prompt directories and into the
`realtime-agent` project under:

```text
projects/realtime-agent/
```

The repository now treats `structure/` as the source of truth for project layout,
configuration, logging, data, Makefile behavior, and documentation. This quest
brings the realtime-agent surface into that model.

The top-level `quests/` directory is intentionally excluded from this migration.
It must remain untouched and should be the only remaining top-level legacy system
area after the realtime-agent migration is complete.

## Current State

Realtime-agent code and assets are currently scattered across legacy top-level
directories:

- `apps/realtime-agent/` contains the Node TypeScript library and CLI.
- `apps/vscode-extension/` contains the Sheaf VS Code extension.
- `docs/operations/REALTIME_AGENT.md` documents realtime-agent operations.
- `docs/architecture/VSCODE_EXTENSION.md` documents the VS Code extension.
- `prompts/system-prompts/basic_realtime_conversation_v1.md` contains the
  default realtime-agent conversation prompt.
- The root `Makefile` still exposes legacy targets for `apps/realtime-agent` and
  `apps/vscode-extension`.

The target project already exists as a scaffold:

```text
projects/realtime-agent/
  README.md
  quests/
  src/
  tests/
  docs/
```

The migration should replace the scaffold with the actual project implementation,
tests, docs, prompts, build configuration, and runtime conventions.

## Goals

- Move the realtime-agent library, CLI, tests, package metadata, and build
  configuration from `apps/realtime-agent/` into `projects/realtime-agent/`.
- Move the Sheaf VS Code extension, tests, media assets, package metadata, and
  build configuration from `apps/vscode-extension/` into
  `projects/realtime-agent/`.
- Move realtime-agent prompt assets from `prompts/` into the realtime-agent
  project.
- Move realtime-agent and VS Code extension documentation from top-level `docs/`
  into `projects/realtime-agent/docs/` using the documentation model in
  `structure/docs-structure.md`.
- Add `projects/realtime-agent/Makefile` and update the root `Makefile` so the
  realtime-agent project participates in the normal `projects/` workflow.
- Remove or replace legacy root Make targets that point at `apps/realtime-agent`
  and `apps/vscode-extension` once project-local targets exist.
- Update package references, imports, test fixtures, README examples, and docs so
  they no longer assume the old `apps/`, top-level `docs/`, or top-level
  `prompts/` layout.
- Configure runtime logs, runtime data, and project configuration according to
  `structure/logs-and-data.md` and `structure/configuration.md`.
- Keep top-level `quests/` unchanged.

## Non-Goals

- Do not migrate, rewrite, delete, renumber, or reformat anything under the
  top-level `quests/` directory.
- Do not migrate legacy quest specs, slice plans, logs, or state files into
  `projects/realtime-agent/quests/`.
- Do not change realtime-agent OpenAI Realtime behavior except where path,
  configuration, logging, data, or packaging changes require it.
- Do not redesign the VS Code extension UI, tool catalog, command names,
  keybindings, or chat behavior.
- Do not introduce a service process unless a later quest defines one. The
  realtime-agent CLI and VS Code extension are not currently long-running Sheaf
  services registered in `config/services.json`.
- Do not move unrelated projects, Conductor code, Quest Runner code, or web UI
  code as part of this quest.

## Target Project Layout

The implementation must stay inside `projects/realtime-agent/` except for
minimal root-level integration files required by the repository structure.

Required project shape:

```text
projects/realtime-agent/
  README.md
  Makefile
  package.json
  package-lock.json
  tsconfig.json
  quests/
  src/
  tests/
  docs/
  prompts/
```

Recommended source grouping:

```text
projects/realtime-agent/src/
  agent/
  vscode-extension/
```

Recommended test grouping:

```text
projects/realtime-agent/tests/
  agent/
  vscode-extension/
```

Recommended documentation grouping:

```text
projects/realtime-agent/docs/
  README.md
  how-to/
  reference/
  explanation/
```

Recommended prompt grouping:

```text
projects/realtime-agent/prompts/
  system-prompts/
```

The physical planner may choose a different internal TypeScript package layout if
it better preserves VS Code extension packaging requirements, but all
implementation, tests, docs, prompts, and project-specific metadata must remain
under `projects/realtime-agent/`.

## Source Migration Requirements

The migrated project must preserve the two existing product surfaces:

- `realtime-agent-lib`: the TypeScript library and CLI for OpenAI Realtime
  sessions.
- `sheaf-vscode-extension`: the VS Code extension that consumes
  `realtime-agent-lib`.

The migration must update build outputs and package references so the extension
depends on the project-local realtime-agent library from its new location. The
current `file:../realtime-agent` relationship must not survive as a stale
`apps/`-based assumption.

The migrated CLI must continue to expose the existing public behavior:

- microphone input capture
- Realtime WebSocket connection
- text output only by default
- server-VAD and manual turn modes
- structured event stdout output
- session/event persistence
- tool registration and dispatch
- response queue behavior
- input device listing and selection

The migrated VS Code extension must continue to expose the existing public
behavior:

- activity bar container and realtime chat webview
- `Sheaf: Toggle Realtime Session`
- `Sheaf: Commit Audio And Request Response`
- default `F16` and `F20` keybindings
- manual turn mode
- VS Code-native read, search, navigation, and `modifyFile` tools
- freshness context pushes
- status bar integration
- chat event summaries and error bubbles

## Prompt Migration

Prompt assets that belong to the realtime-agent project must move from the
top-level `prompts/` directory into:

```text
projects/realtime-agent/prompts/
```

CLI examples, tests, docs, and default prompt lookup behavior must reference the
project-local prompt path. After this migration, top-level `prompts/` should not
remain necessary for realtime-agent operation.

If no non-realtime prompt assets remain, the physical planner should remove the
top-level `prompts/` directory. If unrelated prompt assets are discovered, the
planner must call them out before deciding where they belong.

## Documentation Migration

Realtime-agent current-state documentation must live under:

```text
projects/realtime-agent/docs/
```

Migrate or rewrite the useful content from:

- `docs/operations/REALTIME_AGENT.md`
- `docs/architecture/VSCODE_EXTENSION.md`
- `apps/realtime-agent/README.md`
- `apps/vscode-extension/README.md`

Documentation must follow `structure/docs-structure.md`:

- `docs/README.md` should be the project documentation index.
- Reference docs should cover CLI, library API, VS Code extension behavior,
  configuration, data, logs, and testing.
- Explanation docs should cover the realtime-agent architecture, VS Code
  extension architecture, session lifecycle, turn model, persistence model, tool
  dispatch, and freshness model.
- How-to docs should cover building, running the CLI, launching the extension in
  an Extension Development Host, and handling native module rebuilds.

Top-level docs that only described realtime-agent or the VS Code extension should
be removed or replaced with links only if a repository-level index needs them.

## Configuration Requirements

Configuration must follow `structure/configuration.md`.

Persistent repository configuration belongs in:

```text
config/realtime-agent.json
```

Secrets belong only in:

```text
config/api_keys.json
```

The migrated realtime-agent CLI must no longer require `OPENAI_API_KEY` as its
only persistent configuration source. It should load the OpenAI API key from
`config/api_keys.json`, with any command-line override behavior defined
explicitly by the physical plan.

The migrated VS Code extension must align with repository configuration while
respecting VS Code security constraints. The physical planner must decide how the
extension resolves secrets in this order of preference:

1. VS Code Secret Storage, when running inside VS Code and already configured by
   the user.
2. `config/api_keys.json`, when the extension is running against a Sheaf
   workspace that contains the repository config.
3. An explicit user-provided VS Code setting only if kept for backwards
   compatibility.

The implementation must not add new ad hoc config files outside `config/`. New
environment-variable dependencies should not be introduced. Existing environment
fallbacks may remain only if the physical plan explicitly justifies them as
temporary compatibility behavior and tests the preferred config path.

## Logs And Runtime Data

Runtime output must follow `structure/logs-and-data.md`.

Realtime-agent logs must be written under:

```text
logs/realtime-agent/
```

Runtime data must be written under:

```text
data/realtime-agent/
```

The existing default SQLite path currently resolves under the legacy
`apps/realtime-agent/data/` location. The migrated default must instead resolve
under `data/realtime-agent/`, independent of TypeScript build output paths.

The VS Code extension currently stores its SQLite database under the extension
global storage path. The physical planner must decide whether that data remains
VS Code-owned local extension state or moves to `data/realtime-agent/` when the
workspace is a Sheaf repository. The chosen behavior must be documented and
tested. If the extension keeps VS Code global storage for editor-host isolation,
the docs must explicitly explain why this is the exception.

Structured runtime logs should cover:

- CLI startup and shutdown
- selected model and turn mode
- prompt and context load failures
- Realtime connection lifecycle
- microphone setup and capture failures
- persistence initialization failures
- tool dispatch failures
- VS Code extension session start, stop, and unexpected end
- config lookup failures

Generated logs and runtime data must remain ignored by git.

## Makefile Requirements

Makefile behavior must follow `structure/makefile.md`.

Add:

```text
projects/realtime-agent/Makefile
```

The project Makefile should expose at least:

- `all`
- `build`
- `test`
- `clean`

It may also expose focused targets such as:

- `build-agent`
- `test-agent`
- `build-vscode-extension`
- `test-vscode-extension`
- `run-cli`

Update the root `Makefile` to include `realtime-agent` in `PROJECTS` and expose
thin forwarding targets such as:

```bash
make realtime-agent
make realtime-agent-build
make realtime-agent-test
make realtime-agent-clean
```

After migration, root targets named for the old legacy app layout must either be
removed or changed to delegate to the project Makefile. They must not continue to
`cd apps/realtime-agent` or `cd apps/vscode-extension`.

The root `ci` target, if retained, must use the project workflow rather than the
legacy app targets.

## Root Directory Cleanup

After this quest, the old system should remain only in the top-level `quests/`
directory.

The physical plan must verify whether each of these top-level directories can be
removed after migration:

- `apps/`
- `docs/`
- `prompts/`

If a directory still contains non-realtime content, the planner must identify the
owning project and either migrate that content to the correct project or leave a
clear follow-up issue. Do not delete unrelated content silently.

## Package And Build Requirements

The migrated project must support Node 20 and preserve TypeScript build and test
coverage for both the library/CLI and the VS Code extension.

The physical planner must choose and document one package strategy:

- a single project-level package that builds both the library/CLI and the VS Code
  extension, or
- project-local nested packages under `projects/realtime-agent/` when needed for
  VS Code packaging.

Whichever strategy is chosen, it must satisfy these requirements:

- no package metadata remains under `apps/`
- `realtime-agent-lib` imports resolve from the migrated project
- VS Code extension packaging still resolves native runtime dependencies
  `better-sqlite3` and `naudiodon`
- build output paths match package `main`, `types`, `exports`, and `bin` fields
- test commands do not rely on `find`-style shell behavior that is unavailable on
  supported platforms unless the project already accepts that constraint
- lockfiles are updated in the new location

## Tests

Move or rewrite the existing automated tests under:

```text
projects/realtime-agent/tests/
```

Coverage must include:

- realtime-agent package export resolution
- CLI argument parsing and usage errors
- config loading from `config/api_keys.json` and `config/realtime-agent.json`
- default data path under `data/realtime-agent/`
- runtime log path under `logs/realtime-agent/`
- SQLite migrations and repositories
- Realtime client event routing
- session config for server-VAD and manual modes
- response queue behavior
- tool registry and dispatch
- microphone device selection logic
- stdout event filtering
- VS Code extension config resolution
- VS Code extension session lifecycle
- chat model and chat webview event behavior
- VS Code tool path policy, read/search/navigation behavior, and `modifyFile`
  validation
- freshness context behavior
- Makefile project targets, at least through build and test smoke coverage
- absence of stale references to `apps/realtime-agent`,
  `apps/vscode-extension`, top-level realtime docs, and top-level realtime
  prompts in product code and docs

The final migration should pass:

```bash
make realtime-agent-build
make realtime-agent-test
make test
```

## Acceptance Criteria

- This branch is rebased onto `main` before the spec is written.
- `projects/realtime-agent/` contains the realtime-agent library, CLI, VS Code
  extension, tests, docs, prompts, and project Makefile.
- `projects/realtime-agent/` follows the required project layout from
  `structure/repo-layout.md` and `structure/project-rules.md`.
- Top-level `quests/` is unchanged by the migration.
- Top-level `apps/`, `docs/`, and `prompts/` no longer contain realtime-agent or
  VS Code extension implementation, docs, or prompt assets.
- The root `Makefile` includes `realtime-agent` in `PROJECTS`.
- Root Make targets delegate to `projects/realtime-agent/Makefile` and no longer
  depend on `apps/realtime-agent` or `apps/vscode-extension`.
- Runtime logs go to `logs/realtime-agent/`.
- Runtime data goes to `data/realtime-agent/`, except for any explicitly
  documented VS Code host storage exception.
- Persistent config is loaded from `config/realtime-agent.json`.
- Secrets are loaded from `config/api_keys.json`, with VS Code Secret Storage
  allowed for the extension.
- The realtime-agent CLI still works with the migrated prompt path and preserves
  existing user-visible behavior.
- The VS Code extension still builds, activates, starts manual realtime sessions,
  exposes the existing tools, and preserves the current chat and freshness
  behavior.
- Project docs describe the migrated current state and do not point readers at
  the old `apps/`, top-level `docs/`, or top-level `prompts/` layout.
- Automated tests cover migrated paths, config, logs, data, package resolution,
  and the preserved realtime-agent and VS Code extension behavior.
