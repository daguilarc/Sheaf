import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const aguiChatPath = path.resolve(__dirname, "../src/agui-chat.js");

function CreateFakeDom() {
  class FakeElement {
    constructor(tag) {
      this.tagName = tag.toUpperCase();
      this.nodeName = this.tagName;
      this.className = "";
      this.classList = {
        add: (...names) => {
          const existing = this.className ? this.className.split(/\s+/) : [];
          for (const name of names) {
            if (!existing.includes(name)) {
              existing.push(name);
            }
          }
          this.className = existing.join(" ");
        },
        remove: (...names) => {
          const existing = this.className ? this.className.split(/\s+/) : [];
          this.className = existing.filter((name) => !names.includes(name)).join(" ");
        },
        contains: (name) => {
          const existing = this.className ? this.className.split(/\s+/) : [];
          return existing.includes(name);
        },
      };
      this.dataset = {};
      this.style = {};
      this.children = [];
      this.childNodes = this.children;
      this.parentNode = null;
      this._textContent = "";
      this.innerHTML = "";
      this.type = "";
      this.scrollHeight = 0;
      this.scrollTop = 0;
      this.clientHeight = 0;
      this._listeners = {};
    }

    get textContent() {
      if (this.children.length === 0) {
        return this._textContent;
      }
      return this.children.map((child) => child.textContent).join("");
    }

    set textContent(value) {
      this._textContent = value != null ? String(value) : "";
      this.children = [];
      this.innerHTML = "";
    }

    appendChild(child) {
      if (child.parentNode) {
        child.parentNode.removeChild(child);
      }
      child.parentNode = this;
      this.children.push(child);
      if (
        this.className &&
        this.className.includes("agui-chat-transcript")
      ) {
        this.scrollHeight = Math.max(this.scrollHeight, this.children.length * 500);
      }
      return child;
    }

    removeChild(child) {
      const index = this.children.indexOf(child);
      if (index >= 0) {
        this.children.splice(index, 1);
        child.parentNode = null;
      }
      return child;
    }

    addEventListener(type, handler) {
      this._listeners[type] = handler;
    }

    removeEventListener(type) {
      delete this._listeners[type];
    }

    click() {
      if (this._listeners.click) {
        this._listeners.click();
      }
    }

    querySelector(selector) {
      if (selector.startsWith(".")) {
        const className = selector.slice(1);
        const stack = [...this.children];
        while (stack.length) {
          const node = stack.shift();
          if (node.className && node.className.split(/\s+/).includes(className)) {
            return node;
          }
          stack.push(...node.children);
        }
      }
      return null;
    }

    querySelectorAll(selector) {
      const results = [];
      if (selector.startsWith(".")) {
        const className = selector.slice(1);
        const stack = [...this.children];
        while (stack.length) {
          const node = stack.shift();
          if (node.className && node.className.split(/\s+/).includes(className)) {
            results.push(node);
          }
          stack.push(...node.children);
        }
      }
      return results;
    }
  }

  function createElement(tag) {
    return new FakeElement(tag);
  }

  return { createElement, FakeElement };
}

const moduleDom = CreateFakeDom();
const document = { createElement: moduleDom.createElement };

