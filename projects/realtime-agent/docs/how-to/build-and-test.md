# Build and Test

## Prerequisites

- Node.js 20 or newer
- npm
- For extension development: VS Code 1.85+ and Xcode command-line tools on macOS when rebuilding native modules

## Install dependencies

From the repository root:

```bash
make -C projects/realtime-agent install
```

Or from the project directory:

```bash
cd projects/realtime-agent
npm install
```

This installs the root workspace and both packages under `src/agent` and
`src/vscode-extension`.

## Build

From the repository root:

```bash
make -C projects/realtime-agent build
make realtime-agent-build
```

Or:

```bash
cd projects/realtime-agent
make build
```

This runs `build-agent` (TypeScript compile for `realtime-agent-lib`) and
`build-vscode-extension` (esbuild bundle for `sheaf-vscode-extension`).

Build only one package:

```bash
make -C projects/realtime-agent build-agent
make -C projects/realtime-agent build-vscode-extension
```

## Test

From the repository root:

```bash
make -C projects/realtime-agent test
make realtime-agent-test
```

Or:

```bash
cd projects/realtime-agent
make test
```

Run one package's tests:

```bash
make -C projects/realtime-agent test-agent
make -C projects/realtime-agent test-vscode-extension
```

## Clean

```bash
make -C projects/realtime-agent clean
make realtime-agent-clean
```

## Related docs

- [Testing reference](../reference/testing.md)
- [Rebuild native modules](rebuild-native-modules.md)
