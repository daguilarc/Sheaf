# Sheaf

Sheaf now contains the realtime voice workflow pieces:

- `apps/realtime-agent`: Node TypeScript library (`realtime-agent-lib`) and `realtime-agent` CLI for OpenAI Realtime sessions.
- `apps/vscode-extension`: VS Code extension that embeds `realtime-agent-lib` and exposes the `sheaf VS Code` editor tool set.
- `prompts/system-prompts`: reusable prompt files for realtime sessions.
- `docs`: architecture, operations, product, and testing notes for the remaining realtime and VS Code surfaces.
- `quests`: historical planning/spec records for the realtime agent and VS Code extension work.

## Build And Test

```bash
make build-realtime-agent
make test-realtime-agent
make build-vscode-extension
make test-vscode-extension
```

The VS Code extension depends on the realtime-agent package, so build the realtime agent first when running extension builds manually.

## Realtime CLI

```bash
export OPENAI_API_KEY="your-key"
cd apps/realtime-agent
npm install
npm run build
node dist/src/cli.js \
  --prompt-file ../../prompts/system-prompts/basic_realtime_conversation_v1.md \
  --context-file /path/to/context.md \
  --model gpt-realtime-2
```

Runtime SQLite data is generated under `apps/realtime-agent/data/` by default and is intentionally not kept in the repository.

## VS Code Extension

```bash
cd apps/realtime-agent && npm install && npm run build
cd ../vscode-extension && npm install && npm run build
```

Open `apps/vscode-extension` in VS Code and start an Extension Development Host with `F5`.
