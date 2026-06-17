## 1. Codex Hook Assets

- [x] 1.1 Create `projects/agents/global/codex/hooks/session_start_after_compact.py` as a dependency-free command hook script that reads Codex hook JSON from stdin.
- [x] 1.2 Make the script no-op successfully unless `hook_event_name` is `SessionStart` and `source` is `compact`.
- [x] 1.3 Make the script emit Codex-compatible JSON with `hookSpecificOutput.hookEventName = "SessionStart"` and `additionalContext` containing the requested post-compaction plan/checklist/task-list reminder.
- [x] 1.4 Create `projects/agents/global/codex/hooks/hooks.json` as the canonical hook configuration template with a `SessionStart` matcher for `^compact$`.

## 2. Installer Integration

- [x] 2.1 Extend `projects/agents/scripts/install.py` so global/all output construction includes the Codex hook script under `$CODEX_HOME/hooks/sheaf/session_start_after_compact.py`.
- [x] 2.2 Extend installer rendering so global/all output construction includes a managed `$CODEX_HOME/hooks.json` rendered from the source template with the resolved absolute installed script path.
- [x] 2.3 Preserve existing unmanaged-conflict behavior for `$CODEX_HOME/hooks.json` and the installed script path.
- [x] 2.4 Ensure repo-only scope does not write user-global Codex hook outputs.
- [x] 2.5 Ensure global clean removes managed Codex hook outputs and leaves unmanaged hook files unchanged.

## 3. Documentation

- [x] 3.1 Update `projects/agents/README.md` to list the Codex hook outputs installed by global scope.
- [x] 3.2 Document that Codex may require hook review/trust through `/hooks` before the command hook runs.
- [x] 3.3 Document the unmanaged `$CODEX_HOME/hooks.json` conflict behavior and the manual merge/force path.

## 4. Verification

- [x] 4.1 Add or update installer tests/fixture checks for global install with temporary `--home` and `--codex-home`, asserting the hook script and rendered hook config are written.
- [x] 4.2 Verify global check reports missing or stale Codex hook outputs with temporary fixtures.
- [x] 4.3 Verify global clean removes only managed Codex hook outputs with temporary fixtures.
- [x] 4.4 Run the hook script directly with sample `SessionStart` stdin for `compact` and non-compaction sources.
- [x] 4.5 Run `openspec status --change add-codex-post-compact-session-hook` and confirm the change is apply-ready.
