# Scoped Tools

Sheaf Chat gives Pi agents a service-owned extension with scoped filesystem tools. The extension is registered per session with the session's `rootDirectory`.

The implementation lives under `projects/sheaf-chat/src/extensions/sheaf-chat/`.

## Tool List

Only these tools are enabled for Sheaf Chat Pi sessions:

| Tool | Purpose |
|------|---------|
| `read` | Read UTF-8 text files with optional 1-indexed line offset and line limit. |
| `write` | Create or overwrite a UTF-8 text file. |
| `edit` | Replace exact text in a file. Ambiguous or missing target text returns a tool error. |
| `list` | List directory entries with type, size, and modified time. |
| `tree` | Return a bounded directory tree with default ignores. |
| `find_files` | Discover files by glob, extension, path segment, include/exclude globs, max depth, and limit. |
| `search_text` | Search text with literal or regex mode, case controls, include/exclude globs, context lines, and match limit. |
| `file_info` | Stat a relative path and report in-root metadata. |

Pi built-in shell and command execution tools are not enabled. The Pi session is created with built-in tools disabled and the scoped tool names explicitly supplied.

## Path Policy

Every tool path is resolved through a `RootPolicy` created from the canonical session root.

The policy:

- resolves the configured root with `realpath`;
- rejects empty paths and null bytes;
- normalizes backslashes before checking segments;
- rejects any `..` segment;
- accepts relative paths under the root;
- accepts absolute paths only when the resolved target remains under the root;
- resolves symlinks for existing paths and verifies the final target remains under the canonical root;
- supports missing target paths only for tools that create files, while still verifying the existing ancestor chain.

Returned paths are root-relative. Tool results must not reveal parent directories outside the root.

## Escape Handling

When a path escape is detected, the tools report `root_escape_denied` behavior through the scoped activity/audit binding.

The activity event shape is:

```json
{
  "type": "sheaf_chat.path_escape_denied",
  "inputPath": "../outside",
  "reason": "parent_traversal",
  "tool": "read"
}
```

The AGUI mapper preserves path enforcement activity as sanitized AGUI activity events so browser clients can see that an attempted operation was denied.

## Default Ignore Behavior

Tree, file discovery, and text search skip large or generated directories by default, including dependency, build, cache, and VCS directories such as `.git`, `node_modules`, `dist`, `build`, and cache folders.

`search_text` skips binary files and bounds the number of returned matches.

## Result Sanitization

The AGUI and tool-result sanitizers redact secret-looking fields and relativize absolute paths under the session root. Absolute paths outside the root are not exposed as navigable tool output.

## Operational Constraints

Scoped tools are intended for code and text workflows inside the selected root. They do not provide process execution, environment inspection, network access, or shell-style command composition.

If an agent needs code navigation, it should use `tree`, `find_files`, `search_text`, `list`, and `file_info` instead of shell commands.
