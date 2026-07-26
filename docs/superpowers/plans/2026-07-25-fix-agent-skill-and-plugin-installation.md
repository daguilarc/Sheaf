# Global Skills and xagent Plugin Installation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install shared skills only in user-global locations, keep `smoke-test` repo-local, and install xagent globally as one proper Codex plugin.

**Architecture:** The agents installer will calculate desired and obsolete outputs separately for repo and global scopes, always preserving unmanaged files. A new Python helper will build xagent into a temporary package, stage it in the personal marketplace with a management marker, update that marketplace through the installed plugin-creator helpers, and register the plugin through the Codex CLI.

**Tech Stack:** Python 3 standard library and `unittest`, Make, Node.js/npm for xagent packaging, Codex CLI personal marketplaces.

## Global Constraints

- Shared filesystem skills from `projects/agents/global/skills/` install only to user-global harness locations.
- `smoke-test` installs only from `projects/agents/sheaf/skills/smoke-test/` to repo-local harness locations.
- `xagent-subagents`, `scripts/xagent`, and the packaged runtime install only inside `$HOME/.agents/plugins/plugins/xagent/`.
- The xagent package marker is `.sheaf-managed` with exact contents `sheaf-xagent-plugin\n`.
- Managed obsolete files may be removed; unmanaged files at the same paths must be preserved.
- A new marketplace defaults to name `personal`; an existing non-empty marketplace name is preserved.
- The marketplace entry uses `policy.installation: "AVAILABLE"`, `policy.authentication: "ON_INSTALL"`, and `category: "Productivity"`.
- The xagent marketplace entry uses a local `source.path` that resolves under the invoking home to `$HOME/.agents/plugins/plugins/xagent`.
- Build and validate the install package in a temporary directory without modifying tracked plugin assets.
- Use the installed plugin-creator helpers and fail explicitly if they, the Codex CLI, validation, or plugin registration fail.
- Do not copy an xagent launcher or runtime to `PATH`, a standalone skill directory, or a repo-local harness directory.

---

### Task 1: Make agents skill scopes exclusive

**Assignment:** `gpt-5.5`, high effort

**OpenSpec coverage:** 1.1–1.5; `asd-4`, `asd-18`, `asd-24`

**Files:**

- Modify: `projects/agents/scripts/install.py`
- Modify: `projects/agents/scripts/install_test.py`
- Modify: `projects/agents/README.md`
- Modify: `Makefile`

**Interfaces:**

- Consumes: existing `Skill`, `Output`, `read_sources()`, managed marker checks, and scope-specific install/check/clean modes.
- Produces: `build_obsolete_repo_outputs(repo_root: Path) -> list[Output]`; repo desired outputs containing only root instructions and Sheaf skills; global obsolete ID coverage for `xagent-subagents`.

- [ ] **Step 1: Replace the old xagent-specific output tests with failing scope tests**

Add `SkillScopeOutputTests` methods
`test_repo_outputs_include_only_sheaf_skills`,
`test_repo_outputs_honor_synthetic_codex_only_sheaf_skill`, and
`test_global_outputs_include_only_non_plugin_global_skills`. Add
`ObsoleteRepoOutputTests` methods
`test_repo_obsolete_outputs_cover_all_global_ids_and_retired_xagent` and
`test_repo_install_check_clean_handle_only_managed_obsolete_outputs`.

Build the target-filter test in a temporary copied repository fixture containing a synthetic `projects/agents/sheaf/skills/codex-only` skill. Assert that repo output paths contain that skill only under `.codex/skills/`. For every real global skill ID, assert it is absent from repo desired outputs and present in the appropriate global desired outputs.

- [ ] **Step 2: Run the installer unit tests and confirm the new expectations fail**

Run:

```bash
python3 -m unittest projects/agents/scripts/install_test.py -v
```

Expected: failures show global skills still appear in repo desired outputs and no repo obsolete-output builder exists.

- [ ] **Step 3: Separate desired repo outputs from obsolete repo outputs**

Implement these constants and function:

```python
RETIRED_REPO_SKILL_IDS = ("xagent-subagents",)
OBSOLETE_GLOBAL_SKILL_IDS = ("smoke-test", "xagent-subagents")

def build_obsolete_repo_outputs(repo_root: Path) -> list[Output]:
    _global_source, global_skills, _sheaf_skills = read_sources(repo_root)
    skill_ids = {skill.skill_id for skill in global_skills}
    skill_ids.update(RETIRED_REPO_SKILL_IDS)
    return [
        Output(repo_root / target_dir / skill_id / "SKILL.md", "")
        for skill_id in sorted(skill_ids)
        for target_dir in REPO_TARGET_DIRS.values()
    ]
```

