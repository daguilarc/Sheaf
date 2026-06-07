# Physical Plan: Root Integration Cleanup And Validation

## Objective

Integrate the migrated realtime-agent project into the repository-level Make workflow, remove obsolete legacy top-level app/docs/prompt locations, and run final acceptance validation for paths, behavior, packaging, and stale references.

Expected outcome:

- Root `Makefile` includes `realtime-agent` in `PROJECTS`.
- Root targets delegate to `projects/realtime-agent/Makefile`.
- Legacy targets no longer `cd apps/realtime-agent` or `cd apps/vscode-extension`.
- Top-level `apps/`, `docs/`, and `prompts/` no longer contain realtime-agent or VS Code extension implementation, docs, prompts, package metadata, or build configuration.
- Top-level `quests/` is unchanged.
- Final checks pass:
  - `make realtime-agent-build`
  - `make realtime-agent-test`
  - `make test`

## Key Files And Systems

Likely affected files:

- `Makefile`
- `.gitignore`
- `config/api_keys.example.json`
- `config/realtime-agent.json`
- `projects/realtime-agent/Makefile`
- `projects/realtime-agent/package.json`
- `projects/realtime-agent/package-lock.json`
- `projects/realtime-agent/README.md`
- `projects/realtime-agent/docs/**`
- `projects/web/docs/reference/renderer-constraints.md`

Likely removed paths:

- `apps/realtime-agent/**`
- `apps/vscode-extension/**`
- `prompts/**`, if empty after realtime prompt migration.
- `docs/operations/REALTIME_AGENT.md`
- `docs/architecture/VSCODE_EXTENSION.md`
- top-level realtime-specific product/roadmap/testing docs after their useful content is migrated.
- top-level `docs/` directory after moving `docs/renderer constraints.md` to `projects/web/docs/reference/renderer-constraints.md` and deleting empty directories.

Do not modify top-level `quests/`.

## Existing APIs To Reuse As-Is

- Root Makefile project pattern for bare `make <project>`.
- Root Makefile explicit forwarding style used by `conductor`, `web`, `quest-runner`, and `dictator`.
- Project Makefile standard targets from `structure/makefile.md`.
- Project-local npm workspace scripts from earlier slices.

## APIs To Extend Or Modify

Root `Makefile`:

- Add `realtime-agent` to `PROJECTS`.
- Add `.PHONY` entries:
  - `realtime-agent-build`
  - `realtime-agent-test`
  - `realtime-agent-clean`
  - optional `realtime-agent-run-cli` if the project Makefile exposes `run-cli`.
- Add forwarding targets:
  - `realtime-agent-build`: `$(MAKE) -C projects/realtime-agent build`
  - `realtime-agent-test`: `$(MAKE) -C projects/realtime-agent test`
  - `realtime-agent-clean`: `$(MAKE) -C projects/realtime-agent clean`
  - optional `realtime-agent-run-cli`: `$(MAKE) -C projects/realtime-agent run-cli`
- Remove or repoint legacy targets:
  - `build-realtime-agent`
  - `test-realtime-agent`
  - `build-vscode-extension`
  - `test-vscode-extension`
  - `ci`
- Preferred behavior: remove legacy target names if no external callers are documented. If kept temporarily, each must delegate to the project Makefile and must not mention `apps/`.
- Root `ci`, if retained, should depend on `realtime-agent-test` or the aggregate `test`, not app targets.

Project `Makefile`:

- Ensure it exposes at least:
  - `all`
  - `build`
  - `test`
  - `clean`
- Focused targets:
  - `build-agent`
  - `test-agent`
  - `build-vscode-extension`
  - `test-vscode-extension`
  - `run-cli`
- Use npm workspace scripts; do not duplicate build logic in shell.

Git ignore cleanup:

- Replace old ignored paths:
  - `apps/realtime-agent/node_modules/`
  - `apps/realtime-agent/dist/`
  - `apps/vscode-extension/node_modules/`
  - `apps/vscode-extension/out/`
  - `apps/vscode-extension/.test-dist/`
  - `apps/vscode-extension/*.vsix`
- Add project-local ignores:
  - `projects/realtime-agent/node_modules/`
  - `projects/realtime-agent/src/agent/node_modules/`
  - `projects/realtime-agent/src/agent/dist/`
  - `projects/realtime-agent/src/vscode-extension/node_modules/`
  - `projects/realtime-agent/src/vscode-extension/out/`
  - `projects/realtime-agent/src/vscode-extension/.test-dist/`
  - `projects/realtime-agent/src/vscode-extension/*.vsix`
