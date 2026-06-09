import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  CreatePiToAguiMapper,
  mapPiEventToAgui,
  mapSheafActivityToAgui,
  mapUserMessageToAgui,
} from "../../src/agui/mapper.js";
import { AgentLifecycleState } from "../../src/shared/types.js";
import { ValidateAguiEvent } from "../../src/agui/schemaValidation.js";

const x_packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const x_context = {
  threadId: "pi-thread",
  step: 7,
  sequence: 1,
};

test("mapUserMessageToAgui emits a complete user text triplet", async () =>
{
  const events = mapUserMessageToAgui({
    messageId: "user-1",
    text: "Please inspect src/app.ts",
  });

  assert.deepEqual(
    events.map((event) => event.type),
    ["TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_END"],
  );

  for (const event of events)
  {
    await ValidateAguiEvent(event);
  }
});

test("mapSheafActivityToAgui maps control and activity surfaces", async () =>
{
  const pathEvent = mapSheafActivityToAgui({
    kind: "path_escape_denied",
    inputPath: "/tmp/secret.txt",
    reason: "outside root",
    tool: "read",
  }, x_context);

  assert.equal(pathEvent.type, "CUSTOM");
  assert.equal(pathEvent.name, "sheaf.path_enforcement");
  await ValidateAguiEvent(pathEvent);

  const modelEvent = mapSheafActivityToAgui({
    kind: "model_changed",
    model: { provider: "openai", id: "gpt-test" },
    applyTo: "next_turn",
  }, x_context);
  assert.equal(modelEvent.name, "sheaf.model_changed");
  await ValidateAguiEvent(modelEvent);

  const lifecycleEvent = mapSheafActivityToAgui({
    kind: "lifecycle_status",
    state: AgentLifecycleState.Active,
    previousState: AgentLifecycleState.Starting,
  }, x_context);
  assert.equal(lifecycleEvent.name, "sheaf.lifecycle_status");
  await ValidateAguiEvent(lifecycleEvent);

  const cancelEvent = mapSheafActivityToAgui({ kind: "cancellation" }, x_context);
  assert.equal(cancelEvent.type, "RUN_ERROR");
  assert.equal(cancelEvent.code, "cancelled");
  await ValidateAguiEvent(cancelEvent);
});

test("mapPiEventToAgui maps representative Pi streaming lifecycle", async () =>
{
  const mapper = CreatePiToAguiMapper();
  const fixturePath = path.join(x_packageRoot, "tests/fixtures/pi-sessions/streaming-lifecycle.jsonl");
  const raw = await readFile(fixturePath, "utf8");
  const events = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line, index) => mapper.Consume(JSON.parse(line) as Record<string, unknown>, {
      ...x_context,
      sequence: index + 1,
    }));

  events.push(...mapper.Flush(x_context));

  const messageId = "pi-thread:step:7:pi-message:assistant:123456";

  assert.deepEqual(
    events.map((event) => event.type),
    [
      "RUN_STARTED",
      "STEP_STARTED",
      "TEXT_MESSAGE_START",
      "TEXT_MESSAGE_CONTENT",
      "REASONING_START",
      "REASONING_MESSAGE_START",
      "REASONING_MESSAGE_CONTENT",
      "TOOL_CALL_START",
      "TOOL_CALL_ARGS",
      "TOOL_CALL_RESULT",
      "TOOL_CALL_RESULT",
      "TOOL_CALL_END",
      "REASONING_MESSAGE_END",
      "REASONING_END",
      "TEXT_MESSAGE_END",
      "STEP_FINISHED",
      "RUN_FINISHED",
    ],
  );

  assert.equal(events[2].messageId, messageId);
  assert.equal(events[7].toolCallId, "pi-tool-1");
  assert.equal(events[7].parentMessageId, messageId);
  assert.equal(events[8].delta, "{\"query\":");
  assert.equal(events[9].content, "partial");
  assert.deepEqual(JSON.parse(String(events[10].content)), { result: "done", isError: false });
  assert.equal(mapper.Errors().length, 0);

  for (const event of events)
  {
    await ValidateAguiEvent(event);
  }
});

