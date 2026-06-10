# Capability: Scoped Tools

ID prefix: `st`

## Purpose

The service-owned Pi extension giving agents a filesystem tool set strictly
confined to the session's root directory. Eight tools (read, write, edit,
list, tree, find_files, search_text, file_info) replace Pi's built-in tools;
there is no shell, process, or network tool. Every path passes through a
root policy; every result reports root-relative paths only.

## Requirements

### Registration

- **[st-1]** THE service SHALL register exactly the tools `read`, `write`,
  `edit`, `list`, `tree`, `find_files`, `search_text`, `file_info` on each
  Pi session, with built-in Pi tools disabled
  ([agent-runtime](agent-runtime.md)); the extension SHALL be bound to the
  session's root directory at session creation.
- **[st-2]** WHERE the extension is loaded standalone (default export
  outside the service), THE root SHALL be `SHEAF_CHAT_ROOT` or the process
  working directory.

### Path policy

- **[st-3]** THE policy SHALL canonicalize the configured root with
  `realpath` at creation and resolve every tool path against it:
  backslashes normalize to `/`; empty, whitespace-only, and NUL-containing
  paths are rejected; any `..` segment is rejected; relative paths resolve
  under the canonical root; absolute paths are accepted only when they
  resolve under it.
- **[st-4]** THE policy SHALL resolve symlinks of existing targets and
  verify the final real path remains under the canonical root; for
  create-capable tools (`write`), a missing target is allowed but its
  nearest existing ancestor is realpath-verified and every missing segment
  is re-checked for containment.
- **[st-5]** IF a path violates the policy, THEN THE tool SHALL return an
  error result (not throw) with text
  `Path is outside the session root: <inputPath>`, details
  `{"code": "root_escape_denied", "reason": "<reason>"}`, and SHALL log an
  audit event and emit the `sheaf_chat.path_escape_denied` activity with
  `{inputPath, reason, tool}`. Reasons: `invalid_path`, `empty_path`,
  `parent_traversal`, `outside_root`, `resolved_path_outside_root`.
- **[st-6]** THE tools SHALL report all paths root-relative (`.` for the
  root itself, `/`-separated) and SHALL NOT reveal the absolute root or any
  parent directory in results.

### Tool behavior

- **[st-7]** `read` SHALL return UTF-8 file content as
  `<displayPath>\n<numbered lines>` with right-aligned 1-based line numbers
  (`N|line`), supporting optional `offset` (1-based start line) and `limit`
  (line count); output is head-truncated to 2000 lines / 50KB with a
  continuation note `[Showing lines A-B of N. Use offset=K to continue.]`
  (or `[N more lines in file. …]` when only `limit` cut it short). Errors:
  unreadable path → `Could not read file: <path>`; NUL byte in the first
  8KB → `File is not UTF-8 text: <path>`; offset beyond EOF →
  `Offset <n> is beyond end of file (<N> lines total)`.
- **[st-8]** `write` SHALL create or overwrite a UTF-8 file, creating
  parent directories, and report
  `Successfully wrote <n> bytes to <path>` with `{path, bytes}` details.
- **[st-9]** `edit` SHALL apply one or more exact-text replacements
  (`edits[]` of `{oldText, newText}`; a top-level `oldText`/`newText` pair
  and a JSON-string `edits` value are normalized into the array): each
  `oldText` must be non-empty, match exactly once in the original file, and
  not overlap other edits; matching is line-ending-normalized with BOM and
  original CRLF/LF endings preserved on write. Success reports
  `Successfully replaced <n> block(s) in <path>.`; failures return the
  pinned messages in the error catalogue.
- **[st-10]** `list` SHALL list a directory (default `.`) sorted by name as
  `<relPath>\t<type>\t<size>\t<mtimeISO>` lines, `type` ∈
  `dir|symlink|file`, capped at `limit` (default 500) with a
  `[Truncated: showing L of N entries.]` note.
- **[st-11]** `tree` SHALL return a bounded indented tree (default
  `maxDepth` 4, `maxEntries` 200, directories suffixed `/`), skipping
  symlinks and the default ignore set, with a
  `[Truncated: reached maxEntries=N.]` note when capped.
- **[st-12]** `find_files` SHALL list matching file paths filtered by
  `glob`, `extension`, `pathSegment`, `include`/`exclude` glob arrays,
  `maxDepth`, and `limit` (default 1000), skipping symlinks and default
  ignore directories; no matches yields `(no matches)`.
- **[st-13]** `search_text` SHALL search UTF-8 files (binary files skipped)
  with `pattern` as JavaScript regex or literal (`literal: true`), optional
  `ignoreCase`, `include`/`exclude` globs, `context` lines, and `limit`
  matches (default 100), emitting `file:lineNumber:line` lines with
  context lines counted against the limit and individual lines capped at
  2000 chars (`...` appended). An empty pattern errors
  (`pattern must not be empty`); an invalid regex errors
  (`Invalid search pattern: <detail>`).
- **[st-14]** `file_info` SHALL stat a path and report
  `path`, `type` (`dir|symlink|file|other`), `size`, `modifiedAt`,
  `createdAt` as `key: value` lines plus the same details object.
- **[st-15]** `tree`, `find_files`, and `search_text` SHALL skip these
  directory names by default: `node_modules`, `.git`, `dist`, `build`,
  `.cache`, `__pycache__`, `.venv`, `venv`, `target`, `vendor`, `.next`,
  `.turbo`, `coverage`, `.pytest_cache`, `.mypy_cache`, `.tox`, `out`.
