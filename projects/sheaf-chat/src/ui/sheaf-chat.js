/**
 * Sheaf Chat browser UI: piles, sessions, and interactive chat screens.
 */
(function () {
  "use strict";

  const x_ClientIdKey = "sheaf-chat-client-id";
  const x_DefaultRootDirectory = "projects";
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
      return { screen: "piles" };
    }

    if (parts[0] === "piles" && parts.length === 1) {
      return { screen: "piles" };
    }

    if (parts[0] === "piles" && parts.length === 2) {
      return { screen: "sessions", pile: decodeURIComponent(parts[1]) };
    }

    if (
      parts[0] === "piles" &&
      parts.length === 4 &&
      parts[2] === "sessions"
    ) {
      return {
        screen: "chat",
        pile: decodeURIComponent(parts[1]),
        sessionId: decodeURIComponent(parts[3]),
      };
    }

    return { screen: "piles" };
  }

  function NavigateTo(route) {
    if (route.screen === "piles") {
      window.location.hash = "#/";
      return;
    }

    if (route.screen === "sessions") {
      window.location.hash = "#/piles/" + encodeURIComponent(route.pile);
      return;
    }

    if (route.screen === "chat") {
      window.location.hash =
        "#/piles/" +
        encodeURIComponent(route.pile) +
        "/sessions/" +
        encodeURIComponent(route.sessionId);
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

  function RenderPilesScreen(app, route) {
    app.textContent = "";
    const shell = CreateScreenShell("Piles", null);
    app.appendChild(shell.screen);

    const list = CreateElement("ul", "sheaf-chat-list");
    shell.content.appendChild(list);

    const errorNode = CreateElement("div", "sheaf-chat-error");
    shell.content.appendChild(errorNode);

    const form = CreateElement("form", "sheaf-chat-form");
    const field = CreateElement("div", "sheaf-chat-field");
    const label = CreateElement("label", "sheaf-chat-label");
    label.textContent = "New pile name";
    label.htmlFor = "sheaf-chat-new-pile";
    const input = CreateElement("input", "sheaf-chat-input");
    input.id = "sheaf-chat-new-pile";
    input.name = "pile";
    input.required = true;
    input.autocomplete = "off";
    field.appendChild(label);
    field.appendChild(input);
    form.appendChild(field);

    const submit = CreateElement("button", "sheaf-chat-button sheaf-chat-button--primary");
    submit.type = "submit";
    submit.textContent = "Create pile";
    form.appendChild(submit);
    shell.screen.appendChild(form);

    function RenderPileRows(piles) {
      list.textContent = "";
      errorNode.textContent = "";

      if (!piles || piles.length === 0) {
        const empty = CreateElement("p", "sheaf-chat-empty");
        empty.textContent = "No piles yet. Create one below.";
        list.appendChild(empty);
        return;
      }

      for (const pile of piles) {
        const pileName = pile.pile || pile.name;
        const latestUpdatedAt = pile.latestUpdatedAt || pile.updatedAt;
        const item = CreateElement("li", "sheaf-chat-list-item");
        const button = CreateElement("button", "sheaf-chat-list-button");
        button.type = "button";
        button.textContent = pileName;
        const meta = CreateElement("span", "sheaf-chat-list-meta");
        meta.textContent =
          (pile.sessionCount != null ? pile.sessionCount : 0) +
          " sessions" +
          (latestUpdatedAt ? " · " + FormatTimestamp(latestUpdatedAt) : "");
        button.appendChild(meta);
        button.addEventListener("click", function () {
          NavigateTo({ screen: "sessions", pile: pileName });
        });
        item.appendChild(button);
        list.appendChild(item);
      }
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      errorNode.textContent = "";
      const pileName = input.value.trim();
      if (!pileName) {
        return;
      }

      submit.disabled = true;
      FetchJson("/api/piles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pile: pileName }),
      })
        .then(function () {
          input.value = "";
          return FetchJson("/api/piles");
        })
        .then(function (body) {
          RenderPileRows(body.piles || []);
        })
        .catch(function (error) {
          errorNode.textContent = error.message || "Failed to create pile";
        })
        .finally(function () {
          submit.disabled = false;
        });
    });

    FetchJson("/api/piles")
      .then(function (body) {
        RenderPileRows(body.piles || []);
      })
      .catch(function (error) {
        errorNode.textContent = error.message || "Failed to load piles";
      });
  }

  function RenderSessionsScreen(app, route) {
    app.textContent = "";
    const shell = CreateScreenShell(route.pile, function () {
      NavigateTo({ screen: "piles" });
    });
    app.appendChild(shell.screen);

    const list = CreateElement("ul", "sheaf-chat-list");
    shell.content.appendChild(list);
    const errorNode = CreateElement("div", "sheaf-chat-error");
    shell.content.appendChild(errorNode);

    const form = CreateElement("form", "sheaf-chat-form");
    const rootField = CreateElement("div", "sheaf-chat-field");
    const rootLabel = CreateElement("label", "sheaf-chat-label");
    rootLabel.textContent = "Root directory";
    rootLabel.htmlFor = "sheaf-chat-root-directory";
    const rootInput = CreateElement("input", "sheaf-chat-input");
    rootInput.id = "sheaf-chat-root-directory";
    rootInput.name = "rootDirectory";
    rootInput.required = true;
    rootInput.value = x_DefaultRootDirectory;
    rootField.appendChild(rootLabel);
    rootField.appendChild(rootInput);

    const modelField = CreateElement("div", "sheaf-chat-field");
    const modelLabel = CreateElement("label", "sheaf-chat-label");
    modelLabel.textContent = "Model";
    modelLabel.htmlFor = "sheaf-chat-new-session-model";
    const modelSelect = CreateElement("select", "sheaf-chat-select");
    modelSelect.id = "sheaf-chat-new-session-model";
    modelSelect.name = "model";
    modelSelect.required = true;
    modelField.appendChild(modelLabel);
    modelField.appendChild(modelSelect);

    form.appendChild(rootField);
    form.appendChild(modelField);

    const submit = CreateElement("button", "sheaf-chat-button sheaf-chat-button--primary");
    submit.type = "submit";
    submit.textContent = "New session";
    form.appendChild(submit);
    shell.screen.appendChild(form);

    let models = [];

    function RenderSessionRows(sessions) {
      list.textContent = "";
      if (!sessions || sessions.length === 0) {
        const empty = CreateElement("p", "sheaf-chat-empty");
        empty.textContent = "No sessions in this pile yet.";
        list.appendChild(empty);
        return;
      }

      for (const session of sessions) {
        const item = CreateElement("li", "sheaf-chat-list-item");
        const button = CreateElement("button", "sheaf-chat-list-button");
        button.type = "button";
        const title =
          session.chatName ||
          session.description ||
          session.sessionId ||
          "Session";
        button.textContent = title;
        const meta = CreateElement("span", "sheaf-chat-list-meta");
        const model =
          session.model && session.model.id
            ? session.model.provider + "/" + session.model.id
            : "";
        meta.textContent =
          (session.rootDirectory || "") +
          (model ? " · " + model : "") +
          (session.updatedAt ? " · " + FormatTimestamp(session.updatedAt) : "");
        button.appendChild(meta);
        button.addEventListener("click", function () {
          NavigateTo({
            screen: "chat",
            pile: route.pile,
            sessionId: session.sessionId,
          });
        });
        item.appendChild(button);
        list.appendChild(item);
      }
    }

    function PopulateModelSelect() {
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

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      errorNode.textContent = "";
      const selected = modelSelect.value.split(":");
      if (selected.length !== 2) {
        errorNode.textContent = "Select a model";
        return;
      }

      submit.disabled = true;
      FetchJson("/api/piles/" + encodeURIComponent(route.pile) + "/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rootDirectory: rootInput.value.trim(),
          model: { provider: selected[0], id: selected[1] },
        }),
      })
        .then(function (body) {
          NavigateTo({
            screen: "chat",
            pile: route.pile,
            sessionId: body.sessionId,
          });
        })
        .catch(function (error) {
          errorNode.textContent = error.message || "Failed to create session";
        })
        .finally(function () {
          submit.disabled = false;
        });
    });

    Promise.all([
      FetchJson("/api/models"),
      FetchJson("/api/piles/" + encodeURIComponent(route.pile) + "/sessions"),
    ])
      .then(function (results) {
        models = results[0].models || [];
        PopulateModelSelect();
        RenderSessionRows(results[1].sessions || []);
      })
      .catch(function (error) {
        errorNode.textContent = error.message || "Failed to load sessions";
      });
  }

  function BuildWebSocketUrl(pile, sessionId, after) {
    const params = new URLSearchParams();
    params.set("p", pile);
    params.set("session", sessionId);
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

  function CreateEnvelope(kind, pile, sessionId, payload) {
    return {
      v: 1,
      kind: kind,
      id: GenerateId(),
      pile: pile,
      sessionId: sessionId,
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
        CreateEnvelope("client.ack", route.pile, route.sessionId, {
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
        route.pile,
        route.sessionId,
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
        const messageId = payload.messageId || GenerateId();
        if (chatHandle) {
          window.ChatView.appendAguiEvent(chatHandle, {
            type: "TEXT_MESSAGE_START",
            messageId: messageId,
            role: "user",
          });
          window.ChatView.appendAguiEvent(chatHandle, {
            type: "TEXT_MESSAGE_CONTENT",
            messageId: messageId,
            delta: payload.text != null ? String(payload.text) : "",
          });
          window.ChatView.appendAguiEvent(chatHandle, {
            type: "TEXT_MESSAGE_END",
            messageId: messageId,
          });
        }
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

      const wsUrl = BuildWebSocketUrl(route.pile, route.sessionId, lastSequence);
      socket = new WebSocket(wsUrl);

      socket.addEventListener("open", function () {
        connected = true;
        UpdateComposerState();
        UpdateStatusText();
        FlushQueue();
        SendEnvelope(
          CreateEnvelope("client.hello", route.pile, route.sessionId, {
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
      QueueOrSend(
        CreateEnvelope("client.user_message", route.pile, route.sessionId, {
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
        CreateEnvelope("client.model_select", route.pile, route.sessionId, {
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
      directoryCache: {},
      expandedDirectories: new Set(["."]),
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

    function FilesApiBase() {
      return (
        "/api/piles/" +
        encodeURIComponent(route.pile) +
        "/sessions/" +
        encodeURIComponent(route.sessionId)
      );
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
        return;
      }

      state.expandedDirectories.add(directoryPath);
      LoadDirectory(directoryPath).then(function () {
        RenderExplorer();
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

      UpdateMobileTitle();
    }

    function RenderSelectedFile() {
      fileViewEl.textContent = "";
      const selected = state.selectedPath
        ? FindTab(state.selectedPath)
        : null;

      if (!selected) {
        const empty = CreateElement("p", "sheaf-chat-file-empty");
        empty.textContent = "Open a file from the explorer.";
        fileViewEl.appendChild(empty);
        return;
      }

      if (selected.isLoading) {
        const loading = CreateElement("p", "sheaf-chat-file-loading");
        loading.textContent = "Loading…";
        fileViewEl.appendChild(loading);
        return;
      }

      if (selected.error) {
        const errorNode = CreateElement("div", "sheaf-chat-file-error");
        errorNode.textContent = selected.error;
        fileViewEl.appendChild(errorNode);
        return;
      }

      const contentWrap = CreateElement("div", "sheaf-file-view-content");

      if (IsMarkdownContentType(selected.contentType, selected.path)) {
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
          } else {
            const fallback = CreateElement("pre", "sheaf-chat-file-plain");
            fallback.textContent = selected.content;
            contentWrap.appendChild(fallback);
          }
        } else {
          const fallback = CreateElement("pre", "sheaf-chat-file-plain");
          fallback.textContent = selected.content;
          contentWrap.appendChild(fallback);
        }
      } else if (
        selected.contentType &&
        selected.contentType.indexOf("text/") === 0
      ) {
        const plain = CreateElement("pre", "sheaf-chat-file-plain");
        plain.textContent = selected.content;
        contentWrap.appendChild(plain);
      } else {
        const unsupported = CreateElement("div", "sheaf-chat-file-unsupported");
        unsupported.textContent = "This file type is not supported for preview.";
        contentWrap.appendChild(unsupported);
      }

      fileViewEl.appendChild(contentWrap);

      if (selected.fragment) {
        ScrollToFragment(selected.fragment);
        selected.fragment = null;
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
      RenderTabs();
      RenderSelectedFile();
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

      state.selectedPath = normalized;
      if (options && options.fragment) {
        tab.fragment = options.fragment;
      }

      RenderTabs();

      if (tab.stale || tab.isLoading) {
        return FetchTabContent(tab, options);
      }

      RenderSelectedFile();
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
      }
      RenderTabs();
      RenderSelectedFile();
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
    RenderSelectedFile();
    LoadDirectory(".").then(function () {
      RenderExplorer();
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
    };
  }

  function RenderTouchChatScreen(app, route) {
    app.textContent = "";
    if (!window.ChatView) {
      const missing = CreateElement("p", "sheaf-chat-error");
      missing.textContent = "Chat renderer failed to load.";
      app.appendChild(missing);
      return null;
    }

    app.classList.add("sheaf-chat-touch");
    app.classList.remove("sheaf-chat-desktop");

    const screen = CreateElement("div", "sheaf-chat-screen sheaf-chat-chat-layout");
    const header = CreateElement("header", "sheaf-chat-header");
    const back = CreateElement("button", "sheaf-chat-back");
    back.type = "button";
    back.textContent = "Back";
    back.addEventListener("click", function () {
      NavigateTo({ screen: "sessions", pile: route.pile });
    });
    header.appendChild(back);

    const title = CreateElement("h1", "sheaf-chat-header-title");
    title.textContent = route.sessionId;
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
    filePane.appendChild(mobileToolbar);
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
    chatTitle.textContent = "Chat";
    const chatClose = CreateElement(
      "button",
      "sheaf-chat-icon-button sheaf-chat-mobile-panel-close"
    );
    chatClose.type = "button";
    chatClose.textContent = "×";
    chatHeader.appendChild(chatTitle);
    chatHeader.appendChild(chatClose);

    const statusRow = CreateElement("div", "sheaf-chat-chat-status");
    const connectionLabel = CreateElement("span");
    connectionLabel.textContent = "Connecting…";
    statusRow.appendChild(connectionLabel);

    const modelSelect = CreateElement("select", "sheaf-chat-model-select");
    statusRow.appendChild(modelSelect);

    const chatMain = CreateElement("div", "sheaf-chat-chat-main");
    const chatContainer = CreateElement("div", "sheaf-chat-chat-view");
    chatMain.appendChild(chatContainer);

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

    chatPane.appendChild(chatHeader);
    chatPane.appendChild(statusRow);
    chatPane.appendChild(chatMain);
    chatPane.appendChild(composer);

    workspace.appendChild(filePane);
    workspace.appendChild(mobileBackdrop);
    workspace.appendChild(explorerPane);
    workspace.appendChild(tabsPane);
    workspace.appendChild(chatPane);
    screen.appendChild(workspace);
    app.appendChild(screen);

    let openFileFn = null;

    const session = CreateChatSessionController({
      route: route,
      touchLayout: true,
      title: title,
      connectionLabel: connectionLabel,
      modelSelect: modelSelect,
      chatContainer: chatContainer,
      composer: composer,
      textarea: textarea,
      sendButton: sendButton,
      linkContext: {
        rootMode: "root",
        onFileLink: function (targetPath, fragment) {
          if (openFileFn) {
            openFileFn(targetPath, { fragment: fragment });
          }
        },
      },
    });

    const workspaceController = CreateFileWorkspace({
      route: route,
      explorerEl: explorerEl,
      tabBarEl: null,
      fileViewEl: fileViewEl,
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

    session.setFileChangedHandler(workspaceController.HandleFileChanged);

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

    window.addEventListener(
      "pagehide",
      function () {
        session.destroy();
      },
      { once: true }
    );

    return session.destroy;
  }

  function RenderDesktopChatScreen(app, route) {
    app.textContent = "";
    if (!window.ChatView) {
      const missing = CreateElement("p", "sheaf-chat-error");
      missing.textContent = "Chat renderer failed to load.";
      app.appendChild(missing);
      return null;
    }

    app.classList.add("sheaf-chat-desktop");
    app.classList.remove("sheaf-chat-touch");

    const screen = CreateElement("div", "sheaf-chat-screen sheaf-chat-chat-layout");
    const header = CreateElement("header", "sheaf-chat-header");
    const back = CreateElement("button", "sheaf-chat-back");
    back.type = "button";
    back.textContent = "Back";
    back.addEventListener("click", function () {
      NavigateTo({ screen: "sessions", pile: route.pile });
    });
    header.appendChild(back);

    const title = CreateElement("h1", "sheaf-chat-header-title");
    title.textContent = route.sessionId;
    header.appendChild(title);
    screen.appendChild(header);

    const statusRow = CreateElement("div", "sheaf-chat-chat-status");
    const connectionLabel = CreateElement("span");
    connectionLabel.textContent = "Connecting…";
    statusRow.appendChild(connectionLabel);

    const modelSelect = CreateElement("select", "sheaf-chat-model-select");
    statusRow.appendChild(modelSelect);
    screen.appendChild(statusRow);

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
    const fileViewEl = CreateElement("div", "sheaf-chat-file-view");
    filePane.appendChild(tabBarEl);
    filePane.appendChild(fileViewEl);

    const chatResize = CreateElement(
      "div",
      "sheaf-chat-resize-handle sheaf-chat-resize-handle--chat"
    );

    const chatPane = CreateElement("div", "sheaf-chat-chat-pane");
    const chatHeader = CreateElement("div", "sheaf-chat-pane-header");
    const chatTitle = CreateElement("span", "sheaf-chat-pane-title");
    chatTitle.textContent = "Chat";
    const chatCollapse = CreateElement(
      "button",
      "sheaf-chat-icon-button sheaf-chat-pane-collapse"
    );
    chatCollapse.type = "button";
    chatCollapse.textContent = "⟩";
    chatHeader.appendChild(chatTitle);
    chatHeader.appendChild(chatCollapse);

    const chatMain = CreateElement("div", "sheaf-chat-chat-main");
    const chatContainer = CreateElement("div", "sheaf-chat-chat-view");
    chatMain.appendChild(chatContainer);

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

    chatPane.appendChild(chatHeader);
    chatPane.appendChild(chatMain);
    chatPane.appendChild(composer);

    workspace.appendChild(explorerPane);
    workspace.appendChild(explorerResize);
    workspace.appendChild(filePane);
    workspace.appendChild(chatResize);
    workspace.appendChild(chatPane);
    screen.appendChild(workspace);
    app.appendChild(screen);

    let openFileFn = null;

    const session = CreateChatSessionController({
      route: route,
      touchLayout: false,
      title: title,
      connectionLabel: connectionLabel,
      modelSelect: modelSelect,
      chatContainer: chatContainer,
      composer: composer,
      textarea: textarea,
      sendButton: sendButton,
      linkContext: {
        rootMode: "root",
        onFileLink: function (targetPath, fragment) {
          if (openFileFn) {
            openFileFn(targetPath, { fragment: fragment });
          }
        },
      },
    });

    const workspaceController = CreateFileWorkspace({
      route: route,
      explorerEl: explorerEl,
      tabBarEl: tabBarEl,
      fileViewEl: fileViewEl,
      workspaceEl: workspace,
      explorerPane: explorerPane,
      chatPane: chatPane,
      onOpenFile: function (openFile) {
        openFileFn = openFile;
      },
    });

    session.setFileChangedHandler(workspaceController.HandleFileChanged);

    explorerCollapse.addEventListener("click", function () {
      workspaceController.ToggleExplorerCollapsed();
    });
    chatCollapse.addEventListener("click", function () {
      workspaceController.ToggleChatCollapsed();
    });

    explorerResize.addEventListener("mousedown", function (event) {
      workspaceController.StartResize("explorer", event);
    });
    chatResize.addEventListener("mousedown", function (event) {
      workspaceController.StartResize("chat", event);
    });

    window.addEventListener(
      "pagehide",
      function () {
        session.destroy();
      },
      { once: true }
    );

    return session.destroy;
  }

  function RenderChatScreen(app, route) {
    if (IsTouchLayout()) {
      return RenderTouchChatScreen(app, route);
    }

    return RenderDesktopChatScreen(app, route);
  }

  function Render(route) {
    const app = document.getElementById("app");
    if (!app) {
      return null;
    }

    if (route.screen === "piles") {
      RenderPilesScreen(app, route);
      return null;
    }

    if (route.screen === "sessions") {
      RenderSessionsScreen(app, route);
      return null;
    }

    if (route.screen === "chat") {
      return RenderChatScreen(app, route);
    }

    RenderPilesScreen(app, route);
    return null;
  }

  function Boot() {
    let destroyChat = null;

    function OnRouteChange() {
      if (destroyChat) {
        destroyChat();
        destroyChat = null;
      }
      const route = ParseRoute();
      destroyChat = Render(route);
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
