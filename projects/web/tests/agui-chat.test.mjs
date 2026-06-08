import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const aguiChatPath = path.resolve(__dirname, "../src/agui-chat.js");

function LoadChatView(WebSocketClass) {
  const source = fs.readFileSync(aguiChatPath, "utf8");
  const context = {
    console,
    setTimeout,
    clearTimeout,
    WebSocket: WebSocketClass || class FakeWebSocket {
      constructor(url) {
        this.url = url;
        this.readyState = 0;
        this.CONNECTING = 0;
        this.OPEN = 1;
        this.CLOSING = 2;
        this.CLOSED = 3;
      }

      addEventListener() {}

      removeEventListener() {}

      close() {
        this.readyState = 3;
      }
    },
  };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.ChatView;
}

const ChatView = LoadChatView();
const { createChatState, reduceAguiEvent, applyServerMessage } = ChatView._test;

function ReduceAll(state, events) {
  for (const event of events) {
    reduceAguiEvent(state, event);
  }
  return state;
}

function MessageContent(state, messageId) {
  return state.messages.get(messageId)?.content;
}

test("simple text message lifecycle", () => {
  const state = createChatState();
  const messageId = "msg-1";

  ReduceAll(state, [
    { type: "TEXT_MESSAGE_START", messageId, role: "assistant" },
    { type: "TEXT_MESSAGE_CONTENT", messageId, delta: "Hello " },
    { type: "TEXT_MESSAGE_CONTENT", messageId, delta: "world" },
    { type: "TEXT_MESSAGE_END", messageId },
  ]);

  const message = state.messages.get(messageId);
  assert.equal(message.role, "assistant");
  assert.equal(message.content, "Hello world");
  assert.equal(message.isStreaming, false);
  assert.equal(state.openTextMessages.size, 0);
  assert.equal(state.messageOrder.length, 1);
  assert.equal(state.messageOrder[0], messageId);
});

test("tool call lifecycle", () => {
  const state = createChatState();
  const parentId = "assistant-1";
  const toolCallId = "tool-1";

  ReduceAll(state, [
    { type: "TEXT_MESSAGE_START", messageId: parentId, role: "assistant" },
    { type: "TEXT_MESSAGE_END", messageId: parentId },
    {
      type: "TOOL_CALL_START",
      toolCallId,
      toolCallName: "grep",
      parentMessageId: parentId,
    },
    { type: "TOOL_CALL_ARGS", toolCallId, delta: '{"pattern":' },
    { type: "TOOL_CALL_ARGS", toolCallId, delta: '"foo"}' },
    {
      type: "TOOL_CALL_RESULT",
      toolCallId,
      messageId: `${toolCallId}:result`,
      content: "match line",
      role: "tool",
    },
    { type: "TOOL_CALL_END", toolCallId },
  ]);

  const parent = state.messages.get(parentId);
  assert.equal(parent.toolCalls.length, 1);
  assert.equal(parent.toolCalls[0].args, '{"pattern":"foo"}');
  assert.equal(parent.toolCalls[0].result, "match line");
  assert.equal(parent.toolCalls[0].isOpen, false);
  assert.equal(state.openToolCalls.size, 0);

  const toolMessage = state.messages.get(`${toolCallId}:result`);
  assert.equal(toolMessage.role, "tool");
  assert.equal(toolMessage.content, "match line");
  assert.equal(toolMessage.toolCallId, toolCallId);
});

test("reasoning lifecycle", () => {
  const state = createChatState();
  const phaseId = "reason-phase";
  const messageId = "reason-msg";

  ReduceAll(state, [
    { type: "REASONING_START", messageId: phaseId },
    { type: "REASONING_MESSAGE_START", messageId, role: "reasoning" },
    { type: "REASONING_MESSAGE_CONTENT", messageId, delta: "Thinking" },
    { type: "REASONING_MESSAGE_CONTENT", messageId, delta: " hard" },
    { type: "REASONING_MESSAGE_END", messageId },
    { type: "REASONING_END", messageId: phaseId },
  ]);

  const message = state.messages.get(messageId);
  assert.equal(message.role, "reasoning");
  assert.equal(message.content, "Thinking hard");
  assert.equal(message.isStreaming, false);
  assert.equal(state.openReasoning.size, 0);
});

