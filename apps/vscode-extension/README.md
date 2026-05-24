# Sheaf VS Code extension

Voice-driven OpenAI Realtime session inside VS Code using the shared `realtime-agent-lib` package (no duplicated websocket client). The built-in system prompt (when `sheaf.realtime.systemPrompt` is empty) describes the `sheaf VS Code` read/navigation tools plus validated `modifyFile` buffer edits.

## Develop

1. Build the library (native modules target the Node used for that build):

   ```bash
   cd apps/realtime-agent && npm install && npm run build
   ```

2. Install and build the extension:

   ```bash
   cd apps/vscode-extension && npm install && npm run build
   ```

3. Open `apps/vscode-extension` in VS Code and run **Run > Start Debugging** (or F5) to launch an Extension Development Host.

## Controls

- **F16** — toggle realtime session (manual turn mode): start microphone streaming, then stop and tear down.
- **F20** — commit buffered audio and request a model response (only while a session is active).
- **Status bar** — shows session state; click to run the same toggle as F16.

## Configuration

| Setting / secret | Purpose |
| --- | --- |
| Secret `sheaf.realtime.openAiApiKey` (preferred) | OpenAI API key |
| Setting `sheaf.realtime.openAiApiKey` | Fallback key (less secure) |
| Env `OPENAI_API_KEY` | Last-resort fallback |
| `sheaf.realtime.model` | Defaults to `gpt-realtime-2` |
| `sheaf.realtime.systemPrompt` | Non-empty overrides the built-in `sheaf VS Code` prompt |
| `sheaf.realtime.inputDevice` | Optional device id or name substring |
| `sheaf.realtime.safetyIdentifier` | Optional Realtime safety header |

## Native modules (`better-sqlite3`, `naudiodon`)

These ship platform binaries for **Node**, not necessarily for the **Electron** version embedded in your VS Code build. If the extension fails to activate with a native module error, rebuild the dependencies against the extension host’s Node/Electron ABI (for example using `electron-rebuild` pointed at VS Code’s Electron version, or by following current VS Code guidance for native addons). Until then, use a VS Code build whose embedded Node matches the compiled binaries, or rebuild locally.

## macOS microphone

Grant microphone access to **Visual Studio Code** (or **Code - Insiders**) in **System Settings → Privacy & Security → Microphone** the first time you start a session.