function LoadChatView(options) {
  const opts = options || {};
  const fakeDom = CreateFakeDom();
  const pendingFrames = [];

  const source = fs.readFileSync(aguiChatPath, "utf8");
  const context = {
    console,
    setTimeout,
    clearTimeout,
    document: {
      createElement: fakeDom.createElement,
    },
    requestAnimationFrame(callback) {
      pendingFrames.push(callback);
      return pendingFrames.length;
    },
    cancelAnimationFrame(id) {
      pendingFrames[id - 1] = null;
    },
    flushAnimationFrames() {
      while (pendingFrames.length) {
        const callback = pendingFrames.shift();
        if (callback) {
          callback();
        }
      }
    },
    WebSocket:
      opts.WebSocket ||
      class FakeWebSocket {
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
  context.ChatView._flushFrames = context.flushAnimationFrames;
  context.ChatView._FakeElement = fakeDom.FakeElement;
  return context.ChatView;
}

const ChatView = LoadChatView();
const {
  createChatState,
  reduceAguiEvent,
  applyServerMessage,
  escapeHtml,
  formatMarkdown,
  isAtBottom,
  renderChat,
  x_AutoScrollThreshold,
} = ChatView._test;

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

test("ChatView.create and destroy manage websocket lifecycle and DOM structure", () => {
  const container = document.createElement("div");
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

  const LiveChatView = LoadChatView({ WebSocket: RecordingWebSocket });
  const handle = LiveChatView.create(container, "ws://example.test/stream");

  assert.ok(handle.state);
  assert.ok(handle.root);
  assert.ok(handle.statusBar);
  assert.ok(handle.transcript);
  assert.equal(container.children.length, 1);
  assert.equal(container.children[0], handle.root);
  assert.equal(handle.statusBar.className.includes("agui-chat-status"), true);
  assert.equal(handle.transcript.className.includes("agui-chat-transcript"), true);

  LiveChatView._flushFrames();
  assert.equal(handle.statusBar.textContent.includes("Loading history"), true);

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
  LiveChatView._flushFrames();

  assert.equal(handle.state.messages.get("live")?.content, "ok");
  assert.equal(handle.messageNodes.has("live"), true);

  LiveChatView.destroy(handle);
  assert.equal(closed, true);
  assert.equal(container.textContent, "");
});

test("text streaming reuses the same message DOM node", () => {
  const container = document.createElement("div");
  const LiveChatView = LoadChatView();
  const handle = LiveChatView.create(container, null);
  LiveChatView._flushFrames();

  applyServerMessage(handle.state, {
    type: "events",
    events: [
      { type: "TEXT_MESSAGE_START", messageId: "stream-1", role: "assistant" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "stream-1", delta: "part" },
    ],
  });
  renderChat(handle);

  const firstNode = handle.messageNodes.get("stream-1")?.root;
  assert.ok(firstNode);

  applyServerMessage(handle.state, {
    type: "events",
    events: [
      { type: "TEXT_MESSAGE_CONTENT", messageId: "stream-1", delta: " two" },
    ],
  });
  renderChat(handle);

  const secondNode = handle.messageNodes.get("stream-1")?.root;
  assert.equal(firstNode, secondNode);
  assert.equal(handle.transcript.children.length, 1);
  assert.equal(
    handle.messageNodes.get("stream-1").content.innerHTML.includes("part two"),
    true
  );
});

test("tool and reasoning panels toggle expanded state", () => {
  const container = document.createElement("div");
  const LiveChatView = LoadChatView();
  const handle = LiveChatView.create(container, null);
  LiveChatView._flushFrames();

  applyServerMessage(handle.state, {
    type: "events",
    events: [
      {
        type: "TEXT_MESSAGE_START",
        messageId: "asst",
        role: "assistant",
      },
      { type: "TEXT_MESSAGE_END", messageId: "asst" },
      {
        type: "TOOL_CALL_START",
        toolCallId: "tc-1",
        toolCallName: "grep",
        parentMessageId: "asst",
      },
      {
        type: "TOOL_CALL_RESULT",
        toolCallId: "tc-1",
        messageId: "tool-msg",
        content: "found it",
      },
      { type: "TOOL_CALL_END", toolCallId: "tc-1" },
      { type: "REASONING_MESSAGE_START", messageId: "reason-1" },
      { type: "REASONING_MESSAGE_CONTENT", messageId: "reason-1", delta: "hmm" },
      { type: "REASONING_MESSAGE_END", messageId: "reason-1" },
    ],
  });
  renderChat(handle);

  const toolBubble = handle.messageNodes.get("tool-msg")?.root;
  const reasonBubble = handle.messageNodes.get("reason-1")?.root;
  assert.ok(toolBubble);
  assert.ok(reasonBubble);
  assert.equal(toolBubble.classList.contains("agui-chat-bubble--expanded"), false);
  assert.equal(reasonBubble.classList.contains("agui-chat-bubble--expanded"), false);

  const toolHeader = toolBubble.children[0];
  toolHeader.click();
  assert.equal(toolBubble.classList.contains("agui-chat-bubble--expanded"), true);
  toolHeader.click();
  assert.equal(toolBubble.classList.contains("agui-chat-bubble--expanded"), false);

  const reasonHeader = reasonBubble.children[0];
  reasonHeader.click();
  assert.equal(reasonBubble.classList.contains("agui-chat-bubble--expanded"), true);
});

test("auto-scroll stays at bottom when near bottom and skips when scrolled up", () => {
  const transcript = document.createElement("div");
  transcript.scrollHeight = 1000;
  transcript.clientHeight = 200;

  transcript.scrollTop = 800;
  assert.equal(isAtBottom(transcript, x_AutoScrollThreshold), true);

  transcript.scrollTop = 500;
  assert.equal(isAtBottom(transcript, x_AutoScrollThreshold), false);

  const container = document.createElement("div");
  const LiveChatView = LoadChatView();
  const handle = LiveChatView.create(container, null);
  LiveChatView._flushFrames();

  handle.transcript.scrollHeight = 1000;
  handle.transcript.clientHeight = 200;
  handle.transcript.scrollTop = 800;

  applyServerMessage(handle.state, {
    type: "events",
    events: [
      { type: "TEXT_MESSAGE_START", messageId: "scroll-1", role: "assistant" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "scroll-1", delta: "grow" },
    ],
  });
  renderChat(handle);
  assert.equal(handle.transcript.scrollTop, handle.transcript.scrollHeight);

  handle.transcript.scrollTop = 400;
  handle.transcript.scrollHeight = 2000;
  applyServerMessage(handle.state, {
    type: "events",
    events: [
      { type: "TEXT_MESSAGE_CONTENT", messageId: "scroll-1", delta: " more" },
    ],
  });
  handle.transcript.scrollHeight = 2000;
  renderChat(handle);
  assert.equal(handle.transcript.scrollTop, 400);
});

test("markdown rendering escapes HTML and formats basic syntax", () => {
  assert.equal(escapeHtml("<script>"), "&lt;script&gt;");

  const html = formatMarkdown(
    "**bold** and *italic* with `inline` and:\n\n```\n<code>\n```\n\n<script>alert(1)</script>"
  );
  assert.equal(html.includes("<script>"), false);
  assert.equal(html.includes("&lt;script&gt;"), true);
  assert.equal(html.includes("<strong>bold</strong>"), true);
  assert.equal(html.includes("<em>italic</em>"), true);
  assert.equal(html.includes('class="agui-chat-inline-code"'), true);
  assert.equal(html.includes('class="agui-chat-code-block"'), true);
  assert.equal(html.includes("<code>"), true);
});

test("MESSAGES_SNAPSHOT removes stale DOM nodes", () => {
  const container = document.createElement("div");
  const LiveChatView = LoadChatView();
  const handle = LiveChatView.create(container, null);
  LiveChatView._flushFrames();

  applyServerMessage(handle.state, {
    type: "events",
    events: [
      { type: "TEXT_MESSAGE_START", messageId: "old-msg", role: "user" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "old-msg", delta: "gone" },
      { type: "TEXT_MESSAGE_END", messageId: "old-msg" },
    ],
  });
  renderChat(handle);
  assert.equal(handle.messageNodes.has("old-msg"), true);
  assert.equal(handle.transcript.children.length, 1);

  applyServerMessage(handle.state, {
    type: "events",
    events: [
      {
        type: "MESSAGES_SNAPSHOT",
        messages: [{ id: "new-msg", role: "assistant", content: "fresh" }],
      },
    ],
  });
  renderChat(handle);
  assert.equal(handle.messageNodes.has("old-msg"), false);
  assert.equal(handle.messageNodes.has("new-msg"), true);
  assert.equal(handle.transcript.children.length, 1);
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
