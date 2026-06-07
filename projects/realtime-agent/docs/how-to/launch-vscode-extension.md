# Launch the VS Code Extension

## Prerequisites

1. Build the project:

```bash
make -C projects/realtime-agent build
```

2. Configure an OpenAI API key using one of:

- VS Code Secret Storage (`sheaf.realtime.openAiApiKey`)
- `config/api_keys.json` with `openai_api_key` when opening a Sheaf repository workspace
- `sheaf.realtime.openAiApiKey` workspace setting

3. On macOS, grant microphone permission to the VS Code app you use for development.

## Open the extension in Extension Development Host

1. Open `projects/realtime-agent/src/vscode-extension` in VS Code.
2. Press `F5` to launch an Extension Development Host.

The extension activates on its commands or when opening the `Realtime Chat` view.

## Start a session

- Press `F16`, click the `Sheaf` status bar item, or run **Sheaf: Toggle Realtime Session**.
- Active state shows `Sheaf Listening` in the status bar.
- Open the **Sheaf** activity bar container and the **Realtime Chat** view to see bubbles.

## Commit audio and get a response

- Press `F20`, use the chat pane button, or run **Sheaf: Commit Audio And Request Response**.

The extension uses manual turn mode: audio streams continuously, but the model
responds only after an explicit commit-and-respond action.

## Stop a session

Press `F16` again or toggle the session command. The extension stops microphone
capture before closing the realtime session and database.

## Troubleshooting

- **Missing API key**: set Secret Storage, `config/api_keys.json`, or the workspace setting. See [Configuration](../reference/config.md).
- **Native module errors**: rebuild `better-sqlite3` and `naudiodon` for your VS Code Electron ABI. See [Rebuild native modules](rebuild-native-modules.md).
- **Connection lost**: the extension resets to idle and does not resume dropped sessions. Start a new session.

## Related docs

- [VS Code extension reference](../reference/vscode-extension.md)
- [Turn model](../explanation/turn-model.md)
- [Freshness model](../explanation/freshness.md)
