## Context

The agents project already treats `projects/agents/global` as the source of
truth for user-global guidance and skills, and `projects/agents/scripts/install.py`
can install, check, and clean Codex user-global outputs under `$CODEX_HOME`.

Codex hooks are the right lifecycle surface for this behavior. The current
Codex hooks documentation says:

- Codex discovers hooks from `hooks.json` or inline `[hooks]` tables next to
  active config layers, including `~/.codex/hooks.json`.
- `SessionStart` matchers filter on the start source, whose values include
  `compact`.
- `SessionStart` plain stdout or JSON
  `hookSpecificOutput.additionalContext` is added as extra developer context.
- Command hooks receive a JSON object on stdin, including common fields and
  `SessionStart.source`.

This means the least confusing post-compaction implementation is a
`SessionStart` hook with matcher `^compact$` that emits explicit developer
context identifying itself as hook-injected compaction context.

## Goals / Non-Goals

**Goals:**

- Keep every hook asset, including the script and hook configuration template,
  in the Sheaf repo under `projects/agents/global`.
- Install the hook into Codex's user/global configuration during
  `projects/agents/scripts/install.py install --scope global`.
- Inject a model-visible reminder only after compaction, not on normal startup,
  resume, or clear.
- Preserve the agents installer's managed-file safety, check, and clean
  semantics.
- Make the hook output self-identifying so Codex understands the reminder is
  post-compaction context, not a new user request.

**Non-Goals:**

- Installing a Codex plugin or publishing a separate package.
- Changing Codex's compaction prompt.
- Reading or modifying session transcripts to infer whether a plan exists.
- Merging arbitrary user-authored Codex hook configuration.
- Making this hook project-local; it should run globally even when the current
  project's `.codex` layer is untrusted.

## Decisions

### 1. Store Codex-Specific Assets Under `projects/agents/global/codex`

Add a Codex-specific source tree:

```text
projects/agents/global/codex/
  hooks/
    hooks.json
    session_start_after_compact.py
```

`hooks.json` is a template, not the installed file. It defines:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "^compact$",
        "hooks": [
          {
            "type": "command",
            "command": "python3 <installed-script-path>",
            "statusMessage": "Loading post-compaction reminder",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

The installer renders the command with the resolved absolute script path under
`$CODEX_HOME`, avoiding reliance on shell expansion or Codex's current working
directory.

Alternative considered: put the hook in `.codex/hooks.json` in this repo. That
would only run for trusted Sheaf checkouts and would not help other projects,
which misses the user-global goal.

### 2. Use `SessionStart` Source `compact`, Not `PostCompact`

Use `SessionStart` with matcher `^compact$` because Codex documents that
`SessionStart` additional context is injected as developer context, and
`compact` is a supported start source. `PostCompact` can run after compaction,
but its documented output is warnings/system messages rather than extra
developer context.

Alternative considered: change `compact_prompt` or
`experimental_compact_prompt_file`. That would affect the summary-generation
prompt, not the resumed post-compaction agent context, and is more likely to
confuse the model about whether it should summarize or continue.

### 3. Make The Script Defensive And Self-Identifying

The script reads hook stdin as JSON and no-ops unless:

- `hook_event_name == "SessionStart"`
- `source == "compact"`

When matched, it writes JSON:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "Post-compaction reminder from the Sheaf Codex hook: If you were working from a plan, checklist, or task list, please review it after compaction."
  }
}
```

The reminder keeps the requested wording while adding a short prefix that
identifies why the context appeared. That reduces the chance that Codex treats
the hook text as a fresh user request or an instruction unrelated to compaction.

Alternative considered: emit plain text. Plain text would work for
`SessionStart`, but JSON is easier to test and makes the intended hook event
explicit.

### 4. Extend The Existing Installer Rather Than Add A Second Installer

Extend `projects/agents/scripts/install.py` global outputs to include:

```text
$CODEX_HOME/hooks/sheaf/session_start_after_compact.py
$CODEX_HOME/hooks.json
```

The script file and rendered `hooks.json` use the same managed marker as other
agents outputs. `install` refuses to overwrite unmanaged conflicts unless
`--force` is passed. `check` reports missing, stale, or unmanaged conflicts.
`clean` removes only managed files.

This keeps the behavior consistent with the current global instruction and
skill installation model.

Alternative considered: merge the hook into an existing user-authored
`$CODEX_HOME/hooks.json`. That would be friendlier for users with existing
hooks, but it creates a structural merge problem for user-owned JSON and makes
clean rollback ambiguous. The safer first implementation is explicit conflict
detection with a clear path for the user to review or merge manually.

## Risks / Trade-offs

- Existing unmanaged `$CODEX_HOME/hooks.json` blocks install -> The installer
  reports the conflict and preserves the file; the user can manually merge or
  rerun with `--force` after review.
- Multiple hooks may run concurrently -> The hook is read-only and emits only
  context, so it does not depend on ordering against other hooks.
- Hook trust may require review -> Codex documents that non-managed command
  hooks must be reviewed and trusted before they run; implementation notes and
  README updates should point users to `/hooks` when Codex reports a hook
  review warning.
- Codex hook schemas can evolve -> Keep the script small, test the documented
  stdin/stdout contract, and link the design to the current Codex hooks
  documentation as the source of truth.
- Installed absolute paths can become stale if `CODEX_HOME` changes -> The
  user-global install command is the migration mechanism; rerunning it renders
  the hook with the new resolved path.

## Migration Plan

1. Add the Codex hook source directory and script under `projects/agents/global`.
2. Extend installer output construction to render the Codex hook script and
   user-global `$CODEX_HOME/hooks.json` only for global/all scopes.
3. Update docs to describe the hook, global destination, trust review step, and
   unmanaged conflict behavior.
4. Add installer tests or fixture-based checks using temporary `--home` and
   `--codex-home` paths.
5. Verify `install`, `check`, and `clean` for global scope using temp
   directories before running against the real Codex home.