test("run lifecycle and caught_up status", () => {
  const state = createChatState();
  const runId = "run-1";

  ReduceAll(state, [
    { type: "RUN_STARTED", runId, threadId: "thread-1" },
    { type: "TEXT_MESSAGE_START", messageId: "m1", role: "user" },
    { type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: "hi" },
  ]);

  assert.equal(state.runs.get(runId).status, "running");
  assert.equal(state.status.kind, "loading");
  assert.equal(state.openTextMessages.has("m1"), true);

  applyServerMessage(state, { type: "caught_up" });
  assert.equal(state.caughtUp, true);
  assert.equal(state.status.kind, "live");

  ReduceAll(state, [
    { type: "TEXT_MESSAGE_END", messageId: "m1" },
    { type: "RUN_FINISHED", runId, threadId: "thread-1" },
  ]);

  assert.equal(state.runs.get(runId).status, "finished");
  assert.equal(state.openTextMessages.size, 0);
  assert.equal(state.status.kind, "complete");
});

test("RUN_FINISHED closes open text, tool call, and reasoning streams", () => {
  const state = createChatState();
  const runId = "run-cleanup";
  const messageId = "assistant-cleanup";
  const toolCallId = "tool-cleanup";
  const reasoningId = "reasoning-cleanup";

  ReduceAll(state, [
    { type: "RUN_STARTED", runId, threadId: "thread-1" },
    { type: "TEXT_MESSAGE_START", messageId, role: "assistant" },
    { type: "TEXT_MESSAGE_CONTENT", messageId, delta: "partial answer" },
    {
      type: "TOOL_CALL_START",
      toolCallId,
      toolCallName: "lookup",
      parentMessageId: messageId,
    },
    { type: "TOOL_CALL_ARGS", toolCallId, delta: '{"query":"status"}' },
    { type: "REASONING_MESSAGE_START", messageId: reasoningId },
    { type: "REASONING_MESSAGE_CONTENT", messageId: reasoningId, delta: "checking" },
  ]);

  applyServerMessage(state, { type: "caught_up" });
  assert.equal(state.status.kind, "live");
  assert.equal(state.openTextMessages.has(messageId), true);
  assert.equal(state.openToolCalls.has(toolCallId), true);
  assert.equal(state.openReasoning.has(reasoningId), true);

  reduceAguiEvent(state, { type: "RUN_FINISHED", runId, threadId: "thread-1" });

  const message = state.messages.get(messageId);
  assert.equal(message.isStreaming, false);
  assert.equal(message.toolCalls.length, 1);
  assert.equal(message.toolCalls[0].args, '{"query":"status"}');
  assert.equal(message.toolCalls[0].isOpen, false);

  const reasoning = state.messages.get(reasoningId);
  assert.equal(reasoning.isStreaming, false);
  assert.equal(state.runs.get(runId).status, "finished");
  assert.equal(state.openTextMessages.size, 0);
  assert.equal(state.openToolCalls.size, 0);
  assert.equal(state.openReasoning.size, 0);
  assert.equal(state.status.kind, "complete");
});

test("RUN_ERROR creates system message and error status", () => {
  const state = createChatState();
  ReduceAll(state, [
    { type: "RUN_STARTED", runId: "run-err", threadId: "thread-1" },
    { type: "RUN_ERROR", runId: "run-err", message: "Harness failed" },
  ]);

  assert.equal(state.runs.get("run-err").status, "error");
  assert.equal(state.status.kind, "error");
  assert.equal(state.status.message, "Harness failed");

  const systemMessage = state.messages.get("error:run-err");
  assert.equal(systemMessage.role, "system");
  assert.equal(systemMessage.content, "Harness failed");
});

test("CUSTOM provider text, generic CUSTOM, and RAW", () => {
  const state = createChatState();

  ReduceAll(state, [
    {
      type: "CUSTOM",
      name: "provider.text",
      value: { text: "provider says hi" },
    },
    {
      type: "CUSTOM",
      name: "claude.system",
      value: { type: "system" },
    },
    {
      type: "RAW",
      source: "cursor",
      event: { event_kind: "unknown" },
    },
  ]);

  const providerMessage = state.messageOrder
    .map((id) => state.messages.get(id))
    .find((message) => message.activityType === "provider.text");
  assert.equal(providerMessage.content, "provider says hi");

  const genericCustom = state.messageOrder
    .map((id) => state.messages.get(id))
    .find((message) => message.activityType === "claude.system");
  assert.equal(genericCustom.content, "claude.system");

  const rawMessage = state.messageOrder
    .map((id) => state.messages.get(id))
    .find((message) => message.activityType === "cursor");
  assert.equal(rawMessage.content, "unrecognized event");
});

