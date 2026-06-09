import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { CreatePiToAguiMapper } from "../../src/agui/mapper.js";
import { mapUserMessageToAgui } from "../../src/agui/mapper.js";
import { eventsToSnapshots } from "../../src/agui/snapshots.js";
import type { AguiSnapshotMessage } from "../../src/agui/types.js";

const x_packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const x_testDirectory = path.dirname(fileURLToPath(import.meta.url));

async function LoadAguiChatTestApi(): Promise<{
  reduceAguiEvent: (state: unknown, event: Record<string, unknown>) => unknown;
  createChatState: () => {
    messages: Map<string, unknown>;
    messageOrder: string[];
  };
}>
{
  const aguiChatPath = path.resolve(x_testDirectory, "../../../../web/src/agui-chat.js");
  const source = await readFile(aguiChatPath, "utf8");
  const sandbox: {
    globalThis: Record<string, unknown>;
    window?: Record<string, unknown>;
  } = {
    globalThis: {},
    window: {},
  };

  vm.runInNewContext(source, sandbox as vm.Context);

  const chatView = sandbox.globalThis.ChatView as {
    _test: {
      reduceAguiEvent: (state: unknown, event: Record<string, unknown>) => unknown;
      createChatState: () => {
        messages: Map<string, unknown>;
        messageOrder: string[];
      };
    };
  };

  return chatView._test;
}

function SnapshotToComparable(message: AguiSnapshotMessage): Record<string, unknown>
{
  return {
    id: message.id,
    role: message.role,
    content: message.content ?? "",
    activityType: message.activityType,
    toolCallId: message.toolCallId,
    toolCalls: message.toolCalls,
  };
}

test("eventsToSnapshots deduplicates by id and preserves sequence order", () =>
{
  const events = [
    ...mapUserMessageToAgui({ messageId: "user-1", text: "hello" }),
    ...mapUserMessageToAgui({ messageId: "user-1", text: "ignored duplicate" }),
    {
      type: "TEXT_MESSAGE_START",
      messageId: "assistant-1",
      role: "assistant",
    },
    {
      type: "TEXT_MESSAGE_CONTENT",
      messageId: "assistant-1",
      delta: "world",
    },
    {
      type: "TEXT_MESSAGE_END",
      messageId: "assistant-1",
    },
  ];

  const snapshots = eventsToSnapshots(events);

  assert.deepEqual(snapshots.map((message) => message.id), ["user-1", "assistant-1"]);
  assert.equal(snapshots[0]?.content, "hello");
  assert.equal(snapshots[1]?.content, "world");
});

test("eventsToSnapshots places derived reasoning before assistant parent", () =>
{
  const assistantId = "assistant-turn";
  const reasoningId = `${assistantId}:thinking`;
  const snapshots = eventsToSnapshots([
    {
      type: "TEXT_MESSAGE_START",
      messageId: assistantId,
      role: "assistant",
    },
    {
      type: "REASONING_MESSAGE_START",
      messageId: reasoningId,
      role: "reasoning",
    },
    {
      type: "REASONING_MESSAGE_CONTENT",
      messageId: reasoningId,
      delta: "Thinking",
    },
    {
      type: "REASONING_MESSAGE_END",
      messageId: reasoningId,
    },
    {
      type: "TEXT_MESSAGE_CONTENT",
      messageId: assistantId,
      delta: "Answer",
    },
    {
      type: "TEXT_MESSAGE_END",
      messageId: assistantId,
    },
  ]);

  assert.deepEqual(snapshots.map((message) => message.id), [reasoningId, assistantId]);
  assert.equal(snapshots[0]?.content, "Thinking");
  assert.equal(snapshots[1]?.content, "Answer");
});

test("eventsToSnapshots places implicit derived reasoning before assistant parent", () =>
{
  const assistantId = "assistant-turn";
  const reasoningId = `${assistantId}:thinking`;
  const snapshots = eventsToSnapshots([
    {
      type: "TEXT_MESSAGE_START",
      messageId: assistantId,
      role: "assistant",
    },
    {
      type: "REASONING_MESSAGE_CONTENT",
      messageId: reasoningId,
      delta: "Thinking without explicit start",
    },
    {
      type: "REASONING_MESSAGE_END",
      messageId: reasoningId,
    },
    {
      type: "TEXT_MESSAGE_CONTENT",
      messageId: assistantId,
      delta: "Answer",
    },
    {
      type: "TEXT_MESSAGE_END",
      messageId: assistantId,
    },
  ]);

  assert.deepEqual(snapshots.map((message) => message.id), [reasoningId, assistantId]);
  assert.equal(snapshots[0]?.content, "Thinking without explicit start");
  assert.equal(snapshots[1]?.content, "Answer");
});