Change `build_repo_outputs()` to render only `sheaf_skills`. In `main()`, include `build_obsolete_repo_outputs()` when scope is `repo` or `all`, and route the resulting list through the existing managed-only install/check/clean behavior alongside global obsolete outputs.

- [ ] **Step 4: Run unit and repo installation checks**

Run:

```bash
python3 -m unittest projects/agents/scripts/install_test.py -v
make agents-install-repo
make agents-check-repo
```

Expected: tests pass; install removes managed repo-local global skill copies; check passes; `.claude/skills/smoke-test`, `.cursor/skills/smoke-test`, `.pi/skills/smoke-test`, and `.codex/skills/smoke-test` remain.

- [ ] **Step 5: Document the ownership split**

Update the agents README and root Make help so the exact user-facing statements are:

```text
Repo-local outputs contain repository instructions and Sheaf-only skills.
Shared skills install only through agents-install-global.
Plugin-owned skills such as xagent-subagents are excluded from the agents installer.
```

Also change the root `agents-install` help text from “locally and globally” to “repo-local Sheaf guidance and user-global shared guidance.”

- [ ] **Step 6: Commit Task 1**

Run:

```bash
git add projects/agents/scripts/install.py projects/agents/scripts/install_test.py projects/agents/README.md Makefile .claude/skills .cursor/skills .pi/skills .codex/skills
git commit -m "fix(agents): keep shared skills global"
```

### Task 2: Add the global xagent plugin installer

**Assignment:** `gpt-5.6-sol`, high effort

**OpenSpec coverage:** 2.1–2.5; `xa-11`, `xa-14`

**Files:**

- Create: `plugins/xagent/scripts/install_global.py`
- Create: `plugins/xagent/scripts/install_global_test.py`
- Modify: `plugins/xagent/scripts/package_xagent.py`
- Modify: `Makefile`

**Interfaces:**

- Consumes: plugin source at `plugins/xagent/`, xagent source at `projects/xagent/`, plugin-creator scripts under `$CODEX_HOME/skills/.system/plugin-creator/scripts/`, and `codex plugin`.
- Produces: `install_global.py install --home PATH --codex-home PATH`; staged package at `$HOME/.agents/plugins/plugins/xagent/`; root target `xagent-plugin-install-global`.

- [ ] **Step 1: Write failing package and marketplace tests**

Use temporary home, Codex home, plugin source, and fake executables. Add
`GlobalPluginInstallTests` methods named
`test_new_marketplace_defaults_to_personal`,
`test_existing_marketplace_name_interface_and_unrelated_entries_survive`,
`test_second_install_updates_one_xagent_entry`,
`test_unmanaged_destination_is_rejected`,
`test_staged_package_has_marker_cachebuster_and_executable_launcher`,
`test_tracked_plugin_tree_is_unchanged`, and
`test_missing_helper_and_failed_codex_command_are_reported`.

The fake Codex executable must record `plugin add xagent@<actual-name>` and return a `plugin list` table containing one enabled xagent row whose `PATH` is the staged package. Use a fixed cachebuster in tests.

- [ ] **Step 2: Run the new tests and confirm they fail**

Run:

```bash
python3 -m unittest plugins/xagent/scripts/install_global_test.py -v
```

Expected: import or missing-interface failure because `install_global.py` does not exist.

- [ ] **Step 3: Make plugin packaging support an untracked destination**

Refactor `package_xagent.py` around:

```python
def build_package(destination: Path) -> None:
    # Copy .codex-plugin/, skills/, and scripts/ from PLUGIN_ROOT.
    # Build projects/xagent, then copy package.json and dist/src into
    # destination/assets/xagent without writing PLUGIN_ROOT/assets.

def validate_launcher(plugin_root: Path) -> None:
    # Run help, fake-adapter repository independence, and missing-runtime checks
    # against plugin_root/scripts/xagent.
```

Add `--output PATH`; retain the current source-package behavior only when no output is supplied so existing `xagent-plugin-build` and `xagent-plugin-test` remain compatible. Preserve `scripts/xagent` mode with `shutil.copy2`.

- [ ] **Step 4: Implement deterministic global installation**

Implement these constants and callable boundary exactly:

```python
PLUGIN_NAME = "xagent"
MANAGED_FILE = ".sheaf-managed"
MANAGED_CONTENT = "sheaf-xagent-plugin\n"
```

