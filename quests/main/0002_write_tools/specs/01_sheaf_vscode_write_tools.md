# Sheaf VS Code Write Tools

## Overview

The VS Code extension tool surface should become the general Sheaf VS Code
toolset instead of the read/navigation-only toolset. Rename the existing
`sheaf_vscode_read_nav` tool call set to:

```text
sheaf VS Code
```

The renamed set continues to include the existing read/navigation tools and adds
one write API/tool call named `modifyFile`.

The write tool must edit VS Code document buffers through the VS Code extension
API. It must not edit files through direct filesystem writes, shell commands, or
external patch tools. This keeps behavior aligned with unsaved buffers, virtual
documents, editor undo history, and VS Code change events.

## Existing Tool Compatibility

The renamed toolset must preserve the existing tools and their tool names:

- `code_read`
- `list_files`
- `rgrep`
- `read_visible_range`
- `set_cursor_position`
- `move_visible_range`

Only the toolset display/name changes from the read-navigation-specific name to
`sheaf VS Code`. Existing tool call names and argument contracts remain stable.

## Shared Position Semantics

`modifyFile` uses the same position convention as the existing VS Code tools:

- `line` is 1-based.
- `character` is 0-based.
- Positions refer to the current VS Code text document buffer, not necessarily
  the file contents on disk.
- The start position is inclusive.
- The end position is exclusive.
- The start and end positions must refer to the same file.

```ts
export interface CodePosition
{
  file: string;
  line: number;
  character: number;
}
```

## Modify File API

Replaces an exact range of text in one VS Code document after validating that the
range and the surrounding context still match the agent's expectations.

Tool name:

```text
modifyFile
```

Arguments:

```ts
export interface ModifyFileArgs
{
  start: CodePosition;
  end: CodePosition;
  exactText: string;
  replacementText: string;
  contextBeforeText: string;
  contextAfterText: string;
}
```

Argument meanings:

- `start`: The inclusive start position of the code to replace.
- `end`: The exclusive end position of the code to replace.
- `exactText`: The exact text expected between `start` and `end`.
- `replacementText`: The text that should replace `exactText`.
- `contextBeforeText`: The exact text from up to three full lines above the
  replacement start, rounded to the nearest line start, ending at `start`.
- `contextAfterText`: The exact text from `end` through up to three full lines
  below the replacement end, rounded to the nearest line end.

The context strings are allowed to contain fewer than three surrounding lines
when the edit is at the beginning or end of the file. The tool must treat that as
valid only when the provided context reaches the actual file boundary.

All text arguments must preserve the line breaks and whitespace from the VS Code
buffer observations the agent used to prepare the edit. Validation compares the
current buffer text to the supplied strings exactly, including indentation,
spacing, and line break characters.

Result:

```ts
export interface ModifyFileResult
{
  file: string;
  start: CodePosition;
  end: CodePosition;
  insertedText: string;
  replacedText: string;
}
```

## Validation Behavior

`modifyFile` must validate the full expected edit window before applying any
change.

The implementation should compute:

- The target range from `start` to `end`.
- The before-context range from the line start up to three lines above `start`,
  clamped to the beginning of the file, through `start`.
- The after-context range from `end` through the line end up to three lines below
  `end`, clamped to the end of the file.

The edit may proceed only if all of the following are true:

- `start.file` and `end.file` are the same workspace file.
- The file exists, is a text document, and is inside the workspace.
- `start` and `end` are valid positions in the current VS Code buffer.
- `start` is before or equal to `end`.
- The text currently in the target range exactly equals `exactText`.
- The text currently in the before-context range exactly equals
  `contextBeforeText`.
- The text currently in the after-context range exactly equals
  `contextAfterText`.
- If fewer than three before-context lines are provided, the computed context
  range must begin at the actual beginning of the file.
- If fewer than three after-context lines are provided, the computed context
  range must end at the actual end of the file.

The tool must not apply a partial edit. Any mismatch or invalid argument returns
a structured error and leaves the buffer unchanged.

## Error Handling

`modifyFile` should return structured errors using stable codes. The existing
tool error shape remains:

```ts
export interface ToolError
{
  code: string;
  message: string;
  details?: Record<string, unknown>;
}
```

The write tool should support these additional error codes:

```ts
type ModifyFileErrorCode =
  | "invalid_position"
  | "file_mismatch"
  | "expected_text_mismatch"
  | "context_before_mismatch"
  | "context_after_mismatch"
  | "edit_rejected";
```

Clear error messages are required. For mismatch errors, the message must identify
which part failed. The `details` object should include enough information for the
agent to recover without guessing, such as:

- The file path.
- The requested start and end positions.
- The expected and actual text lengths.
- The mismatch category.
- A short actual-text preview when safe and reasonably small.

The tool must not dump large file contents into error details.

## Buffer Change Notifications

The extension already tracks editor freshness and informs the agent when
previously observed context may be stale. With `modifyFile`, this behavior is
part of the write contract:

- Edits made by `modifyFile` are agent-originated changes and must not trigger a
  "changed since last read" notification back to the agent.
- Edits made by the user, another extension, formatter, language server, git
  operation, or any non-agent source must still notify the agent when relevant.
- The system prompt must tell the agent that if the buffer is edited by something
  else, the agent will be informed.

## System Prompt Requirements

Update the built-in VS Code system prompt so the agent understands the renamed
toolset and the write flow.

The prompt must explain:

- The toolset is named `sheaf VS Code`.
- The agent should use VS Code tools instead of guessing editor state or file
  contents.
- `modifyFile` edits the current VS Code buffer and validates exact text plus
  three lines of surrounding context before changing anything.
- The agent must gather fresh context before calling `modifyFile` unless it
  already has the exact target text and surrounding context from a recent tool
  result.
- The agent must supply start and end positions, `exactText`, `replacementText`,
  `contextBeforeText`, and `contextAfterText`.
- The context before and after should cover three full lines when available, and
  may be shorter only at the beginning or end of the file.
- If `modifyFile` reports a mismatch, the agent should not retry blindly. It
  should reread the relevant file or visible range, then compute a new edit.
- If the buffer is edited by something else, the agent will be informed through
  context freshness notifications.
- If the agent receives a spoken description of code, it should assume the user
  wants to insert that code at the current cursor position unless the user says
  otherwise.  If the agent does not know the cursor position, it should query for it before it starts writing; otherwise, it should proceed.

## Spoken Code Insertion Behavior

When the user speaks code or describes a code snippet without naming a target
file or range, the agent should treat the active cursor position as the insertion
point.

Expected flow:

1. Read the current visible range or cursor context if needed.
2. Build a zero-length `modifyFile` replacement where `start` equals `end` at the
   current cursor position.
3. Use an empty `exactText`.
4. Use the spoken code as `replacementText`, preserving intended indentation and
   line breaks as well as possible.
5. Include the required three-line context before and after the cursor position.

If the spoken request is ambiguous enough that inserting at the cursor would be
dangerous, the agent should ask one concise clarifying question before editing.

## Acceptance Criteria

- The VS Code tool call set is specified as `sheaf VS Code`.
- The existing read/navigation tool contracts remain unchanged.
- The `modifyFile` API is specified with exact target text, replacement text,
  start/end positions, and three-line before/after context.
- The validation rules require exact matching and no partial edit on failure.
- The error contract requires clear mismatch errors.
- The system prompt requirements explain how to use `modifyFile`, how to respond
  to mismatches, that external buffer edits are reported, and that spoken code
  defaults to insertion at the current cursor.
