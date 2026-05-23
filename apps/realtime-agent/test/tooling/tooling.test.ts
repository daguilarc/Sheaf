import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFunctionCallOutputEvent,
  buildToolErrorPayload,
  DuplicateToolNameError,
  ToolDispatcher,
  ToolRegistry,
  type RealtimeEvent,
} from "../../src/index.js";

test("ToolRegistry rejects duplicate tool names", () =>
{
  assert.throws(
    () =>
      new ToolRegistry({
        tools: [
          { name: "echo", inputSchema: {}, callback: () => ({}) },
          { name: "echo", inputSchema: {}, callback: () => ({}) },
        ],
      }),
    DuplicateToolNameError,
  );
});

test("ToolRegistry resolves tools and produces realtime descriptors", () =>
{
  const registry = new ToolRegistry({
    tools: [
      {
        name: "echo",
        description: "Echo tool",
        inputSchema: { type: "object" },
        callback: () => ({ ok: true }),
      },
    ],
  });

  assert.equal(registry.Resolve("missing"), undefined);
  assert.equal(registry.Resolve("echo")?.name, "echo");
  assert.deepEqual(registry.GetToolNames(), ["echo"]);
  assert.deepEqual(registry.ToRealtimeToolDescriptors(), [
    {
      type: "function",
      name: "echo",
      description: "Echo tool",
      parameters: { type: "object" },
    },
  ]);
});

test("buildFunctionCallOutputEvent serializes callback output as JSON string", () =>
{
  const event = buildFunctionCallOutputEvent("call_1", { ok: true });
  assert.equal(event.type, "conversation.item.create");
  assert.deepEqual(event.item, {
    type: "function_call_output",
    call_id: "call_1",
    output: JSON.stringify({ ok: true }),
  });
});

test("buildToolErrorPayload includes code and message", () =>
{
  assert.deepEqual(buildToolErrorPayload("tool_not_found", "missing"), {
    error: "missing",
    code: "tool_not_found",
  });
});

test("ToolDispatcher returns structured errors for missing tools and malformed JSON", async () =>
{
  const outgoing: RealtimeEvent[] = [];
  const lifecycle: string[] = [];

  const registry = new ToolRegistry({
    tools: [
      {
        name: "echo",
        inputSchema: {},
        callback: () => ({ ok: true }),
      },
    ],
  });

  const dispatcher = new ToolDispatcher({
    sessionId: "sess_test",
    registry,
    sendContext: {
      sendOutgoingEvent: (event) =>
      {
        outgoing.push(event);
      },
      enqueueResponseCreate: async () => ({ status: "sent" as const }),
    },
    onToolLifecycle: (notification) =>
    {
      lifecycle.push(`${notification.toolCallId}:${notification.phase}`);
    },
  });

  dispatcher.Enqueue({
    callId: "call_missing",
    name: "missing_tool",
    argumentsJson: "{}",
  });

  dispatcher.Enqueue({
    callId: "call_bad_json",
    name: "echo",
    argumentsJson: "{not-json",
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(outgoing.length, 2);

  const missingOutput = JSON.parse(
    (outgoing[0]?.item as { output?: string }).output ?? "{}",
  ) as { code?: string };
  assert.equal(missingOutput.code, "tool_not_found");

  const badJsonOutput = JSON.parse(
    (outgoing[1]?.item as { output?: string }).output ?? "{}",
  ) as { code?: string };
  assert.equal(badJsonOutput.code, "invalid_arguments");

  assert.ok(lifecycle.includes("call_missing:failed"));
  assert.ok(lifecycle.includes("call_bad_json:failed"));
});

test("ToolDispatcher executes callbacks in FIFO order", async () =>
{
  const order: string[] = [];
  const outgoing: RealtimeEvent[] = [];

  const registry = new ToolRegistry({
    tools: [
      {
        name: "slow_a",
        inputSchema: {},
        callback: async () =>
        {
          order.push("start_a");
          await new Promise((resolve) => setTimeout(resolve, 30));
          order.push("end_a");
          return { tool: "a" };
        },
      },
      {
        name: "slow_b",
        inputSchema: {},
        callback: async () =>
        {
          order.push("start_b");
          order.push("end_b");
          return { tool: "b" };
        },
      },
    ],
  });

  const dispatcher = new ToolDispatcher({
    sessionId: "sess_fifo",
    registry,
    sendContext: {
      sendOutgoingEvent: (event) =>
      {
        outgoing.push(event);
      },
      enqueueResponseCreate: async () => ({ status: "sent" as const }),
    },
  });

  dispatcher.Enqueue({
    callId: "call_a",
    name: "slow_a",
    argumentsJson: "{}",
  });

  dispatcher.Enqueue({
    callId: "call_b",
    name: "slow_b",
    argumentsJson: "{}",
  });

  await new Promise((resolve) => setTimeout(resolve, 80));

  assert.deepEqual(order, ["start_a", "end_a", "start_b", "end_b"]);
  assert.equal(outgoing.length, 2);
});

test("ToolDispatcher emits structured error when callback throws", async () =>
{
  const outgoing: RealtimeEvent[] = [];

  const registry = new ToolRegistry({
    tools: [
      {
        name: "boom",
        inputSchema: {},
        callback: () =>
        {
          throw new Error("callback exploded");
        },
      },
    ],
  });

  const dispatcher = new ToolDispatcher({
    sessionId: "sess_throw",
    registry,
    sendContext: {
      sendOutgoingEvent: (event) =>
      {
        outgoing.push(event);
      },
      enqueueResponseCreate: async () => ({ status: "sent" as const }),
    },
  });

  dispatcher.Enqueue({
    callId: "call_throw",
    name: "boom",
    argumentsJson: "{}",
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  const payload = JSON.parse(
    (outgoing[0]?.item as { output?: string }).output ?? "{}",
  ) as { code?: string; error?: string };

  assert.equal(payload.code, "callback_failed");
  assert.match(payload.error ?? "", /callback exploded/);
});
