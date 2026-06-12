# Capability: Scoped Tools

Project: `projects/sheaf-chat`
ID prefix: `st` — requirement IDs are append-only; never renumber or reuse.

## Purpose

The service-owned Pi extension giving agents a filesystem tool set strictly
confined to the session's root directory. Eight tools (read, write, edit,
list, tree, find_files, search_text, file_info) replace Pi's built-in tools;
there is no shell, process, or network tool. Every path passes through a
root policy; every result reports root-relative paths only.

## Requirements

### Requirement: st-1 — Registration: tool set and session binding
THE service SHALL register exactly the tools `read`, `write`, `edit`, `list`, `tree`, `find_files`, `search_text`, `file_info` on each Pi session, with built-in Pi tools disabled ([agent-runtime](../sheaf-chat-agent-runtime/spec.md)); the extension SHALL be bound to the session's root directory at session creation.

#### Scenario: Extension registered
- **WHEN** a Pi session is created
- **THEN** exactly the tools `read`, `write`, `edit`, `list`, `tree`, `find_files`, `search_text`, `file_info` are registered with built-in Pi tools disabled and the extension is bound to the session's root directory

### Requirement: st-2 — Registration: standalone root resolution
WHERE the extension is loaded standalone (default export outside the service), THE root SHALL be `SHEAF_CHAT_ROOT` or the process working directory.

#### Scenario: Loaded standalone with env var
- **WHEN** the extension is loaded standalone and `SHEAF_CHAT_ROOT` is set
- **THEN** the root is `SHEAF_CHAT_ROOT`

#### Scenario: Loaded standalone without env var
- **WHEN** the extension is loaded standalone and `SHEAF_CHAT_ROOT` is not set
- **THEN** the root is the process working directory

### Requirement: st-3 — Path policy: canonicalization and resolution
THE policy SHALL canonicalize the configured root with `realpath` at creation and resolve every tool path against it: backslashes normalize to `/`; empty, whitespace-only, and NUL-containing paths are rejected; any `..` segment is rejected; relative paths resolve under the canonical root; absolute paths are accepted only when they resolve under it.

#### Scenario: Backslash normalization
- **WHEN** a tool path contains backslashes
- **THEN** they are normalized to `/` before resolution

#### Scenario: Empty or whitespace-only path
- **WHEN** a tool path is empty or whitespace-only
- **THEN** the path is rejected

#### Scenario: NUL-containing path
- **WHEN** a tool path contains a NUL byte
- **THEN** the path is rejected

#### Scenario: Parent traversal segment
- **WHEN** a tool path contains a `..` segment
- **THEN** the path is rejected

#### Scenario: Relative path
- **WHEN** a tool path is relative
- **THEN** it is resolved under the canonical root

#### Scenario: Absolute path within root
- **WHEN** a tool path is absolute and resolves under the canonical root
- **THEN** it is accepted

#### Scenario: Absolute path outside root
- **WHEN** a tool path is absolute and does not resolve under the canonical root
- **THEN** it is rejected

### Requirement: st-4 — Path policy: symlink resolution for existing and create-capable targets
THE policy SHALL resolve symlinks of existing targets and verify the final real path remains under the canonical root; for create-capable tools (`write`), a missing target is allowed but its nearest existing ancestor is realpath-verified and every missing segment is re-checked for containment.

#### Scenario: Symlink resolution for existing target
- **WHEN** a tool path refers to an existing target that is a symlink
- **THEN** the policy resolves symlinks and verifies the final real path remains under the canonical root

#### Scenario: Missing target for write
- **WHEN** `write` is invoked with a missing target path
- **THEN** the nearest existing ancestor is realpath-verified and every missing segment is re-checked for containment

### Requirement: st-5 — Path policy: violation response
IF a path violates the policy, THEN THE tool SHALL return an error result (not throw) with text `Path is outside the session root: <inputPath>`, details `{"code": "root_escape_denied", "reason": "<reason>"}`, and SHALL log an audit event and emit the `sheaf_chat.path_escape_denied` activity with `{inputPath, reason, tool}`. Reasons: `invalid_path`, `empty_path`, `parent_traversal`, `outside_root`, `resolved_path_outside_root`.

#### Scenario: Path violation
- **WHEN** a tool path violates the policy
- **THEN** the tool returns an error result (not throw) with text `Path is outside the session root: <inputPath>`, details `{"code": "root_escape_denied", "reason": "<reason>"}`, and logs an audit event and emits the `sheaf_chat.path_escape_denied` activity with `{inputPath, reason, tool}`

### Requirement: st-6 — Path policy: root-relative reporting
THE tools SHALL report all paths root-relative (`.` for the root itself, `/`-separated) and SHALL NOT reveal the absolute root or any parent directory in results.

#### Scenario: Path in result
- **WHEN** a tool returns a path in its result
- **THEN** the path is root-relative (`.` for the root itself, `/`-separated) and the absolute root or any parent directory is not revealed

