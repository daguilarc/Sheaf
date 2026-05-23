# Realtime Agent

Node TypeScript library and CLI for experimenting with the OpenAI Realtime API.

## Quick start

From the repository root:

```bash
export OPENAI_API_KEY="your-key"
make build-realtime-agent
realtime-agent \
  --prompt-file prompts/system-prompts/basic_realtime_conversation_v1.md \
  --context-file data/initial-context.md \
  --model gpt-realtime-2
```

Or from this directory:

```bash
npm install
npm run build
export OPENAI_API_KEY="your-key"
node dist/src/cli.js \
  --prompt-file ../../prompts/system-prompts/basic_realtime_conversation_v1.md \
  --context-file ../../data/initial-context.md
```

List local microphone input devices:

```bash
realtime-agent --list-input-devices
```

Select a device by numeric id or name substring:

```bash
realtime-agent \
  --prompt-file prompts/system-prompts/basic_realtime_conversation_v1.md \
  --context-file data/initial-context.md \
  --input-device 2
```

## CLI options

- `--prompt-file <path>` (required) system prompt file
- `--context-file <path>` (required) initial context file
- `--model <model>` optional, default `gpt-realtime-2`
- `--tool <name>` repeatable; comma-separated lists are allowed on a single flag
- `--input-device <id-or-name>` optional microphone selection
- `--list-input-devices` print input devices and exit
- `--safety-identifier <id>` optional `OpenAI-Safety-Identifier` header value

## Environment

- `OPENAI_API_KEY` (required) bearer token for the Realtime API

## Stdout

Non-audio realtime events are printed as one JSON object per line with `session_id`, `direction`, `event_type`, and `event`. Outgoing `input_audio_buffer.append` events are not printed.

## Persistence

Session metadata and events are stored in `apps/realtime-agent/data/realtime-agent.sqlite` by default. Outgoing audio append events are forwarded to the API but not persisted.

## Library

Import the published contracts from the package entry point (`realtime-agent-lib`):

```ts
import {
  DEFAULT_REALTIME_MODEL,
  startAgentSession,
  type AgentStartConfig,
  type ToolDefinition,
} from "realtime-agent-lib";
```

System prompts remain under `prompts/system-prompts/` at the repository root.

## Tests

```bash
npm test
```
