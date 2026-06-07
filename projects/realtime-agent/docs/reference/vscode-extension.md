# VS Code Extension Reference

Package: `sheaf-vscode-extension`

Source: `src/vscode-extension/`

The extension provides a voice-driven editor workflow on top of
`realtime-agent-lib`. It starts manual-turn Realtime sessions, captures
microphone audio in the extension host, exposes VS Code-native tools, shows a
focused chat pane, and pushes structured context when observed editor state
becomes stale.

## Activity bar and chat view

| Surface | Id / title |
|---|---|
| Activity bar container | `Sheaf` (`sheafContainer`) |
| Webview view | `Realtime Chat` (`sheaf.chatView`) |

## Commands and keybindings

| Command id | Title | Default key |
|---|---|---|
| `sheaf.realtime.toggleSession` | Sheaf: Toggle Realtime Session | `F16` |
| `sheaf.realtime.commitAndRespond` | Sheaf: Commit Audio And Request Response | `F20` |

Commands are global VS Code commands. They do not require focus inside the
webview.

The chat pane also exposes a commit-and-respond control wired to
`sheaf.realtime.commitAndRespond`.

## Status bar

| State | Label |
|---|---|
| Idle | `Sheaf` |
| Active session | `Sheaf Listening` |
| Starting or stopping | Spinner |

Clicking the status bar toggles the session (`sheaf.realtime.toggleSession`).

## Settings

Workspace settings under `sheaf.realtime`:

| Setting | Description |
|---|---|
| `sheaf.realtime.openAiApiKey` | OpenAI API key. Optional when Secret Storage or `config/api_keys.json` provides a key. |
| `sheaf.realtime.model` | Realtime model. Default `gpt-realtime-2`. |
| `sheaf.realtime.systemPrompt` | Overrides the built-in prompt when non-empty. |
| `sheaf.realtime.inputDevice` | Optional microphone id or substring. |
| `sheaf.realtime.safetyIdentifier` | Optional `OpenAI-Safety-Identifier` header value. |

See [Configuration](config.md) for API key resolution order.

## API key and config resolution

When the extension runs in a Sheaf repository workspace, it resolves the OpenAI
API key in this order:

1. VS Code Secret Storage (`sheaf.realtime.openAiApiKey`)
2. `config/api_keys.json` (`openai_api_key`)
3. `sheaf.realtime.openAiApiKey` workspace setting (explicit backwards compatibility)

The extension does not read environment variables for API keys.

Repository detection uses `FindRepositoryRoot` from `realtime-agent-lib` and
requires `projects/realtime-agent/` to exist under the resolved root.

## Chat bubble behavior

The webview chat pane is a reduced conversation view built from the realtime
event stream.

Shown:

- Completed and in-progress user transcript bubbles
- Streamed assistant text bubbles
- Tool activity bubbles (summarized operations)
- Context push bubbles (freshness and structured context)
- Session and command error bubbles

Not shown:

- Raw websocket events
- Individual `input_audio_buffer.append` events
- Low-level response lifecycle noise
- Full tool output payloads

## Tool surface

The extension registers one tool call set named `sheaf VS Code` with seven tools:

| Tool | Purpose |
|---|---|
| `code_read` | Read a full file or line range from the open text document view. |
| `list_files` | List workspace files (non-recursive by default). |
| `rgrep` | Workspace text search via VS Code file discovery. |
| `read_visible_range` | Read around the active cursor including unsaved buffer contents. |
| `set_cursor_position` | Move the cursor absolutely or relatively. |
| `move_visible_range` | Scroll the viewport without moving the cursor. |
| `modifyFile` | Validated buffer edit through the VS Code text document API. |

Read and navigation tools use VS Code APIs and editor buffers rather than shell
commands or direct filesystem traversal.

### Path and write policy

- Tool paths are workspace-relative by default.
- Absolute paths are accepted only when they resolve inside an open workspace folder.
- Files outside the workspace are rejected.
- Returned paths are normalized to workspace-relative POSIX-style paths.
- `modifyFile` is the only write tool. It validates exact target text and up to
  three lines of context before and after the edit range. Mismatches return
  structured errors and leave the buffer unchanged.
- Successful `modifyFile` calls run under the agent-mutation freshness guard so
  the extension does not notify the model about its own write side effects.

Write error codes include `invalid_position`, `file_mismatch`,
`expected_text_mismatch`, `context_before_mismatch`, `context_after_mismatch`, and
`edit_rejected`, plus path/document errors such as `file_not_found`,
`path_outside_workspace`, `path_is_directory`, `binary_file`, and
`unsupported_document`.

Files must be at most 2 MiB and must not look binary.

## Session database location

Session SQLite data is stored at:

```text
<extension global storage>/realtime-agent.sqlite3
```

This is intentional. See [Data](data.md) and the storage exception note in
[docs/README.md](../README.md).

## Runtime logs

When running against a Sheaf repository workspace, structured JSONL logs are
written to:

```text
logs/realtime-agent/vscode-extension.jsonl
```

See [Logs](logs.md).
