# Run the CLI

## Prerequisites

1. Build the agent package. See [Build and test](build-and-test.md).
2. Add your OpenAI API key to `config/api_keys.json`:

```json
{
  "openai_api_key": "sk-..."
}
```

3. Prepare a context file. `--context-file` is required on every run.

## Default prompt

When `--prompt-file` is omitted, the CLI uses:

```text
projects/realtime-agent/prompts/system-prompts/basic_realtime_conversation_v1.md
```

Override with `--prompt-file` or change `default_prompt_file` in
`config/realtime-agent.json`.

## Basic run

From the repository root after building, use the project target:

```bash
make realtime-agent-run-cli CONTEXT_FILE=/path/to/context.md
```

Or invoke the built CLI directly:

```bash
node projects/realtime-agent/src/agent/dist/src/agent/src/cli.js \
  --context-file /path/to/context.md
```

With an explicit prompt and model:

```bash
node projects/realtime-agent/src/agent/dist/src/agent/src/cli.js \
  --prompt-file projects/realtime-agent/prompts/system-prompts/basic_realtime_conversation_v1.md \
  --context-file /path/to/context.md \
  --model gpt-realtime-2
```

## Tools

Register the built-in `echo` tool:

```bash
node projects/realtime-agent/src/agent/dist/src/agent/src/cli.js \
  --context-file /path/to/context.md \
  --tool echo
```

## Microphone selection

List input devices:

```bash
node projects/realtime-agent/src/agent/dist/src/agent/src/cli.js --list-input-devices
```

Select by id or name substring:

```bash
node projects/realtime-agent/src/agent/dist/src/agent/src/cli.js \
  --context-file /path/to/context.md \
  --input-device 2
```

## Optional safety identifier

```bash
node projects/realtime-agent/src/agent/dist/src/agent/src/cli.js \
  --context-file /path/to/context.md \
  --safety-identifier my-user-id
```

## Runtime output

- Structured JSON lines on stdout for non-audio Realtime events
- SQLite session data under `data/realtime-agent/realtime-agent.sqlite`
- JSONL runtime log under `logs/realtime-agent/realtime-agent.jsonl`

Press `Ctrl+C` to stop. The CLI shuts down microphone capture, closes the
session, and exits.

## Related docs

- [CLI reference](../reference/cli.md)
- [Configuration](../reference/config.md)
- [Session lifecycle](../explanation/session-lifecycle.md)