The function signature is
`install_global(*, repo_root: Path, home: Path, codex_home: Path,
codex: str = "codex", cachebuster: str | None = None) -> None`.

The function must:

1. Resolve and require `create_basic_plugin.py`, `update_plugin_cachebuster.py`, `read_marketplace_name.py`, and `validate_plugin.py`.
2. Build into `TemporaryDirectory()` via `package_xagent.py --output`.
3. Run the validator on that temporary package.
4. Reject an existing destination unless its `.sheaf-managed` contents exactly equal `MANAGED_CONTENT`.
5. Copy to a sibling staging directory, write the marker, apply one cachebuster to the staged manifest, then atomically replace the managed destination with rollback on rename failure.
6. Run `create_basic_plugin.py xagent --path <temporary-scaffold-parent> --with-marketplace --marketplace-path <marketplace.json> --install-policy AVAILABLE --auth-policy ON_INSTALL --category Productivity --force`.
7. Normalize the xagent marketplace entry's local `source.path` to the staged package path relative to the selected home.
8. Read the actual marketplace name through `read_marketplace_name.py`.
9. Run `codex plugin add xagent@<name>`, then `codex plugin list` using the same selected home.
10. Parse the xagent row and require installed/enabled status plus the resolved staged package path.

Catch dependency and subprocess errors at the CLI boundary, print the named failed dependency or command to stderr, and exit non-zero without selecting another install path.

- [ ] **Step 5: Wire the Make target and pass all tests**

Add:

```make
.PHONY: xagent-plugin-install-global

xagent-plugin-install-global:
	python3 plugins/xagent/scripts/install_global.py install
```

Run:

```bash
python3 -m unittest plugins/xagent/scripts/install_global_test.py -v
make xagent-plugin-test
```

Expected: all installer tests pass; plugin build/launcher/manifest validation passes; `git diff -- plugins/xagent/assets` is empty after the global-installer tests.

- [ ] **Step 6: Commit Task 2**

Run:

```bash
git add plugins/xagent/scripts/install_global.py plugins/xagent/scripts/install_global_test.py plugins/xagent/scripts/package_xagent.py Makefile
git commit -m "feat(xagent): add global Codex plugin installer"
```

### Task 3: Migrate xagent to one installed owner

**Assignment:** `gpt-5.5`, high effort

**OpenSpec coverage:** 3.1–3.5; `asd-23`, `xa-15`

**Files:**

- Delete: `projects/agents/global/skills/xagent-subagents/skill.yaml`
- Delete: `projects/agents/global/skills/xagent-subagents/SKILL.md`
- Modify: `plugins/xagent/skills/xagent-subagents/SKILL.md`
- Modify: `projects/agents/README.md`
- Create or modify: `plugins/xagent/README.md`
- Regenerate/delete managed outputs under `.claude/skills/`, `.cursor/skills/`, `.pi/skills/`, and `.codex/skills/`

**Interfaces:**

- Consumes: Task 1 obsolete-output behavior and Task 2 installed package path.
- Produces: plugin-only `xagent-subagents` ownership and documentation that invokes `$HOME/.agents/plugins/plugins/xagent/scripts/xagent` from the active repository.

- [ ] **Step 1: Add source-ownership assertions**

Extend `projects/agents/scripts/install_test.py` with:

```python
def test_xagent_skill_is_not_an_agents_source_or_desired_output(self) -> None:
    self.assertFalse(
        (REPO_ROOT / "projects/agents/global/skills/xagent-subagents").exists()
    )
    # Assert no desired repo/global Output ends in xagent-subagents/SKILL.md.
```

Run the focused test before deleting the source:

```bash
python3 -m unittest projects.agents.scripts.install_test.SkillScopeOutputTests.test_xagent_skill_is_not_an_agents_source_or_desired_output -v
```

Expected: FAIL because the agents-owned source still exists.

- [ ] **Step 2: Remove the standalone source and update plugin instructions**

Delete the two agents source files. Change every executable example in the plugin skill to:

```shell
XAGENT_PLUGIN_ROOT="${HOME}/.agents/plugins/plugins/xagent"
"${XAGENT_PLUGIN_ROOT}/scripts/xagent" run --harness claude_code --model opus --subagent "<review prompt>"
```

State that `codex plugin list` must report xagent installed and enabled at that package before invocation, the command must run with the active repository as its working directory, and a launcher/model/infrastructure failure must be surfaced rather than bypassed.

- [ ] **Step 3: Regenerate repo-local and global filesystem skills**

Run:

