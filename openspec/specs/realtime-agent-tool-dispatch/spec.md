# Capability: Tool Dispatch

Project: `projects/realtime-agent`
ID prefix: `td` — requirement IDs are append-only; never renumber or reuse.

## Purpose

Tools registered with a session are advertised to the Realtime API in
`session.update`; when the model emits function calls, the library extracts
them from the event stream, runs the matching callbacks one at a time
through a per-session FIFO queue, and returns `function_call_output` items —
structured error payloads on failure — optionally followed by an automatic
`response.create`.

## Requirements

### Requirement: td-1 — Registry build and advertisement
THE library SHALL build a `ToolRegistry` from `AgentStartConfig.toolCallSet`, rejecting duplicate names with `DuplicateToolNameError` ([session-lifecycle](../realtime-agent-session-lifecycle/spec.md) ses-3), and SHALL advertise each tool to the API as `{type:"function", name, description, parameters: inputSchema}`.

#### Scenario: Duplicate tool name rejected
- **WHEN** `AgentStartConfig.toolCallSet` contains duplicate tool names
- **THEN** the library rejects the configuration with `DuplicateToolNameError`

#### Scenario: Tools advertised to API
- **WHEN** the session is started with a `toolCallSet`
- **THEN** each tool is advertised to the API as `{type:"function", name, description, parameters: inputSchema}`

### Requirement: td-2 — Streaming function-call dispatch
WHEN `response.function_call_arguments.delta` events arrive, THE library SHALL accumulate `delta` strings (and capture `name`) per `call_id`; WHEN the matching `response.function_call_arguments.done` arrives, it SHALL dispatch a call using the event's `name`/`arguments` fields, falling back to the accumulated values for whichever is absent. IF neither source yields both a name and an arguments string, THEN nothing SHALL be dispatched for that event.

#### Scenario: Delta events accumulated and done dispatches call
- **WHEN** `response.function_call_arguments.delta` events arrive and the matching `response.function_call_arguments.done` arrives
- **THEN** the library dispatches a call using the event's `name`/`arguments` fields, falling back to accumulated values for whichever is absent

#### Scenario: Insufficient data — no dispatch
- **WHEN** neither the event nor accumulated data yields both a name and an arguments string
- **THEN** nothing is dispatched for that event

### Requirement: td-3 — Batch function-call dispatch
WHEN a `response.done` event arrives whose `response.output` array contains items with `type == "function_call"` and string `call_id`, `name`, and `arguments`, THE library SHALL dispatch each such call.

#### Scenario: Batch dispatch from response.done
- **WHEN** a `response.done` event arrives with `function_call` items in `response.output` having string `call_id`, `name`, and `arguments`
- **THEN** the library dispatches each such call

### Requirement: td-4 — Deduplicate across streaming and batch paths
THE library SHALL dispatch each `call_id` at most once, even when the same call is observed on both the streaming (td-2) and batch (td-3) paths.

#### Scenario: Same call on both paths
- **WHEN** the same `call_id` is observed on both the streaming and batch paths
- **THEN** the call is dispatched exactly once

### Requirement: td-5 — FIFO serial execution
THE dispatcher SHALL execute queued calls strictly FIFO with concurrency 1; incoming events continue to route while a callback runs.

#### Scenario: Serial FIFO execution
- **WHEN** multiple tool calls are queued
- **THEN** the dispatcher executes them strictly FIFO with concurrency 1, routing incoming events while a callback runs

