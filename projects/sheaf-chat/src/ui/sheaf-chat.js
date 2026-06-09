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

  function RenderChatScreen(app, route) {
    app.textContent = "";
    if (!window.ChatView) {
      const missing = CreateElement("p", "sheaf-chat-error");
      missing.textContent = "Chat renderer failed to load.";
      app.appendChild(missing);
      return;
    }

    const touchLayout = IsTouchLayout();
    app.classList.toggle("sheaf-chat-touch", touchLayout);
    app.classList.toggle("sheaf-chat-desktop", !touchLayout);

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

    const chatMain = CreateElement("div", "sheaf-chat-chat-main");
    const chatContainer = CreateElement("div", "sheaf-chat-chat-view");
    chatMain.appendChild(chatContainer);
    screen.appendChild(chatMain);

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
    screen.appendChild(composer);
    app.appendChild(screen);

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

    chatHandle = window.ChatView.create(chatContainer, {
      onScrollNearTop: function () {
        if (historyLoading || !hasMoreBefore || oldestSequence == null) {
          return;
        }
        RequestHistory({ before: oldestSequence, limit: x_HistoryPageLimit });
      },
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

    window.addEventListener(
      "pagehide",
      function () {
        DestroyChat();
      },
      { once: true }
    );

    Connect();

    return DestroyChat;
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
