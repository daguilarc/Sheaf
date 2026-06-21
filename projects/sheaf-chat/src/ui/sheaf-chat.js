/**
 * Sheaf Chat browser UI: repositories, workspaces, and interactive chat screens.
 */
(function () {
  "use strict";

  const x_ClientIdKey = "sheaf-chat-client-id";
  const x_HistoryPageLimit = 5000;
  const x_InitialHistoryLimit = 5000;
  const x_NearTopHistoryThreshold = 80;
  const x_ReconnectDelayMs = 1500;
  const x_ExplorerWidthKey = "sheaf-chat-explorer-width";
  const x_ChatWidthKey = "sheaf-chat-chat-width";
  const x_DefaultExplorerWidth = 240;
  const x_DefaultChatWidth = 360;
  const x_MinExplorerWidth = 160;
  const x_MaxExplorerWidth = 480;
  const x_MinChatWidth = 280;
  const x_MaxChatWidth = 640;

  function CreateElement(tag, className) {
    const element = document.createElement(tag);
    if (className) {
      element.className = className;
    }
    return element;
  }

  function GenerateId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  function GetClientId() {
    try {
      const existing = localStorage.getItem(x_ClientIdKey);
      if (existing) {
        return existing;
      }
      const created = GenerateId();
      localStorage.setItem(x_ClientIdKey, created);
      return created;
    } catch (_error) {
      return GenerateId();
    }
  }

  function IsTouchLayout() {
    if (typeof window === "undefined") {
      return false;
    }
    if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) {
      return true;
    }
    return "ontouchstart" in window;
  }

  function ParseRoute() {
    const hash = (window.location.hash || "#/").replace(/^#/, "");
    const parts = hash.split("/").filter(function (part) {
      return part.length > 0;
    });

    if (parts.length === 0) {
      return { screen: "repositories" };
    }

    if (parts[0] === "repositories" && parts.length === 1) {
      return { screen: "repositories" };
    }

    if (parts[0] === "repositories" && parts.length === 2) {
      return { screen: "workspaces", repoId: decodeURIComponent(parts[1]) };
    }

    if (
      parts[0] === "repositories" &&
      parts.length === 4 &&
      parts[2] === "workspaces"
    ) {
      return {
        screen: "workspace",
        repoId: decodeURIComponent(parts[1]),
        workspaceId: decodeURIComponent(parts[3]),
      };
    }

    if (
      parts[0] === "repositories" &&
      parts.length === 6 &&
      parts[2] === "workspaces" &&
      parts[4] === "chats"
    ) {
      return {
        screen: "chat",
        repoId: decodeURIComponent(parts[1]),
        workspaceId: decodeURIComponent(parts[3]),
        chatId: decodeURIComponent(parts[5]),
      };
    }

    return { screen: "repositories" };
  }

  function NavigateTo(route) {
    if (route.screen === "repositories") {
      window.location.hash = "#/";
      return;
    }

    if (route.screen === "workspaces") {
      window.location.hash = "#/repositories/" + encodeURIComponent(route.repoId);
      return;
    }

    if (route.screen === "workspace") {
      window.location.hash =
        "#/repositories/" +
        encodeURIComponent(route.repoId) +
        "/workspaces/" +
        encodeURIComponent(route.workspaceId);
      return;
    }

    if (route.screen === "chat") {
      window.location.hash =
        "#/repositories/" +
        encodeURIComponent(route.repoId) +
        "/workspaces/" +
        encodeURIComponent(route.workspaceId) +
        "/chats/" +
        encodeURIComponent(route.chatId);
    }
  }

  async function FetchJson(path, options) {
    const response = await fetch(path, options);
    const body = await response.json();
    if (!response.ok) {
      const message =
        body &&
        body.error &&
        body.error.message != null
          ? String(body.error.message)
          : "request failed";
      throw new Error(message);
    }
    return body;
  }

  function FormatTimestamp(value) {
    if (!value) {
      return "";
    }
    try {
      return new Date(value).toLocaleString();
    } catch (_error) {
      return String(value);
    }
  }

  function CreateScreenShell(title, onBack) {
    const screen = CreateElement("div", "sheaf-chat-screen");
    const header = CreateElement("header", "sheaf-chat-header");

    if (onBack) {
      const back = CreateElement("button", "sheaf-chat-back");
      back.type = "button";
      back.textContent = "Back";
      back.addEventListener("click", onBack);
      header.appendChild(back);
    }

    const heading = CreateElement("h1", "sheaf-chat-header-title");
    heading.textContent = title;
    header.appendChild(heading);
    screen.appendChild(header);

    const content = CreateElement("div", "sheaf-chat-content");
    screen.appendChild(content);

    return { screen, content };
  }

  function RenderRepositoriesScreen(app, route) {
    app.textContent = "";
    const shell = CreateScreenShell("Repositories", null);
    app.appendChild(shell.screen);

    const list = CreateElement("ul", "sheaf-chat-list");
    shell.content.appendChild(list);

    const errorNode = CreateElement("div", "sheaf-chat-error");
    shell.content.appendChild(errorNode);

    function RenderRepositoryRows(repositories) {
      list.textContent = "";
      errorNode.textContent = "";

      if (!repositories || repositories.length === 0) {
        const empty = CreateElement("p", "sheaf-chat-empty");
        empty.textContent = "No repositories found.";
        list.appendChild(empty);
        return;
      }

      for (const repository of repositories) {
        const item = CreateElement("li", "sheaf-chat-list-item");
        const button = CreateElement("button", "sheaf-chat-list-button");
        button.type = "button";
        button.textContent = repository.name || repository.repoId;
        const meta = CreateElement("span", "sheaf-chat-list-meta");
        meta.textContent = repository.path || "";
        button.appendChild(meta);
        button.addEventListener("click", function () {
          NavigateTo({ screen: "workspaces", repoId: repository.repoId });
        });
        item.appendChild(button);
        list.appendChild(item);
      }
    }

    FetchJson("/api/repositories")
      .then(function (body) {
        RenderRepositoryRows(body.repositories || []);
      })
      .catch(function (error) {
        errorNode.textContent = error.message || "Failed to load repositories";
      });
  }

  function RenderWorkspacesScreen(app, route) {
    app.textContent = "";
    const shell = CreateScreenShell("Workspaces", function () {
      NavigateTo({ screen: "repositories" });
    });
    app.appendChild(shell.screen);

    const list = CreateElement("ul", "sheaf-chat-list");
    shell.content.appendChild(list);
    const errorNode = CreateElement("div", "sheaf-chat-error");
    shell.content.appendChild(errorNode);

    function RenderWorkspaceRows(workspaces) {
      list.textContent = "";
      if (!workspaces || workspaces.length === 0) {
        const empty = CreateElement("p", "sheaf-chat-empty");
        empty.textContent = "No workspaces found.";
        list.appendChild(empty);
        return;
      }

      for (const workspace of workspaces) {
        const item = CreateElement("li", "sheaf-chat-list-item");
        const button = CreateElement("button", "sheaf-chat-list-button");
        button.type = "button";
        button.textContent = workspace.displayName || workspace.workspaceId;
        const meta = CreateElement("span", "sheaf-chat-list-meta");
        meta.textContent = (workspace.kind || "workspace") + " · " + (workspace.path || "");
        button.appendChild(meta);
        button.addEventListener("click", function () {
          NavigateTo({
            screen: "workspace",
            repoId: route.repoId,
            workspaceId: workspace.workspaceId,
          });
        });
        item.appendChild(button);
        list.appendChild(item);
      }
    }

    FetchJson("/api/repositories/" + encodeURIComponent(route.repoId) + "/workspaces")
      .then(function (body) {
        RenderWorkspaceRows(body.workspaces || []);
      })
      .catch(function (error) {
        errorNode.textContent = error.message || "Failed to load workspaces";
      });
  }

  function WorkspaceApiBase(route) {
    return (
      "/api/repositories/" +
      encodeURIComponent(route.repoId) +
      "/workspaces/" +
      encodeURIComponent(route.workspaceId)
    );
  }

  function ChatApiBase(route) {
    return WorkspaceApiBase(route) + "/chats/" + encodeURIComponent(route.chatId);
  }

  function BuildWebSocketUrl(repoId, workspaceId, chatId, after) {
    const params = new URLSearchParams();
    params.set("repo", repoId);
    params.set("workspace", workspaceId);
    params.set("chat", chatId);
    params.set("client", GetClientId());
    if (after != null && after > 0) {
      params.set("after", String(after));
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return (
      protocol +
      "//" +
      window.location.host +
      "/ws/chat?" +
      params.toString()
    );
  }

  function BuildAgentReviewWebSocketUrl(repoId, workspaceId) {
    const params = new URLSearchParams();
    params.set("repo", repoId);
    params.set("workspace", workspaceId);
    params.set("client", GetClientId());

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return (
      protocol +
      "//" +
      window.location.host +
      "/ws/agent-review?" +
      params.toString()
    );
  }

  function CreateEnvelope(kind, repoId, workspaceId, chatId, payload) {
    return {
      v: 1,
      kind: kind,
      id: GenerateId(),
      repoId: repoId,
      workspaceId: workspaceId,
      chatId: chatId,
      timestamp: new Date().toISOString(),
      payload: payload,
    };
  }

  function Clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function ReadStoredNumber(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) {
        return fallback;
      }
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) {
        return fallback;
      }
      return parsed;
    } catch (_error) {
      return fallback;
    }
  }

  function WriteStoredNumber(key, value) {
    try {
      localStorage.setItem(key, String(value));
    } catch (_error) {
    }
  }

  function NormalizeTabPath(pathValue) {
    if (pathValue == null) {
      return null;
    }

    const decoded = String(pathValue).replace(/\\/g, "/");
    const segments = decoded.split("/").filter(function (segment) {
      return segment.length > 0;
    });
    const normalized = [];

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      if (segment === ".") {
        continue;
      }
      if (segment === "..") {
        return null;
      }
      normalized.push(segment);
    }

    return normalized.join("/");
  }

  function BaseName(pathValue) {
    const parts = String(pathValue).split("/");
    return parts[parts.length - 1] || String(pathValue);
  }

  function EscapeSelector(value) {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
      return CSS.escape(value);
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function IsMarkdownContentType(contentType, pathValue) {
    if (contentType === "text/markdown") {
      return true;
    }
    const lower = String(pathValue).toLowerCase();
    return lower.endsWith(".md") || lower.endsWith(".markdown");
  }

  const x_HighlightLanguageByExtension = {
    ".bash": "bash",
    ".c++": "cpp",
    ".cc": "cpp",
    ".cjs": "javascript",
    ".cpp": "cpp",
    ".cts": "typescript",
    ".cxx": "cpp",
    ".h": "cpp",
    ".h++": "cpp",
    ".hh": "cpp",
    ".htm": "xml",
    ".html": "xml",
    ".hpp": "cpp",
    ".hxx": "cpp",
    ".js": "javascript",
    ".json": "json",
    ".json5": "json",
    ".jsonc": "json",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".mts": "typescript",
    ".plist": "xml",
    ".py": "python",
    ".pyw": "python",
    ".sh": "bash",
    ".svg": "xml",
    ".swift": "swift",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".xhtml": "xml",
    ".xml": "xml",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".zsh": "bash",
  };

  function HighlightLanguageForPath(pathValue) {
    const fileName = BaseName(pathValue).toLowerCase();
    const dotIndex = fileName.lastIndexOf(".");
    if (dotIndex < 0) {
      return null;
    }

    return x_HighlightLanguageByExtension[fileName.slice(dotIndex)] || null;
  }

  function CreatePlainFilePreview(content) {
    const plain = CreateElement("pre", "sheaf-chat-file-plain");
    plain.textContent = content;
    return plain;
  }

  function GetHighlighter() {
    if (typeof window !== "undefined" && window.hljs) {
      return window.hljs;
    }
    if (typeof globalThis !== "undefined" && globalThis.hljs) {
      return globalThis.hljs;
    }
    return null;
  }

  function CreateHighlightedFilePreview(content, language) {
    const highlighter = GetHighlighter();
    if (
      !highlighter ||
      typeof highlighter.highlight !== "function" ||
      typeof highlighter.getLanguage !== "function" ||
      !highlighter.getLanguage(language)
    ) {
      return null;
    }

    try {
      const result = highlighter.highlight(String(content), {
        language: language,
        ignoreIllegals: true,
      });
      const pre = CreateElement(
        "pre",
        "sheaf-chat-file-plain sheaf-chat-file-highlighted"
      );
      const code = CreateElement("code", "hljs language-" + language);
      code.innerHTML = result && result.value != null ? String(result.value) : "";
      pre.appendChild(code);
      return pre;
    } catch (_error) {
      return null;
    }
  }

  function CreateChatSessionController(config) {
    const route = config.route;
    const touchLayout = config.touchLayout === true;
    const title = config.title;
    const connectionLabel = config.connectionLabel;
    const modelSelect = config.modelSelect;
    const chatContainer = config.chatContainer;
    const composer = config.composer;
    const textarea = config.textarea;
    const sendButton = config.sendButton;

    let socket = null;
    let chatHandle = null;
    let destroyed = false;
    let connected = false;
    let lastSequence = 0;
    let oldestSequence = null;
    let hasMoreBefore = false;
    let historyLoading = false;
    let models = [];
    let activeModel = null;
    let reconnectTimer = null;
    let intentionalClose = false;
    const outboundQueue = [];
    let fileChangedHandler = null;

    function UpdateComposerState() {
      const queuedCount = outboundQueue.length;
      composer.classList.toggle("sheaf-chat-composer--disconnected", !connected);
      composer.classList.toggle("sheaf-chat-composer--queued", queuedCount > 0);
      textarea.disabled = false;
      sendButton.disabled = !connected && queuedCount === 0;
      if (chatHandle) {
        window.ChatView.setConnectionState(chatHandle, {
          connected: connected,
          queuedCount: queuedCount,
          label: connected ? null : "Disconnected",
        });
      }
    }

    function ResizeTextarea() {
      textarea.style.height = "auto";
      const maxHeight = 200;
      textarea.style.height =
        Math.min(textarea.scrollHeight, maxHeight) + "px";
    }

    function PopulateModels() {
      modelSelect.textContent = "";
      for (const model of models) {
        const option = document.createElement("option");
        option.value = model.provider + ":" + model.id;
        const selected =
          activeModel &&
          activeModel.provider === model.provider &&
          activeModel.id === model.id;
        option.selected = selected;
        option.textContent =
          (model.displayName || model.id) +
          (model.available === false ? " (unavailable)" : "");
        option.disabled = model.available === false;
        modelSelect.appendChild(option);
      }
    }

    function UpdateStatusText() {
      const modelText =
        activeModel != null
          ? activeModel.provider + "/" + activeModel.id
          : "model unknown";
      connectionLabel.innerHTML =
        "<strong>" +
        (connected ? "Connected" : "Disconnected") +
        "</strong> · " +
        modelText;
    }

    function SendEnvelope(envelope) {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return false;
      }
      socket.send(JSON.stringify(envelope));
      return true;
    }

    function FlushQueue() {
      if (!connected) {
        return;
      }
      while (outboundQueue.length > 0) {
        const item = outboundQueue[0];
        if (!SendEnvelope(item)) {
          break;
        }
        outboundQueue.shift();
      }
      UpdateComposerState();
    }

    function QueueOrSend(envelope) {
      if (SendEnvelope(envelope)) {
        return;
      }
      outboundQueue.push(envelope);
      UpdateComposerState();
    }

    function SendAck(sequence) {
      if (sequence == null || sequence <= 0) {
        return;
      }
      SendEnvelope(
        CreateEnvelope("client.ack", route.repoId, route.workspaceId, route.chatId, {
          sequence: sequence,
        })
      );
    }

    function RequestHistory(options) {
      if (historyLoading && options.before != null) {
        return;
      }

      const payload = {
        limit: options.limit || x_HistoryPageLimit,
        prefer: "snapshots",
      };
      if (options.before != null) {
        payload.before = options.before;
      }
      if (options.after != null) {
        payload.after = options.after;
      }
      const envelope = CreateEnvelope(
        "client.history_request",
        route.repoId,
        route.workspaceId,
        route.chatId,
        payload
      );
      if (options.before != null) {
        historyLoading = true;
      }
      QueueOrSend(envelope);
    }

    function TranscriptIsNearTop() {
      return (
        chatHandle &&
        chatHandle.transcript &&
        chatHandle.transcript.scrollTop <= x_NearTopHistoryThreshold
      );
    }

    function ContinueHistoryIfPinnedNearTop() {
      if (historyLoading || !hasMoreBefore || oldestSequence == null) {
        return;
      }

      if (!TranscriptIsNearTop()) {
        return;
      }

      window.setTimeout(function () {
        if (historyLoading || !hasMoreBefore || oldestSequence == null) {
          return;
        }
        if (TranscriptIsNearTop()) {
          RequestHistory({ before: oldestSequence, limit: x_HistoryPageLimit });
        }
      }, 0);
    }

    function HandleHistoryPage(payload) {
      historyLoading = false;
      if (!payload) {
        return;
      }

      if (payload.oldestSequence != null) {
        oldestSequence = payload.oldestSequence;
      }
      if (payload.hasMoreBefore != null) {
        hasMoreBefore = payload.hasMoreBefore === true;
      }

      const messages = Array.isArray(payload.messages) ? payload.messages : [];
      if (messages.length > 0 && chatHandle) {
        window.ChatView.prependHistory(chatHandle, messages);
      }

      const events = Array.isArray(payload.events) ? payload.events : [];
      for (const event of events) {
        if (event && chatHandle) {
          window.ChatView.appendAguiEvent(chatHandle, event);
        }
      }

      ContinueHistoryIfPinnedNearTop();
    }

    function AppendUserMessage(messageId, text) {
      if (!chatHandle) {
        return;
      }
      window.ChatView.appendAguiEvent(chatHandle, {
        type: "TEXT_MESSAGE_START",
        messageId: messageId,
        role: "user",
      });
      window.ChatView.appendAguiEvent(chatHandle, {
        type: "TEXT_MESSAGE_CONTENT",
        messageId: messageId,
        delta: text != null ? String(text) : "",
      });
      window.ChatView.appendAguiEvent(chatHandle, {
        type: "TEXT_MESSAGE_END",
        messageId: messageId,
      });
    }

    function HandleServerEnvelope(envelope) {
      if (!envelope || typeof envelope !== "object") {
        return;
      }

      if (envelope.sequence != null && envelope.sequence > lastSequence) {
        lastSequence = envelope.sequence;
        SendAck(envelope.sequence);
      }

      const kind = envelope.kind;
      const payload = envelope.payload;

      if (kind === "server.hello") {
        if (payload && Array.isArray(payload.models)) {
          models = payload.models;
        }
        if (payload && payload.activeModel) {
          activeModel = payload.activeModel;
        }
        if (payload && payload.manifest && payload.manifest.chatName) {
          title.textContent = payload.manifest.chatName;
        }
        if (payload && payload.latestSequence != null) {
          lastSequence = Math.max(lastSequence, payload.latestSequence);
        }
        if (payload && payload.historyWindow) {
          oldestSequence = payload.historyWindow.oldestSequence;
          hasMoreBefore =
            payload.historyWindow.oldestSequence != null &&
            payload.historyWindow.oldestSequence > 1;
        }
        PopulateModels();
        UpdateStatusText();
        RequestHistory({ limit: x_InitialHistoryLimit });
        return;
      }

      if (kind === "history.page") {
        HandleHistoryPage(payload);
        return;
      }

      if (kind === "agui.event" && payload) {
        if (chatHandle) {
          window.ChatView.appendAguiEvent(chatHandle, payload);
        }
        return;
      }

      if (kind === "chat.user_message" && payload) {
        // The same messageId may already be on screen from the optimistic local
        // echo in SubmitMessage; the renderer dedupes by id, so re-applying the
        // events here reconciles to the single existing bubble.
        AppendUserMessage(payload.messageId || GenerateId(), payload.text);
        return;
      }

      if (kind === "model.changed" && payload && payload.model) {
        activeModel = payload.model;
        PopulateModels();
        UpdateStatusText();
        return;
      }

      if (kind === "session.updated" && payload && payload.manifest) {
        if (payload.manifest.chatName) {
          title.textContent = payload.manifest.chatName;
        }
        return;
      }

      if (kind === "agent.status" && payload && payload.state) {
        connectionLabel.innerHTML =
          "<strong>" +
          (connected ? "Connected" : "Disconnected") +
          "</strong> · agent " +
          String(payload.state);
        return;
      }

      if (kind === "server.caught_up") {
        if (chatHandle) {
          window.ChatView.setCaughtUp(chatHandle, true);
        }
        return;
      }

      if (kind === "file.changed" && payload && fileChangedHandler) {
        fileChangedHandler(payload);
        return;
      }

      if (kind === "server.error" && payload) {
        connectionLabel.textContent = String(payload.message || "Server error");
      }
    }

    function Connect() {
      if (destroyed) {
        return;
      }

      intentionalClose = false;
      connected = false;
      UpdateComposerState();
      UpdateStatusText();

      const wsUrl = BuildWebSocketUrl(
        route.repoId,
        route.workspaceId,
        route.chatId,
        lastSequence
      );
      socket = new WebSocket(wsUrl);

      socket.addEventListener("open", function () {
        connected = true;
        UpdateComposerState();
        UpdateStatusText();
        FlushQueue();
        SendEnvelope(
          CreateEnvelope("client.hello", route.repoId, route.workspaceId, route.chatId, {
            supportsSnapshots: true,
            supportsLazyHistory: true,
            lastSeenSequence: lastSequence,
          })
        );
      });

      socket.addEventListener("message", function (event) {
        let envelope;
        try {
          envelope = JSON.parse(event.data);
        } catch (_error) {
          return;
        }
        HandleServerEnvelope(envelope);
      });

      socket.addEventListener("close", function () {
        connected = false;
        UpdateComposerState();
        UpdateStatusText();
        if (!destroyed && !intentionalClose) {
          reconnectTimer = window.setTimeout(function () {
            Connect();
          }, x_ReconnectDelayMs);
        }
      });

      socket.addEventListener("error", function () {
        connected = false;
        UpdateComposerState();
        UpdateStatusText();
      });
    }

    function DestroyChat() {
      destroyed = true;
      intentionalClose = true;
      if (reconnectTimer != null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (socket) {
        socket.close();
        socket = null;
      }
      if (chatHandle) {
        window.ChatView.destroy(chatHandle);
        chatHandle = null;
      }
    }

    function SubmitMessage() {
      const text = textarea.value.trim();
      if (!text) {
        return;
      }

      const messageId = GenerateId();
      // Optimistic local echo: render the user's message immediately so it never
      // depends on the server round-trip (the later server echo dedupes by id).
      AppendUserMessage(messageId, text);
      QueueOrSend(
        CreateEnvelope("client.user_message", route.repoId, route.workspaceId, route.chatId, {
          messageId: messageId,
          text: text,
          attachments: [],
          steer: true,
        })
      );
      textarea.value = "";
      ResizeTextarea();
      UpdateComposerState();
    }

    function SetFileChangedHandler(handler) {
      fileChangedHandler = handler;
    }

    chatHandle = window.ChatView.create(chatContainer, {
      onScrollNearTop: function () {
        if (historyLoading || !hasMoreBefore || oldestSequence == null) {
          return;
        }
        RequestHistory({ before: oldestSequence, limit: x_HistoryPageLimit });
      },
      linkContext: config.linkContext || null,
    });
    UpdateComposerState();

    modelSelect.addEventListener("change", function () {
      const parts = modelSelect.value.split(":");
      if (parts.length !== 2) {
        return;
      }
      QueueOrSend(
        CreateEnvelope("client.model_select", route.repoId, route.workspaceId, route.chatId, {
          provider: parts[0],
          id: parts[1],
          applyTo: "next_turn",
        })
      );
    });

    sendButton.addEventListener("click", SubmitMessage);
    textarea.addEventListener("input", ResizeTextarea);
    textarea.addEventListener("keydown", function (event) {
      if (event.key !== "Enter") {
        return;
      }

      if (touchLayout) {
        return;
      }

      if (event.shiftKey) {
        return;
      }

      event.preventDefault();
      SubmitMessage();
    });

    Connect();

    return {
      destroy: DestroyChat,
      setFileChangedHandler: SetFileChangedHandler,
      getChatHandle: function () {
        return chatHandle;
      },
    };
  }

  function CreateFileWorkspace(config) {
    const route = config.route;
    const explorerEl = config.explorerEl;
    const tabBarEl = config.tabBarEl;
    const fileViewEl = config.fileViewEl;
    const reviewBarEl = config.reviewBarEl || null;
    const workspaceEl = config.workspaceEl;
    const explorerPane = config.explorerPane;
    const chatPane = config.chatPane;
    const onOpenFile = config.onOpenFile;
    const touchLayout = config.touchLayout === true;
    const mobileTabListEl = config.mobileTabListEl || null;
    const mobileTitleEl = config.mobileTitleEl || null;
    const mobileBackdropEl = config.mobileBackdropEl || null;
    const mobileTabsPane = config.mobileTabsPane || null;

    const state = {
      tabs: [],
      selectedPath: null,
      viewports: {},
      directoryCache: {},
      expandedDirectories: new Set(["."]),
      agentReview: {
        loaded: false,
        available: false,
        active: false,
        socket: null,
        connected: false,
        socketReady: false,
        state: null,
        error: null,
        pendingCommentFocusHunkId: null,
        pendingScrollHunkId: null,
        pendingScrollForceReveal: false,
        presenceListener: null,
        lastFocusKey: null,
        pendingHunkMutation: false,
        pendingCommandResult: false,
      },
    };

    const panelState = {
      explorerWidth: Clamp(
        ReadStoredNumber(x_ExplorerWidthKey, x_DefaultExplorerWidth),
        x_MinExplorerWidth,
        x_MaxExplorerWidth
      ),
      chatWidth: Clamp(
        ReadStoredNumber(x_ChatWidthKey, x_DefaultChatWidth),
        x_MinChatWidth,
        x_MaxChatWidth
      ),
      explorerCollapsed: false,
      chatCollapsed: false,
    };

    const mobilePanelState = {
      mobileExplorerOpen: false,
      mobileTabsOpen: false,
      mobileChatOpen: false,
    };

    let activeResize = null;
    let saveEditorStateTimer = null;
    let applyingEditorState = false;
    const fileNavigation =
      window.SheafFileNavigation &&
      typeof window.SheafFileNavigation.createController === "function"
        ? window.SheafFileNavigation.createController({
          fileViewEl: fileViewEl,
          getSelectedTab: function () {
            return state.selectedPath ? FindTab(state.selectedPath) : null;
          },
          getTabs: function () {
            return state.tabs.slice();
          },
          listDirectory: function (directoryPath) {
            const cacheKey = directoryPath || ".";
            return LoadDirectory(cacheKey).then(function () {
              const cached = state.directoryCache[cacheKey] || {};
              return Array.isArray(cached.entries) ? cached.entries : [];
            });
          },
          openFile: OpenFile,
          selectTab: SelectTab,
          renderSelectedFile: RenderSelectedFile,
          onStateChange: ScheduleEditorStateSave,
        })
        : null;

    function FilesApiBase() {
      return route.chatId ? ChatApiBase(route) : WorkspaceApiBase(route);
    }

    function AgentReviewBase() {
      // Agent Review is workspace-scoped (the worktree), independent of any chat.
      return WorkspaceApiBase(route) + "/agent-review";
    }

    function EditorStateApi() {
      return WorkspaceApiBase(route) + "/editor-state";
    }

    function CaptureSelectedViewport() {
      if (!state.selectedPath) {
        return;
      }

      // While restoring editor state, the live scrollTop is still 0 because the
      // restore runs in a later animation frame. Capturing here would clobber the
      // viewport we are about to restore, so leave the restored values untouched.
      if (applyingEditorState) {
        return;
      }

      state.viewports[state.selectedPath] = {
        scrollTop: fileViewEl.scrollTop || 0,
      };
    }

    function BuildEditorStatePayload() {
      CaptureSelectedViewport();
      return {
        tabs: state.tabs.map(function (tab) {
          return tab.path;
        }),
        selectedPath: state.selectedPath,
        expandedDirectories: Array.from(state.expandedDirectories),
        viewports: state.viewports,
        navigation:
          fileNavigation && typeof fileNavigation.exportState === "function"
            ? fileNavigation.exportState()
            : undefined,
      };
    }

    function ScheduleEditorStateSave() {
      if (applyingEditorState) {
        return;
      }

      if (saveEditorStateTimer !== null) {
        clearTimeout(saveEditorStateTimer);
      }

      saveEditorStateTimer = window.setTimeout(function () {
        saveEditorStateTimer = null;
        FetchJson(EditorStateApi(), {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(BuildEditorStatePayload()),
        }).catch(function () {
        });
      }, 250);
    }

    function RestoreSelectedViewport() {
      if (!state.selectedPath) {
        return;
      }

      const viewport = state.viewports[state.selectedPath];
      if (!viewport || typeof viewport.scrollTop !== "number") {
        return;
      }

      window.requestAnimationFrame(function () {
        fileViewEl.scrollTop = viewport.scrollTop;
      });
    }

    function ApplyEditorState(editorState) {
      if (!editorState || typeof editorState !== "object") {
        return Promise.resolve();
      }

      applyingEditorState = true;
      state.expandedDirectories = new Set(
        Array.isArray(editorState.expandedDirectories)
          ? editorState.expandedDirectories
          : ["."]
      );
      state.expandedDirectories.add(".");
      state.viewports =
        editorState.viewports && typeof editorState.viewports === "object"
          ? editorState.viewports
          : {};
      if (fileNavigation && typeof fileNavigation.applyState === "function") {
        fileNavigation.applyState(editorState.navigation);
      }

      const tabs = Array.isArray(editorState.tabs) ? editorState.tabs : [];
      const selectedPath =
        typeof editorState.selectedPath === "string" ? editorState.selectedPath : null;

      return Promise.all(Array.from(state.expandedDirectories).map(function (directoryPath) {
        return LoadDirectory(directoryPath);
      }))
        .then(function () {
          return tabs.reduce(function (chain, tabPath) {
            return chain.then(function () {
              return OpenFile(tabPath);
            });
          }, Promise.resolve());
        })
        .then(function () {
          if (selectedPath) {
            return SelectTab(selectedPath);
          }
          return Promise.resolve();
        })
        .finally(function () {
          applyingEditorState = false;
          RenderExplorer();
          RenderTabs();
          RenderSelectedFile();
        });
    }

    function LoadEditorState() {
      return FetchJson(EditorStateApi())
        .then(function (body) {
          return ApplyEditorState(body.editorState);
        })
        .catch(function () {
        });
    }

    function TraceAgentReviewUi(event, fields) {
      try {
        if (window.localStorage.getItem("sheaf.chat.agentReviewTrace") !== "1") {
          return;
        }
      } catch (_) {
        return;
      }
      if (!window.console || typeof window.console.info !== "function") {
        return;
      }
      const payload = Object.assign({
        service: "sheaf-chat",
        feature: "agent-review",
        event: event,
        repoId: route.repoId,
        workspaceId: route.workspaceId,
      }, fields || {});
      window.console.info("[agent-review]", payload);
    }

    function ReviewCommand(action) {
      const review = state.agentReview;
      const reviewState = review.state;
      const current = reviewState ? reviewState.currentHunk : null;
      TraceAgentReviewUi("ui.command.click", {
        action: action,
        socketReady: review.socketReady === true,
        socketState: review.socket ? review.socket.readyState : null,
        hunkId: current ? current.hunkId : null,
        patchHash: current ? current.patchHash : null,
      });
      if (!review.socket || review.socket.readyState !== WebSocket.OPEN || !review.socketReady) {
        review.error = "Agent Review is disconnected.";
        RenderReviewBar();
        return;
      }

      if (action === "stage" || action === "revert") {
        review.pendingHunkMutation = true;
      }
      review.pendingCommandResult = true;

      review.socket.send(JSON.stringify({
        type: "command",
        id: GenerateId(),
        action: action,
        hunkId: current ? current.hunkId : undefined,
        patchHash: current ? current.patchHash : undefined,
      }));
      TraceAgentReviewUi("ui.command.sent", {
        action: action,
        hunkId: current ? current.hunkId : null,
        patchHash: current ? current.patchHash : null,
      });
    }

    function SendReviewFrame(frame) {
      const review = state.agentReview;
      if (!review.socket || review.socket.readyState !== WebSocket.OPEN) {
        return false;
      }
      review.socket.send(JSON.stringify(frame));
      return true;
    }

    function ReviewWindowFocused() {
      // Strict focus: the tab must be visible AND the window must hold OS focus.
      // Fall back to focused when the environment lacks these APIs.
      const visible =
        typeof document.hidden === "boolean" ? !document.hidden : true;
      const focused =
        typeof document.hasFocus === "function" ? document.hasFocus() : true;
      return visible && focused;
    }

    function SendReviewPresence() {
      SendReviewFrame({ type: "presence", focused: ReviewWindowFocused() });
    }

    function AttachReviewPresenceListeners() {
      const review = state.agentReview;
      if (review.presenceListener) {
        return;
      }
      const listener = function () {
        SendReviewPresence();
      };
      review.presenceListener = listener;
      document.addEventListener("visibilitychange", listener);
      window.addEventListener("focus", listener);
      window.addEventListener("blur", listener);
    }

    function DetachReviewPresenceListeners() {
      const review = state.agentReview;
      const listener = review.presenceListener;
      if (!listener) {
        return;
      }
      review.presenceListener = null;
      document.removeEventListener("visibilitychange", listener);
      window.removeEventListener("focus", listener);
      window.removeEventListener("blur", listener);
    }

    function ReviewEntryForHunk(hunkId, kind) {
      const reviewState = state.agentReview.state;
      const entries = reviewState && reviewState.reviewDraft
        ? reviewState.reviewDraft.entries || []
        : [];
      return entries.find(function (entry) {
        return entry &&
          entry.kind === kind &&
          entry.hunk &&
          entry.hunk.hunkId === hunkId;
      }) || null;
    }

    function CommentTextForHunk(hunkId) {
      const entry = ReviewEntryForHunk(hunkId, "comment");
      return entry && typeof entry.text === "string" ? entry.text : "";
    }

    function ShouldShowReviewCommentBox(hunkId) {
      const reviewState = state.agentReview.state;
      const draft = reviewState ? reviewState.reviewDraft : null;
      return CommentTextForHunk(hunkId).trim().length > 0 ||
        (draft && draft.visibleCommentHunkId === hunkId);
    }

    function InlineReviewFileForPath(pathValue) {
      const reviewState = state.agentReview.state;
      const inlineFiles = reviewState && Array.isArray(reviewState.inlineFiles)
        ? reviewState.inlineFiles
        : [];
      return inlineFiles.find(function (file) {
        return file && file.file === pathValue && Array.isArray(file.rows);
      }) || null;
    }

    function FirstReviewHunkForPath(pathValue) {
      const reviewState = state.agentReview.state;
      const hunks = reviewState && Array.isArray(reviewState.hunks)
        ? reviewState.hunks
        : [];
      return hunks.find(function (hunk) {
        return hunk && hunk.file === pathValue;
      }) || null;
    }

    function CurrentReviewHunkForSelectedFile() {
      const reviewState = state.agentReview.state;
      const current = reviewState ? reviewState.currentHunk : null;
      if (current && current.file === state.selectedPath) {
        return current;
      }
      return state.selectedPath ? FirstReviewHunkForPath(state.selectedPath) : null;
    }

    function SynchronizeReviewFocus() {
      const review = state.agentReview;
      if (
        !state.selectedPath ||
        !review.state ||
        !review.socket ||
        review.socket.readyState !== WebSocket.OPEN ||
        !review.socketReady
      ) {
        return;
      }

      const current = review.state.currentHunk;
      const target = FirstReviewHunkForPath(state.selectedPath);
      const focusKey = target
        ? "hunk:" + target.hunkId
        : "file:" + state.selectedPath;
      if (review.lastFocusKey === focusKey) {
        return;
      }

      if (target) {
        if (current && current.hunkId === target.hunkId) {
          review.lastFocusKey = focusKey;
          return;
        }
        if (SendReviewFrame({ type: "focus", hunkId: target.hunkId })) {
          review.lastFocusKey = focusKey;
        }
        return;
      }

      if (SendReviewFrame({ type: "focus", hunkId: null, file: state.selectedPath })) {
        review.lastFocusKey = focusKey;
      }
    }

    function FindReviewHunkAnchor(hunkId) {
      const anchors = fileViewEl.querySelectorAll(".sheaf-chat-agent-review-inline-hunk-anchor");
      return Array.from(anchors).find(function (anchor) {
        return anchor.getAttribute("data-hunk-id") === hunkId;
      }) || null;
    }

    function ReviewHunkRevealTarget(anchor) {
      const parent = anchor && anchor.parentNode;
      const siblings = parent ? Array.from(parent.children || []) : [];
      const index = siblings.indexOf(anchor);
      if (index < 0) {
        return anchor;
      }
      return siblings[Math.max(0, index - 3)] || anchor;
    }

    function ReviewHunkChangedRows(hunkId) {
      const rows = fileViewEl.querySelectorAll(
        ".sheaf-chat-agent-review-inline-row--addition[data-hunk-id], " +
        ".sheaf-chat-agent-review-inline-row--deletion[data-hunk-id]"
      );
      return Array.from(rows).filter(function (row) {
        return row.getAttribute("data-hunk-id") === hunkId;
      });
    }

    function HunkRowsFullyVisible(rows, viewRect) {
      if (rows.length === 0) {
        return false;
      }

      for (const row of rows) {
        if (typeof row.getBoundingClientRect !== "function") {
          return false;
        }
        const rowRect = row.getBoundingClientRect();
        if (rowRect.top < viewRect.top || rowRect.bottom > viewRect.bottom) {
          return false;
        }
      }

      return true;
    }

    function ScrollPendingReviewHunk() {
      const hunkId = state.agentReview.pendingScrollHunkId;
      if (!hunkId) {
        return;
      }
      const forceReveal = state.agentReview.pendingScrollForceReveal === true;

      const anchor = FindReviewHunkAnchor(hunkId);
      if (!anchor) {
        return;
      }
      const revealTarget = ReviewHunkRevealTarget(anchor);

      state.agentReview.pendingScrollHunkId = null;
      state.agentReview.pendingScrollForceReveal = false;
      function RevealReviewHunkNow() {
        const hunkChangedRows = ReviewHunkChangedRows(hunkId);
        if (
          typeof fileViewEl.getBoundingClientRect !== "function" ||
          typeof revealTarget.getBoundingClientRect !== "function" ||
          typeof fileViewEl.scrollTo !== "function"
        ) {
          if (typeof revealTarget.scrollIntoView === "function") {
            if (
              fileNavigation &&
              typeof fileNavigation.noteProgrammaticScroll === "function"
            ) {
              fileNavigation.noteProgrammaticScroll(fileViewEl.scrollTop || 0);
            }
            revealTarget.scrollIntoView({ block: "start" });
          }
          return;
        }

        const viewRect = fileViewEl.getBoundingClientRect();
        if (!forceReveal && HunkRowsFullyVisible(hunkChangedRows, viewRect)) {
          return;
        }

        const targetRect = revealTarget.getBoundingClientRect();
        const targetTop = targetRect.top - viewRect.top + fileViewEl.scrollTop;
        const nextScrollTop = Math.max(0, targetTop);
        if (
          fileNavigation &&
          typeof fileNavigation.noteProgrammaticScroll === "function"
        ) {
          fileNavigation.noteProgrammaticScroll(nextScrollTop);
        }
        fileViewEl.scrollTo({
          top: nextScrollTop,
          behavior: "auto",
        });
      }

      RevealReviewHunkNow();
      window.requestAnimationFrame(RevealReviewHunkNow);
    }

    function CreateReviewCommentBox(currentHunk) {
      const commentWrap = CreateElement("div", "sheaf-chat-agent-review-comment");
      const textarea = CreateElement("textarea", "sheaf-chat-agent-review-comment-textarea");
      textarea.rows = 3;
      textarea.value = CommentTextForHunk(currentHunk.hunkId);
      textarea.addEventListener("input", function () {
        SendReviewFrame({
          type: "comment",
          hunkId: currentHunk.hunkId,
          text: textarea.value,
        });
      });
      textarea.addEventListener("focus", function () {
        SendReviewFrame({
          type: "comment_focus",
          hunkId: currentHunk.hunkId,
        });
      });
      textarea.addEventListener("blur", function () {
        SendReviewFrame({
          type: "comment_blur",
          hunkId: currentHunk.hunkId,
        });
      });
      commentWrap.appendChild(textarea);

      if (state.agentReview.pendingCommentFocusHunkId === currentHunk.hunkId) {
        state.agentReview.pendingCommentFocusHunkId = null;
        window.setTimeout(function () {
          textarea.focus();
        }, 0);
      }

      return commentWrap;
    }

    function RenderInlineReviewFile(contentWrap, inlineFile, currentHunk, selectedFile) {
      const review = CreateElement("div", "sheaf-chat-agent-review-inline");
      const rows = Array.isArray(inlineFile.rows) ? inlineFile.rows : [];
      const focusedHunkId = currentHunk ? currentHunk.hunkId : null;
      const anchorHunkIds = new Set();
      let anchoredHunks = new Set();
      let mountedComment = false;
      let sourceSearchOffset = 0;
      const sourceContent = selectedFile && selectedFile.content != null
        ? String(selectedFile.content)
        : "";

      rows.forEach(function (row) {
        const hunkId = typeof row.hunkId === "string" ? row.hunkId : null;
        if (
          hunkId !== null &&
          !anchorHunkIds.has(hunkId) &&
          (row.kind === "addition" || row.kind === "deletion")
        ) {
          anchorHunkIds.add(hunkId);
        }
      });

      rows.forEach(function (row, index) {
        const hunkId = typeof row.hunkId === "string" ? row.hunkId : null;
        const isFocused = hunkId !== null && hunkId === focusedHunkId;
        const classNames = [
          "sheaf-chat-agent-review-inline-row",
          "sheaf-chat-agent-review-inline-row--" + (row.kind || "context"),
        ];
        if (hunkId !== null) {
          classNames.push("sheaf-chat-agent-review-inline-row--changed");
          classNames.push(
            isFocused
              ? "sheaf-chat-agent-review-inline-row--focused"
              : "sheaf-chat-agent-review-inline-row--muted"
          );
        }

        const rowEl = CreateElement("div", classNames.join(" "));
        rowEl.setAttribute("data-review-row-id", String(row.id || index));
        if (hunkId !== null) {
          rowEl.setAttribute("data-hunk-id", hunkId);
          if (
            !anchoredHunks.has(hunkId) &&
            anchorHunkIds.has(hunkId) &&
            (row.kind === "addition" || row.kind === "deletion")
          ) {
            anchoredHunks.add(hunkId);
            rowEl.classList.add("sheaf-chat-agent-review-inline-hunk-anchor");
            rowEl.setAttribute("data-review-hunk-anchor", hunkId);
          }
        }
        if (row.text != null && String(row.text).length > 0 && sourceContent.length > 0) {
          const rowText = String(row.text);
          let sourceOffset = sourceContent.indexOf(rowText, sourceSearchOffset);
          if (sourceOffset < 0) {
            sourceOffset = sourceContent.indexOf(rowText);
          }
          if (sourceOffset >= 0) {
            rowEl.setAttribute("data-source-offset", String(sourceOffset));
            sourceSearchOffset = sourceOffset + rowText.length;
          }
        }

        const marker = CreateElement("span", "sheaf-chat-agent-review-inline-marker");
        marker.textContent =
          row.kind === "addition" ? "+" :
          row.kind === "deletion" ? "-" :
          " ";
        const lineNumber = CreateElement("span", "sheaf-chat-agent-review-inline-line-number");
        const oldLine = row.oldLineNumber == null ? "" : String(row.oldLineNumber);
        const newLine = row.newLineNumber == null ? "" : String(row.newLineNumber);
        lineNumber.textContent = oldLine || newLine ? oldLine + " " + newLine : "";
        const code = CreateElement("span", "sheaf-chat-agent-review-inline-code");
        code.textContent = row.text == null ? "" : String(row.text);

        rowEl.appendChild(marker);
        rowEl.appendChild(lineNumber);
        rowEl.appendChild(code);
        review.appendChild(rowEl);

        const next = rows[index + 1];
        const isFocusedHunkEnd =
          focusedHunkId !== null &&
          hunkId === focusedHunkId &&
          (!next || next.hunkId !== focusedHunkId);
        if (
          isFocusedHunkEnd &&
          currentHunk &&
          !mountedComment &&
          ShouldShowReviewCommentBox(currentHunk.hunkId)
        ) {
          mountedComment = true;
          review.appendChild(CreateReviewCommentBox(currentHunk));
        }
      });

      contentWrap.appendChild(review);
    }

    function RenderReviewBar() {
      if (!reviewBarEl) {
        return;
      }

      const review = state.agentReview;
      const reviewHunks =
        review.state && Array.isArray(review.state.hunks) ? review.state.hunks : [];
      // Show review controls only when there are hunks, preserved review output,
      // or an error worth surfacing. A Git worktree with nothing to review does
      // not surface the bar.
      const draft =
        review.state && review.state.reviewDraft ? review.state.reviewDraft : null;
      const showReview =
        review.loaded &&
        review.available &&
        (reviewHunks.length > 0 || review.error || (draft && draft.hasSerializedContent));

      reviewBarEl.textContent = "";
      reviewBarEl.classList.toggle("sheaf-chat-agent-review--active", showReview);
      reviewBarEl.classList.toggle("sheaf-chat-agent-review--available", showReview);

      if (!showReview) {
        return;
      }

      const reviewState = review.state;
      const actions = reviewState ? reviewState.actions : {};
      const current = CurrentReviewHunkForSelectedFile();
      const commandsReady = review.socketReady === true;
      const status = CreateElement("span", "sheaf-chat-agent-review-status");
      // The current file is shown by its always-visible tab, so the review bar
      // no longer repeats the file name here.
      status.textContent = current
        ? (current.hunkIndex + 1) + "/" + current.hunkCount
        : "No unstaged hunks";
      reviewBarEl.appendChild(status);

      // Unobtrusive position indicator: which hunk within the current file
      // (a/x) and which file among files with unstaged hunks (file b/y).
      const reviewFiles =
        reviewState && Array.isArray(reviewState.files) ? reviewState.files : [];
      const fileCount = reviewFiles.length;
      const counts = CreateElement("span", "sheaf-chat-agent-review-counts");
      if (current) {
        const currentFile = reviewFiles[current.fileIndex];
        const fileHunkCount = currentFile ? currentFile.hunkCount : 0;
        let hunksBeforeFile = 0;
        for (let i = 0; i < current.fileIndex; i += 1) {
          hunksBeforeFile += reviewFiles[i] ? reviewFiles[i].hunkCount : 0;
        }
        const hunkInFile = current.hunkIndex - hunksBeforeFile + 1;
        const fileNumber = current.fileIndex + 1;
        counts.textContent =
          hunkInFile + "/" + fileHunkCount + " in file · file " + fileNumber + "/" + fileCount;
        counts.title =
          "Viewing hunk " + hunkInFile + " of " + fileHunkCount + " in this file · file " +
          fileNumber + " of " + fileCount + " files";
      } else {
        counts.textContent = fileCount + (fileCount === 1 ? " file" : " files");
        counts.title = fileCount + " files with unstaged hunks";
      }
      reviewBarEl.appendChild(counts);

      const buttons = [
        ["previousFile", "Prev File", actions.canGoPrevFile],
        ["previousHunk", "Prev", actions.canGoUp],
        ["nextHunk", "Next", actions.canGoDown],
        ["nextFile", "Next File", actions.canGoNextFile],
        ["stage", "Stage", actions.canStage],
        ["revert", "Revert", actions.canRevert],
        ["undo", "Undo", actions.canUndo],
      ];

      for (const entry of buttons) {
        const button = CreateElement("button", "sheaf-chat-icon-button sheaf-chat-agent-review-command");
        button.type = "button";
        button.textContent = entry[1];
        button.disabled = !commandsReady || entry[2] !== true;
        button.addEventListener("click", function () {
          ReviewCommand(entry[0]);
        });
        reviewBarEl.appendChild(button);
      }

      if (review.error) {
        const error = CreateElement("span", "sheaf-chat-agent-review-error");
        error.textContent = review.error;
        reviewBarEl.appendChild(error);
      }
    }

    function ApplyReviewState(nextState) {
      state.agentReview.state = nextState;
      state.agentReview.available = nextState && nextState.available === true;
      state.agentReview.error = null;

      const current = nextState ? nextState.currentHunk : null;
      let renderSelectedFileNow = true;
      const shouldOpenCurrent =
        current &&
        current.file &&
        (!state.selectedPath || (state.agentReview.pendingCommandResult && state.selectedPath !== current.file));
      if (current && current.file && (shouldOpenCurrent || state.selectedPath === current.file)) {
        state.agentReview.pendingScrollHunkId = current.hunkId;
        state.agentReview.pendingScrollForceReveal = shouldOpenCurrent === true;
        if (shouldOpenCurrent && state.selectedPath !== current.file) {
          state.agentReview.lastFocusKey = "hunk:" + current.hunkId;
          renderSelectedFileNow = false;
          OpenFile(current.file);
        }
      } else {
        state.agentReview.pendingScrollHunkId = null;
        state.agentReview.pendingScrollForceReveal = false;
      }
      if (state.agentReview.pendingHunkMutation && current === null && state.selectedPath) {
        state.agentReview.lastFocusKey = "file:" + state.selectedPath;
      }
      state.agentReview.pendingHunkMutation = false;
      state.agentReview.pendingCommandResult = false;

      RenderReviewBar();
      if (renderSelectedFileNow) {
        RenderSelectedFile();
      }
      SynchronizeReviewFocus();
    }

    function StartAgentReview() {
      const review = state.agentReview;
      if (review.active) {
        return;
      }

      review.active = true;
      review.error = null;
      RenderReviewBar();

      const socket = new WebSocket(
        BuildAgentReviewWebSocketUrl(route.repoId, route.workspaceId)
      );
      review.socket = socket;
      review.socketReady = false;
      socket.addEventListener("open", function () {
        review.connected = true;
        TraceAgentReviewUi("ui.socket.open");
        SendReviewPresence();
        AttachReviewPresenceListeners();
        RenderReviewBar();
      });
      socket.addEventListener("message", function (event) {
        let frame;
        try {
          frame = JSON.parse(event.data);
        } catch (_error) {
          return;
        }

        if (
          (frame.type === "bootstrap" || frame.type === "state") &&
          frame.state
        ) {
          TraceAgentReviewUi("ui.state.received", {
            frameType: frame.type,
            available: frame.state.available === true,
            hunkCount: Array.isArray(frame.state.hunks) ? frame.state.hunks.length : null,
            currentHunkId: frame.state.currentHunk ? frame.state.currentHunk.hunkId : null,
            dictatorConnected: frame.state.dictatorBridge ? frame.state.dictatorBridge.connected === true : null,
            dictatorLastError: frame.state.dictatorBridge ? frame.state.dictatorBridge.lastError : null,
          });
          review.socketReady = true;
          ApplyReviewState(frame.state);
          return;
        }

        if (frame.type === "focus_comment" && frame.hunkId) {
          review.pendingCommentFocusHunkId = frame.hunkId;
          RenderSelectedFile();
          return;
        }

        if (frame.type === "command_result") {
          TraceAgentReviewUi("ui.command.result", {
            action: frame.result ? frame.result.action : null,
            commandId: frame.result ? frame.result.commandId : null,
            ok: frame.result ? frame.result.ok === true : null,
            error: frame.result ? frame.result.error || null : null,
            stale: frame.result ? frame.result.stale === true : null,
          });
          if (frame.result && frame.result.ok === false) {
            review.error = frame.result.error || "Agent Review command failed.";
          }
          if (frame.state) {
            review.socketReady = true;
            review.pendingCommandResult = true;
            if (
              frame.result &&
              (frame.result.action === "stage" || frame.result.action === "revert")
            ) {
              review.pendingHunkMutation = true;
            }
            ApplyReviewState(frame.state);
          } else {
            RenderReviewBar();
          }
          return;
        }

        if (frame.type === "error") {
          TraceAgentReviewUi("ui.error_frame", {
            code: frame.code || null,
            message: frame.message || null,
          });
          review.error = frame.message || "Agent Review error.";
          RenderReviewBar();
        }
      });
      socket.addEventListener("close", function () {
        review.connected = false;
        review.socketReady = false;
        TraceAgentReviewUi("ui.socket.close");
        if (review.socket === socket) {
          review.socket = null;
        }
        DetachReviewPresenceListeners();
        if (review.active) {
          review.error = "Agent Review disconnected.";
        }
        RenderReviewBar();
      });
      socket.addEventListener("error", function () {
        TraceAgentReviewUi("ui.socket.error");
        review.error = "Agent Review connection failed.";
        RenderReviewBar();
      });
    }

    function StopAgentReview() {
      const review = state.agentReview;
      review.active = false;
      review.connected = false;
      review.socketReady = false;
      review.error = null;
      review.state = null;
      review.pendingScrollHunkId = null;
      review.pendingScrollForceReveal = false;
      review.lastFocusKey = null;
      review.pendingHunkMutation = false;
      review.pendingCommandResult = false;
      DetachReviewPresenceListeners();
      if (review.socket) {
        review.socket.close();
        review.socket = null;
      }
      RenderReviewBar();
      RenderSelectedFile();
    }

    function LoadAgentReviewAvailability() {
      return FetchJson(AgentReviewBase())
        .then(function (body) {
          state.agentReview.loaded = true;
          state.agentReview.available = body && body.available === true;
          ApplyReviewState(body || null);
          if (state.agentReview.available) {
            StartAgentReview();
          }
        })
        .catch(function () {
          state.agentReview.loaded = true;
          state.agentReview.available = false;
          RenderReviewBar();
        });
    }

    function ApplyPanelLayout() {
      if (touchLayout) {
        return;
      }

      const explorerWidth = panelState.explorerWidth + "px";
      const chatWidth = panelState.chatWidth + "px";
      if (
        workspaceEl.style &&
        typeof workspaceEl.style.setProperty === "function"
      ) {
        workspaceEl.style.setProperty("--sheaf-chat-explorer-width", explorerWidth);
        workspaceEl.style.setProperty("--sheaf-chat-chat-width", chatWidth);
      } else if (workspaceEl.style) {
        workspaceEl.style["--sheaf-chat-explorer-width"] = explorerWidth;
        workspaceEl.style["--sheaf-chat-chat-width"] = chatWidth;
      }
      explorerPane.classList.toggle(
        "sheaf-chat-explorer-pane--collapsed",
        panelState.explorerCollapsed
      );
      chatPane.classList.toggle(
        "sheaf-chat-chat-pane--collapsed",
        panelState.chatCollapsed
      );
    }

    function ApplyMobilePanelState() {
      if (!touchLayout) {
        return;
      }

      const anyOpen =
        mobilePanelState.mobileExplorerOpen ||
        mobilePanelState.mobileTabsOpen ||
        mobilePanelState.mobileChatOpen;

      if (explorerPane) {
        explorerPane.classList.toggle(
          "sheaf-chat-mobile-panel--open",
          mobilePanelState.mobileExplorerOpen
        );
      }
      if (mobileTabsPane) {
        mobileTabsPane.classList.toggle(
          "sheaf-chat-mobile-panel--open",
          mobilePanelState.mobileTabsOpen
        );
      }
      if (chatPane) {
        chatPane.classList.toggle(
          "sheaf-chat-mobile-panel--open",
          mobilePanelState.mobileChatOpen
        );
      }
      if (mobileBackdropEl) {
        mobileBackdropEl.classList.toggle(
          "sheaf-chat-mobile-backdrop--visible",
          anyOpen
        );
      }
      if (workspaceEl) {
        workspaceEl.classList.toggle(
          "sheaf-chat-workspace--panel-open",
          anyOpen
        );
      }
    }

    function CloseMobilePanels() {
      mobilePanelState.mobileExplorerOpen = false;
      mobilePanelState.mobileTabsOpen = false;
      mobilePanelState.mobileChatOpen = false;
      ApplyMobilePanelState();
    }

    function OpenMobilePanel(name) {
      CloseMobilePanels();
      if (name === "explorer") {
        mobilePanelState.mobileExplorerOpen = true;
      } else if (name === "tabs") {
        mobilePanelState.mobileTabsOpen = true;
      } else if (name === "chat") {
        mobilePanelState.mobileChatOpen = true;
      }
      ApplyMobilePanelState();
    }

    function ToggleMobilePanel(name) {
      if (name === "explorer") {
        if (mobilePanelState.mobileExplorerOpen) {
          CloseMobilePanels();
          return;
        }
        OpenMobilePanel("explorer");
        return;
      }
      if (name === "tabs") {
        if (mobilePanelState.mobileTabsOpen) {
          CloseMobilePanels();
          return;
        }
        OpenMobilePanel("tabs");
        return;
      }
      if (name === "chat") {
        if (mobilePanelState.mobileChatOpen) {
          CloseMobilePanels();
          return;
        }
        OpenMobilePanel("chat");
      }
    }

    function UpdateMobileTitle() {
      if (!mobileTitleEl) {
        return;
      }

      const selected = state.selectedPath
        ? FindTab(state.selectedPath)
        : null;
      mobileTitleEl.textContent = selected ? selected.name : "No file open";
    }

    function FindTab(pathValue) {
      return state.tabs.find(function (tab) {
        return tab.path === pathValue;
      });
    }

    function ScrollToFragment(fragment) {
      if (!fragment) {
        return;
      }

      window.requestAnimationFrame(function () {
        const target = fileViewEl.querySelector(
          "[id='" + EscapeSelector(fragment) + "']"
        );
        if (target && target.scrollIntoView) {
          target.scrollIntoView();
        }
      });
    }

    function RenderExplorer() {
      explorerEl.textContent = "";
      const tree = CreateElement("ul", "sheaf-chat-explorer-list");
      explorerEl.appendChild(tree);
      RenderExplorerNode(tree, ".", 0);
    }

    function RenderExplorerNode(parent, directoryPath, depth) {
      const normalized = NormalizeTabPath(directoryPath);
      if (normalized == null && directoryPath !== ".") {
        return;
      }

      const cacheKey = normalized === "" ? "." : normalized || ".";
      const cached = state.directoryCache[cacheKey];
      const isExpanded = state.expandedDirectories.has(cacheKey);
      const item = CreateElement("li", "sheaf-chat-explorer-item");
      item.style.paddingLeft = depth * 12 + "px";

      const row = CreateElement("div", "sheaf-chat-explorer-row");
      const toggle = CreateElement(
        "button",
        "sheaf-chat-icon-button sheaf-chat-explorer-toggle"
      );
      toggle.type = "button";
      toggle.textContent = isExpanded ? "▾" : "▸";
      toggle.addEventListener("click", function (event) {
        event.stopPropagation();
        ToggleDirectory(cacheKey);
      });

      const label = CreateElement(
        "button",
        "sheaf-chat-explorer-directory"
      );
      label.type = "button";
      label.textContent = cacheKey === "." ? "." : BaseName(cacheKey);
      label.addEventListener("click", function () {
        ToggleDirectory(cacheKey);
      });

      row.appendChild(toggle);
      row.appendChild(label);
      item.appendChild(row);

      if (cached && cached.error) {
        const errorNode = CreateElement("div", "sheaf-chat-explorer-error");
        errorNode.textContent = cached.error;
        item.appendChild(errorNode);
      }

      parent.appendChild(item);

      if (!isExpanded || !cached || !Array.isArray(cached.entries)) {
        return;
      }

      const childList = CreateElement("ul", "sheaf-chat-explorer-list");
      item.appendChild(childList);

      for (const entry of cached.entries) {
        if (entry.kind === "directory") {
          RenderExplorerNode(childList, entry.path, depth + 1);
          continue;
        }

        const fileItem = CreateElement("li", "sheaf-chat-explorer-item");
        fileItem.style.paddingLeft = (depth + 1) * 12 + 12 + "px";
        const fileButton = CreateElement(
          "button",
          "sheaf-chat-explorer-file"
        );
        fileButton.type = "button";
        fileButton.textContent = entry.name;
        if (entry.supported === false) {
          fileButton.classList.add("sheaf-chat-explorer-file--unsupported");
        }
        fileButton.addEventListener("click", function () {
          OpenFile(entry.path).then(function () {
            if (touchLayout) {
              CloseMobilePanels();
            }
          });
        });
        fileItem.appendChild(fileButton);
        childList.appendChild(fileItem);
      }
    }

    function ToggleDirectory(directoryPath) {
      if (state.expandedDirectories.has(directoryPath)) {
        state.expandedDirectories.delete(directoryPath);
        RenderExplorer();
        ScheduleEditorStateSave();
        return;
      }

      state.expandedDirectories.add(directoryPath);
      LoadDirectory(directoryPath).then(function () {
        RenderExplorer();
        ScheduleEditorStateSave();
      });
    }

    function LoadDirectory(directoryPath) {
      const cacheKey = directoryPath || ".";
      const queryPath = cacheKey === "." ? "." : cacheKey;
      const url =
        FilesApiBase() +
        "/files?path=" +
        encodeURIComponent(queryPath);

      return FetchJson(url)
        .then(function (body) {
          state.directoryCache[cacheKey] = {
            entries: body.entries || [],
          };
        })
        .catch(function (error) {
          state.directoryCache[cacheKey] = {
            entries: [],
            error: error.message || "Failed to load directory",
          };
        });
    }

    function AppendTabButton(containerEl, tab, vertical) {
      const tabClass = vertical
        ? "sheaf-chat-tab sheaf-chat-mobile-tab"
        : "sheaf-chat-tab";
      const tabButton = CreateElement("button", tabClass);
      tabButton.type = "button";
      if (tab.path === state.selectedPath) {
        tabButton.classList.add("sheaf-chat-tab--selected");
      }
      if (tab.stale) {
        tabButton.classList.add("sheaf-chat-tab--stale");
      }

      const label = CreateElement("span", "sheaf-chat-tab-label");
      label.textContent = tab.name;
      tabButton.appendChild(label);

      const closeButton = CreateElement(
        "button",
        "sheaf-chat-tab-close"
      );
      closeButton.type = "button";
      closeButton.textContent = "×";
      closeButton.addEventListener("click", function (event) {
        event.stopPropagation();
        CloseTab(tab.path);
      });
      tabButton.appendChild(closeButton);

      tabButton.addEventListener("click", function () {
        SelectTab(tab.path);
        if (touchLayout) {
          CloseMobilePanels();
        }
      });

      containerEl.appendChild(tabButton);
    }

    function ScrollSelectedTabIntoView() {
      // Keep the active file's tab visible when the horizontal tab bar overflows.
      if (!tabBarEl) {
        return;
      }
      const selected = tabBarEl.querySelector(".sheaf-chat-tab--selected");
      if (selected && selected.scrollIntoView) {
        selected.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    }

    function RenderTabs() {
      if (tabBarEl) {
        tabBarEl.textContent = "";
        for (const tab of state.tabs) {
          AppendTabButton(tabBarEl, tab, false);
        }
      }

      if (mobileTabListEl) {
        mobileTabListEl.textContent = "";
        for (const tab of state.tabs) {
          AppendTabButton(mobileTabListEl, tab, true);
        }
      }

      ScrollSelectedTabIntoView();
      UpdateMobileTitle();
    }

    function RenderSelectedFile() {
      fileViewEl.textContent = "";
      const selected = state.selectedPath
        ? FindTab(state.selectedPath)
        : null;

      if (!selected) {
        if (fileNavigation) {
          fileNavigation.syncSelectedTab(null);
        }
        const empty = CreateElement("p", "sheaf-chat-file-empty");
        empty.textContent = "Open a file from the explorer.";
        fileViewEl.appendChild(empty);
        return;
      }

      if (selected.isLoading) {
        if (fileNavigation) {
          fileNavigation.syncSelectedTab(null);
        }
        const loading = CreateElement("p", "sheaf-chat-file-loading");
        loading.textContent = "Loading…";
        fileViewEl.appendChild(loading);
        return;
      }

      if (selected.error) {
        if (fileNavigation) {
          fileNavigation.syncSelectedTab(null);
        }
        const errorNode = CreateElement("div", "sheaf-chat-file-error");
        errorNode.textContent = selected.error;
        fileViewEl.appendChild(errorNode);
        return;
      }

      const contentWrap = CreateElement("div", "sheaf-file-view-content");
      const reviewState = state.agentReview.state;
      const currentHunk = reviewState ? CurrentReviewHunkForSelectedFile() : null;
      const inlineFile = reviewState ? InlineReviewFileForPath(selected.path) : null;

      if (inlineFile) {
        selected.renderDocument = null;
        RenderInlineReviewFile(contentWrap, inlineFile, currentHunk, selected);
        if (
          fileNavigation &&
          typeof fileNavigation.decorateRenderedReview === "function"
        ) {
          fileNavigation.decorateRenderedReview(contentWrap, selected);
        }
        fileViewEl.appendChild(contentWrap);
        ScrollPendingReviewHunk();
        return;
      }

      if (IsMarkdownContentType(selected.contentType, selected.path)) {
        selected.renderDocument = null;
        if (
          window.SheafMarkdown &&
          typeof window.SheafMarkdown.renderMarkdown === "function"
        ) {
          const rendered = window.SheafMarkdown.renderMarkdown(selected.content);
          if (rendered != null) {
            contentWrap.innerHTML = rendered;
            if (typeof window.SheafMarkdown.enhanceRenderedLinks === "function") {
              window.SheafMarkdown.enhanceRenderedLinks(contentWrap, {
                basePath: selected.path,
                onFileLink: function (targetPath, fragment) {
                  OpenFile(targetPath, { fragment: fragment });
                },
              });
            }
            if (
              fileNavigation &&
              typeof fileNavigation.decorateRenderedMarkdown === "function"
            ) {
              fileNavigation.decorateRenderedMarkdown(contentWrap, selected);
            }
          } else {
            contentWrap.appendChild(
              fileNavigation
                ? fileNavigation.renderPlainText(selected)
                : CreatePlainFilePreview(selected.content)
            );
          }
        } else {
          contentWrap.appendChild(
            fileNavigation
              ? fileNavigation.renderPlainText(selected)
              : CreatePlainFilePreview(selected.content)
          );
        }
      } else if (
        selected.contentType &&
        selected.contentType.indexOf("text/") === 0
      ) {
        const sourceRendering = window.SheafSourceRendering;
        const documentModel =
          sourceRendering &&
          typeof sourceRendering.buildPlainDocument === "function"
            ? sourceRendering.buildPlainDocument(selected.path, selected.content)
            : null;
        const language = HighlightLanguageForPath(selected.path);
        selected.renderDocument = documentModel;
        const rendered =
          documentModel &&
          sourceRendering &&
          typeof sourceRendering.renderDocument === "function"
            ? sourceRendering.renderDocument(documentModel, {
                language: language,
                highlighter: GetHighlighter(),
              })
            : null;
        const highlighted = rendered || (language
          ? CreateHighlightedFilePreview(selected.content, language)
          : null);
        if (
          highlighted &&
          fileNavigation &&
          typeof fileNavigation.decorateHighlightedPreview === "function"
        ) {
          fileNavigation.decorateHighlightedPreview(highlighted, selected);
        }
        contentWrap.appendChild(
          highlighted ||
            (fileNavigation
              ? fileNavigation.renderPlainText(selected)
              : CreatePlainFilePreview(selected.content))
        );
        if (
          highlighted &&
          fileNavigation &&
          typeof fileNavigation.renderPrompt === "function"
        ) {
          const prompt = fileNavigation.renderPrompt(selected);
          if (prompt) {
            contentWrap.appendChild(prompt);
          }
        }
      } else {
        selected.renderDocument = null;
        const unsupported = CreateElement("div", "sheaf-chat-file-unsupported");
        unsupported.textContent = "This file type is not supported for preview.";
        contentWrap.appendChild(unsupported);
      }

      fileViewEl.appendChild(contentWrap);

      if (selected.fragment) {
        ScrollToFragment(selected.fragment);
        selected.fragment = null;
      } else {
        RestoreSelectedViewport();
      }
    }

    function FetchTabContent(tab, options) {
      tab.isLoading = true;
      tab.error = null;
      RenderSelectedFile();

      const url =
        FilesApiBase() +
        "/file?path=" +
        encodeURIComponent(tab.path);

      return FetchJson(url)
        .then(function (body) {
          const file = body.file || {};
          tab.content = file.content != null ? String(file.content) : "";
          tab.contentType = file.contentType || tab.contentType;
          tab.name = file.name || tab.name;
          tab.isLoading = false;
          tab.error = null;
          tab.stale = false;
          if (options && options.fragment) {
            tab.fragment = options.fragment;
          }
          RenderTabs();
          if (state.selectedPath === tab.path) {
            RenderSelectedFile();
          }
        })
        .catch(function (error) {
          tab.isLoading = false;
          tab.error = error.message || "Failed to load file";
          tab.stale = false;
          RenderTabs();
          if (state.selectedPath === tab.path) {
            RenderSelectedFile();
          }
        });
    }

    function OpenFile(pathValue, options) {
      const normalized = NormalizeTabPath(pathValue);
      if (!normalized) {
        return Promise.resolve();
      }

      const existing = FindTab(normalized);
      if (existing) {
        return SelectTab(normalized, options);
      }

      const tab = {
        path: normalized,
        name: BaseName(normalized),
        content: "",
        contentType: "text/markdown",
        isLoading: true,
        error: null,
        stale: false,
        fragment: options && options.fragment ? options.fragment : null,
      };
      state.tabs.push(tab);
      state.selectedPath = normalized;
      state.agentReview.lastFocusKey = null;
      RenderTabs();
      RenderSelectedFile();
      SynchronizeReviewFocus();
      ScheduleEditorStateSave();
      return FetchTabContent(tab, options);
    }

    function SelectTab(pathValue, options) {
      const normalized = NormalizeTabPath(pathValue);
      if (!normalized) {
        return Promise.resolve();
      }

      const tab = FindTab(normalized);
      if (!tab) {
        return OpenFile(normalized, options);
      }

      CaptureSelectedViewport();
      state.selectedPath = normalized;
      state.agentReview.lastFocusKey = null;
      if (options && options.fragment) {
        tab.fragment = options.fragment;
      }

      RenderTabs();
      ScheduleEditorStateSave();

      if (tab.stale || tab.isLoading) {
        SynchronizeReviewFocus();
        return FetchTabContent(tab, options);
      }

      RenderSelectedFile();
      SynchronizeReviewFocus();
      return Promise.resolve();
    }

    function CloseTab(pathValue) {
      const normalized = NormalizeTabPath(pathValue);
      if (!normalized) {
        return;
      }

      const index = state.tabs.findIndex(function (tab) {
        return tab.path === normalized;
      });
      if (index < 0) {
        return;
      }

      state.tabs.splice(index, 1);
      if (state.selectedPath === normalized) {
        state.selectedPath =
          state.tabs.length > 0
            ? state.tabs[Math.max(0, index - 1)].path
            : null;
        state.agentReview.lastFocusKey = null;
      }
      RenderTabs();
      RenderSelectedFile();
      SynchronizeReviewFocus();
      ScheduleEditorStateSave();
    }

    function HandleFileChanged(payload) {
      const changedPath = NormalizeTabPath(
        payload && (payload.path || payload.fileId)
      );
      if (!changedPath) {
        return;
      }

      const tab = FindTab(changedPath);
      if (!tab) {
        return;
      }

      if (state.selectedPath === changedPath) {
        FetchTabContent(tab);
        return;
      }

      tab.stale = true;
      RenderTabs();
    }

    function DestroyFileWorkspace() {
      if (saveEditorStateTimer !== null) {
        clearTimeout(saveEditorStateTimer);
        saveEditorStateTimer = null;
      }
      if (fileNavigation) {
        fileNavigation.destroy();
      }
      StopAgentReview();
    }

    function StartResize(which, event) {
      if (activeResize) {
        return;
      }

      const startX =
        event.clientX != null ? event.clientX : event.pageX != null ? event.pageX : 0;
      const startExplorer = panelState.explorerWidth;
      const startChat = panelState.chatWidth;

      function OnMove(moveEvent) {
        const currentX =
          moveEvent.clientX != null
            ? moveEvent.clientX
            : moveEvent.pageX != null
              ? moveEvent.pageX
              : startX;
        const delta = currentX - startX;

        if (which === "explorer") {
          panelState.explorerWidth = Clamp(
            startExplorer + delta,
            x_MinExplorerWidth,
            x_MaxExplorerWidth
          );
        } else {
          panelState.chatWidth = Clamp(
            startChat - delta,
            x_MinChatWidth,
            x_MaxChatWidth
          );
        }
        ApplyPanelLayout();
      }

      function OnUp() {
        document.removeEventListener("mousemove", OnMove);
        document.removeEventListener("mouseup", OnUp);
        activeResize = null;
        WriteStoredNumber(x_ExplorerWidthKey, panelState.explorerWidth);
        WriteStoredNumber(x_ChatWidthKey, panelState.chatWidth);
      }

      activeResize = which;
      document.addEventListener("mousemove", OnMove);
      document.addEventListener("mouseup", OnUp);
      event.preventDefault();
    }

    function ToggleExplorerCollapsed() {
      panelState.explorerCollapsed = !panelState.explorerCollapsed;
      ApplyPanelLayout();
    }

    function ToggleChatCollapsed() {
      panelState.chatCollapsed = !panelState.chatCollapsed;
      ApplyPanelLayout();
    }

    ApplyPanelLayout();
    ApplyMobilePanelState();
    RenderExplorer();
    RenderTabs();
    RenderReviewBar();
    RenderSelectedFile();
    LoadDirectory(".").then(function () {
      RenderExplorer();
    });
    LoadEditorState();
    LoadAgentReviewAvailability();
    fileViewEl.addEventListener("scroll", function () {
      CaptureSelectedViewport();
      ScheduleEditorStateSave();
    });

    if (typeof onOpenFile === "function") {
      onOpenFile(OpenFile);
    }

    return {
      OpenFile: OpenFile,
      SelectTab: SelectTab,
      CloseTab: CloseTab,
      HandleFileChanged: HandleFileChanged,
      StartResize: StartResize,
      ToggleExplorerCollapsed: ToggleExplorerCollapsed,
      ToggleChatCollapsed: ToggleChatCollapsed,
      OpenMobilePanel: OpenMobilePanel,
      CloseMobilePanels: CloseMobilePanels,
      ToggleMobilePanel: ToggleMobilePanel,
      getPanelState: function () {
        return panelState;
      },
      getMobilePanelState: function () {
        return mobilePanelState;
      },
      getState: function () {
        return state;
      },
      StartAgentReview: StartAgentReview,
      StopAgentReview: StopAgentReview,
      destroy: DestroyFileWorkspace,
    };
  }

  // Single touch/mobile workspace editor mounted by repo+workspace. Mirrors the
  // desktop editor: the file pane and slide-in panels mount once, and the chat
  // panel owns a list <-> open sub-state via the shared chat-pane controller.
  function RenderWorkspaceEditorTouch(app, route) {
    app.textContent = "";
    const noop = function () {};
    if (!window.ChatView) {
      const missing = CreateElement("p", "sheaf-chat-error");
      missing.textContent = "Chat renderer failed to load.";
      app.appendChild(missing);
      return {
        repoId: route.repoId,
        workspaceId: route.workspaceId,
        applyRoute: noop,
        destroy: noop,
      };
    }

    app.classList.add("sheaf-chat-touch");
    app.classList.remove("sheaf-chat-desktop");

    const workspaceRoute = {
      screen: "workspace",
      repoId: route.repoId,
      workspaceId: route.workspaceId,
    };

    const screen = CreateElement("div", "sheaf-chat-screen sheaf-chat-chat-layout");
    const header = CreateElement("header", "sheaf-chat-header");
    const back = CreateElement("button", "sheaf-chat-back");
    back.type = "button";
    back.textContent = "Back";
    back.addEventListener("click", function () {
      NavigateTo({ screen: "workspaces", repoId: route.repoId });
    });
    header.appendChild(back);

    const title = CreateElement("h1", "sheaf-chat-header-title");
    title.textContent = "Workspace";
    header.appendChild(title);
    screen.appendChild(header);

    const workspace = CreateElement(
      "div",
      "sheaf-chat-workspace sheaf-chat-workspace--mobile"
    );

    const filePane = CreateElement("div", "sheaf-chat-file-pane");
    const mobileToolbar = CreateElement("div", "sheaf-chat-mobile-toolbar");

    const explorerToggle = CreateElement(
      "button",
      "sheaf-chat-icon-button sheaf-chat-mobile-toolbar-button sheaf-chat-mobile-toolbar-explorer"
    );
    explorerToggle.type = "button";
    explorerToggle.textContent = "☰";
    explorerToggle.setAttribute("aria-label", "Open explorer");

    const mobileFileTitle = CreateElement(
      "span",
      "sheaf-chat-mobile-file-title"
    );
    mobileFileTitle.textContent = "No file open";

    const tabsToggle = CreateElement(
      "button",
      "sheaf-chat-icon-button sheaf-chat-mobile-toolbar-button sheaf-chat-mobile-toolbar-tabs"
    );
    tabsToggle.type = "button";
    tabsToggle.textContent = "▤";
    tabsToggle.setAttribute("aria-label", "Open tabs");

    const chatToggle = CreateElement(
      "button",
      "sheaf-chat-icon-button sheaf-chat-mobile-toolbar-button sheaf-chat-mobile-toolbar-chat"
    );
    chatToggle.type = "button";
    chatToggle.textContent = "💬";
    chatToggle.setAttribute("aria-label", "Open chat");

    mobileToolbar.appendChild(explorerToggle);
    mobileToolbar.appendChild(mobileFileTitle);
    mobileToolbar.appendChild(tabsToggle);
    mobileToolbar.appendChild(chatToggle);

    const fileViewEl = CreateElement("div", "sheaf-chat-file-view");
    const reviewBarEl = CreateElement("div", "sheaf-chat-agent-review-bar");
    filePane.appendChild(mobileToolbar);
    filePane.appendChild(reviewBarEl);
    filePane.appendChild(fileViewEl);

    const mobileBackdrop = CreateElement("div", "sheaf-chat-mobile-backdrop");

    const explorerPane = CreateElement(
      "div",
      "sheaf-chat-mobile-panel sheaf-chat-mobile-panel--explorer"
    );
    const explorerHeader = CreateElement("div", "sheaf-chat-pane-header");
    const explorerTitle = CreateElement("span", "sheaf-chat-pane-title");
    explorerTitle.textContent = "Explorer";
    const explorerClose = CreateElement(
      "button",
      "sheaf-chat-icon-button sheaf-chat-mobile-panel-close"
    );
    explorerClose.type = "button";
    explorerClose.textContent = "×";
    explorerHeader.appendChild(explorerTitle);
    explorerHeader.appendChild(explorerClose);
    const explorerEl = CreateElement("div", "sheaf-chat-explorer-tree");
    explorerPane.appendChild(explorerHeader);
    explorerPane.appendChild(explorerEl);

    const tabsPane = CreateElement(
      "div",
      "sheaf-chat-mobile-panel sheaf-chat-mobile-panel--tabs"
    );
    const tabsHeader = CreateElement("div", "sheaf-chat-pane-header");
    const tabsTitle = CreateElement("span", "sheaf-chat-pane-title");
    tabsTitle.textContent = "Tabs";
    const tabsClose = CreateElement(
      "button",
      "sheaf-chat-icon-button sheaf-chat-mobile-panel-close"
    );
    tabsClose.type = "button";
    tabsClose.textContent = "×";
    tabsHeader.appendChild(tabsTitle);
    tabsHeader.appendChild(tabsClose);
    const mobileTabListEl = CreateElement("div", "sheaf-chat-mobile-tab-list");
    tabsPane.appendChild(tabsHeader);
    tabsPane.appendChild(mobileTabListEl);

    const chatPane = CreateElement(
      "div",
      "sheaf-chat-mobile-panel sheaf-chat-mobile-panel--chat"
    );
    const chatHeader = CreateElement("div", "sheaf-chat-pane-header");
    const chatTitle = CreateElement("span", "sheaf-chat-pane-title");
    chatTitle.textContent = "Chats";
    const chatClose = CreateElement(
      "button",
      "sheaf-chat-icon-button sheaf-chat-mobile-panel-close"
    );
    chatClose.type = "button";
    chatClose.textContent = "×";
    chatHeader.appendChild(chatTitle);
    chatHeader.appendChild(chatClose);
    const chatPaneBody = CreateElement("div", "sheaf-chat-chat-pane-body");
    chatPane.appendChild(chatHeader);
    chatPane.appendChild(chatPaneBody);

    workspace.appendChild(filePane);
    workspace.appendChild(mobileBackdrop);
    workspace.appendChild(explorerPane);
    workspace.appendChild(tabsPane);
    workspace.appendChild(chatPane);
    screen.appendChild(workspace);
    app.appendChild(screen);

    let openFileFn = null;
    const workspaceController = CreateFileWorkspace({
      route: workspaceRoute,
      explorerEl: explorerEl,
      tabBarEl: null,
      fileViewEl: fileViewEl,
      reviewBarEl: reviewBarEl,
      workspaceEl: workspace,
      explorerPane: explorerPane,
      chatPane: chatPane,
      touchLayout: true,
      mobileTabListEl: mobileTabListEl,
      mobileTitleEl: mobileFileTitle,
      mobileBackdropEl: mobileBackdrop,
      mobileTabsPane: tabsPane,
      onOpenFile: function (openFile) {
        openFileFn = openFile;
      },
    });

    explorerToggle.addEventListener("click", function () {
      workspaceController.ToggleMobilePanel("explorer");
    });
    tabsToggle.addEventListener("click", function () {
      workspaceController.ToggleMobilePanel("tabs");
    });
    chatToggle.addEventListener("click", function () {
      workspaceController.ToggleMobilePanel("chat");
    });
    explorerClose.addEventListener("click", function () {
      workspaceController.CloseMobilePanels();
    });
    tabsClose.addEventListener("click", function () {
      workspaceController.CloseMobilePanels();
    });
    chatClose.addEventListener("click", function () {
      workspaceController.CloseMobilePanels();
    });
    mobileBackdrop.addEventListener("click", function () {
      workspaceController.CloseMobilePanels();
    });

    const chatPaneController = CreateChatPaneController({
      route: route,
      workspaceRoute: workspaceRoute,
      body: chatPaneBody,
      titleEl: chatTitle,
      workspaceController: workspaceController,
      touchLayout: true,
      getOpenFile: function () {
        return openFileFn;
      },
    });

    chatPaneController.applyRoute(route);

    function DestroyWorkspaceEditor() {
      chatPaneController.destroy();
      workspaceController.destroy();
    }

    window.addEventListener(
      "pagehide",
      DestroyWorkspaceEditor,
      { once: true }
    );

    return {
      repoId: route.repoId,
      workspaceId: route.workspaceId,
      applyRoute: chatPaneController.applyRoute,
      destroy: DestroyWorkspaceEditor,
    };
  }

  // Owns the chat pane's list <-> open sub-state for a mounted workspace editor.
  // Shared by the desktop and touch editors; only the surrounding layout differs.
  // Opening or closing a chat swaps only the pane body (no editor re-mount).
  function CreateChatPaneController(config) {
    const route = config.route;
    const workspaceRoute = config.workspaceRoute;
    const body = config.body;
    const titleEl = config.titleEl;
    const workspaceController = config.workspaceController;
    const touchLayout = config.touchLayout === true;
    const getOpenFile = config.getOpenFile || function () { return null; };

    let currentSession = null;

    function DestroySession() {
      if (currentSession) {
        currentSession.destroy();
        currentSession = null;
      }
    }

    function ShowChatList() {
      DestroySession();
      titleEl.textContent = "Chats";
      body.textContent = "";

      const form = CreateElement("form", "sheaf-chat-form");
      const modelLabel = CreateElement("label", "sheaf-chat-label");
      modelLabel.textContent = "Model";
      modelLabel.htmlFor = "sheaf-chat-new-chat-model";
      const modelSelect = CreateElement("select", "sheaf-chat-select");
      modelSelect.id = "sheaf-chat-new-chat-model";
      const submit = CreateElement(
        "button",
        "sheaf-chat-icon-button sheaf-chat-button--primary"
      );
      submit.type = "submit";
      submit.textContent = "+";
      submit.title = "New chat";
      submit.setAttribute("aria-label", "New chat");
      form.appendChild(modelLabel);
      form.appendChild(modelSelect);
      form.appendChild(submit);
      body.appendChild(form);

      const list = CreateElement("ul", "sheaf-chat-list");
      body.appendChild(list);
      const errorNode = CreateElement("div", "sheaf-chat-error");
      body.appendChild(errorNode);

      function PopulateModels(models) {
        modelSelect.textContent = "";
        for (const model of models) {
          const option = document.createElement("option");
          option.value = model.provider + ":" + model.id;
          option.textContent =
            (model.displayName || model.id) +
            (model.available === false ? " (unavailable)" : "");
          option.disabled = model.available === false;
          modelSelect.appendChild(option);
        }
      }

      function RenderChats(chats) {
        list.textContent = "";
        if (!chats || chats.length === 0) {
          const empty = CreateElement("p", "sheaf-chat-empty");
          empty.textContent = "No chats in this workspace yet.";
          list.appendChild(empty);
          return;
        }

        for (const chat of chats) {
          const item = CreateElement("li", "sheaf-chat-list-item");
          const button = CreateElement("button", "sheaf-chat-list-button");
          button.type = "button";
          button.textContent = chat.chatName || chat.description || chat.chatId || "Chat";
          const meta = CreateElement("span", "sheaf-chat-list-meta");
          const model =
            chat.model && chat.model.id
              ? chat.model.provider + "/" + chat.model.id
              : "";
          meta.textContent =
            (model ? model : "") +
            (chat.updatedAt ? " · " + FormatTimestamp(chat.updatedAt) : "");
          button.appendChild(meta);
          button.addEventListener("click", function () {
            NavigateTo({
              screen: "chat",
              repoId: route.repoId,
              workspaceId: route.workspaceId,
              chatId: chat.chatId,
            });
          });
          item.appendChild(button);
          list.appendChild(item);
        }
      }

      form.addEventListener("submit", function (event) {
        event.preventDefault();
        errorNode.textContent = "";
        const selected = modelSelect.value.split(":");
        if (selected.length !== 2) {
          errorNode.textContent = "Select a model";
          return;
        }

        submit.disabled = true;
        FetchJson(WorkspaceApiBase(workspaceRoute) + "/chats", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: { provider: selected[0], id: selected[1] },
          }),
        })
          .then(function (created) {
            NavigateTo({
              screen: "chat",
              repoId: route.repoId,
              workspaceId: route.workspaceId,
              chatId: created.chatId,
            });
          })
          .catch(function (error) {
            errorNode.textContent = error.message || "Failed to create chat";
          })
          .finally(function () {
            submit.disabled = false;
          });
      });

      Promise.all([
        FetchJson("/api/models"),
        FetchJson(WorkspaceApiBase(workspaceRoute) + "/chats"),
      ])
        .then(function (results) {
          PopulateModels(results[0].models || []);
          RenderChats(results[1].chats || []);
        })
        .catch(function (error) {
          errorNode.textContent = error.message || "Failed to load workspace";
        });
    }

    function OpenChat(chatId) {
      DestroySession();
      titleEl.textContent = chatId;
      body.textContent = "";

      const chatRoute = {
        screen: "chat",
        repoId: route.repoId,
        workspaceId: route.workspaceId,
        chatId: chatId,
      };

      const paneTop = CreateElement("div", "sheaf-chat-chat-pane-top");
      const paneBack = CreateElement(
        "button",
        "sheaf-chat-back sheaf-chat-chat-pane-back"
      );
      paneBack.type = "button";
      paneBack.textContent = "Back";
      paneBack.title = "Back to chats";
      paneBack.setAttribute("aria-label", "Back to chats");
      paneBack.addEventListener("click", function () {
        NavigateTo(workspaceRoute);
      });
      const connectionLabel = CreateElement("span", "sheaf-chat-connection");
      connectionLabel.textContent = "Connecting…";
      const modelSelect = CreateElement("select", "sheaf-chat-model-select");
      paneTop.appendChild(paneBack);
      paneTop.appendChild(connectionLabel);
      paneTop.appendChild(modelSelect);
      body.appendChild(paneTop);

      const chatContainer = CreateElement("div", "sheaf-chat-chat-view");
      body.appendChild(chatContainer);

      const composer = CreateElement("div", "sheaf-chat-composer");
      const textarea = CreateElement("textarea", "sheaf-chat-textarea");
      textarea.rows = 1;
      textarea.placeholder = "Message the agent…";
      const sendButton = CreateElement(
        "button",
        "sheaf-chat-button sheaf-chat-button--primary sheaf-chat-send"
      );
      sendButton.type = "button";
      sendButton.textContent = "Send";
      composer.appendChild(textarea);
      composer.appendChild(sendButton);
      body.appendChild(composer);

      const session = CreateChatSessionController({
        route: chatRoute,
        touchLayout: touchLayout,
        title: titleEl,
        connectionLabel: connectionLabel,
        modelSelect: modelSelect,
        chatContainer: chatContainer,
        composer: composer,
        textarea: textarea,
        sendButton: sendButton,
        linkContext: {
          rootMode: "root",
          onFileLink: function (targetPath, fragment) {
            const openFile = getOpenFile();
            if (openFile) {
              openFile(targetPath, { fragment: fragment });
            }
          },
        },
      });
      session.setFileChangedHandler(workspaceController.HandleFileChanged);
      currentSession = session;
    }

    function ApplyRoute(nextRoute) {
      if (nextRoute && nextRoute.chatId) {
        OpenChat(nextRoute.chatId);
        return;
      }
      ShowChatList();
    }

    return {
      applyRoute: ApplyRoute,
      destroy: DestroySession,
    };
  }

  // Single desktop workspace editor mounted by repo+workspace. The explorer and
  // file panes mount once; the chat pane owns a list <-> open sub-state. Opening
  // or closing a chat swaps only the chat pane (no editor re-mount), the top-level
  // Back returns to the workspace picker, and a chat-pane Back returns to the list.
  function RenderWorkspaceEditorDesktop(app, route) {
    app.textContent = "";

    const noop = function () {};
    if (!window.ChatView) {
      const missing = CreateElement("p", "sheaf-chat-error");
      missing.textContent = "Chat renderer failed to load.";
      app.appendChild(missing);
      return {
        repoId: route.repoId,
        workspaceId: route.workspaceId,
        applyRoute: noop,
        destroy: noop,
      };
    }

    app.classList.add("sheaf-chat-desktop");
    app.classList.remove("sheaf-chat-touch");

    const workspaceRoute = {
      screen: "workspace",
      repoId: route.repoId,
      workspaceId: route.workspaceId,
    };

    const screen = CreateElement("div", "sheaf-chat-screen sheaf-chat-chat-layout");
    const header = CreateElement("header", "sheaf-chat-header");
    const back = CreateElement("button", "sheaf-chat-back");
    back.type = "button";
    back.textContent = "Back";
    back.addEventListener("click", function () {
      NavigateTo({ screen: "workspaces", repoId: route.repoId });
    });
    header.appendChild(back);
    const title = CreateElement("h1", "sheaf-chat-header-title");
    title.textContent = "Workspace";
    header.appendChild(title);
    screen.appendChild(header);

    const workspace = CreateElement("div", "sheaf-chat-workspace");

    const explorerPane = CreateElement("div", "sheaf-chat-explorer-pane");
    const explorerHeader = CreateElement("div", "sheaf-chat-pane-header");
    const explorerTitle = CreateElement("span", "sheaf-chat-pane-title");
    explorerTitle.textContent = "Explorer";
    const explorerCollapse = CreateElement(
      "button",
      "sheaf-chat-icon-button sheaf-chat-pane-collapse"
    );
    explorerCollapse.type = "button";
    explorerCollapse.textContent = "⟨";
    explorerHeader.appendChild(explorerTitle);
    explorerHeader.appendChild(explorerCollapse);
    const explorerEl = CreateElement("div", "sheaf-chat-explorer-tree");
    explorerPane.appendChild(explorerHeader);
    explorerPane.appendChild(explorerEl);

    const explorerResize = CreateElement(
      "div",
      "sheaf-chat-resize-handle sheaf-chat-resize-handle--explorer"
    );

    const filePane = CreateElement("div", "sheaf-chat-file-pane");
    const tabBarEl = CreateElement("div", "sheaf-chat-tab-bar");
    const reviewBarEl = CreateElement("div", "sheaf-chat-agent-review-bar");
    const fileViewEl = CreateElement("div", "sheaf-chat-file-view");
    filePane.appendChild(tabBarEl);
    filePane.appendChild(reviewBarEl);
    filePane.appendChild(fileViewEl);

    const chatResize = CreateElement(
      "div",
      "sheaf-chat-resize-handle sheaf-chat-resize-handle--chat"
    );

    const chatPane = CreateElement("div", "sheaf-chat-chat-pane");
    const chatHeader = CreateElement("div", "sheaf-chat-pane-header");
    const chatTitle = CreateElement("span", "sheaf-chat-pane-title");
    chatTitle.textContent = "Chats";
    const chatCollapse = CreateElement(
      "button",
      "sheaf-chat-icon-button sheaf-chat-pane-collapse"
    );
    chatCollapse.type = "button";
    chatCollapse.textContent = "⟩";
    chatHeader.appendChild(chatTitle);
    chatHeader.appendChild(chatCollapse);
    const chatPaneBody = CreateElement("div", "sheaf-chat-chat-pane-body");
    chatPane.appendChild(chatHeader);
    chatPane.appendChild(chatPaneBody);

    workspace.appendChild(explorerPane);
    workspace.appendChild(explorerResize);
    workspace.appendChild(filePane);
    workspace.appendChild(chatResize);
    workspace.appendChild(chatPane);
    screen.appendChild(workspace);
    app.appendChild(screen);

    let openFileFn = null;
    const workspaceController = CreateFileWorkspace({
      route: workspaceRoute,
      explorerEl: explorerEl,
      tabBarEl: tabBarEl,
      fileViewEl: fileViewEl,
      reviewBarEl: reviewBarEl,
      workspaceEl: workspace,
      explorerPane: explorerPane,
      chatPane: chatPane,
      onOpenFile: function (openFile) {
        openFileFn = openFile;
      },
    });

    function SyncCollapseButtons() {
      const explorerCollapsed = explorerPane.classList.contains(
        "sheaf-chat-explorer-pane--collapsed"
      );
      const chatCollapsed = chatPane.classList.contains(
        "sheaf-chat-chat-pane--collapsed"
      );
      explorerCollapse.textContent = explorerCollapsed ? "⟩" : "⟨";
      explorerCollapse.setAttribute(
        "aria-label",
        explorerCollapsed ? "Expand explorer" : "Collapse explorer"
      );
      explorerCollapse.title = explorerCollapsed ? "Expand explorer" : "Collapse explorer";
      chatCollapse.textContent = chatCollapsed ? "⟨" : "⟩";
      chatCollapse.setAttribute(
        "aria-label",
        chatCollapsed ? "Expand chat" : "Collapse chat"
      );
      chatCollapse.title = chatCollapsed ? "Expand chat" : "Collapse chat";
    }
    SyncCollapseButtons();

    explorerCollapse.addEventListener("click", function () {
      workspaceController.ToggleExplorerCollapsed();
      SyncCollapseButtons();
    });
    chatCollapse.addEventListener("click", function () {
      workspaceController.ToggleChatCollapsed();
      SyncCollapseButtons();
    });
    explorerResize.addEventListener("mousedown", function (event) {
      workspaceController.StartResize("explorer", event);
    });
    chatResize.addEventListener("mousedown", function (event) {
      workspaceController.StartResize("chat", event);
    });

    const chatPaneController = CreateChatPaneController({
      route: route,
      workspaceRoute: workspaceRoute,
      body: chatPaneBody,
      titleEl: chatTitle,
      workspaceController: workspaceController,
      touchLayout: false,
      getOpenFile: function () {
        return openFileFn;
      },
    });

    chatPaneController.applyRoute(route);

    function DestroyWorkspaceEditor() {
      chatPaneController.destroy();
      workspaceController.destroy();
    }

    window.addEventListener(
      "pagehide",
      DestroyWorkspaceEditor,
      { once: true }
    );

    return {
      repoId: route.repoId,
      workspaceId: route.workspaceId,
      applyRoute: chatPaneController.applyRoute,
      destroy: DestroyWorkspaceEditor,
    };
  }

  function Render(route) {
    const app = document.getElementById("app");
    if (!app) {
      return null;
    }

    if (route.screen === "repositories") {
      RenderRepositoriesScreen(app, route);
      return null;
    }

    if (route.screen === "workspaces") {
      RenderWorkspacesScreen(app, route);
      return null;
    }

    RenderRepositoriesScreen(app, route);
    return null;
  }

  function MountRoute(route) {
    const app = document.getElementById("app");
    if (!app) {
      return { kind: "other", destroy: function () {} };
    }

    const isEditorRoute = route.screen === "workspace" || route.screen === "chat";
    if (isEditorRoute) {
      const touch = IsTouchLayout();
      const editor = touch
        ? RenderWorkspaceEditorTouch(app, route)
        : RenderWorkspaceEditorDesktop(app, route);
      return {
        kind: "editor",
        touch: touch,
        repoId: editor.repoId,
        workspaceId: editor.workspaceId,
        applyRoute: editor.applyRoute,
        destroy: editor.destroy,
      };
    }

    const destroy = Render(route);
    return {
      kind: "other",
      destroy: typeof destroy === "function" ? destroy : function () {},
    };
  }

  function Boot() {
    let mounted = null;

    function OnRouteChange() {
      const route = ParseRoute();
      const isEditorRoute = route.screen === "workspace" || route.screen === "chat";

      if (
        mounted &&
        mounted.kind === "editor" &&
        isEditorRoute &&
        mounted.touch === IsTouchLayout() &&
        mounted.repoId === route.repoId &&
        mounted.workspaceId === route.workspaceId
      ) {
        // The same workspace editor is already mounted; update only the chat
        // pane in place so the explorer and file panes (and their server-restored
        // state) are not torn down and re-fetched.
        mounted.applyRoute(route);
        return;
      }

      if (mounted) {
        mounted.destroy();
        mounted = null;
      }
      mounted = MountRoute(route);
    }

    window.addEventListener("hashchange", OnRouteChange);
    window.addEventListener("popstate", OnRouteChange);
    OnRouteChange();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", Boot);
  } else {
    Boot();
  }

  const SheafChatApp = {
    _test: {
      parseRoute: ParseRoute,
      buildWebSocketUrl: BuildWebSocketUrl,
      createEnvelope: CreateEnvelope,
      isTouchLayout: IsTouchLayout,
    },
  };

  if (typeof globalThis !== "undefined") {
    globalThis.SheafChatApp = SheafChatApp;
  }
  if (typeof window !== "undefined") {
    window.SheafChatApp = SheafChatApp;
  }
})();
