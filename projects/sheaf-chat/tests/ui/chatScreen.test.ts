import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const x_packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const x_sheafChatJsPath = path.join(x_packageRoot, "src", "ui", "sheaf-chat.js");
const x_aguiChatJsPath = path.resolve(x_packageRoot, "..", "web", "src", "agui-chat.js");

type Listener = (event: Record<string, unknown>) => void;

class FakeElement
{
  public readonly tagName: string;
  public readonly nodeName: string;
  public className = "";
  public readonly dataset: Record<string, string> = {};
  public readonly style: Record<string, string> = {};
  public readonly children: FakeElement[] = [];
  public parentNode: FakeElement | null = null;
  public type = "";
  public id = "";
  public name = "";
  public value = "";
  public required = false;
  public autocomplete = "";
  public htmlFor = "";
  public rows = 0;
  public placeholder = "";
  public disabled = false;
  public selected = false;
  public scrollHeight = 0;
  public scrollTop = 0;
  public clientHeight = 0;
  private x_textContent = "";
  private x_innerHTML = "";
  private readonly x_listeners: Record<string, Listener[]> = {};

  public readonly classList = {
    add: (...names: string[]): void => {
      const existing = this.x_ClassNames();
      for (const name of names) {
        if (!existing.includes(name)) {
          existing.push(name);
        }
      }
      this.className = existing.join(" ");
    },
    remove: (...names: string[]): void => {
      this.className = this.x_ClassNames()
        .filter((name) => !names.includes(name))
        .join(" ");
    },
    contains: (name: string): boolean => this.x_ClassNames().includes(name),
    toggle: (name: string, force?: boolean): boolean => {
      const shouldAdd = force == null ? !this.classList.contains(name) : force;
      if (shouldAdd) {
        this.classList.add(name);
      } else {
        this.classList.remove(name);
      }
      return shouldAdd;
    },
  };

  public constructor(tagName: string, className?: string)
  {
    this.tagName = tagName.toUpperCase();
    this.nodeName = this.tagName;
    this.className = className || "";
  }

  public get childNodes(): FakeElement[]
  {
    return this.children;
  }

  public get textContent(): string
  {
    if (this.children.length > 0) {
      return this.children.map((child) => child.textContent).join("");
    }
    return this.x_textContent;
  }

  public set textContent(value: string)
  {
    for (const child of this.children) {
      child.parentNode = null;
    }
    this.children.length = 0;
    this.x_textContent = value != null ? String(value) : "";
    this.x_innerHTML = "";
  }

  public get innerHTML(): string
  {
    return this.x_innerHTML;
  }

  public set innerHTML(value: string)
  {
    for (const child of this.children) {
      child.parentNode = null;
    }
    this.children.length = 0;
    this.x_innerHTML = value != null ? String(value) : "";
    this.x_textContent = this.x_innerHTML.replace(/<[^>]*>/g, "");
  }

  public appendChild(child: FakeElement): FakeElement
  {
    if (child.parentNode) {
      child.parentNode.removeChild(child);
    }
    child.parentNode = this;
    this.children.push(child);

    if (this.tagName === "SELECT" && child.tagName === "OPTION") {
      if (child.selected || this.value === "") {
        this.value = child.value;
      }
    }

    if (this.classList.contains("agui-chat-transcript")) {
      this.scrollHeight = Math.max(this.scrollHeight, this.children.length * 500);
    }

    return child;
  }

  public removeChild(child: FakeElement): FakeElement
  {
    const index = this.children.indexOf(child);
    if (index >= 0) {
      this.children.splice(index, 1);
      child.parentNode = null;
    }
    return child;
  }

  public addEventListener(type: string, handler: Listener): void
  {
    this.x_listeners[type] = this.x_listeners[type] || [];
    this.x_listeners[type].push(handler);
  }

  public removeEventListener(type: string, handler?: Listener): void
  {
    if (!handler) {
      delete this.x_listeners[type];
      return;
    }
    this.x_listeners[type] = (this.x_listeners[type] || []).filter(
      (entry) => entry !== handler,
    );
  }

