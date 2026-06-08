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

  const x_AutoScrollThreshold = 50;

  function EscapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function FormatMarkdown(text) {
    const placeholders = [];
    let working = EscapeHtml(text);

    working = working.replace(/```([\s\S]*?)```/g, function (_match, code) {
      const index = placeholders.length;
      placeholders.push(
        '<pre class="agui-chat-code-block"><code>' +
          code.replace(/^\n|\n$/g, "") +
          "</code></pre>"
      );
      return "\x00PH" + index + "\x00";
    });

    working = working.replace(/`([^`\n]+)`/g, function (_match, code) {
      const index = placeholders.length;
      placeholders.push('<code class="agui-chat-inline-code">' + code + "</code>");
      return "\x00PH" + index + "\x00";
    });

    working = working.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    working = working.replace(/__([^_]+)__/g, "<strong>$1</strong>");
    working = working.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
    working = working.replace(/_([^_\n]+)_/g, "<em>$1</em>");

    const paragraphs = working.split(/\n\n+/);
    let html = paragraphs
      .map(function (paragraph) {
        if (paragraph === "") {
          return "";
        }
        return "<p>" + paragraph.replace(/\n/g, "<br>") + "</p>";
      })
      .join("");

    for (let index = 0; index < placeholders.length; index += 1) {
      html = html.split("\x00PH" + index + "\x00").join(placeholders[index]);
    }

    return html;
  }

  function IsAtBottom(element, threshold) {
    if (!element) {
      return true;
    }
    const limit = threshold != null ? threshold : x_AutoScrollThreshold;
    const distance =
      element.scrollHeight - element.scrollTop - element.clientHeight;
    return distance <= limit;
  }

  function ScrollToBottom(element) {
    if (!element) {
      return;
    }
    element.scrollTop = element.scrollHeight;
  }

  function CreateElement(tag, className) {
    const element = document.createElement(tag);
    if (className) {
      element.className = className;
    }
    return element;
  }

  function ActivityLabel(message) {
    if (message.role === "system") {
      return "System";
    }
    if (message.activityType) {
      return message.activityType;
    }
    return "Activity";
  }

  function ActivityContentText(message) {
    if (!message.content) {
      return "";
    }
    if (message.role === "system") {
      return message.content;
    }
    try {
      const parsed = JSON.parse(message.content);
      if (parsed && typeof parsed === "object") {
        if (parsed.text != null) {
          return String(parsed.text);
        }
        if (parsed.path != null) {
          return String(parsed.path);
        }
        return JSON.stringify(parsed);
      }
    } catch (_error) {
      //
    }
    return message.content;
  }

  function ToolDisplayName(state, message) {
    if (message.toolCallId) {
      const toolInfo = FindToolCallInfo(state, message.toolCallId);
      if (toolInfo && toolInfo.name) {
        return toolInfo.name;
      }
      const openTool = state.openToolCalls.get(message.toolCallId);
      if (openTool && openTool.toolCallName) {
        return openTool.toolCallName;
      }
    }
    return "Tool";
  }

  function ToolBodyText(state, message) {
    const sections = [];
    if (message.toolCallId) {
      const toolInfo = FindToolCallInfo(state, message.toolCallId);
      if (toolInfo) {
        if (toolInfo.args) {
          sections.push("Args:\n" + toolInfo.args);
        }
        if (toolInfo.result != null) {
          sections.push("Result:\n" + toolInfo.result);
        }
      }
    }
    if (sections.length === 0 && message.content) {
      sections.push("Result:\n" + message.content);
    }
    return sections.join("\n\n");
  }

  function ToolShowsSpinner(state, message) {
    if (!message.toolCallId) {
      return false;
    }
    const toolInfo = FindToolCallInfo(state, message.toolCallId);
    if (toolInfo && toolInfo.isOpen) {
      return true;
    }
    return state.openToolCalls.has(message.toolCallId);
  }

  function TogglePanelExpanded(handle, messageId, bubble) {
    const expanded = handle.panelExpanded.get(messageId) === true;
    handle.panelExpanded.set(messageId, !expanded);
    if (expanded) {
      bubble.classList.remove("agui-chat-bubble--expanded");
    } else {
      bubble.classList.add("agui-chat-bubble--expanded");
    }
  }

  function CreateCollapsiblePanel(handle, message, state, options) {
    const opts = options || {};
    const bubble = CreateElement("div", "agui-chat-bubble " + opts.bubbleClass);
    bubble.dataset.messageId = message.id;

    const header = CreateElement("button", "agui-chat-tool-header");
    header.type = "button";

    const chevron = CreateElement("span", "agui-chat-chevron");
    header.appendChild(chevron);

    const title = CreateElement("span", "agui-chat-tool-name");
    title.textContent = opts.title || "";
    header.appendChild(title);

    let spinner = null;
    if (opts.showSpinner) {
      spinner = CreateElement("span", "agui-chat-spinner");
      header.appendChild(spinner);
    }

    const body = CreateElement("div", "agui-chat-tool-body");
    body.textContent = opts.bodyText || "";

    header.addEventListener("click", function () {
      TogglePanelExpanded(handle, message.id, bubble);
    });

    bubble.appendChild(header);
    bubble.appendChild(body);

    return {
      root: bubble,
      header: header,
      title: title,
      body: body,
      spinner: spinner,
    };
  }

  function CreateMessageNode(handle, message, state) {
    if (
      message.role === "activity" ||
      message.role === "system"
    ) {
      const row = CreateElement("div", "agui-chat-activity");
      row.dataset.messageId = message.id;

      const label = CreateElement("span", "agui-chat-activity-label");
      label.textContent = ActivityLabel(message);
      row.appendChild(label);

      const content = CreateElement("span", "agui-chat-activity-content");
      content.textContent = ActivityContentText(message);
      row.appendChild(content);

      return { root: row, content: content };
    }

    if (message.role === "user") {
      const bubble = CreateElement("div", "agui-chat-bubble agui-chat-bubble--user");
      bubble.dataset.messageId = message.id;

      const role = CreateElement("span", "agui-chat-role");
      role.textContent = "User";
      bubble.appendChild(role);

      const content = CreateElement("div", "agui-chat-content");
      content.textContent = message.content;
      bubble.appendChild(content);

      return { root: bubble, content: content };
    }

    if (message.role === "assistant") {
      const bubble = CreateElement(
        "div",
        "agui-chat-bubble agui-chat-bubble--assistant"
      );
      bubble.dataset.messageId = message.id;

      const content = CreateElement("div", "agui-chat-content");
      bubble.appendChild(content);

      return { root: bubble, content: content, role: "assistant" };
    }

    if (message.role === "tool") {
      const panel = CreateCollapsiblePanel(handle, message, state, {
        bubbleClass: "agui-chat-bubble--tool",
        title: ToolDisplayName(state, message),
        bodyText: ToolBodyText(state, message),
        showSpinner: ToolShowsSpinner(state, message),
      });
      return {
        root: panel.root,
        content: panel.body,
        header: panel.header,
        title: panel.title,
        spinner: panel.spinner,
        role: "tool",
      };
    }

    if (message.role === "reasoning") {
      const panel = CreateCollapsiblePanel(handle, message, state, {
        bubbleClass: "agui-chat-bubble--reasoning",
        title: "Thinking",
        bodyText: message.content,
        showSpinner: message.isStreaming,
      });
      return {
        root: panel.root,
        content: panel.body,
        header: panel.header,
        title: panel.title,
        spinner: panel.spinner,
        role: "reasoning",
      };
    }

    const fallback = CreateElement("div", "agui-chat-activity");
    fallback.dataset.messageId = message.id;
    fallback.textContent = message.content;
    return { root: fallback, content: fallback };
  }

  function UpdateAssistantContent(contentNode, message) {
    let html = FormatMarkdown(message.content);
    if (message.isStreaming) {
      html += '<span class="agui-chat-streaming"></span>';
    }
    contentNode.innerHTML = html;
  }

  function UpdateMessageNode(handle, nodeEntry, message, state) {
    if (message.role === "assistant") {
      UpdateAssistantContent(nodeEntry.content, message);
      nodeEntry.renderedStreaming = message.isStreaming === true;
      return;
    }

    if (message.role === "user") {
      nodeEntry.content.textContent = message.content;
      return;
    }

    if (message.role === "activity" || message.role === "system") {
      nodeEntry.content.textContent = ActivityContentText(message);
      return;
    }

    if (message.role === "tool") {
      if (nodeEntry.title) {
        nodeEntry.title.textContent = ToolDisplayName(state, message);
      }
      nodeEntry.content.textContent = ToolBodyText(state, message);
      if (nodeEntry.spinner) {
        if (ToolShowsSpinner(state, message)) {
          nodeEntry.spinner.style.display = "";
        } else {
          nodeEntry.spinner.style.display = "none";
        }
      }
      return;
    }

    if (message.role === "reasoning") {
      nodeEntry.content.textContent = message.content;
      if (nodeEntry.spinner) {
        if (message.isStreaming) {
          nodeEntry.spinner.style.display = "";
        } else {
          nodeEntry.spinner.style.display = "none";
        }
      }
      nodeEntry.renderedStreaming = message.isStreaming === true;
    }
  }

  function PrependSnapshotMessages(state, snapshotMessages) {
    const newIds = [];
    const messages = Array.isArray(snapshotMessages) ? snapshotMessages : [];

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const snapshotMessage = messages[index];
      if (!snapshotMessage || snapshotMessage.id == null) {
        continue;
      }

      const messageId = String(snapshotMessage.id);
      if (state.messages.has(messageId)) {
        continue;
      }

      const message = SnapshotMessageToChatMessage(snapshotMessage);
      state.messages.set(messageId, message);
      newIds.unshift(messageId);
    }

    if (newIds.length > 0) {
      state.messageOrder = newIds.concat(state.messageOrder);
    }

    return newIds.length;
  }

  function NormalizeCreateOptions(wsUrlOrOptions) {
    if (typeof wsUrlOrOptions === "string") {
      return { wsUrl: wsUrlOrOptions };
    }

    if (wsUrlOrOptions && typeof wsUrlOrOptions === "object") {
      return wsUrlOrOptions;
    }

    return {};
  }

  function RenderStatusBar(statusBar, state, connectionState) {
    statusBar.textContent = "";

    const main = CreateElement("div", "agui-chat-status-main");
    const dot = CreateElement("span", "agui-chat-status-dot");
    const label = CreateElement("span", "agui-chat-status-label");

    if (connectionState && connectionState.connected === false) {
      dot.classList.add("agui-chat-status-dot--warning");
      label.classList.add("agui-chat-status-label--warning");
      label.textContent = connectionState.label || "Disconnected";
      main.appendChild(dot);
      main.appendChild(label);

      if (connectionState.queuedCount > 0) {
        const queued = CreateElement("span", "agui-chat-status-count");
        queued.textContent = connectionState.queuedCount + " queued";
        main.appendChild(queued);
      }
    } else if (state.status.kind === "loading") {
      label.textContent = "Loading history...";
      const count = CreateElement("span", "agui-chat-status-count");
      count.textContent = state.eventCount + " events";
      main.appendChild(dot);
      main.appendChild(label);
      main.appendChild(count);
    } else if (state.status.kind === "live") {
      dot.classList.add("agui-chat-status-dot--live");
      label.textContent = "Live";
      main.appendChild(dot);
      main.appendChild(label);
    } else if (state.status.kind === "complete") {
      label.textContent = "Complete";
      main.appendChild(dot);
      main.appendChild(label);
    } else if (state.status.kind === "error") {
      dot.classList.add("agui-chat-status-dot--warning");
      label.classList.add("agui-chat-status-label--warning");
      label.textContent = state.status.message || "Connection error";
      main.appendChild(dot);
      main.appendChild(label);
    } else {
      label.textContent = state.status.kind;
      main.appendChild(dot);
      main.appendChild(label);
    }

    statusBar.appendChild(main);

    if (state.activeSteps.size > 0) {
      const steps = CreateElement("div", "agui-chat-status-steps");
      for (const step of state.activeSteps.values()) {
        const chip = CreateElement("span", "agui-chat-step-chip");
        chip.textContent = step.stepName;
        steps.appendChild(chip);
      }
      statusBar.appendChild(steps);
    }
  }

  function RenderTranscript(handle) {
    const state = handle.state;
    const transcript = handle.transcript;
    if (!transcript) {
      return;
    }

    const wasAtBottom = IsAtBottom(transcript, x_AutoScrollThreshold);
    const liveIds = new Set(state.messageOrder);

    for (const messageId of state.messageOrder) {
      const message = state.messages.get(messageId);
      if (!message) {
        continue;
      }

      let nodeEntry = handle.messageNodes.get(messageId);
      if (!nodeEntry) {
        nodeEntry = CreateMessageNode(handle, message, state);
        handle.messageNodes.set(messageId, nodeEntry);
        transcript.appendChild(nodeEntry.root);
        UpdateMessageNode(handle, nodeEntry, message, state);
      } else if (
        message.isStreaming ||
        nodeEntry.renderedStreaming === true ||
        state.openTextMessages.has(messageId) ||
        state.openReasoning.has(messageId) ||
        message.role === "tool"
      ) {
        UpdateMessageNode(handle, nodeEntry, message, state);
      }
    }

    for (const messageId of Array.from(handle.messageNodes.keys())) {
      if (!liveIds.has(messageId)) {
        const nodeEntry = handle.messageNodes.get(messageId);
        if (nodeEntry && nodeEntry.root.parentNode === transcript) {
          transcript.removeChild(nodeEntry.root);
        }
        handle.messageNodes.delete(messageId);
        handle.panelExpanded.delete(messageId);
      }
    }

    if (wasAtBottom) {
      ScrollToBottom(transcript);
    }
  }

  function RenderChat(handle) {
    if (!handle || handle._owned.destroyed) {
      return;
    }
    if (handle.statusBar) {
      RenderStatusBar(handle.statusBar, handle.state, handle.connectionState);
    }
    RenderTranscript(handle);
  }

  function AppendAguiEvent(handle, event) {
    if (!handle || handle._owned.destroyed) {
      return;
    }

    ReduceAguiEvent(handle.state, event);
    ScheduleRender(handle);
  }

  function PrependHistory(handle, snapshotMessages) {
    if (!handle || handle._owned.destroyed) {
      return 0;
    }

    const transcript = handle.transcript;
    const previousScrollHeight = transcript ? transcript.scrollHeight : 0;
    const previousScrollTop = transcript ? transcript.scrollTop : 0;
    const added = PrependSnapshotMessages(handle.state, snapshotMessages);

    if (added > 0) {
      RenderChat(handle);

      if (transcript) {
        const delta = transcript.scrollHeight - previousScrollHeight;
        transcript.scrollTop = previousScrollTop + delta;
      }
    }

    return added;
  }

  function SetCaughtUp(handle, caughtUp) {
    if (!handle || handle._owned.destroyed) {
      return;
    }

    handle.state.caughtUp = caughtUp === true;
    RecomputeStatus(handle.state);
    ScheduleRender(handle);
  }

  function SetConnectionState(handle, connectionState) {
    if (!handle || handle._owned.destroyed) {
      return;
    }

    handle.connectionState = connectionState || null;
    ScheduleRender(handle);
  }

  function GetUiState(handle) {
    if (!handle) {
      return {
        connected: false,
        queuedCount: 0,
        caughtUp: false,
        messageCount: 0,
      };
    }

    return {
      connected:
        handle.connectionState == null
          ? true
          : handle.connectionState.connected === true,
      queuedCount:
        handle.connectionState && handle.connectionState.queuedCount != null
          ? handle.connectionState.queuedCount
          : 0,
      caughtUp: handle.state.caughtUp === true,
      messageCount: handle.state.messageOrder.length,
    };
  }

  function ScheduleRender(handle) {
    if (!handle || handle._owned.destroyed) {
      return;
    }
    if (handle.pendingFrame != null) {
      return;
    }
    const schedule =
      typeof requestAnimationFrame !== "undefined"
        ? requestAnimationFrame
        : function (callback) {
            return setTimeout(callback, 0);
          };
    handle.pendingFrame = schedule(function () {
      handle.pendingFrame = null;
      RenderChat(handle);
    });
  }

  function Create(container, wsUrlOrOptions) {
    const options = NormalizeCreateOptions(wsUrlOrOptions);
    const wsUrl = options.wsUrl;
    const state = CreateChatState();
    const owned = {
      socket: null,
      reconnectTimer: null,
      listeners: [],
      destroyed: false,
      scrollNearTopPending: false,
    };

    if (container) {
      container.textContent = "";
    }

    const root = CreateElement("div", "agui-chat-root");
    const statusBar = CreateElement("div", "agui-chat-status");
    const transcript = CreateElement("div", "agui-chat-transcript");

    root.appendChild(statusBar);
    root.appendChild(transcript);
    if (container) {
      container.appendChild(root);
    }

    const handle = {
      state: state,
      container: container,
      wsUrl: wsUrl,
      root: root,
      statusBar: statusBar,
      transcript: transcript,
      messageNodes: new Map(),
      panelExpanded: new Map(),
      pendingFrame: null,
      connectionState: null,
      _owned: owned,
    };

    function TrackListener(target, type, handler) {
      target.addEventListener(type, handler);
      owned.listeners.push({ target: target, type: type, handler: handler });
    }

    function OnSocketMessage(event) {
      if (owned.destroyed) {
        return;
      }
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch (_error) {
        return;
      }
      ApplyServerMessage(state, payload);
      ScheduleRender(handle);
    }

    function OnSocketError() {
      if (owned.destroyed) {
        return;
      }
      const errorText = "WebSocket error";
      ApplyServerMessage(state, { type: "error", message: errorText });
      ScheduleRender(handle);
    }

    function OnSocketClose() {
      if (owned.destroyed || state.status.kind === "error") {
        return;
      }
      const errorText = "WebSocket closed";
      ApplyServerMessage(state, { type: "error", message: errorText });
      ScheduleRender(handle);
    }

    if (typeof options.onScrollNearTop === "function") {
      TrackListener(transcript, "scroll", function () {
        if (owned.destroyed || owned.scrollNearTopPending) {
          return;
        }

        if (transcript.scrollTop > 80) {
          return;
        }

        owned.scrollNearTopPending = true;
        options.onScrollNearTop();
        setTimeout(function () {
          owned.scrollNearTopPending = false;
        }, 500);
      });
    }

    if (typeof WebSocket !== "undefined" && wsUrl) {
      owned.socket = new WebSocket(wsUrl);
      TrackListener(owned.socket, "message", OnSocketMessage);
      TrackListener(owned.socket, "error", OnSocketError);
      TrackListener(owned.socket, "close", OnSocketClose);
    }

    ScheduleRender(handle);

    return handle;
  }

  function Destroy(handle) {
    if (!handle) {
      return;
    }

    handle._owned = handle._owned || {};
    handle._owned.destroyed = true;

    if (handle.pendingFrame != null) {
      const cancel =
        typeof cancelAnimationFrame !== "undefined"
          ? cancelAnimationFrame
          : clearTimeout;
      cancel(handle.pendingFrame);
      handle.pendingFrame = null;
    }

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

    handle.messageNodes = new Map();
    handle.panelExpanded = new Map();
  }

  const ChatView = {
    create: Create,
    destroy: Destroy,
    appendAguiEvent: AppendAguiEvent,
    prependHistory: PrependHistory,
    setCaughtUp: SetCaughtUp,
    setConnectionState: SetConnectionState,
    getUiState: GetUiState,
    _test: {
      createChatState: CreateChatState,
      reduceAguiEvent: ReduceAguiEvent,
      applyServerMessage: ApplyServerMessage,
      applyJsonPatch: ApplyJsonPatch,
      parseActivityContent: ParseActivityContent,
      prependSnapshotMessages: PrependSnapshotMessages,
      escapeHtml: EscapeHtml,
      formatMarkdown: FormatMarkdown,
      isAtBottom: IsAtBottom,
      renderChat: RenderChat,
      scheduleRender: ScheduleRender,
      x_AutoScrollThreshold: x_AutoScrollThreshold,
    },
  };

  if (typeof globalThis !== "undefined") {
    globalThis.ChatView = ChatView;
  }
  if (typeof window !== "undefined") {
    window.ChatView = ChatView;
  }
})();