- Keep root runtime ignores for `data/**` and `logs/**`.

Top-level directory cleanup:

- `apps/`: current inventory contains only realtime-agent and VS Code extension app packages. Remove it after migration.
- `prompts/`: current inventory contains only the realtime default prompt. Remove it after migration.
- `docs/`: migrate realtime-specific content to project docs in slice 4; move `docs/renderer constraints.md` to `projects/web/docs/reference/renderer-constraints.md`; remove top-level docs if empty.
- If implementation discovers additional non-realtime files under these directories, do not delete them silently. Identify the owning project, migrate them if ownership is clear, or create a follow-up issue before completing this slice.

Final compatibility cleanup:

- Remove any temporary `OPENAI_API_KEY` fallback retained in slices 2 or 3 unless a reviewer explicitly accepts it.
- Remove any compatibility paths pointing at:
  - `apps/realtime-agent`
  - `apps/vscode-extension`
  - top-level realtime `docs/`
  - top-level realtime `prompts/`
- Remove old package lockfiles and generated dependency/build outputs under `apps/`.

## Validation

Required commands:

- `npm install --prefix projects/realtime-agent`
- `make realtime-agent-build`
- `make realtime-agent-test`
- `make test`
- `make -C projects/realtime-agent build-agent`
- `make -C projects/realtime-agent test-agent`
- `make -C projects/realtime-agent build-vscode-extension`
- `make -C projects/realtime-agent test-vscode-extension`

Required automated coverage review:

- realtime-agent package export resolution.
- CLI argument parsing and usage errors.
- config loading from `config/api_keys.json` and `config/realtime-agent.json`.
- default data path under `data/realtime-agent/`.
- runtime log path under `logs/realtime-agent/`.
- SQLite migrations and repositories.
- Realtime client event routing.
- server-VAD and manual session config.
- response queue behavior.
- tool registry and dispatch.
- microphone device selection.
- stdout event filtering.
- VS Code extension config resolution.
- VS Code extension session lifecycle.
- chat model and chat webview event behavior.
- VS Code tool path policy, read/search/navigation behavior, and `modifyFile` validation.
- freshness context behavior.
- Makefile project targets through build and test smoke coverage.
- absence of stale references to legacy app/doc/prompt locations in product code and docs.

Static checks:

- `rg "apps/realtime-agent|apps/vscode-extension|docs/operations/REALTIME_AGENT|docs/architecture/VSCODE_EXTENSION|prompts/system-prompts/basic_realtime_conversation_v1.md|OPENAI_API_KEY" projects/realtime-agent Makefile config -S`
  - Expected: no active stale references. The prompt filename may appear only under `projects/realtime-agent/prompts/...` or docs using the project-local path. `OPENAI_API_KEY` should not appear unless explicitly labeled as removed legacy behavior.
- `rg "cd apps/realtime-agent|cd apps/vscode-extension" Makefile -S` should find nothing.
- `find apps docs prompts -maxdepth 3 -type f -print` should fail because the directories are removed, or print only non-realtime files with documented follow-up ownership.
- `git diff --name-only -- quests` should remain empty.
- `git diff --name-only -- projects/realtime-agent/quests/main/0000_migrate_realtime_agent` should show only quest plan/state files created by this planning work, not implementation changes under top-level `quests/`.
- `git check-ignore data/realtime-agent/realtime-agent.sqlite logs/realtime-agent/realtime-agent.jsonl projects/realtime-agent/src/agent/dist/index.js projects/realtime-agent/src/vscode-extension/out/extension.js`

Manual smoke checks:

- Configure `config/api_keys.json` with `openai_api_key`.
- Run `make -C projects/realtime-agent run-cli CONTEXT_FILE=<path>` or the final documented CLI command with a context file and optional `--list-input-devices`.
- Confirm stdout still emits structured non-audio Realtime events.
- Launch the VS Code extension from `projects/realtime-agent/src/vscode-extension` in an Extension Development Host.
- Confirm `F16` starts/stops a manual session, `F20` commits and requests a response, the chat view shows event summaries/errors, and `modifyFile` edits remain VS Code-buffer-backed and undoable.
