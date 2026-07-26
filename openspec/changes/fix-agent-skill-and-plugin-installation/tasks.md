## 1. Agents installer scope and cleanup

- [x] 1.1 Update the existing installer tests and add a synthetic Codex-only fixture proving repo desired outputs contain repo-root instructions plus Sheaf-only skills, honor target filtering, exclude every global skill, and global desired outputs still contain every non-plugin shared skill for its declared targets.
- [x] 1.2 Add failing tests proving repo install/check/clean identify obsolete managed repo-local global-skill outputs, remove or report them by mode, and preserve unmanaged files at the same paths.
- [x] 1.3 Implement separate desired and obsolete repo output sets in `projects/agents/scripts/install.py`; expand current global source IDs and an explicit retired repo-skill ID list containing `xagent-subagents` across all repo harness skill directories.
- [x] 1.4 Extend the existing global obsolete-ID handling with `xagent-subagents`, so former standalone outputs under `$HOME/.agents/skills/` and `$CODEX_HOME/skills/` are removed or reported only when managed.
- [x] 1.5 Update `projects/agents/README.md` and Make help text to document global-only shared skills, repo-local-only Sheaf skills, and plugin-owned skill exclusion.

## 2. xagent global plugin installation

- [x] 2.1 Add failing unit tests for creating a new marketplace named `personal`, preserving an existing marketplace's name, unrelated entries, and interface metadata, updating one xagent entry idempotently, and rejecting an unmanaged destination package.
- [x] 2.2 Add failing unit tests for building in a temporary directory, staging a complete xagent plugin package with the exact `.sheaf-managed` marker at `$HOME/.agents/plugins/plugins/xagent/`, preserving launcher executable mode, applying exactly one cachebuster to the staged manifest, and leaving tracked plugin assets unchanged.
- [x] 2.3 Implement a tested xagent global plugin install helper using atomic package replacement, the installed plugin-creator marketplace/cachebuster helpers, structured marketplace updates, managed-destination safety, and explicit dependency or Codex command failures.
- [x] 2.4 Add the root Make target `xagent-plugin-install-global`, while retaining the existing package build/test targets.
- [x] 2.5 Make install read the marketplace's actual name, invoke `codex plugin add xagent@<marketplace-name>`, and verify `codex plugin list` reports the installed and enabled plugin with the staged package path.

## 3. Single ownership migration

- [x] 3.1 Remove `projects/agents/global/skills/xagent-subagents/` and keep `plugins/xagent/skills/xagent-subagents/SKILL.md` as the only canonical xagent skill source.
- [x] 3.2 Update the plugin skill so command examples resolve and invoke the installed plugin launcher rather than assuming the active repository contains `plugins/xagent`.
- [x] 3.3 Regenerate repo-local outputs with the managed installer, deleting all managed global-skill copies from `.claude/skills/`, `.cursor/skills/`, `.pi/skills/`, and `.codex/skills/` while retaining the repo-local `smoke-test` outputs.
- [x] 3.4 Run the global agents installer to retain non-plugin shared skills and prune the former standalone managed xagent skill without installing any launcher or runtime outside the plugin package.
- [x] 3.5 Update xagent and agents documentation with the artifact ownership matrix, global install/update commands, new-conversation pickup requirement, and recovery behavior.

## 4. Verification

- [x] 4.1 Run `make -C projects/agents test`, `make agents-check-repo`, and `make agents-check-global`; verify all installer tests pass and no obsolete managed skill outputs remain.
- [x] 4.2 Run `make -C projects/xagent test` and `make xagent-plugin-test`; verify the CLI, packaged launcher, missing-runtime behavior, tracked plugin runtime asset currency, global installer tests, and plugin manifest validation pass.
- [x] 4.3 Run `make xagent-plugin-install-global` and `codex plugin list`; verify exactly one installed and enabled `xagent@<marketplace-name>` plugin is reported at the staged package path.
- [x] 4.4 From a temporary non-Sheaf repository, invoke the installed plugin launcher with `XAGENT_TEST_ADAPTER=fake` and an explicit temporary `XAGENT_LOG_ROOT`; verify it uses packaged assets, preserves the temporary repository as the child working directory, and writes logs only to that configured root.
- [x] 4.5 Run `openspec validate fix-agent-skill-and-plugin-installation --strict` and `git diff --check`, then confirm a new Codex conversation discovers `xagent-subagents` from the installed plugin and does not discover standalone repo-local or user-global copies.
