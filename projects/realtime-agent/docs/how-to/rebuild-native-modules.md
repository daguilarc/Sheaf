# Rebuild Native Modules

The agent library and VS Code extension depend on native Node modules:

- `better-sqlite3` — SQLite persistence
- `naudiodon` — microphone capture through PortAudio

These modules compile against the Node or Electron ABI of the runtime that loads
them. Rebuild or reinstall them when you change Node versions, update VS Code, or
see load errors such as `MODULE_NOT_FOUND` or ABI mismatch messages.

## Agent package (CLI and library)

From `projects/realtime-agent/src/agent/`:

```bash
npm rebuild better-sqlite3 naudiodon
```

Or reinstall dependencies:

```bash
cd projects/realtime-agent
npm install
npm run build:agent
```

The CLI runs under system Node 20+. Native modules must match that Node ABI.

## VS Code extension package

The extension host runs on VS Code's Electron Node ABI, which differs from system
Node. Rebuild native modules from the extension directory using the Electron
version that matches your VS Code install.

Typical workflow:

```bash
cd projects/realtime-agent/src/vscode-extension
npm rebuild better-sqlite3 naudiodon --build-from-source
```

If rebuild still fails after a VS Code upgrade, remove and reinstall extension
dependencies:

```bash
cd projects/realtime-agent/src/vscode-extension
rm -rf node_modules
npm install
npm run build
```

Consult the `better-sqlite3` and `naudiodon` package docs for Electron-specific
rebuild flags if your environment requires `electron-rebuild`.

## Verify

After rebuilding:

```bash
make -C projects/realtime-agent test
```

For the extension, launch the Extension Development Host (`F5`) and start a
session with `F16` to confirm microphone capture and database open succeed.

## Related docs

- [Build and test](build-and-test.md)
- [Launch the VS Code extension](launch-vscode-extension.md)