### Requirement: st-7 — Tool behavior: read
`read` SHALL return UTF-8 file content as `<displayPath>\n<numbered lines>` with right-aligned 1-based line numbers (`N|line`), supporting optional `offset` (1-based start line) and `limit` (line count); output is head-truncated to 2000 lines / 50KB with a continuation note `[Showing lines A-B of N. Use offset=K to continue.]` (or `[N more lines in file. …]` when only `limit` cut it short). Errors: unreadable path → `Could not read file: <path>`; NUL byte in the first 8KB → `File is not UTF-8 text: <path>`; offset beyond EOF → `Offset <n> is beyond end of file (<N> lines total)`.

#### Scenario: Successful read
- **WHEN** `read` is invoked with a valid path
- **THEN** it returns UTF-8 file content as `<displayPath>\n<numbered lines>` with right-aligned 1-based line numbers (`N|line`)

#### Scenario: Output truncated at 2000 lines or 50KB
- **WHEN** the file content exceeds 2000 lines or 50KB
- **THEN** output is head-truncated with a continuation note `[Showing lines A-B of N. Use offset=K to continue.]`

#### Scenario: Output truncated by limit only
- **WHEN** only the `limit` parameter cuts the output short
- **THEN** the continuation note is `[N more lines in file. …]`

#### Scenario: Unreadable path
- **WHEN** `read` is invoked with an unreadable path
- **THEN** it returns error `Could not read file: <path>`

#### Scenario: Binary file
- **WHEN** `read` encounters a NUL byte in the first 8KB
- **THEN** it returns error `File is not UTF-8 text: <path>`

#### Scenario: Offset beyond EOF
- **WHEN** `read` is invoked with an `offset` beyond the end of file
- **THEN** it returns error `Offset <n> is beyond end of file (<N> lines total)`

### Requirement: st-8 — Tool behavior: write
`write` SHALL create or overwrite a UTF-8 file, creating parent directories, and report `Successfully wrote <n> bytes to <path>` with `{path, bytes}` details.

#### Scenario: Successful write
- **WHEN** `write` is invoked with a valid path and content
- **THEN** it creates or overwrites the UTF-8 file (creating parent directories as needed) and reports `Successfully wrote <n> bytes to <path>` with `{path, bytes}` details

### Requirement: st-9 — Tool behavior: edit
`edit` SHALL apply one or more exact-text replacements (`edits[]` of `{oldText, newText}`; a top-level `oldText`/`newText` pair and a JSON-string `edits` value are normalized into the array): each `oldText` must be non-empty, match exactly once in the original file, and not overlap other edits; matching is line-ending-normalized with BOM and original CRLF/LF endings preserved on write. Success reports `Successfully replaced <n> block(s) in <path>.`; failures return the pinned messages in the error catalogue.

#### Scenario: Successful edit
- **WHEN** `edit` is invoked with valid edits where each `oldText` matches exactly once and edits do not overlap
- **THEN** it applies the replacements, preserves BOM and original CRLF/LF endings, and reports `Successfully replaced <n> block(s) in <path>.`

#### Scenario: Edit failure
- **WHEN** an edit condition is violated (empty oldText, no match, ambiguous match, overlap, no-op, unreadable file)
- **THEN** `edit` returns the pinned error message from the error catalogue

### Requirement: st-10 — Tool behavior: list
`list` SHALL list a directory (default `.`) sorted by name as `<relPath>\t<type>\t<size>\t<mtimeISO>` lines, `type` ∈ `dir|symlink|file`, capped at `limit` (default 500) with a `[Truncated: showing L of N entries.]` note.

#### Scenario: Successful list
- **WHEN** `list` is invoked on a valid directory
- **THEN** it returns entries sorted by name as `<relPath>\t<type>\t<size>\t<mtimeISO>` lines, capped at `limit` (default 500) with a `[Truncated: showing L of N entries.]` note when capped

### Requirement: st-11 — Tool behavior: tree
`tree` SHALL return a bounded indented tree (default `maxDepth` 4, `maxEntries` 200, directories suffixed `/`), skipping symlinks and the default ignore set, with a `[Truncated: reached maxEntries=N.]` note when capped.

#### Scenario: Successful tree
- **WHEN** `tree` is invoked on a valid directory
- **THEN** it returns a bounded indented tree with directories suffixed `/`, skipping symlinks and default ignore directories, with a `[Truncated: reached maxEntries=N.]` note when capped

### Requirement: st-12 — Tool behavior: find_files
`find_files` SHALL list matching file paths filtered by `glob`, `extension`, `pathSegment`, `include`/`exclude` glob arrays, `maxDepth`, and `limit` (default 1000), skipping symlinks and default ignore directories; no matches yields `(no matches)`.

#### Scenario: Matches found
- **WHEN** `find_files` is invoked and matching paths exist
- **THEN** it returns matching file paths filtered by the provided parameters