  public dispatchEvent(event: Record<string, unknown>): boolean
  {
    const type = String(event.type || "");
    for (const handler of this.x_listeners[type] || []) {
      handler(event);
    }
    return true;
  }

  public click(): void
  {
    this.dispatchEvent({ type: "click" });
  }

  public querySelector(selector: string): FakeElement | null
  {
    return this.querySelectorAll(selector)[0] || null;
  }

  public querySelectorAll(selector: string): FakeElement[]
  {
    const results: FakeElement[] = [];
    const matcher = this.x_CreateMatcher(selector);
    const stack = [...this.children];
    while (stack.length > 0) {
      const node = stack.shift();
      if (!node) {
        continue;
      }
      if (matcher(node)) {
        results.push(node);
      }
      stack.push(...node.children);
    }
    return results;
  }

  private x_ClassNames(): string[]
  {
    return this.className.split(/\s+/).filter(Boolean);
  }

  private x_CreateMatcher(selector: string): (node: FakeElement) => boolean
  {
    if (selector.startsWith(".")) {
      const className = selector.slice(1);
      return (node: FakeElement) => node.x_ClassNames().includes(className);
    }
    const tagName = selector.toUpperCase();
    return (node: FakeElement) => node.tagName === tagName;
  }
}

class FakeDocument
{
  public readyState = "complete";
  public readonly app = new FakeElement("div");
  private readonly x_listeners: Record<string, Listener[]> = {};

  public constructor()
  {
    this.app.id = "app";
  }

  public createElement(tagName: string): FakeElement
  {
    return new FakeElement(tagName);
  }

  public getElementById(id: string): FakeElement | null
  {
    return id === "app" ? this.app : null;
  }

  public addEventListener(type: string, handler: Listener): void
  {
    this.x_listeners[type] = this.x_listeners[type] || [];
    this.x_listeners[type].push(handler);
  }
}

class FakeWebSocket
{
  public static readonly CONNECTING = 0;
  public static readonly OPEN = 1;
  public static readonly CLOSING = 2;
  public static readonly CLOSED = 3;
  public static instances: FakeWebSocket[] = [];

  public readonly url: string;
  public readyState = FakeWebSocket.CONNECTING;
  public readonly sent: string[] = [];
  private readonly x_listeners: Record<string, Listener[]> = {};