test("mapPiEventToAgui consumes Pi content lifecycle updates without RAW rows", async () =>
{
  const mapper = CreatePiToAguiMapper();
  const message = {
    role: "assistant",
    content: [],
    timestamp: 42,
  };
  const events = [
    { type: "message_start", message },
    {
      type: "message_update",
      message,
      assistantMessageEvent: { type: "thinking_start", contentIndex: 0 },
    },
    {
      type: "message_update",
      message,
      assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "Plan" },
    },
    {
      type: "message_update",
      message,
      assistantMessageEvent: { type: "thinking_end", contentIndex: 0, content: "Plan" },
    },
    {
      type: "message_update",
      message,
      assistantMessageEvent: { type: "text_start", contentIndex: 1 },
    },
    {
      type: "message_update",
      message,
      assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: "Answer" },
    },
    {
      type: "message_update",
      message,
      assistantMessageEvent: { type: "text_end", contentIndex: 1, content: "Answer" },
    },
    { type: "message_end", message },
  ].flatMap((event, index) => mapper.Consume(event, {
    ...x_context,
    sequence: index + 1,
  }));

  assert.deepEqual(
    events.map((event) => event.type),
    [
      "TEXT_MESSAGE_START",
      "REASONING_START",
      "REASONING_MESSAGE_START",
      "REASONING_MESSAGE_CONTENT",
      "REASONING_MESSAGE_END",
      "REASONING_END",
      "TEXT_MESSAGE_CONTENT",
      "TEXT_MESSAGE_END",
    ],
  );
  assert.equal(events.some((event) => event.type === "RAW"), false);
  assert.equal(events.find((event) => event.type === "REASONING_MESSAGE_CONTENT")?.delta, "Plan");
  assert.equal(events.find((event) => event.type === "TEXT_MESSAGE_CONTENT")?.delta, "Answer");
  assert.equal(mapper.Errors().length, 0);

  for (const event of events)
  {
    await ValidateAguiEvent(event);
  }
});

test("PiToAguiMapper.Flush finishes dangling runs with the original thread id", async () =>
{
  const mapper = CreatePiToAguiMapper();
  const startEvents = mapPiEventToAgui({ type: "agent_start" }, x_context, mapper);
  const runId = String(startEvents[0]?.runId);

  assert.equal(startEvents[0]?.type, "RUN_STARTED");
  assert.equal(startEvents[0]?.threadId, x_context.threadId);
  assert.equal(runId, "pi-thread:step:7:run:1");

  const flushEvents = mapper.Flush(x_context);
  assert.deepEqual(
    flushEvents.map((event) => event.type),
    ["RUN_FINISHED"],
  );
  assert.equal(flushEvents[0]?.threadId, x_context.threadId);
  assert.equal(flushEvents[0]?.runId, runId);

  for (const event of flushEvents)
  {
    await ValidateAguiEvent(event);
  }
});

test("mapPiEventToAgui requires a caller-owned mapper", () =>
{
  assert.throws(
    () => mapPiEventToAgui(
      { type: "agent_start" },
      x_context,
      undefined as unknown as ReturnType<typeof CreatePiToAguiMapper>,
    ),
    /requires a PiToAguiMapper instance/,
  );
});

test("mapPiEventToAgui preserves persisted Pi session header events as CUSTOM", async () =>
{
  const mapper = CreatePiToAguiMapper();
  const fixturePath = path.join(x_packageRoot, "tests/fixtures/pi-sessions/spec-session-head.jsonl");
  const raw = await readFile(fixturePath, "utf8");
  const lines = raw.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);

  const events = lines.flatMap((line, index) => mapPiEventToAgui(JSON.parse(line) as Record<string, unknown>, {
    threadId: "spec-session",
    step: 1,
    sequence: index + 1,
  }, mapper));

  assert.equal(events.filter((event) => event.type === "CUSTOM").length, 4);
  assert.deepEqual(
    events.slice(0, 4).map((event) => event.name),
    [
      "pi.session",
      "pi.model_change",
      "pi.thinking_level_change",
      "pi.session_info",
    ],
  );
  assert.deepEqual(
    events.slice(4).map((event) => event.type),
    ["TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_END"],
  );

  for (const event of events)
  {
    await ValidateAguiEvent(event);
  }
});

test("mapPiEventToAgui emits RAW for unrecognized Pi events", async () =>
{
  const mapper = CreatePiToAguiMapper();
  const events = mapPiEventToAgui({ type: "future_pi_event", payload: { value: 1 } }, x_context, mapper);

  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, "RAW");
  assert.equal(mapper.Errors().length, 1);
  await ValidateAguiEvent(events[0]!);
});