test("eventsToSnapshots materializes non-empty open spans at page boundaries", () =>
{
  const assistantId = "assistant-turn";
  const reasoningId = `${assistantId}:thinking`;
  const snapshots = eventsToSnapshots([
    {
      type: "TEXT_MESSAGE_START",
      messageId: assistantId,
      role: "assistant",
    },
    {
      type: "REASONING_MESSAGE_START",
      messageId: reasoningId,
    },
    {
      type: "REASONING_MESSAGE_CONTENT",
      messageId: reasoningId,
      delta: "Still thinking when this page ends",
    },
    {
      type: "TEXT_MESSAGE_CONTENT",
      messageId: assistantId,
      delta: "Partial answer",
    },
  ]);

  assert.deepEqual(snapshots.map((message) => message.id), [reasoningId, assistantId]);
  assert.equal(snapshots[0]?.role, "reasoning");
  assert.equal(snapshots[0]?.content, "Still thinking when this page ends");
  assert.equal(snapshots[1]?.role, "assistant");
  assert.equal(snapshots[1]?.content, "Partial answer");
});

test("eventsToSnapshots drops empty completed text and reasoning spans", () =>
{
  const snapshots = eventsToSnapshots([
    {
      type: "TEXT_MESSAGE_START",
      messageId: "empty-user",
      role: "user",
    },
    {
      type: "TEXT_MESSAGE_END",
      messageId: "empty-user",
    },
    {
      type: "REASONING_MESSAGE_START",
      messageId: "empty-thinking",
    },
    {
      type: "REASONING_MESSAGE_END",
      messageId: "empty-thinking",
    },
    {
      type: "TEXT_MESSAGE_START",
      messageId: "visible",
      role: "assistant",
    },
    {
      type: "TEXT_MESSAGE_CONTENT",
      messageId: "visible",
      delta: "hello",
    },
    {
      type: "TEXT_MESSAGE_END",
      messageId: "visible",
    },
  ]);

  assert.deepEqual(snapshots.map((message) => message.id), ["visible"]);
});

test("eventsToSnapshots ignores persisted RAW Pi content lifecycle markers", () =>
{
  const snapshots = eventsToSnapshots([
    {
      type: "RAW",
      source: "message_update",
      event: {
        type: "message_update",
        assistantMessageEvent: {
          type: "thinking_start",
          contentIndex: 0,
        },
      },
    },
    {
      type: "RAW",
      source: "future_pi_event",
      event: {
        type: "future_pi_event",
        value: true,
      },
    },
  ]);

  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0]?.role, "activity");
  assert.equal(snapshots[0]?.activityType, "future_pi_event");
});

test("eventsToSnapshots produces shapes accepted by agui-chat.js", async () =>
{
  const mapper = CreatePiToAguiMapper();
  const fixturePath = path.join(x_packageRoot, "tests/fixtures/pi-sessions/streaming-lifecycle.jsonl");
  const raw = await readFile(fixturePath, "utf8");
  const context = { threadId: "pi-thread", step: 7, sequence: 1 };
  const events = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line, index) => mapper.Consume(JSON.parse(line) as Record<string, unknown>, {
      ...context,
      sequence: index + 1,
    }));

  events.push(...mapper.Flush(context));

  const snapshots = eventsToSnapshots(events);
  const aguiChat = await LoadAguiChatTestApi();
  const snapshotState = aguiChat.createChatState();
  const eventState = aguiChat.createChatState();

  for (const snapshot of snapshots)
  {
    assert.ok(snapshot.id);
    assert.ok(snapshot.role);

    snapshotState.messages.set(String(snapshot.id), {
      id: String(snapshot.id),
      role: String(snapshot.role),
      content: snapshot.content != null ? String(snapshot.content) : "",
      toolCalls: Array.isArray(snapshot.toolCalls) ? snapshot.toolCalls : [],
      toolCallId: snapshot.toolCallId,
      activityType: snapshot.activityType,
      isStreaming: false,
      timestamp: snapshot.timestamp ?? null,
    });
    snapshotState.messageOrder.push(String(snapshot.id));
  }

  for (const event of events)
  {
    aguiChat.reduceAguiEvent(eventState, event);
  }

  const comparableSnapshots = snapshotState.messageOrder.map((messageId) =>
    SnapshotToComparable(snapshotState.messages.get(messageId) as AguiSnapshotMessage),
  );
  const comparableEvents = eventState.messageOrder.map((messageId) =>
  {
    const message = eventState.messages.get(messageId) as Record<string, unknown>;
    return {
      id: message.id,
      role: message.role,
      content: message.content ?? "",
      activityType: message.activityType,
      toolCallId: message.toolCallId,
      toolCalls: message.toolCalls,
    };
  });

  const sortKey = (message: { id: unknown; role: unknown }) =>
    `${String(message.id)}:${String(message.role)}`;

  assert.deepEqual(
    comparableSnapshots
      .map((message) => [message.id, message.role, message.content])
      .sort((left, right) => sortKey({ id: left[0], role: left[1] }).localeCompare(sortKey({ id: right[0], role: right[1] }))),
    comparableEvents
      .map((message) => [message.id, message.role, message.content])
      .sort((left, right) => sortKey({ id: left[0], role: left[1] }).localeCompare(sortKey({ id: right[0], role: right[1] }))),
  );
});