```bash
make agents-install-repo
make agents-check-repo
make agents-install-global
make agents-check-global
```

Expected: all managed repo-local shared skills and all standalone global `xagent-subagents` copies are absent; all four repo-local `smoke-test` copies remain; non-plugin global skills remain current.

- [ ] **Step 4: Document the ownership matrix and recovery**

Document:

```text
Shared skills: projects/agents/global/skills -> agents-install-global
smoke-test: projects/agents/sheaf/skills/smoke-test -> agents-install-repo
xagent-subagents + launcher + runtime: plugins/xagent -> xagent-plugin-install-global
```

Include the global install/update command, the need to open a new Codex conversation after install, and recovery: rerun `make xagent-plugin-install-global`; if the installed package is unmarked, inspect it and move it aside manually rather than forcing overwrite.

- [ ] **Step 5: Run focused ownership checks**

Run:

```bash
python3 -m unittest projects/agents/scripts/install_test.py -v
find .claude/skills .cursor/skills .pi/skills .codex/skills -path '*/xagent-subagents/SKILL.md' -print
find .claude/skills .cursor/skills .pi/skills .codex/skills -path '*/smoke-test/SKILL.md' -print
```

Expected: tests pass; the first `find` prints nothing; the second prints exactly four paths.

- [ ] **Step 6: Commit Task 3**

Run:

```bash
git add projects/agents/global/skills/xagent-subagents plugins/xagent/skills/xagent-subagents/SKILL.md projects/agents/README.md plugins/xagent/README.md .claude/skills .cursor/skills .pi/skills .codex/skills
git commit -m "chore(xagent): make plugin the single skill owner"
```

### Task 4: Install globally and verify end to end

**Assignment:** `gpt-5.5`, high effort

**OpenSpec coverage:** 4.1–4.5

**Files:**

- Modify: `openspec/changes/fix-agent-skill-and-plugin-installation/tasks.md`
- Verify only: user-global agents locations, `$HOME/.agents/plugins/marketplace.json`, and `$HOME/.agents/plugins/plugins/xagent/`

**Interfaces:**

- Consumes: all outputs from Tasks 1–3.
- Produces: installed/enabled global xagent plugin and verified OpenSpec completion state.

- [ ] **Step 1: Run the complete local test matrix**

Run:

```bash
make -C projects/agents test
make agents-check-repo
make agents-check-global
make -C projects/xagent test
make xagent-plugin-test
```

Expected: every command exits zero.

- [ ] **Step 2: Install and inspect the real global plugin**

Run:

```bash
make xagent-plugin-install-global
codex plugin list
```

Expected: exactly one xagent plugin identity is installed and enabled, and its reported path resolves to `$HOME/.agents/plugins/plugins/xagent`.

- [ ] **Step 3: Smoke-test the installed launcher outside Sheaf**

Run from a fresh temporary directory:

```bash
XAGENT_LOG_ROOT="<temporary-log-root>" \
XAGENT_TEST_ADAPTER=fake \
"${HOME}/.agents/plugins/plugins/xagent/scripts/xagent" \
run --harness codex --subagent "installed plugin smoke test"
```

Expected: exit zero; emitted session events show the temporary directory as the child working directory; logs exist only under `<temporary-log-root>`; no `data/xagent` directory appears in the temporary repository.

- [ ] **Step 4: Verify single ownership and artifact integrity**

Run:

```bash
find "${HOME}/.agents/skills" "${CODEX_HOME:-${HOME}/.codex}/skills" -path '*/xagent-subagents/SKILL.md' -print
find .claude/skills .cursor/skills .pi/skills .codex/skills -path '*/xagent-subagents/SKILL.md' -print
git diff --check
openspec validate fix-agent-skill-and-plugin-installation --strict
```

Expected: both `find` commands print nothing; diff and OpenSpec validation pass. Confirm in a new Codex conversation that `xagent-subagents` is discovered from the installed plugin.

- [ ] **Step 5: Synchronize OpenSpec checkboxes**

After all corresponding implementation, review, and verification gates pass, mark tasks 1.1–4.5 complete in:

```text
openspec/changes/fix-agent-skill-and-plugin-installation/tasks.md
```

Then run:

```bash
openspec status --change fix-agent-skill-and-plugin-installation --json
```

Expected: apply tasks report complete and the change is ready to archive.

- [ ] **Step 6: Commit Task 4**

Run:

```bash
git add openspec/changes/fix-agent-skill-and-plugin-installation docs/superpowers/plans
git commit -m "docs(openspec): complete global skill installation change"
```