### Requirement: td-6 — Lifecycle notifications
THE dispatcher SHALL emit `onToolLifecycle` notifications `{sessionId, toolCallId, toolName, phase, error?}` with phase `queued` on enqueue, `started` when execution begins, then exactly one of `succeeded` or `failed` (with `error` set to the error payload's `error` string).

#### Scenario: Successful call lifecycle
- **WHEN** a tool call is enqueued and completes successfully
- **THEN** `onToolLifecycle` emits `queued`, then `started`, then `succeeded`

#### Scenario: Failed call lifecycle
- **WHEN** a tool call is enqueued and fails
- **THEN** `onToolLifecycle` emits `queued`, then `started`, then `failed` with `error` set to the error payload's `error` string

### Requirement: td-7 — Transmit function_call_output on resolve
WHEN a callback resolves, THE dispatcher SHALL transmit `{"type":"conversation.item.create","item":{"type":"function_call_output","call_id":<callId>,"output":JSON.stringify(<result>)}}`.

#### Scenario: Callback resolves
- **WHEN** a callback resolves
- **THEN** the dispatcher transmits a `conversation.item.create` event with a `function_call_output` item carrying the stringified result

### Requirement: td-8 — Tool not found error
IF the requested tool name is not registered, THEN THE dispatcher SHALL send a `function_call_output` whose output is the error payload `{"error":"Tool not found: <name>","code":"tool_not_found"}` and emit phase `failed`.

#### Scenario: Unregistered tool name
- **WHEN** the requested tool name is not registered
- **THEN** the dispatcher sends a `function_call_output` with `{"error":"Tool not found: <name>","code":"tool_not_found"}` and emits phase `failed`

### Requirement: td-9 — Invalid arguments error
IF the arguments string is not valid JSON, THEN THE dispatcher SHALL send payload `{"error":"Tool arguments must be valid JSON","code":"invalid_arguments","details":{"message":<parse error>}}` and emit phase `failed`. (Arguments are parsed as JSON only; `inputSchema` is advertised to the model but not validated locally.)

#### Scenario: Arguments not valid JSON
- **WHEN** the arguments string is not valid JSON
- **THEN** the dispatcher sends a `function_call_output` with `{"error":"Tool arguments must be valid JSON","code":"invalid_arguments","details":{"message":<parse error>}}` and emits phase `failed`

### Requirement: td-10 — Callback error handling
IF the callback throws or rejects, THEN THE dispatcher SHALL send payload `{"error":<error.message or "Tool callback failed">,"code":"callback_failed"}` and emit phase `failed`. Tool failures never end the session.

#### Scenario: Callback throws or rejects
- **WHEN** the callback throws or rejects
- **THEN** the dispatcher sends a `function_call_output` with `{"error":<error.message or "Tool callback failed">,"code":"callback_failed"}`, emits phase `failed`, and the session continues

### Requirement: td-11 — Callback context argument
THE callback SHALL receive `(parsedArgs, ctx)` where `ctx` is `{sessionId, toolCallId, metadata: {sourceEventType: <the event type the call was extracted from>}}`.

#### Scenario: Callback invoked with context
- **WHEN** a tool callback is invoked
- **THEN** it receives `(parsedArgs, ctx)` where `ctx` includes `sessionId`, `toolCallId`, and `metadata.sourceEventType`

### Requirement: td-12 — Follow-up response.create
WHERE `AgentStartConfig.responseAfterToolOutput === true`, THE dispatcher SHALL enqueue a follow-up `response.create` (policy `enqueue`) after every tool output — successes and structured errors alike — deferred behind any active response and ordered FIFO across multiple tool calls; otherwise no follow-up is sent.

#### Scenario: responseAfterToolOutput enabled
- **WHEN** `AgentStartConfig.responseAfterToolOutput === true` and a tool output is sent
- **THEN** the dispatcher enqueues a follow-up `response.create` (policy `enqueue`) after every tool output, including structured errors, ordered FIFO

#### Scenario: responseAfterToolOutput disabled
- **WHEN** `AgentStartConfig.responseAfterToolOutput` is not `true`
- **THEN** no follow-up `response.create` is sent after tool outputs

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
  tool outputs is specified in [turn-model](../realtime-agent-turn-model/spec.md) turn-11.
- The CLI's built-in registry and the extension's `sheaf VS Code` set are
  owned by [cli](../realtime-agent-cli/spec.md) and [editor-tools](../realtime-agent-editor-tools/spec.md).
- Tests: `tests/agent/tooling/tooling.test.ts`,
  `tests/agent/agent_loop/agent_loop.test.ts`,
  `tests/agent/agent_loop/response_queue.test.ts` (follow-up ordering).

## Interactions

- [session-lifecycle](../realtime-agent-session-lifecycle/spec.md) — events feeding extraction;
  transmit path for outputs.
- [turn-model](../realtime-agent-turn-model/spec.md) — follow-up responses and tool-output holds.
- [editor-tools](../realtime-agent-editor-tools/spec.md) — the extension's tools return `ToolError`
  objects as *successful* callback results, deliberately avoiding td-10.
- [cli](../realtime-agent-cli/spec.md) — the built-in `echo` tool.
