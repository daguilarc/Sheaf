# Capability: Tool Dispatch

ID prefix: `td`

## Purpose

Tools registered with a session are advertised to the Realtime API in
`session.update`; when the model emits function calls, the library extracts
them from the event stream, runs the matching callbacks one at a time
through a per-session FIFO queue, and returns `function_call_output` items —
structured error payloads on failure — optionally followed by an automatic
`response.create`.

## Requirements

- **[td-1]** THE library SHALL build a `ToolRegistry` from
  `AgentStartConfig.toolCallSet`, rejecting duplicate names with
  `DuplicateToolNameError` ([session-lifecycle](session-lifecycle.md)
  ses-3), and SHALL advertise each tool to the API as
  `{type:"function", name, description, parameters: inputSchema}`.
- **[td-2]** WHEN `response.function_call_arguments.delta` events arrive,
  THE library SHALL accumulate `delta` strings (and capture `name`) per
  `call_id`; WHEN the matching `response.function_call_arguments.done`
  arrives, it SHALL dispatch a call using the event's `name`/`arguments`
  fields, falling back to the accumulated values for whichever is absent.
  IF neither source yields both a name and an arguments string, THEN
  nothing SHALL be dispatched for that event.
- **[td-3]** WHEN a `response.done` event arrives whose `response.output`
  array contains items with `type == "function_call"` and string `call_id`,
  `name`, and `arguments`, THE library SHALL dispatch each such call.
- **[td-4]** THE library SHALL dispatch each `call_id` at most once, even
  when the same call is observed on both the streaming (td-2) and batch
  (td-3) paths.
- **[td-5]** THE dispatcher SHALL execute queued calls strictly FIFO with
  concurrency 1; incoming events continue to route while a callback runs.
- **[td-6]** THE dispatcher SHALL emit `onToolLifecycle` notifications
  `{sessionId, toolCallId, toolName, phase, error?}` with phase `queued` on
  enqueue, `started` when execution begins, then exactly one of `succeeded`
  or `failed` (with `error` set to the error payload's `error` string).
- **[td-7]** WHEN a callback resolves, THE dispatcher SHALL transmit
  `{"type":"conversation.item.create","item":{"type":"function_call_output",
  "call_id":<callId>,"output":JSON.stringify(<result>)}}`.
- **[td-8]** IF the requested tool name is not registered, THEN THE
  dispatcher SHALL send a `function_call_output` whose output is the error
  payload `{"error":"Tool not found: <name>","code":"tool_not_found"}` and
  emit phase `failed`.
- **[td-9]** IF the arguments string is not valid JSON, THEN THE dispatcher
  SHALL send payload `{"error":"Tool arguments must be valid JSON",
  "code":"invalid_arguments","details":{"message":<parse error>}}` and emit
  phase `failed`. (Arguments are parsed as JSON only; `inputSchema` is
  advertised to the model but not validated locally.)
- **[td-10]** IF the callback throws or rejects, THEN THE dispatcher SHALL
  send payload `{"error":<error.message or "Tool callback failed">,
  "code":"callback_failed"}` and emit phase `failed`. Tool failures never
  end the session.
- **[td-11]** THE callback SHALL receive `(parsedArgs, ctx)` where `ctx` is
  `{sessionId, toolCallId, metadata: {sourceEventType: <the event type the
  call was extracted from>}}`.
- **[td-12]** WHERE `AgentStartConfig.responseAfterToolOutput === true`, THE
  dispatcher SHALL enqueue a follow-up `response.create` (policy `enqueue`)
  after every tool output — successes and structured errors alike — deferred
  behind any active response and ordered FIFO across multiple tool calls;
  otherwise no follow-up is sent.

## Contracts

### `ToolDefinition`

```ts
interface ToolDefinition<TArgs = unknown, TResult = unknown> {
  name: string;                          // unique within the set
  description?: string;                  // model-facing
  inputSchema: Record<string, unknown>;  // JSON Schema advertised to the model
  callback: (args: TArgs, ctx: ToolRuntimeContext) => Promise<TResult> | TResult;
}
```

A `ToolCallSet` is `{ name?: string; tools: ToolDefinition[] }`; the set
name is stored on the session row.

### Error payload (`ToolErrorPayload`)

```json
{ "error": "<human message>", "code": "tool_not_found | invalid_arguments | callback_failed", "details": {} }
```

`details` is omitted when not supplied. Builders `buildToolErrorPayload` and
`buildFunctionCallOutputEvent` are exported.

### Error catalogue

| Condition | `code` | `error` message (exact) |
|---|---|---|
| Unregistered tool name | `tool_not_found` | `Tool not found: <name>` |
| Arguments not valid JSON | `invalid_arguments` | `Tool arguments must be valid JSON` (+ `details.message`) |
| Callback threw/rejected | `callback_failed` | the thrown `Error.message`, else `Tool callback failed` |

### Worked example — failed call with follow-up enabled

Incoming `response.function_call_arguments.done`
(`call_id: "c1", name: "nope", arguments: "{}"`) produces, in order:

```json
{"type":"conversation.item.create","item":{"type":"function_call_output","call_id":"c1","output":"{\"error\":\"Tool not found: nope\",\"code\":\"tool_not_found\"}"}}
{"type":"response.create"}
```

with lifecycle notifications `queued` → `started` → `failed`.

## Design

- `src/agent/src/tooling.ts` — `ToolRegistry` (insertion-ordered map),
  `ToolDispatcher` (`Enqueue`/`ProcessQueue`/`ExecuteQueuedCall`),
  `responseAfterOutput: "never" | "always"` (mapped from the boolean in
  `startAgentSession`).
- `src/agent/src/agent_loop.ts` — `FunctionCallArgumentAccumulator`
  (streaming path), `ExtractFunctionCallsFromResponseDone` (batch path),
  `DispatchToolCall` dedupe set, and `ToolDispatcherSendContext` whose
  `sendOutgoingEvent` feeds the normal transmit path (so outputs are
  persisted/routed) and whose `enqueueResponseCreate` feeds the response
  queue.
- The interlock that keeps externally queued response units behind pending
  tool outputs is specified in [turn-model](turn-model.md) turn-11.
- The CLI's built-in registry and the extension's `sheaf VS Code` set are
  owned by [cli](cli.md) and [editor-tools](editor-tools.md).
- Tests: `tests/agent/tooling/tooling.test.ts`,
  `tests/agent/agent_loop/agent_loop.test.ts`,
  `tests/agent/agent_loop/response_queue.test.ts` (follow-up ordering).

## Interactions

- [session-lifecycle](session-lifecycle.md) — events feeding extraction;
  transmit path for outputs.
- [turn-model](turn-model.md) — follow-up responses and tool-output holds.
- [editor-tools](editor-tools.md) — the extension's tools return `ToolError`
  objects as *successful* callback results, deliberately avoiding td-10.
- [cli](cli.md) — the built-in `echo` tool.