test("ACTIVITY_SNAPSHOT replacement and ACTIVITY_DELTA patching", () => {
  const state = createChatState();
  const messageId = "activity-1";

  ReduceAll(state, [
    {
      type: "ACTIVITY_SNAPSHOT",
      messageId,
      activityType: "codex.file_change",
      content: { path: "a.txt", status: "pending" },
    },
  ]);

  assert.equal(
    JSON.parse(state.messages.get(messageId).content).path,
    "a.txt"
  );

  ReduceAll(state, [
    {
      type: "ACTIVITY_DELTA",
      messageId,
      activityType: "codex.file_change",
      patch: [{ op: "replace", path: "/status", value: "done" }],
    },
  ]);

  assert.equal(
    JSON.parse(state.messages.get(messageId).content).status,
    "done"
  );

  ReduceAll(state, [
    {
      type: "ACTIVITY_SNAPSHOT",
      messageId,
      activityType: "codex.file_change",
      content: { path: "b.txt" },
      replace: true,
    },
  ]);

  assert.equal(
    JSON.parse(state.messages.get(messageId).content).path,
    "b.txt"
  );

  const beforeInvalidPatch = state.messages.get(messageId).content;
  ReduceAll(state, [
    {
      type: "ACTIVITY_DELTA",
      messageId,
      activityType: "codex.file_change",
      patch: [{ op: "move", path: "/status", from: "/missing" }],
    },
  ]);
  assert.equal(state.messages.get(messageId).content, beforeInvalidPatch);
});

test("MESSAGES_SNAPSHOT resets prior messages", () => {
  const state = createChatState();

  ReduceAll(state, [
    { type: "TEXT_MESSAGE_START", messageId: "old", role: "user" },
    { type: "TEXT_MESSAGE_CONTENT", messageId: "old", delta: "gone" },
    { type: "TEXT_MESSAGE_END", messageId: "old" },
    {
      type: "MESSAGES_SNAPSHOT",
      messages: [
        { id: "new-1", role: "assistant", content: "fresh start" },
        { id: "new-2", role: "user", content: "hello" },
      ],
    },
  ]);

  assert.equal(state.messages.has("old"), false);
  assert.equal(state.messageOrder.length, 2);
  assert.equal(state.messageOrder[0], "new-1");
  assert.equal(state.messageOrder[1], "new-2");
  assert.equal(MessageContent(state, "new-1"), "fresh start");
  assert.equal(state.openTextMessages.size, 0);
  assert.equal(state.openToolCalls.size, 0);
  assert.equal(state.openReasoning.size, 0);
});

test("no-op and unknown events do not alter visible transcript unexpectedly", () => {
  const state = createChatState();

  ReduceAll(state, [
    { type: "TEXT_MESSAGE_START", messageId: "keep", role: "assistant" },
    { type: "TEXT_MESSAGE_CONTENT", messageId: "keep", delta: "stable" },
    { type: "TEXT_MESSAGE_END", messageId: "keep" },
  ]);

  const before = {
    messageOrder: state.messageOrder.slice(),
    content: MessageContent(state, "keep"),
    eventCount: state.eventCount,
  };

  ReduceAll(state, [
    { type: "STATE_SNAPSHOT", snapshot: { internal: true } },
    { type: "STATE_DELTA", delta: [{ op: "add", path: "/x", value: 1 }] },
    {
      type: "REASONING_ENCRYPTED_VALUE",
      entityId: "keep",
      encryptedValue: "secret",
    },
    { type: "TOTALLY_UNKNOWN" },
  ]);

  assert.deepEqual(state.messageOrder, before.messageOrder);
  assert.equal(MessageContent(state, "keep"), before.content);
  assert.equal(state.eventCount, before.eventCount + 4);
});

