# Manual smoke (slice 0003)

1. Build `apps/realtime-agent` then `apps/vscode-extension` (see extension README).
2. Open `apps/vscode-extension` in VS Code and press F5 (Extension Development Host).
3. Confirm status bar shows **Sheaf** idle; press **F16** — status should switch to **Sheaf Listening** (mic permission may be required on macOS).
4. Speak briefly, press **F20** — a model response should begin (requires valid API key).
5. Press **F16** again — session stops and status returns to idle.

If native modules fail to load, rebuild them for your VS Code Electron/Node ABI (see `apps/vscode-extension/README.md`).
