# VS Code Extension

## Purpose

The VS Code extension in `apps/vscode-extension` provides a voice-driven editor workflow on top of `realtime-agent-lib`. It starts a manual-turn OpenAI Realtime session, captures microphone audio in the extension host, exposes VS Code-native read/navigation tools, shows a focused chat pane, and pushes structured context when observed editor state becomes stale.

## User-Facing Surface

- Activity Bar container: `Sheaf`
- Webview view: `Realtime Chat`
- Commands:
  - `Sheaf: Toggle Realtime Session`
  - `Sheaf: Commit Audio And Request Response`
- Default keybindings:
  - `F16`: start or stop the realtime session
  - `F20`: commit buffered audio and request a response
- Status bar:
  - Idle: `Sheaf`
  - Active: `Sheaf Listening`
  - Transitional: spinner while starting or stopping

The commands are global VS Code commands. They do not require focus inside the webview.

## Session Lifecycle

When a session starts, the extension:

1. Resolves the OpenAI API key from VS Code Secret Storage, then the `sheaf.realtime.openAiApiKey` setting, then `OPENAI_API_KEY`.
2. Opens a SQLite database at `<extension global storage>/realtime-agent.sqlite3`.
3. Starts `realtime-agent-lib` with:
   - model `gpt-realtime-2` by default
   - manual turn mode
   - the built-in VS Code read/navigation tool set
   - `responseAfterToolOutput: true`
4. Starts microphone capture and forwards 24 kHz mono 16-bit PCM frames through `sendAudioFrame()`.
5. Attaches chat event listeners and freshness listeners.

When a session stops, the extension stops microphone capture before stopping the realtime session and closing the database.

If microphone setup fails, session startup fails. If microphone capture fails during a session, the extension shows an error, records a chat error bubble, and shuts the session down.

If the Realtime connection drops unexpectedly, the extension resets to idle and records that the OpenAI connection was lost. It does not resume the dropped session.

## Turn Model

The extension always starts the realtime agent in manual turn mode.

- Audio frames stream continuously while the session is active.
- The model does not answer from raw audio append events alone.
- `F20` calls `commitAudioAndCreateResponse()`, which sends `input_audio_buffer.commit` and `response.create` as one ordered queued unit.

This avoids server-VAD auto-response behavior inside the editor and makes turn boundaries explicit.

## Chat Pane

The webview chat pane is a reduced conversation view built from the realtime event stream. It shows:

- completed and in-progress user transcript bubbles
- streamed assistant text bubbles
- tool activity bubbles
- context push bubbles
- session and command error bubbles

It intentionally does not show:

- raw websocket events
- individual `input_audio_buffer.append` events
- low-level response lifecycle noise
- full tool outputs

Tool bubbles summarize the operation, such as reading a file or moving the viewport. Context bubbles summarize freshness pushes and other structured context messages.

## Tool Surface

The extension registers one tool call set named `sheaf_vscode_read_nav` with six tools:

- `code_read`
- `list_files`
- `rgrep`
- `read_visible_range`
- `set_cursor_position`
- `move_visible_range`

These tools use VS Code APIs and editor buffers rather than shell commands or direct filesystem traversal. That keeps results aligned with open editors, unsaved buffers, workspace roots, and VS Code search behavior.

### Path and Workspace Rules

- Tool paths are workspace-relative by default.
- Absolute paths are accepted only when they still resolve inside an open workspace folder.
- Files outside the workspace are rejected.
- Returned file paths are normalized to workspace-relative POSIX-style paths.

### Read and Search Behavior

- `code_read` returns a full file or an inclusive line range from the open text document view.
- `code_read` rejects directories, files larger than 2 MiB, and binary-looking content.
- Empty files are returned as `lineCount: 0`, `startLine: 0`, `endLine: 0`, and `lines: []`.
- `list_files` defaults to non-recursive listing, excludes hidden names plus `.git` and `node_modules`, and caps results at 500 unless `maxEntries` overrides it.
- `rgrep` uses VS Code workspace file discovery, defaults to `maxMatches: 200`, skips files larger than 2 MiB, and treats truncation as true only when additional matches were omitted.
- `read_visible_range` reads around the active cursor from the active editor and includes unsaved buffer contents.

### Navigation Behavior

- `set_cursor_position` supports absolute file/line moves and relative line moves.
- `move_visible_range` scrolls the viewport without moving the cursor.
- Both navigation tools can optionally return a visible-range snapshot.
- Relative cursor and viewport moves require an active text editor.

## Freshness Pushes

The extension sends structured context messages when state the agent previously observed may now be stale. These pushes do not automatically request a response.

Current freshness message kinds:

- `file_changed_since_last_read`
- `viewport_changed_since_last_check`
- `cursor_changed_since_last_check`

Rules:

- File freshness is cleared when the agent reads a file through `code_read` or a read-producing navigation tool.
- Viewport freshness is cleared when the agent requests visible-range context or receives a returned visible range from a navigation tool.
- Cursor freshness is cleared when the agent reads visible-range context or moves the cursor.
- User-driven edits, scrolling, tab switches, and selection changes can trigger one notification per stale state until the agent observes that state again.
- Agent-caused editor mutations are suppressed so the extension does not notify the model about its own tool side effects.
- Outside-workspace documents are ignored for freshness pushes.

Freshness messages are serialized as structured JSON text through `sendStructuredContext()` and also appear as summarized context bubbles in the chat pane.

## Configuration

The extension reads these workspace settings:

- `sheaf.realtime.openAiApiKey`
- `sheaf.realtime.model`
- `sheaf.realtime.systemPrompt`
- `sheaf.realtime.inputDevice`
- `sheaf.realtime.safetyIdentifier`

If `sheaf.realtime.systemPrompt` is empty, the extension uses a built-in prompt that frames the model as a concise voice-driven coding assistant for navigation and code reading.

## Build and Run

Build the shared realtime-agent package first, then the extension:

```bash
cd apps/realtime-agent
npm install
npm run build

cd ../vscode-extension
npm install
npm run build
```

To run the extension, open `apps/vscode-extension` in VS Code and start an Extension Development Host with `F5`.

## Constraints

- The extension depends on native modules from `better-sqlite3` and `naudiodon`.
- Those native modules must match the Node/Electron ABI used by the VS Code extension host.
- macOS requires microphone permission for the VS Code app being used.