#### Scenario: No matches
- **WHEN** `find_files` is invoked and no matching paths exist
- **THEN** it returns `(no matches)`

### Requirement: st-13 — Tool behavior: search_text
`search_text` SHALL search UTF-8 files (binary files skipped) with `pattern` as JavaScript regex or literal (`literal: true`), optional `ignoreCase`, `include`/`exclude` globs, `context` lines, and `limit` matches (default 100), emitting `file:lineNumber:line` lines with context lines counted against the limit and individual lines capped at 2000 chars (`...` appended). An empty pattern errors (`pattern must not be empty`); an invalid regex errors (`Invalid search pattern: <detail>`).

#### Scenario: Successful search
- **WHEN** `search_text` is invoked with a valid non-empty pattern
- **THEN** it searches UTF-8 files (skipping binary files) and emits `file:lineNumber:line` lines with context lines counted against the limit and individual lines capped at 2000 chars (`...` appended)

#### Scenario: Empty pattern
- **WHEN** `search_text` is invoked with an empty pattern
- **THEN** it returns error `pattern must not be empty`

#### Scenario: Invalid regex
- **WHEN** `search_text` is invoked with an invalid regex pattern
- **THEN** it returns error `Invalid search pattern: <detail>`

### Requirement: st-14 — Tool behavior: file_info
`file_info` SHALL stat a path and report `path`, `type` (`dir|symlink|file|other`), `size`, `modifiedAt`, `createdAt` as `key: value` lines plus the same details object.

#### Scenario: Successful file_info
- **WHEN** `file_info` is invoked with a valid path
- **THEN** it reports `path`, `type` (`dir|symlink|file|other`), `size`, `modifiedAt`, `createdAt` as `key: value` lines plus the same details object

### Requirement: st-15 — Tool behavior: default ignore set
`tree`, `find_files`, and `search_text` SHALL skip these directory names by default: `node_modules`, `.git`, `dist`, `build`, `.cache`, `__pycache__`, `.venv`, `venv`, `target`, `vendor`, `.next`, `.turbo`, `coverage`, `.pytest_cache`, `.mypy_cache`, `.tox`, `out`.

#### Scenario: Default ignore directories skipped
- **WHEN** `tree`, `find_files`, or `search_text` traverses the filesystem
- **THEN** directories named `node_modules`, `.git`, `dist`, `build`, `.cache`, `__pycache__`, `.venv`, `venv`, `target`, `vendor`, `.next`, `.turbo`, `coverage`, `.pytest_cache`, `.mypy_cache`, `.tox`, `out` are skipped by default

### Requirement: st-16 — Tool behavior: aborted signal
IF a tool is invoked with an already-aborted signal, THEN it SHALL return the error result `Operation aborted` without touching the filesystem.

#### Scenario: Aborted signal on invocation
- **WHEN** a tool is invoked with an already-aborted signal
- **THEN** it returns error result `Operation aborted` without touching the filesystem

### Requirement: st-17 — Tool behavior: glob dialect
THE glob dialect SHALL support `*` (within a segment), `?` (single non-separator char), and `**` (any depth, including zero segments), matched against the full root-relative path.

#### Scenario: Glob matching
- **WHEN** a glob pattern is applied
- **THEN** `*` matches within a segment, `?` matches a single non-separator character, and `**` matches any depth (including zero segments), all matched against the full root-relative path

### Requirement: st-18 — Tool behavior: edit file-change notification
WHEN `edit` successfully writes the target file and a file-change notifier is bound, THE tool SHALL notify after the write with canonical absolute file path, root directory, and source `edit_tool`; IF validation or writing fails, THEN it SHALL NOT notify.

#### Scenario: Successful edit with notifier bound
- **WHEN** `edit` successfully writes the target file and a file-change notifier is bound
- **THEN** the tool notifies after the write with canonical absolute file path, root directory, and source `edit_tool`

#### Scenario: Failed edit with notifier bound
- **WHEN** validation or writing fails and a file-change notifier is bound
- **THEN** the tool SHALL NOT notify

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
[file-browser](../sheaf-chat-file-browser/spec.md) `file.changed` broadcasts:

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
  forwarded into chat today, although [agui-mapping](../sheaf-chat-agui-mapping/spec.md)
  defines the mapping (gap noted in [coverage](../../../projects/sheaf-chat/docs/coverage.md)).

## Interactions

- [agent-runtime](../sheaf-chat-agent-runtime/spec.md) — registers the extension per session
  with the manifest/provisional root directory.
- [agui-mapping](../sheaf-chat-agui-mapping/spec.md) — defines the AGUI form of path-escape
  activity; tool calls and results reach the browser through Pi tool events
  mapped there.
- [file-browser](../sheaf-chat-file-browser/spec.md) — consumes successful edit notifications
  as `file.changed` WebSocket events for matching roots.
