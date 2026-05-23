# Slice 0003 — implementation complete

## Summary

Delivered the `apps/vscode-extension` VS Code extension scaffold per `physicalplan/plan.md`: commands and **F15** / **F19** keybindings, manual-mode `startAgentSession` wiring with SQLite under global storage, microphone capture via `CreateMicrophoneCapture` from `realtime-agent-lib`, status-bar toggle, configuration and SecretStorage-style API key resolution, output-channel logging, and esbuild bundling to `out/extension.js`.

## Cross-repo adjustments

- `apps/realtime-agent/package.json`: added a `require` export condition so Node’s test runner can load the library from the extension’s compiled CJS tests.
- `apps/realtime-agent/src/index.ts`: public re-exports for `CreateMicrophoneCapture`, `CreateSoxMicrophoneCapture`, `REALTIME_PCM_SAMPLE_RATE`, and microphone types (already present in tree).
- Root `.gitignore`: entries for `apps/vscode-extension/out`, `node_modules`, and `.test-dist`.

## Validation run

- `npm test` and `npm run lint` in `apps/vscode-extension`
- `npm test` in `apps/realtime-agent` after export change
- `npm run build` in `apps/vscode-extension` (esbuild; expected `import.meta` warning when bundling `db.js` — extension always passes an explicit DB path)

Manual steps are documented in `notes/manual_smoke.md` and `apps/vscode-extension/README.md`.