test("applyServerMessage handles events, caught_up, error, and unknown types", () => {
  const state = createChatState();

  applyServerMessage(state, {
    type: "events",
    events: [
      { type: "TEXT_MESSAGE_START", messageId: "srv-1", role: "user" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "srv-1", delta: "from server" },
      { type: "TEXT_MESSAGE_END", messageId: "srv-1" },
    ],
  });
  assert.equal(MessageContent(state, "srv-1"), "from server");
  assert.equal(state.eventCount, 3);

  applyServerMessage(state, { type: "caught_up" });
  assert.equal(state.caughtUp, true);
  assert.equal(state.status.kind, "complete");

  applyServerMessage(state, { type: "error", message: "stream failed" });
  assert.equal(state.status.kind, "error");
  assert.equal(
    [...state.messages.values()].some(
      (message) => message.role === "system" && message.content === "stream failed"
    ),
    true
  );

  const countBeforeUnknown = state.eventCount;
  applyServerMessage(state, { type: "ping" });
  assert.equal(state.eventCount, countBeforeUnknown);
});

test("golden reducer replay from representative converted JSONL sequence", () => {
  const goldenEvents = [
    {
      type: "RUN_STARTED",
      threadId: "provider-1",
      runId: "test-thread:step:1",
      timestamp: 1735689600000,
    },
    {
      type: "TEXT_MESSAGE_START",
      messageId: "test-thread:step:1:seq:2:prompt",
      role: "user",
      timestamp: 1735689600000,
    },
    {
      type: "TEXT_MESSAGE_CONTENT",
      messageId: "test-thread:step:1:seq:2:prompt",
      delta: "hello",
      timestamp: 1735689600000,
    },
    {
      type: "TEXT_MESSAGE_END",
      messageId: "test-thread:step:1:seq:2:prompt",
      timestamp: 1735689600000,
    },
    {
      type: "RUN_FINISHED",
      threadId: "provider-1",
      runId: "test-thread:step:1",
      timestamp: 1735689601000,
    },
  ];

  const state = createChatState();
  applyServerMessage(state, { type: "events", events: goldenEvents });
  applyServerMessage(state, { type: "caught_up" });

  assert.equal(state.eventCount, goldenEvents.length);
  assert.equal(state.caughtUp, true);
  assert.equal(state.status.kind, "complete");
  assert.equal(state.runs.get("test-thread:step:1").status, "finished");
  assert.equal(state.messageOrder.length, 1);
  assert.equal(
    state.messageOrder[0],
    "test-thread:step:1:seq:2:prompt"
  );
  assert.equal(
    MessageContent(state, "test-thread:step:1:seq:2:prompt"),
    "hello"
  );
});

test("ChatView.create and destroy manage websocket lifecycle", () => {
  const container = { textContent: "" };
  let closed = false;

  class RecordingWebSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 1;
      this.OPEN = 1;
      this.CONNECTING = 0;
      this.CLOSING = 2;
      this.CLOSED = 3;
      this.listeners = {};
    }

    addEventListener(type, handler) {
      this.listeners[type] = handler;
    }

    removeEventListener(type) {
      delete this.listeners[type];
    }

    close() {
      closed = true;
      this.readyState = 3;
    }
  }

  const LiveChatView = LoadChatView(RecordingWebSocket);
  const handle = LiveChatView.create(container, "ws://example.test/stream");
  assert.ok(handle.state);
  assert.equal(container.textContent.includes("status=loading"), true);

  handle._owned.socket.listeners.message({
    data: JSON.stringify({
      type: "events",
      events: [
        { type: "TEXT_MESSAGE_START", messageId: "live", role: "assistant" },
        { type: "TEXT_MESSAGE_CONTENT", messageId: "live", delta: "ok" },
        { type: "TEXT_MESSAGE_END", messageId: "live" },
      ],
    }),
  });
  assert.equal(handle.state.messages.get("live")?.content, "ok");

  LiveChatView.destroy(handle);
  assert.equal(closed, true);
  assert.equal(container.textContent, "");
});

test("STEP_STARTED and STEP_FINISHED track active steps", () => {
  const state = createChatState();
  ReduceAll(state, [
    { type: "STEP_STARTED", stepName: "codex.turn", timestamp: 100 },
    { type: "STEP_STARTED", stepName: "cursor.tool", timestamp: 200 },
    { type: "STEP_FINISHED", stepName: "codex.turn" },
  ]);

  assert.equal(state.activeSteps.size, 1);
  assert.ok(state.activeSteps.has("cursor.tool"));
  assert.equal(state.activeSteps.get("cursor.tool").startTimestamp, 200);
});
