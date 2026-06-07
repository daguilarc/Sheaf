# Tool Dispatch

Realtime Agent registers tools with the OpenAI Realtime API and dispatches model
tool calls through a per-session queue.

## Tool definitions

Each `ToolDefinition` has:

- `name` — unique within the tool call set
- `description` — optional model-facing text
- `inputSchema` — JSON Schema for arguments
- `callback` — handler receiving parsed arguments and `ToolRuntimeContext`

The agent rejects duplicate tool names before connecting.

Built-in surfaces:

- CLI: `echo` tool via `tool_sets.ts`
- VS Code extension: seven tools in the `sheaf VS Code` call set

## Dispatch queue

`ToolDispatcher` processes tool calls through a FIFO queue with default
concurrency of one.

While a callback runs:

- Incoming realtime events continue to route and persist.
- Additional tool calls queue behind the active callback.

## Tool call parsing and errors

The agent accumulates tool call events, parses arguments, and invokes the
matching callback. Failures return structured output payloads to the model:

| Code | Meaning |
|---|---|
| `tool_not_found` | No registered tool matches the requested name. |
| `invalid_arguments` | Arguments failed schema or parse validation. |
| `callback_failed` | The callback threw or returned a failure. |

These failures do not end the session.

Lifecycle callbacks (`onToolLifecycle`) report phases: `queued`, `started`,
`succeeded`, `failed`.

## Follow-up responses

When `responseAfterToolOutput` is enabled (extension default, optional for other
callers):

- Successful tool output schedules a follow-up `response.create`.
- Structured tool errors also schedule a follow-up `response.create`.
- If a response is already active, the follow-up queues instead of interrupting.

## Response queue

Response-affecting operations share a dedicated queue separate from tool
dispatch:

- `createResponse()`
- `commitAudio()`
- `commitAudioAndCreateResponse()`
- Tool-triggered follow-up responses

Policies:

| Policy | Behavior |
|---|---|
| `enqueue` | Wait for the active response to finish (default). |
| `reject` | Return `{ status: "rejected", reason: "response_active" }`. |
| `cancel_current` | Emit `response.cancel`, queue the new unit, return `{ status: "queued", reason: "cancelling_active" }`. |

`commitAudioAndCreateResponse()` enqueues commit and create as one atomic unit so
they cannot interleave with another queued response-affecting action.

## Related docs

- [Library API reference](../reference/api.md)
- [Turn model](turn-model.md)
- [VS Code extension reference](../reference/vscode-extension.md)