- **[st-16]** IF a tool is invoked with an already-aborted signal, THEN it
  SHALL return the error result `Operation aborted` without touching the
  filesystem.
- **[st-17]** THE glob dialect SHALL support `*` (within a segment), `?`
  (single non-separator char), and `**` (any depth, including zero
  segments), matched against the full root-relative path.
- **[st-18]** WHEN `edit` successfully writes the target file and a
  file-change notifier is bound, THE tool SHALL notify after the write with
  canonical absolute file path, root directory, and source `edit_tool`; IF
  validation or writing fails, THEN it SHALL NOT notify.

## Contracts

Tool results are Pi tool results:
`{content: [{type: "text", text}], details, isError?}`.

### Tool parameters (typebox schemas)

| Tool | Required | Optional |
|---|---|---|
| `read` | `path` | `offset`, `limit` |
| `write` | `path`, `content` | — |
| `edit` | `path`, `edits[] {oldText, newText}` | — |
| `list` | — | `path` (default `.`), `limit` (500) |
| `tree` | — | `path` (`.`), `maxDepth` (4), `maxEntries` (200) |
| `find_files` | — | `glob`, `extension`, `pathSegment`, `include[]`, `exclude[]`, `path` (`.`), `maxDepth` (unlimited), `limit` (1000) |
| `search_text` | `pattern` | `path` (`.`), `include[]`, `exclude[]`, `ignoreCase` (false), `literal` (false), `context` (0), `limit` (100) |
| `file_info` | `path` | — |

### Error catalogue (pinned tool-error texts)

| Condition | Message |
|---|---|
| Path escape (any tool) | `Path is outside the session root: <inputPath>` + details `{code: "root_escape_denied", reason}` |
| Aborted signal | `Operation aborted` |
| `read` unreadable | `Could not read file: <path>` |
| `read` binary | `File is not UTF-8 text: <path>` |
| `read` offset past EOF | `Offset <n> is beyond end of file (<N> lines total)` |
| `write` failure | `Could not write file: <path>.` |
| `edit` missing/invalid edits | `Edit tool input is invalid. edits must contain at least one replacement.` / `Edit tool input is invalid. Each edit must include oldText and newText.` |
| `edit` not readable/writable | `Could not edit file: <path>. Error code: <code>.` |
| `edit` empty oldText | `oldText must not be empty in <path>.` (multi: `edits[i].oldText must not be empty in <path>.`) |
| `edit` text not found | `Could not find the exact text in <path>. The old text must match exactly including all whitespace and newlines.` (multi: `Could not find edits[i] in <path>. The oldText must match exactly …`) |
| `edit` ambiguous | `Found <n> occurrences of the text in <path>. The text must be unique. Please provide more context to make it unique.` (multi variant indexes the edit) |
| `edit` overlapping edits | `edits[i] and edits[j] overlap in <path>. Merge them into one edit or target disjoint regions.` |
| `edit` no-op | `No changes made to <path>. The replacement produced identical content. …` |
| `list`/`tree`/`find_files`/`search_text`/`file_info` missing path | `Path not found: <path>` |
| `list`/`tree`/`find_files` non-directory | `Not a directory: <path>` |
| `search_text` empty pattern | `pattern must not be empty` |
| `search_text` bad regex | `Invalid search pattern: <detail>` |

### Path-escape activity event

```json
{ "type": "sheaf_chat.path_escape_denied", "inputPath": "../outside", "reason": "parent_traversal", "tool": "read" }
```

### File-change notification

The service binds this callback and converts it to
[file-browser](file-browser.md) `file.changed` broadcasts:

```json
{
  "absolutePath": "/abs/path/to/root/docs/readme.md",
  "rootDirectory": "/abs/path/to/root",
  "source": "edit_tool"
}
```

## Design

- `src/extensions/sheaf-chat/pathPolicy.ts` — `CreateRootPolicy` (the
  normative resolution algorithm in [st-3]/[st-4]).
- `src/extensions/sheaf-chat/tools/createScopedTools.ts` — tool factory and
  the `x_scopedToolNames` list; `index.ts` — `RegisterScopedTools` adapts
  the definitions to Pi's `registerTool`.
- `src/extensions/sheaf-chat/toolHelpers.ts` — shared error/success
  builders, truncation (`2000` lines / `50 * 1024` bytes), the default
  ignore list, `HandlePathEscape` (audit + activity + error result).
- `src/extensions/sheaf-chat/editDiff.ts` — edit matching with BOM/CRLF
  normalization and the pinned edit error messages;
  `glob.ts` — the glob-to-regex dialect; `results.ts` — display-path
  relativization and leak assertions (test support);
  `audit.ts` — `CreateAuditLogger` (in-memory entries + activity emission).
- `src/extensions/sheaf-chat/tools/edit.ts` — writes edited content and
  invokes the optional `notifyFileChanged` callback only after successful
  write completion.
- The service binds the extension with `CreateDefaultBindings()`, whose
  default `emitActivity` is a no-op — path-escape activity is therefore not
  forwarded into chat today, although [agui-mapping](agui-mapping.md)
  defines the mapping (gap noted in [coverage](../coverage.md)).

## Interactions

- [agent-runtime](agent-runtime.md) — registers the extension per session
  with the manifest/provisional root directory.
- [agui-mapping](agui-mapping.md) — defines the AGUI form of path-escape
  activity; tool calls and results reach the browser through Pi tool events
  mapped there.
- [file-browser](file-browser.md) — consumes successful edit notifications
  as `file.changed` WebSocket events for matching roots.
