# Slice 0003 - System Prompt And Documentation

## Objective

Update the built-in VS Code agent instructions and extension documentation so the agent knows the toolset is now the general `sheaf VS Code` toolset and knows the exact `modifyFile` workflow.

After this slice, the user-facing and agent-facing docs match the implemented tool surface from slice 0002.

## Expected Outcome

- The default VS Code system prompt names the toolset `sheaf VS Code`.
- The prompt explains when and how to use `modifyFile`.
- The prompt instructs the agent to reread context after mismatch errors rather than retrying blindly.
- The prompt states that non-agent buffer edits will be reported through freshness notifications.
- The prompt includes the spoken-code insertion default: when the user speaks or describes code without a target file/range, insert at the current cursor if safe; query cursor position first if unknown.
- Architecture docs describe the renamed toolset and new write tool.

## Key Files / Systems Affected

- `apps/vscode-extension/src/prompts.ts`
- `apps/vscode-extension/test/config.test.ts` or a new focused prompt test under `apps/vscode-extension/test/`
- `docs/architecture/VSCODE_EXTENSION.md`
- `apps/vscode-extension/README.md`

## Existing APIs To Reuse As-Is

- `GetEffectiveSystemPrompt` / `SessionPreferences.getSystemPrompt()` behavior should remain unchanged: user-configured prompts still override the built-in prompt.
- Existing config tests for custom prompt override behavior.
- Existing docs structure in `docs/architecture/VSCODE_EXTENSION.md`.

## APIs To Extend Or Modify

No runtime API changes are required in this slice.

Modify only prompt and documentation text. Do not change the `modifyFile` runtime implementation in this slice unless tests reveal that the prompt/doc update exposed a naming inconsistency.

## Prompt Requirements

Update `BASELINE_VOICE_NAV_SYSTEM_PROMPT` so it covers every requirement from the quest spec:

- The available toolset is named `sheaf VS Code`.
- Use VS Code tools instead of guessing editor state or file contents.
- `modifyFile` edits the current VS Code buffer, not by shelling out or writing files directly.
- `modifyFile` validates exact target text plus up to three surrounding full lines before changing anything.
- Gather fresh context before calling `modifyFile` unless the exact target text and surrounding context came from a recent VS Code tool result.
- Supply `start`, `end`, `exactText`, `replacementText`, `contextBeforeText`, and `contextAfterText`.
- Context before and after should cover three full lines when available and may be shorter only at file boundaries.
- On mismatch, reread the relevant file or visible range and compute a new edit; do not retry blindly.
- If the buffer is edited by a user, formatter, language server, git operation, or other non-agent source, the agent will be informed through context freshness notifications.
- If the user speaks code or describes a snippet without naming a file or range, assume they want insertion at the current cursor position unless they say otherwise.
- If cursor position is unknown for spoken-code insertion, query it before writing; otherwise proceed when safe.

Keep the prompt concise enough for normal session startup, but explicit enough that the write flow is unambiguous.

## Documentation Requirements

Update `docs/architecture/VSCODE_EXTENSION.md`:

- Rename the documented tool call set from `sheaf_vscode_read_nav` to `sheaf VS Code`.
- Preserve all six existing read/navigation tool names and summaries.
- Add `modifyFile` to the tool list.
- Document the write tool as VS Code-buffer-based, exact-range-plus-context validated, and protected by freshness mutation guards.
- Update any text that describes the extension as read/navigation-only.

Update `apps/vscode-extension/README.md` where it describes the built-in prompt or tool surface:

- Mention the built-in prompt now covers read/navigation plus validated buffer edits.
- Keep user settings and keybinding docs unchanged unless the existing wording says navigation-only.

## Validation Expectations

Add or update prompt tests to verify:

- Empty configured prompt returns a built-in prompt containing `sheaf VS Code`.
- The built-in prompt mentions `modifyFile`.
- The built-in prompt mentions exact target/context validation.
- A non-empty configured prompt still overrides the built-in prompt.

Run:

- `npm run lint --prefix apps/vscode-extension`
- `npm test --prefix apps/vscode-extension`

Also manually scan docs for stale `sheaf_vscode_read_nav` references and update all references that describe the current extension toolset. Historical quest logs do not need edits.

## Sequencing Notes

This slice depends on slice 0002 so the prompt does not instruct the agent to call an unavailable write tool.