  public constructor(url: string)
  {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  public addEventListener(type: string, handler: Listener): void
  {
    this.x_listeners[type] = this.x_listeners[type] || [];
    this.x_listeners[type].push(handler);
  }

  public removeEventListener(type: string, handler?: Listener): void
  {
    if (!handler) {
      delete this.x_listeners[type];
      return;
    }
    this.x_listeners[type] = (this.x_listeners[type] || []).filter(
      (entry) => entry !== handler,
    );
  }

  public send(data: string): void
  {
    this.sent.push(data);
  }

  public open(): void
  {
    this.readyState = FakeWebSocket.OPEN;
    this.x_Dispatch("open", {});
  }

  public receive(envelope: unknown): void
  {
    this.x_Dispatch("message", { data: JSON.stringify(envelope) });
  }

  public close(): void
  {
    this.readyState = FakeWebSocket.CLOSED;
    this.x_Dispatch("close", {});
  }

  private x_Dispatch(type: string, event: Record<string, unknown>): void
  {
    for (const handler of this.x_listeners[type] || []) {
      handler(event);
    }
  }
}

interface ChatHarness
{
  app: FakeElement;
  sockets: FakeWebSocket[];
  handles: any[];
  flushAnimationFrames: () => void;
  runTimers: () => void;
}

function LoadChatHarness(options?: { touch?: boolean }): ChatHarness
{
  const document = new FakeDocument();
  const pendingFrames: Array<(() => void) | null> = [];
  const pendingTimers: Array<(() => void) | null> = [];
  const windowListeners: Record<string, Listener[]> = {};
  let idCounter = 0;

  FakeWebSocket.instances = [];

  const context: Record<string, any> = {
    console,
    URLSearchParams,
    WebSocket: FakeWebSocket,
    document,
    location: {
      hash: "#/piles/default/sessions/sess-1",
      protocol: "http:",
      host: "127.0.0.1:9004",
    },
    localStorage: {
      getItem: () => null,
      setItem: () => undefined,
    },
    crypto: {
      randomUUID: () => {
        idCounter += 1;
        return "test-id-" + idCounter;
      },
    },
    matchMedia: () => ({ matches: options?.touch === true }),
    requestAnimationFrame: (callback: () => void): number => {
      pendingFrames.push(callback);
      return pendingFrames.length;
    },
    cancelAnimationFrame: (id: number): void => {
      pendingFrames[id - 1] = null;
    },
    setTimeout: (callback: () => void): number => {
      pendingTimers.push(callback);
      return pendingTimers.length;
    },
    clearTimeout: (id: number): void => {
      pendingTimers[id - 1] = null;
    },
    addEventListener: (type: string, handler: Listener): void => {
      windowListeners[type] = windowListeners[type] || [];
      windowListeners[type].push(handler);
    },
    removeEventListener: (type: string, handler: Listener): void => {
      windowListeners[type] = (windowListeners[type] || []).filter(
        (entry) => entry !== handler,
      );
    },
  };
  context.window = context;
  context.globalThis = context;
  if (options?.touch === true) {
    context.ontouchstart = null;
  }

  vm.createContext(context);
  vm.runInContext(fs.readFileSync(x_aguiChatJsPath, "utf8"), context);

  const handles: any[] = [];
  const originalCreate = context.ChatView.create;
  context.ChatView.create = function (...args: unknown[]): unknown {
    const handle = originalCreate.apply(context.ChatView, args);
    handles.push(handle);
    return handle;
  };

  vm.runInContext(fs.readFileSync(x_sheafChatJsPath, "utf8"), context);

  return {
    app: document.app,
    sockets: FakeWebSocket.instances,
    handles,
    flushAnimationFrames: () => {
      while (pendingFrames.length > 0) {
        const callback = pendingFrames.shift();
        if (callback) {
          callback();
        }
      }
    },
    runTimers: () => {
      while (pendingTimers.length > 0) {
        const callback = pendingTimers.shift();
        if (callback) {
          callback();
        }
      }
    },
  };
}

function Frames(socket: FakeWebSocket, kind?: string): Array<Record<string, any>>
{
  const frames = socket.sent.map((data) => JSON.parse(data) as Record<string, any>);
  return kind ? frames.filter((frame) => frame.kind === kind) : frames;
}

function LastFrame(socket: FakeWebSocket, kind: string): Record<string, any>
{
  const frames = Frames(socket, kind);
  assert.ok(frames.length > 0, "expected at least one " + kind + " frame");
  return frames[frames.length - 1];
}

function ServerEnvelope(
  kind: string,
  payload: unknown,
  sequence?: number,
): Record<string, unknown>
{
  const envelope: Record<string, unknown> = {
    v: 1,
    id: "server-" + kind + "-" + String(sequence || "unsequenced"),
    kind,
    pile: "default",
    sessionId: "sess-1",
    timestamp: "2026-06-08T00:00:00.000Z",
    payload,
  };
  if (sequence != null) {
    envelope.sequence = sequence;
  }
  return envelope;
}

function RequiredElement(root: FakeElement, selector: string): FakeElement
{
  const element = root.querySelector(selector);
  assert.ok(element, "expected " + selector + " to exist");
  return element;
}

function KeyDown(element: FakeElement, key: string, shiftKey = false): Record<string, any>
{
  const event: Record<string, any> = {
    type: "keydown",
    key,
    shiftKey,
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
  };
  element.dispatchEvent(event);
  return event;
}

test("chat send waits for server broadcast and dual user paths render once", () =>
{
  const harness = LoadChatHarness();
  const socket = harness.sockets[0];
  const textarea = RequiredElement(harness.app, ".sheaf-chat-textarea");
  const sendButton = RequiredElement(harness.app, ".sheaf-chat-send");
  const handle = harness.handles[0];

  socket.open();
  harness.flushAnimationFrames();

  textarea.value = "Hello from user";
  sendButton.click();

  const userFrame = LastFrame(socket, "client.user_message");
  assert.deepEqual(userFrame.payload.attachments, []);
  assert.equal(userFrame.payload.text, "Hello from user");
  assert.equal(userFrame.payload.steer, true);
  assert.equal(handle.state.messageOrder.length, 0);

  const messageId = String(userFrame.payload.messageId);
  socket.receive(
    ServerEnvelope("chat.user_message", {
      messageId,
      text: "Hello from user",
    }, 1),
  );
  socket.receive(
    ServerEnvelope("agui.event", {
      type: "TEXT_MESSAGE_START",
      messageId,
      role: "user",
    }, 2),
  );
  socket.receive(
    ServerEnvelope("agui.event", {
      type: "TEXT_MESSAGE_CONTENT",
      messageId,
      delta: "Hello from user",
    }, 3),
  );
  socket.receive(
    ServerEnvelope("agui.event", {
      type: "TEXT_MESSAGE_END",
      messageId,
    }, 4),
  );
  harness.flushAnimationFrames();

  assert.deepEqual(Array.from(handle.state.messageOrder), [messageId]);
  const message = handle.state.messages.get(messageId);
  assert.equal(message.role, "user");
  assert.equal(message.content, "Hello from user");
  assert.equal(handle.transcript.querySelectorAll(".agui-chat-bubble--user").length, 1);
});

test("disconnected submissions queue and flush on reconnect", () =>
{
  const harness = LoadChatHarness();
  const socket = harness.sockets[0];
  const composer = RequiredElement(harness.app, ".sheaf-chat-composer");
  const textarea = RequiredElement(harness.app, ".sheaf-chat-textarea");
  const sendButton = RequiredElement(harness.app, ".sheaf-chat-send");

  assert.equal(composer.classList.contains("sheaf-chat-composer--disconnected"), true);
  assert.equal(sendButton.disabled, true);

  textarea.value = "Queued while offline";
  const event = KeyDown(textarea, "Enter");

  assert.equal(event.prevented, true);
  assert.equal(Frames(socket, "client.user_message").length, 0);
  assert.equal(composer.classList.contains("sheaf-chat-composer--queued"), true);
  assert.equal(sendButton.disabled, false);

  socket.open();

  assert.equal(Frames(socket, "client.user_message").length, 1);
  assert.equal(
    LastFrame(socket, "client.user_message").payload.text,
    "Queued while offline",
  );
  assert.equal(composer.classList.contains("sheaf-chat-composer--queued"), false);
});

test("sequenced envelopes are acked and reconnect resumes after last sequence", () =>
{
  const harness = LoadChatHarness();
  const socket = harness.sockets[0];

  socket.open();
  socket.receive(
    ServerEnvelope("agui.event", {
      type: "TEXT_MESSAGE_START",
      messageId: "assistant-1",
      role: "assistant",
    }, 7),
  );

  const ack = LastFrame(socket, "client.ack");
  assert.equal(ack.payload.sequence, 7);

  socket.close();
  harness.runTimers();

  assert.equal(harness.sockets.length, 2);
  assert.match(harness.sockets[1].url, /^ws:\/\/127\.0\.0\.1:9004\/ws\/chat\?/);
  assert.match(harness.sockets[1].url, /p=default/);
  assert.match(harness.sockets[1].url, /session=sess-1/);
  assert.match(harness.sockets[1].url, /after=7/);
});

test("model selection sends provider id and next-turn scope", () =>
{
  const harness = LoadChatHarness();
  const socket = harness.sockets[0];
  const modelSelect = RequiredElement(harness.app, ".sheaf-chat-model-select");

  socket.open();
  socket.receive(
    ServerEnvelope("server.hello", {
      models: [
        { provider: "openai", id: "gpt-4.1", displayName: "GPT 4.1" },
        { provider: "anthropic", id: "claude-sonnet-4", displayName: "Claude Sonnet 4" },
      ],
      activeModel: { provider: "openai", id: "gpt-4.1" },
      manifest: { chatName: "Test chat" },
    }),
  );

  modelSelect.value = "anthropic:claude-sonnet-4";
  modelSelect.dispatchEvent({ type: "change" });

  assert.deepEqual(LastFrame(socket, "client.model_select").payload, {
    provider: "anthropic",
    id: "claude-sonnet-4",
    applyTo: "next_turn",
  });
});

test("near-top scroll requests older history only when available and idle", () =>
{
  const harness = LoadChatHarness();
  const socket = harness.sockets[0];
  const transcript = harness.handles[0].transcript as FakeElement;

  socket.open();
  transcript.scrollTop = 0;
  transcript.dispatchEvent({ type: "scroll" });
  assert.equal(Frames(socket, "client.history_request").length, 0);

  socket.receive(
    ServerEnvelope("server.hello", {
      models: [],
      activeModel: { provider: "openai", id: "gpt-4.1" },
      historyWindow: {
        oldestSequence: 25,
      },
    }),
  );

  const afterHello = Frames(socket, "client.history_request").length;
  assert.equal(afterHello, 1);
  assert.equal(LastFrame(socket, "client.history_request").payload.before, undefined);

  harness.runTimers();
  transcript.dispatchEvent({ type: "scroll" });

  assert.equal(Frames(socket, "client.history_request").length, afterHello + 1);
  assert.equal(LastFrame(socket, "client.history_request").payload.before, 25);
  assert.equal(LastFrame(socket, "client.history_request").payload.limit, 50);

  harness.runTimers();
  transcript.dispatchEvent({ type: "scroll" });
  assert.equal(Frames(socket, "client.history_request").length, afterHello + 1);

  socket.receive(
    ServerEnvelope("history.page", {
      oldestSequence: 10,
      hasMoreBefore: false,
      messages: [],
      events: [],
    }),
  );
  harness.runTimers();
  transcript.dispatchEvent({ type: "scroll" });
  assert.equal(Frames(socket, "client.history_request").length, afterHello + 1);
});

test("touch and desktop layout classes drive enter-key send behavior", () =>
{
  const desktop = LoadChatHarness();
  const desktopSocket = desktop.sockets[0];
  const desktopTextarea = RequiredElement(desktop.app, ".sheaf-chat-textarea");
  RequiredElement(desktop.app, ".sheaf-chat-send");
  desktopSocket.open();

  assert.equal(desktop.app.classList.contains("sheaf-chat-desktop"), true);
  assert.equal(desktop.app.classList.contains("sheaf-chat-touch"), false);

  desktopTextarea.value = "Shift enter stays in composer";
  const shiftEnter = KeyDown(desktopTextarea, "Enter", true);
  assert.equal(shiftEnter.prevented, false);
  assert.equal(Frames(desktopSocket, "client.user_message").length, 0);

  desktopTextarea.value = "Enter sends on desktop";
  const enter = KeyDown(desktopTextarea, "Enter");
  assert.equal(enter.prevented, true);
  assert.equal(LastFrame(desktopSocket, "client.user_message").payload.text, "Enter sends on desktop");

  const touch = LoadChatHarness({ touch: true });
  const touchSocket = touch.sockets[0];
  const touchTextarea = RequiredElement(touch.app, ".sheaf-chat-textarea");
  RequiredElement(touch.app, ".sheaf-chat-send");
  touchSocket.open();

  assert.equal(touch.app.classList.contains("sheaf-chat-touch"), true);
  assert.equal(touch.app.classList.contains("sheaf-chat-desktop"), false);

  touchTextarea.value = "Enter inserts newline on touch";
  const touchEnter = KeyDown(touchTextarea, "Enter");
  assert.equal(touchEnter.prevented, false);
  assert.equal(touchTextarea.value, "Enter inserts newline on touch");
  assert.equal(Frames(touchSocket, "client.user_message").length, 0);
});
