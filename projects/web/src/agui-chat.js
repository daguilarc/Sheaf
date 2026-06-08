/**
 * AG UI event reducer and ChatView API for streaming chat transcripts.
 * Framework-free; attaches window.ChatView / globalThis.ChatView.
 */
(function () {
  "use strict";

  function CreateChatState() {
    return {
      messages: new Map(),
      messageOrder: [],
      openTextMessages: new Set(),
      openToolCalls: new Map(),
      openReasoning: new Set(),
      runs: new Map(),
      activeSteps: new Map(),
      caughtUp: false,
      eventCount: 0,
      status: { kind: "loading", message: null },
    };
  }

  function SynthesizeId(state, eventType) {
    return `${eventType}:${state.eventCount}`;
  }

  function CreateChatMessage(id, role, options) {
    const opts = options || {};
    return {
      id: id,
      role: role,
      content: opts.content != null ? String(opts.content) : "",
      toolCalls: opts.toolCalls ? opts.toolCalls.slice() : [],
      toolCallId: opts.toolCallId != null ? opts.toolCallId : null,
      isStreaming: opts.isStreaming === true,
      timestamp: opts.timestamp != null ? opts.timestamp : null,
      activityType: opts.activityType != null ? opts.activityType : null,
    };
  }

  function AddMessage(state, message) {
    if (!state.messages.has(message.id)) {
      state.messageOrder.push(message.id);
    }
    state.messages.set(message.id, message);
    return message;
  }

  function AppendSystemMessage(state, content, id) {
    const messageId = id || SynthesizeId(state, "system");
    return AddMessage(
      state,
      CreateChatMessage(messageId, "system", { content: content })
    );
  }

  function FindToolCallInfo(state, toolCallId) {
    for (const messageId of state.messageOrder) {
      const message = state.messages.get(messageId);
      if (!message || message.role !== "assistant") {
        continue;
      }
      for (const toolCall of message.toolCalls) {
        if (toolCall.id === toolCallId) {
          return toolCall;
        }
      }
    }
    return null;
  }

  function RecomputeStatus(state) {
    if (state.status.kind === "error") {
      return;
    }
    if (!state.caughtUp) {
      state.status = { kind: "loading", message: null };
      return;
    }
    let hasRunning = false;
    for (const run of state.runs.values()) {
      if (run.status === "running") {
        hasRunning = true;
        break;
      }
    }
    if (hasRunning) {
      state.status = { kind: "live", message: null };
    } else {
      state.status = { kind: "complete", message: null };
    }
  }

  function CloseOpenStreams(state) {
    for (const messageId of Array.from(state.openTextMessages)) {
      const message = state.messages.get(messageId);
      if (message) {
        message.isStreaming = false;
      }
      state.openTextMessages.delete(messageId);
    }

    for (const toolCallId of Array.from(state.openToolCalls.keys())) {
      const openTool = state.openToolCalls.get(toolCallId);
      const toolInfo = FindToolCallInfo(state, toolCallId);
      if (toolInfo) {
        toolInfo.isOpen = false;
      }
      state.openToolCalls.delete(toolCallId);
      if (openTool) {
        openTool.argsBuffer = toolInfo ? toolInfo.args : openTool.argsBuffer;
      }
    }

    for (const messageId of Array.from(state.openReasoning)) {
      const message = state.messages.get(messageId);
      if (message) {
        message.isStreaming = false;
      }
      state.openReasoning.delete(messageId);
    }
  }

  function SnapshotMessageToChatMessage(snapshotMessage) {
    const role = snapshotMessage.role || "activity";
    const message = CreateChatMessage(String(snapshotMessage.id), role, {
      content:
        snapshotMessage.content != null ? String(snapshotMessage.content) : "",
      timestamp: snapshotMessage.timestamp != null ? snapshotMessage.timestamp : null,
      activityType:
        snapshotMessage.activityType != null
          ? snapshotMessage.activityType
          : null,
      toolCallId:
        snapshotMessage.toolCallId != null ? snapshotMessage.toolCallId : null,
    });

    if (Array.isArray(snapshotMessage.toolCalls)) {
      message.toolCalls = snapshotMessage.toolCalls.map(function (toolCall) {
        return {
          id: String(toolCall.id || toolCall.toolCallId || ""),
          name: String(toolCall.name || toolCall.toolCallName || ""),
          args: toolCall.arguments != null ? String(toolCall.arguments) : toolCall.args != null ? String(toolCall.args) : "",
          result: toolCall.result != null ? String(toolCall.result) : null,
          isOpen: false,
        };
      });
    }

    return message;
  }

  function ParseActivityContent(message) {
    if (!message || !message.content) {
      return {};
    }
    try {
      const parsed = JSON.parse(message.content);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch (_error) {
      //
    }
    return { text: message.content };
  }

  function StringifyActivityContent(value) {
    if (typeof value === "string") {
      return value;
    }
    try {
      return JSON.stringify(value);
    } catch (_error) {
      return String(value);
    }
  }

  function DecodeJsonPointerSegment(segment) {
    return segment.replace(/~1/g, "/").replace(/~0/g, "~");
  }

  function ParseJsonPointer(path) {
    if (typeof path !== "string" || path === "" || path === "/") {
      return [];
    }
    if (path.charAt(0) !== "/") {
      return null;
    }
    return path
      .slice(1)
      .split("/")
      .map(DecodeJsonPointerSegment);
  }

  function ResolvePatchParent(root, tokens) {
    if (!tokens || tokens.length === 0) {
      return { parent: null, key: null, valid: false };
    }
    let current = root;
    for (let index = 0; index < tokens.length - 1; index += 1) {
      const token = tokens[index];
      if (current == null || typeof current !== "object") {
        return { parent: null, key: null, valid: false };
      }
      current = current[token];
    }
    const lastToken = tokens[tokens.length - 1];
    if (current == null || typeof current !== "object") {
      return { parent: null, key: null, valid: false };
    }
    return { parent: current, key: lastToken, valid: true };
  }

  function ApplyJsonPatch(document, patch) {
    if (!Array.isArray(patch)) {
      return null;
    }

    let nextDocument;
    try {
      nextDocument = JSON.parse(JSON.stringify(document));
    } catch (_error) {
      return null;
    }

    for (const operation of patch) {
      if (!operation || typeof operation !== "object") {
        return null;
      }

      const op = operation.op;
      const pathTokens = ParseJsonPointer(operation.path);
      if (pathTokens === null) {
        return null;
      }

      if (op === "add" || op === "replace") {
        if (pathTokens.length === 0) {
          if (op === "replace") {
            nextDocument = operation.value;
          } else {
            return null;
          }
          continue;
        }

        const resolved = ResolvePatchParent(nextDocument, pathTokens);
        if (!resolved.valid) {
          return null;
        }

        if (Array.isArray(resolved.parent) && resolved.key === "-") {
          if (op !== "add") {
            return null;
          }
          resolved.parent.push(operation.value);
        } else {
          resolved.parent[resolved.key] = operation.value;
        }
      } else if (op === "remove") {
        if (pathTokens.length === 0) {
          return null;
        }
        const resolved = ResolvePatchParent(nextDocument, pathTokens);
        if (!resolved.valid) {
          return null;
        }
        if (Array.isArray(resolved.parent)) {
          const index = Number(resolved.key);
          if (!Number.isInteger(index) || index < 0 || index >= resolved.parent.length) {
            return null;
          }
          resolved.parent.splice(index, 1);
        } else {
          delete resolved.parent[resolved.key];
        }
      } else {
        return null;
      }
    }

    return nextDocument;
  }

  function CustomDisplayText(event) {
    if (event.name === "provider.text") {
      const value = event.value;
      if (value && typeof value === "object") {
        if (value.text != null) {
          return String(value.text);
        }
      }
      if (event.text != null) {
        return String(event.text);
      }
      return "";
    }
    return String(event.name || "custom");
  }

  function ReduceAguiEvent(state, event) {
    if (!event || typeof event !== "object") {
      return state;
    }

    state.eventCount += 1;
    const eventType = event.type;

    switch (eventType) {
      case "RUN_STARTED": {
        const runId = event.runId ? String(event.runId) : SynthesizeId(state, "RUN_STARTED");
        state.runs.set(runId, {
          runId: runId,
          threadId: event.threadId != null ? String(event.threadId) : runId,
          status: "running",
        });
        RecomputeStatus(state);
        break;
      }

      case "RUN_FINISHED": {
        const runId = event.runId ? String(event.runId) : null;
        if (runId && state.runs.has(runId)) {
          const run = state.runs.get(runId);
          run.status = "finished";
        }
        CloseOpenStreams(state);
        RecomputeStatus(state);
        break;
      }

      case "RUN_ERROR": {
        const runId = event.runId ? String(event.runId) : null;
        if (runId && state.runs.has(runId)) {
          const run = state.runs.get(runId);
          run.status = "error";
        }
        const errorText = event.message != null ? String(event.message) : "Run error";
        AppendSystemMessage(
          state,
          errorText,
          runId ? `error:${runId}` : SynthesizeId(state, "RUN_ERROR")
        );
        state.status = { kind: "error", message: errorText };
        break;
      }

      case "STEP_STARTED": {
        const stepName = event.stepName ? String(event.stepName) : SynthesizeId(state, "STEP_STARTED");
        state.activeSteps.set(stepName, {
          stepName: stepName,
          startTimestamp: event.timestamp != null ? event.timestamp : null,
        });
        break;
      }

      case "STEP_FINISHED": {
        const stepName = event.stepName ? String(event.stepName) : null;
        if (stepName) {
          state.activeSteps.delete(stepName);
        }
        break;
      }

      case "TEXT_MESSAGE_START": {
        const messageId = event.messageId
          ? String(event.messageId)
          : SynthesizeId(state, "TEXT_MESSAGE_START");
        const role = event.role ? String(event.role) : "assistant";
        AddMessage(
          state,
          CreateChatMessage(messageId, role, {
            isStreaming: true,
            timestamp: event.timestamp != null ? event.timestamp : null,
          })
        );
        state.openTextMessages.add(messageId);
        break;
      }

      case "TEXT_MESSAGE_CONTENT": {
        const messageId = event.messageId ? String(event.messageId) : null;
        if (!messageId) {
          break;
        }
        let message = state.messages.get(messageId);
        if (!message) {
          message = AddMessage(
            state,
            CreateChatMessage(messageId, "assistant", { isStreaming: true })
          );
          state.openTextMessages.add(messageId);
        }
        message.content += event.delta != null ? String(event.delta) : "";
        break;
      }

      case "TEXT_MESSAGE_END": {
        const messageId = event.messageId ? String(event.messageId) : null;
        if (!messageId) {
          break;
        }
        const message = state.messages.get(messageId);
        if (message) {
          message.isStreaming = false;
        }
        state.openTextMessages.delete(messageId);
        break;
      }

      case "TOOL_CALL_START": {
        const toolCallId = event.toolCallId
          ? String(event.toolCallId)
          : SynthesizeId(state, "TOOL_CALL_START");
        const toolCallName = event.toolCallName
          ? String(event.toolCallName)
          : "tool";
        const parentMessageId = event.parentMessageId
          ? String(event.parentMessageId)
          : null;

        state.openToolCalls.set(toolCallId, {
          toolCallId: toolCallId,
          toolCallName: toolCallName,
          argsBuffer: "",
          parentMessageId: parentMessageId,
        });

        if (parentMessageId && state.messages.has(parentMessageId)) {
          const parent = state.messages.get(parentMessageId);
          if (parent.role === "assistant") {
            parent.toolCalls.push({
              id: toolCallId,
              name: toolCallName,
              args: "",
              result: null,
              isOpen: true,
            });
          }
        }
        break;
      }

      case "TOOL_CALL_ARGS": {
        const toolCallId = event.toolCallId ? String(event.toolCallId) : null;
        if (!toolCallId) {
          break;
        }
        const delta = event.delta != null ? String(event.delta) : "";
        const openTool = state.openToolCalls.get(toolCallId);
        if (openTool) {
          openTool.argsBuffer += delta;
        }
        const toolInfo = FindToolCallInfo(state, toolCallId);
        if (toolInfo) {
          toolInfo.args += delta;
        }
        break;
      }

      case "TOOL_CALL_END": {
        const toolCallId = event.toolCallId ? String(event.toolCallId) : null;
        if (!toolCallId) {
          break;
        }
        const toolInfo = FindToolCallInfo(state, toolCallId);
        if (toolInfo) {
          toolInfo.isOpen = false;
        }
        state.openToolCalls.delete(toolCallId);
        break;
      }

      case "TOOL_CALL_RESULT": {
        const toolCallId = event.toolCallId ? String(event.toolCallId) : null;
        const messageId = event.messageId
          ? String(event.messageId)
          : toolCallId
            ? `${toolCallId}:result`
            : SynthesizeId(state, "TOOL_CALL_RESULT");
        const content =
          event.content != null
            ? typeof event.content === "string"
              ? event.content
              : JSON.stringify(event.content)
            : "";

        AddMessage(
          state,
          CreateChatMessage(messageId, "tool", {
            content: content,
            toolCallId: toolCallId,
            timestamp: event.timestamp != null ? event.timestamp : null,
          })
        );

        if (toolCallId) {
          const toolInfo = FindToolCallInfo(state, toolCallId);
          if (toolInfo) {
            toolInfo.result = content;
          }
        }
        break;
      }

      case "REASONING_START":
        break;

      case "REASONING_MESSAGE_START": {
        const messageId = event.messageId
          ? String(event.messageId)
          : SynthesizeId(state, "REASONING_MESSAGE_START");
        AddMessage(
          state,
          CreateChatMessage(messageId, "reasoning", {
            isStreaming: true,
            timestamp: event.timestamp != null ? event.timestamp : null,
          })
        );
        state.openReasoning.add(messageId);
        break;
      }

      case "REASONING_MESSAGE_CONTENT": {
        const messageId = event.messageId ? String(event.messageId) : null;
        if (!messageId) {
          break;
        }
        let message = state.messages.get(messageId);
        if (!message) {
          message = AddMessage(
            state,
            CreateChatMessage(messageId, "reasoning", { isStreaming: true })
          );
          state.openReasoning.add(messageId);
        }
        message.content += event.delta != null ? String(event.delta) : "";
        break;
      }

      case "REASONING_MESSAGE_END": {
        const messageId = event.messageId ? String(event.messageId) : null;
        if (!messageId) {
          break;
        }
        const message = state.messages.get(messageId);
        if (message) {
          message.isStreaming = false;
        }
        state.openReasoning.delete(messageId);
        break;
      }

      case "REASONING_END": {
        const messageId = event.messageId ? String(event.messageId) : null;
        if (messageId) {
          const message = state.messages.get(messageId);
          if (message) {
            message.isStreaming = false;
          }
          state.openReasoning.delete(messageId);
        } else {
          for (const openId of Array.from(state.openReasoning)) {
            const message = state.messages.get(openId);
            if (message) {
              message.isStreaming = false;
            }
          }
          state.openReasoning.clear();
        }
        break;
      }

      case "REASONING_ENCRYPTED_VALUE":
        break;

      case "CUSTOM": {
        const messageId = event.messageId
          ? String(event.messageId)
          : SynthesizeId(state, "CUSTOM");
        const displayText = CustomDisplayText(event);
        AddMessage(
          state,
          CreateChatMessage(messageId, "activity", {
            content: displayText,
            activityType: event.name ? String(event.name) : "custom",
            timestamp: event.timestamp != null ? event.timestamp : null,
          })
        );
        break;
      }

      case "RAW": {
        const messageId = event.messageId
          ? String(event.messageId)
          : SynthesizeId(state, "RAW");
        AddMessage(
          state,
          CreateChatMessage(messageId, "activity", {
            content: "unrecognized event",
            activityType: event.source ? String(event.source) : "raw",
            timestamp: event.timestamp != null ? event.timestamp : null,
          })
        );
        break;
      }

      case "ACTIVITY_SNAPSHOT": {
        const messageId = event.messageId
          ? String(event.messageId)
          : SynthesizeId(state, "ACTIVITY_SNAPSHOT");
        const contentValue = event.content != null ? event.content : {};
        AddMessage(
          state,
          CreateChatMessage(messageId, "activity", {
            content: StringifyActivityContent(contentValue),
            activityType: event.activityType
              ? String(event.activityType)
              : "activity",
            timestamp: event.timestamp != null ? event.timestamp : null,
          })
        );
        break;
      }

      case "ACTIVITY_DELTA": {
        const messageId = event.messageId ? String(event.messageId) : null;
        if (!messageId) {
          break;
        }
        const message = state.messages.get(messageId);
        if (!message || message.role !== "activity") {
          break;
        }
        const currentContent = ParseActivityContent(message);
        const patched = ApplyJsonPatch(currentContent, event.patch);
        if (patched !== null) {
          message.content = StringifyActivityContent(patched);
        }
        if (event.activityType) {
          message.activityType = String(event.activityType);
        }
        break;
      }

      case "MESSAGES_SNAPSHOT": {
        state.messages.clear();
        state.messageOrder = [];
        state.openTextMessages.clear();
        state.openToolCalls.clear();
        state.openReasoning.clear();

        const snapshotMessages = Array.isArray(event.messages) ? event.messages : [];
        for (const snapshotMessage of snapshotMessages) {
          if (!snapshotMessage || snapshotMessage.id == null) {
            continue;
          }
          AddMessage(state, SnapshotMessageToChatMessage(snapshotMessage));
        }
        break;
      }

      case "STATE_SNAPSHOT":
      case "STATE_DELTA":
        break;

      default:
        break;
    }

    return state;
  }

  function ApplyServerMessage(state, message) {
    if (!message || typeof message !== "object") {
      return state;
    }

    const messageType = message.type;
    if (messageType === "events") {
      const events = Array.isArray(message.events) ? message.events : [];
      for (const event of events) {
        ReduceAguiEvent(state, event);
      }
      return state;
    }

    if (messageType === "caught_up") {
      state.caughtUp = true;
      RecomputeStatus(state);
      return state;
    }

    if (messageType === "error") {
      const errorText =
        message.message != null ? String(message.message) : "Connection error";
      AppendSystemMessage(state, errorText, SynthesizeId(state, "server_error"));
      state.status = { kind: "error", message: errorText };
      return state;
    }

    return state;
  }

  function RenderMinimal(container, state) {
    if (!container) {
      return;
    }
    const statusText = state.status.message || state.status.kind;
    const eventCount = state.eventCount;
    const messageCount = state.messageOrder.length;
    container.textContent = `status=${statusText} events=${eventCount} messages=${messageCount}`;
  }

  function Create(container, wsUrl) {
    const state = CreateChatState();
    const owned = {
      socket: null,
      reconnectTimer: null,
      listeners: [],
      destroyed: false,
    };

    function CleanupListeners() {
      for (const entry of owned.listeners) {
        entry.target.removeEventListener(entry.type, entry.handler);
      }
      owned.listeners = [];
    }

    function TrackListener(target, type, handler) {
      target.addEventListener(type, handler);
      owned.listeners.push({ target: target, type: type, handler: handler });
    }

    function OnSocketMessage(event) {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch (_error) {
        return;
      }
      ApplyServerMessage(state, payload);
      RenderMinimal(container, state);
    }

    function OnSocketError() {
      const errorText = "WebSocket error";
      ApplyServerMessage(state, { type: "error", message: errorText });
      RenderMinimal(container, state);
    }

    function OnSocketClose() {
      if (!owned.destroyed && state.status.kind !== "error") {
        const errorText = "WebSocket closed";
        ApplyServerMessage(state, { type: "error", message: errorText });
        RenderMinimal(container, state);
      }
    }

    if (typeof WebSocket !== "undefined" && wsUrl) {
      owned.socket = new WebSocket(wsUrl);
      TrackListener(owned.socket, "message", OnSocketMessage);
      TrackListener(owned.socket, "error", OnSocketError);
      TrackListener(owned.socket, "close", OnSocketClose);
    }

    RenderMinimal(container, state);

    return {
      state: state,
      container: container,
      wsUrl: wsUrl,
      _owned: owned,
    };
  }

  function Destroy(handle) {
    if (!handle) {
      return;
    }

    handle._owned = handle._owned || {};
    handle._owned.destroyed = true;

    if (handle._owned.reconnectTimer != null) {
      clearTimeout(handle._owned.reconnectTimer);
      handle._owned.reconnectTimer = null;
    }

    if (handle._owned.listeners) {
      for (const entry of handle._owned.listeners) {
        entry.target.removeEventListener(entry.type, entry.handler);
      }
      handle._owned.listeners = [];
    }

    if (handle._owned.socket) {
      const socket = handle._owned.socket;
      const connecting =
        typeof WebSocket !== "undefined" && WebSocket.CONNECTING != null
          ? WebSocket.CONNECTING
          : 0;
      const open =
        typeof WebSocket !== "undefined" && WebSocket.OPEN != null
          ? WebSocket.OPEN
          : 1;
      if (socket.readyState === connecting || socket.readyState === open) {
        socket.close();
      }
      handle._owned.socket = null;
    }

    if (handle.container) {
      handle.container.textContent = "";
    }
  }

  const ChatView = {
    create: Create,
    destroy: Destroy,
    _test: {
      createChatState: CreateChatState,
      reduceAguiEvent: ReduceAguiEvent,
      applyServerMessage: ApplyServerMessage,
      applyJsonPatch: ApplyJsonPatch,
      parseActivityContent: ParseActivityContent,
    },
  };

  if (typeof globalThis !== "undefined") {
    globalThis.ChatView = ChatView;
  }
  if (typeof window !== "undefined") {
    window.ChatView = ChatView;
  }
})();
