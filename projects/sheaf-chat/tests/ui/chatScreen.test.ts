import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import katex from "katex";
import markdownit from "markdown-it";

const x_packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const x_sheafChatJsPath = path.join(x_packageRoot, "src", "ui", "sheaf-chat.js");
const x_sheafMarkdownJsPath = path.join(x_packageRoot, "src", "ui", "sheaf-markdown.js");
const x_sheafChatCssPath = path.join(x_packageRoot, "src", "ui", "sheaf-chat.css");
const x_aguiChatJsPath = path.resolve(x_packageRoot, "..", "web", "src", "agui-chat.js");

type Listener = (event: Record<string, unknown>) => void;

class FakeElement
{
  public readonly tagName: string;
  public readonly nodeName: string;
  public className = "";
  public readonly dataset: Record<string, string> = {};
  public readonly style = {
    setProperty(name: string, value: string): void {
      (this as Record<string, string>)[name] = value;
    },
  } as Record<string, string> & {
    setProperty: (name: string, value: string) => void;
  };
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
  private readonly x_attributes = new Map<string, string>();
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
      return this.x_textContent + this.children.map((child) => child.textContent).join("");
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
    this.x_ParseSimpleHtml(this.x_innerHTML);
  }

  public getAttribute(name: string): string | null
  {
    return this.x_attributes.has(name) ? this.x_attributes.get(name)! : null;
  }

  public setAttribute(name: string, value: string): void
  {
    this.x_attributes.set(name, value);
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

  public insertBefore(child: FakeElement, referenceNode: FakeElement | null): FakeElement
  {
    if (referenceNode === null) {
      return this.appendChild(child);
    }

    const referenceIndex = this.children.indexOf(referenceNode);
    if (referenceIndex < 0) {
      return this.appendChild(child);
    }

    if (child.parentNode) {
      child.parentNode.removeChild(child);
    }
    child.parentNode = this;
    this.children.splice(referenceIndex, 0, child);

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
    if (typeof event.preventDefault !== "function") {
      event.preventDefault = () => undefined;
    }
    if (typeof event.stopPropagation !== "function") {
      event.stopPropagation = () => undefined;
    }
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
    const parts = selector.trim().split(/\s+/).filter(Boolean);
    const results: FakeElement[] = [];
    const stack: FakeElement[] = [this];

    while (stack.length > 0) {
      const node = stack.shift();
      if (!node) {
        continue;
      }

      if (parts.length === 1) {
        if (this.x_MatchesSelector(node, parts[0])) {
          results.push(node);
        }
      } else if (this.x_MatchesDescendantSelector(node, parts)) {
        results.push(node);
      }

      stack.push(...node.children);
    }

    return results;
  }

  private x_ParseSimpleHtml(html: string): void
  {
    const tagRegex = /<([a-zA-Z][\w-]*)\b([^>]*)>/g;
    let match: RegExpExecArray | null = tagRegex.exec(html);

    while (match) {
      const tagName = match[1];
      const attributes = match[2] || "";
      const element = new FakeElement(tagName);
      const classMatch = /\bclass="([^"]*)"/.exec(attributes);
      if (classMatch) {
        element.className = classMatch[1];
      }
      const hrefMatch = /\bhref="([^"]*)"/.exec(attributes);
      if (hrefMatch) {
        element.setAttribute("href", hrefMatch[1]);
      }
      const idMatch = /\bid="([^"]*)"/.exec(attributes);
      if (idMatch) {
        element.id = idMatch[1];
      }
      element.parentNode = this;
      this.children.push(element);
      match = tagRegex.exec(html);
    }
  }

  private x_ClassNames(): string[]
  {
    return this.className.split(/\s+/).filter(Boolean);
  }

  private x_MatchesSelector(node: FakeElement, selector: string): boolean
  {
    if (selector.startsWith(".")) {
      const className = selector.slice(1);
      return node.x_ClassNames().includes(className);
    }

    if (selector.includes("[")) {
      const tagMatch = /^([a-zA-Z][\w-]*)/.exec(selector);
      const attrMatch = /\[([^\]=]+)(?:="([^"]*)")?\]/.exec(selector);
      if (tagMatch && node.tagName !== tagMatch[1].toUpperCase()) {
        return false;
      }
      if (attrMatch) {
        const attrValue = node.getAttribute(attrMatch[1]);
        if (attrMatch[2] != null) {
          return attrValue === attrMatch[2];
        }
        return attrValue != null;
      }
    }

    return node.tagName === selector.toUpperCase();
  }

  private x_MatchesDescendantSelector(node: FakeElement, parts: string[]): boolean
  {
    if (!this.x_MatchesSelector(node, parts[parts.length - 1])) {
      return false;
    }

    let current: FakeElement | null = node;
    for (let index = parts.length - 2; index >= 0; index -= 1) {
      let found = false;
      let parent: FakeElement | null = current ? current.parentNode : null;
      while (parent) {
        if (this.x_MatchesSelector(parent, parts[index])) {
          found = true;
          current = parent;
          break;
        }
        parent = parent.parentNode;
      }
      if (!found) {
        return false;
      }
    }

    return true;
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

  public removeEventListener(type: string, handler: Listener): void
  {
    this.x_listeners[type] = (this.x_listeners[type] || []).filter(
      (entry) => entry !== handler,
    );
  }

  public dispatchEvent(event: Record<string, unknown>): void
  {
    const type = String(event.type || "");
    for (const handler of this.x_listeners[type] || []) {
      handler(event);
    }
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
  document: FakeDocument;
  location: { hash: string; protocol: string; host: string };
  sockets: FakeWebSocket[];
  handles: any[];
  flushAnimationFrames: () => void;
  runTimers: () => void;
}

interface FakeFetchResponse
{
  ok: boolean;
  json: () => Promise<unknown>;
}

function JsonResponse(body: unknown, ok = true): FakeFetchResponse
{
  return {
    ok,
    json: async () => body,
  };
}

function DefaultFileFetch(path: string): FakeFetchResponse | null
{
  const filesMatch = path.match(
    /\/api\/piles\/[^/]+\/sessions\/[^/]+\/files\?path=(.+)$/,
  );
  if (filesMatch) {
    const directoryPath = decodeURIComponent(filesMatch[1]);
    if (directoryPath === ".") {
      return JsonResponse({
        directory: { name: ".", path: ".", kind: "directory" },
        entries: [
          {
            name: "readme.md",
            path: "docs/readme.md",
            kind: "file",
            supported: true,
            contentType: "text/markdown",
          },
          {
            name: "other.md",
            path: "docs/other.md",
            kind: "file",
            supported: true,
            contentType: "text/markdown",
          },
        ],
      });
    }
    return JsonResponse({
      directory: { name: directoryPath, path: directoryPath, kind: "directory" },
      entries: [],
    });
  }

  const fileMatch = path.match(
    /\/api\/piles\/[^/]+\/sessions\/[^/]+\/file\?path=(.+)$/,
  );
  if (fileMatch) {
    const filePath = decodeURIComponent(fileMatch[1]);
    const contents: Record<string, string> = {
      "docs/readme.md": "# Readme\n\nSee [other](./other.md).\n",
      "docs/other.md": "# Other\n\nBackground file.\n",
    };
    const content = contents[filePath] || "# Missing\n";
    return JsonResponse({
      file: {
        name: filePath.split("/").pop(),
        path: filePath,
        kind: "file",
        supported: true,
        contentType: "text/markdown",
        content,
        size: content.length,
        modifiedAt: "2026-06-08T00:00:00.000Z",
      },
    });
  }

  return null;
}

function HighlightFileFetch(path: string): FakeFetchResponse | null
{
  const filesMatch = path.match(
    /\/api\/piles\/[^/]+\/sessions\/[^/]+\/files\?path=(.+)$/,
  );
  if (filesMatch) {
    return JsonResponse({
      directory: { name: ".", path: ".", kind: "directory" },
      entries: [
        {
          name: "main.cpp",
          path: "main.cpp",
          kind: "file",
          supported: true,
          contentType: "text/plain",
        },
        {
          name: "config.json",
          path: "config.json",
          kind: "file",
          supported: true,
          contentType: "text/plain",
        },
        {
          name: "notes.txt",
          path: "notes.txt",
          kind: "file",
          supported: true,
          contentType: "text/plain",
        },
      ],
    });
  }

  const fileMatch = path.match(
    /\/api\/piles\/[^/]+\/sessions\/[^/]+\/file\?path=(.+)$/,
  );
  if (fileMatch) {
    const filePath = decodeURIComponent(fileMatch[1]);
    const contents: Record<string, string> = {
      "main.cpp": "int main() { return 0; }\n",
      "config.json": "{ \"enabled\": true }\n",
      "notes.txt": "plain notes\n",
    };
    const content = contents[filePath] || "";
    return JsonResponse({
      file: {
        name: filePath,
        path: filePath,
        kind: "file",
        supported: true,
        contentType: "text/plain",
        content,
        size: content.length,
        modifiedAt: "2026-06-08T00:00:00.000Z",
      },
    });
  }

  return null;
}

function LoadChatHarness(options?: {
  fetch?: (path: string, request?: Record<string, unknown>) => Promise<FakeFetchResponse>;
  highlight?: unknown;
  hash?: string;
  touch?: boolean;
  markdown?: boolean;
}): ChatHarness
{
  const document = new FakeDocument();
  const pendingFrames: Array<(() => void) | null> = [];
  const pendingTimers: Array<(() => void) | null> = [];
  const windowListeners: Record<string, Listener[]> = {};
  const location = {
    hash: options?.hash || "#/piles/default/sessions/sess-1",
    protocol: "http:",
    host: "127.0.0.1:9004",
  };
  let idCounter = 0;

  FakeWebSocket.instances = [];

  const context: Record<string, any> = {
    console,
    URLSearchParams,
    WebSocket: FakeWebSocket,
    document,
    location,
    fetch:
      options?.fetch ||
      (async (path: string) => DefaultFileFetch(path) || JsonResponse({})),
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
  if (options && "highlight" in options) {
    context.hljs = options.highlight;
  }
  if (options?.touch === true) {
    context.ontouchstart = null;
  }

  vm.createContext(context);
  if (options?.markdown !== false) {
    context.markdownit = markdownit;
    context.katex = katex;
    vm.runInContext(fs.readFileSync(x_sheafMarkdownJsPath, "utf8"), context);
  }
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
    document,
    location,
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

function CssRuleBody(cssText: string, selector: string): string
{
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp("^" + escapedSelector + "\\s*\\n\\{\\n([\\s\\S]*?)\\n\\}", "m").exec(cssText);
  assert.ok(match, "expected CSS rule for " + selector);
  return match[1];
}

function ExplorerFileButton(root: FakeElement, name: string): FakeElement
{
  const button = root
    .querySelectorAll(".sheaf-chat-explorer-file")
    .find((entry) => entry.textContent.includes(name));
  assert.ok(button, "expected explorer file button for " + name);
  return button;
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

async function FlushPromises(): Promise<void>
{
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test("piles screen renders backend pile summaries and navigates by pile name", async () =>
{
  const requests: Array<{ path: string; request?: Record<string, unknown> }> = [];
  let piles: Array<{ pile: string; sessionCount: number; latestUpdatedAt: string | null }> = [
    {
      pile: "work",
      sessionCount: 2,
      latestUpdatedAt: "2026-06-08T18:00:00.000Z",
    },
  ];
  const harness = LoadChatHarness({
    hash: "#/",
    fetch: async (path, request) => {
      requests.push({ path, request });

      if (path === "/api/piles" && request?.method === "POST") {
        const body = JSON.parse(String(request.body));
        piles = [
          ...piles,
          {
            pile: body.pile,
            sessionCount: 0,
            latestUpdatedAt: null,
          },
        ];
        return JsonResponse({ pile: body.pile, sessionCount: 0, latestUpdatedAt: null }, true);
      }

      if (path === "/api/piles") {
        return JsonResponse({ piles }, true);
      }

      return JsonResponse({ error: { message: "unexpected request" } }, false);
    },
  });

  await FlushPromises();

  const firstPileButton = RequiredElement(harness.app, ".sheaf-chat-list-button");
  assert.match(firstPileButton.textContent, /^work/);
  assert.doesNotMatch(firstPileButton.textContent, /undefined/);

  firstPileButton.click();
  assert.equal(harness.location.hash, "#/piles/work");

  const input = RequiredElement(harness.app, ".sheaf-chat-input");
  const form = RequiredElement(harness.app, "form");
  input.value = "research";
  form.dispatchEvent({
    type: "submit",
    preventDefault: () => undefined,
  });

  await FlushPromises();

  const postRequest = requests.find((request) => request.request?.method === "POST");
  assert.ok(postRequest);
  assert.equal(JSON.parse(String(postRequest.request?.body)).pile, "research");
  assert.doesNotMatch(harness.app.textContent, /undefined/);
  assert.match(harness.app.textContent, /research/);
});

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
  const chatView = RequiredElement(harness.app, ".sheaf-chat-chat-view");

  assert.ok(chatView);

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
  assert.equal(LastFrame(socket, "client.history_request").payload.limit, 5000);

  harness.runTimers();
  transcript.dispatchEvent({ type: "scroll" });

  assert.equal(Frames(socket, "client.history_request").length, afterHello + 1);
  assert.equal(LastFrame(socket, "client.history_request").payload.before, 25);
  assert.equal(LastFrame(socket, "client.history_request").payload.limit, 5000);

  harness.runTimers();
  transcript.dispatchEvent({ type: "scroll" });
  assert.equal(Frames(socket, "client.history_request").length, afterHello + 1);

  socket.receive(
    ServerEnvelope("history.page", {
      oldestSequence: 10,
      hasMoreBefore: true,
      messages: [],
      events: [],
    }),
  );
  harness.runTimers();
  assert.equal(Frames(socket, "client.history_request").length, afterHello + 2);
  assert.equal(LastFrame(socket, "client.history_request").payload.before, 10);
  assert.equal(LastFrame(socket, "client.history_request").payload.limit, 5000);

  socket.receive(
    ServerEnvelope("history.page", {
      oldestSequence: 1,
      hasMoreBefore: false,
      messages: [],
      events: [],
    }),
  );
  harness.runTimers();
  transcript.dispatchEvent({ type: "scroll" });
  assert.equal(Frames(socket, "client.history_request").length, afterHello + 2);
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

test("desktop workspace renders explorer, file, and chat panes", async () =>
{
  const harness = LoadChatHarness();
  await FlushPromises();

  RequiredElement(harness.app, ".sheaf-chat-workspace");
  RequiredElement(harness.app, ".sheaf-chat-explorer-pane");
  RequiredElement(harness.app, ".sheaf-chat-file-pane");
  RequiredElement(harness.app, ".sheaf-chat-chat-pane");
  RequiredElement(harness.app, ".sheaf-chat-tab-bar");
  RequiredElement(harness.app, ".sheaf-chat-file-view");
});

test("Agent Review Mode opens review socket and sends hunk commands", async () =>
{
  const reviewState: any = {
    available: true,
    repoRoot: "/repo",
    sessionRoot: "/repo/projects/demo",
    sessionRootRelativeToRepo: "projects/demo",
    currentIndex: 0,
    currentHunk: {
      sourceProvider: "sheaf-chat",
      repoRoot: "/repo",
      sessionRoot: "/repo/projects/demo",
      file: "app.ts",
      hunkId: "hunk-1",
      hunkIndex: 0,
      hunkCount: 1,
      fileIndex: 0,
      fileCount: 1,
      header: "@@ -1 +1 @@",
      patchHash: "abc123",
      patch: "diff --git a/app.ts b/app.ts\n@@ -1 +1 @@\n-old\n+new\n",
    },
    hunks: [],
    files: [{ file: "app.ts", hunkCount: 1 }],
    actions: {
      canGoUp: false,
      canGoDown: false,
      canGoPrevFile: false,
      canGoNextFile: false,
      canStage: true,
      canRevert: true,
      canUndo: false,
    },
    dictatorBridge: { connected: false, url: null, lastError: null },
  };
  reviewState.hunks = [reviewState.currentHunk];

  const harness = LoadChatHarness({
    fetch: async (requestPath) => {
      if (requestPath.endsWith("/agent-review")) {
        return JsonResponse(reviewState);
      }
      if (requestPath.includes("/files?path=")) {
        return JsonResponse({
          directory: { name: ".", path: ".", kind: "directory" },
          entries: [
            {
              name: "app.ts",
              path: "app.ts",
              kind: "file",
              supported: true,
              contentType: "text/plain",
            },
          ],
        });
      }
      if (requestPath.includes("/file?path=")) {
        return JsonResponse({
          file: {
            name: "app.ts",
            path: "app.ts",
            kind: "file",
            supported: true,
            contentType: "text/plain",
            content: "new\n",
            size: 4,
            modifiedAt: "2026-06-08T00:00:00.000Z",
          },
        });
      }
      return JsonResponse({});
    },
  });
  await FlushPromises();

  const toggle = RequiredElement(harness.app, ".sheaf-chat-agent-review-toggle");
  assert.match(toggle.textContent, /Agent Review/);
  toggle.click();

  const reviewSocket = harness.sockets.find((socket) => socket.url.includes("/ws/agent-review"));
  assert.ok(reviewSocket, "expected Agent Review WebSocket");
  reviewSocket.open();
  reviewSocket.receive({ type: "bootstrap", state: reviewState });
  await FlushPromises();

  assert.match(harness.app.textContent, /Focused hunk 1\/1/);
  assert.match(harness.app.textContent, /old/);
  assert.match(harness.app.textContent, /new/);

  const stage = harness.app
    .querySelectorAll(".sheaf-chat-agent-review-command")
    .find((button) => button.textContent.includes("Stage"));
  assert.ok(stage, "expected Stage button");
  stage.click();

  const sent = reviewSocket.sent.map((raw) => JSON.parse(raw) as Record<string, any>);
  assert.equal(sent.at(-1)?.action, "stage");
  assert.equal(sent.at(-1)?.hunkId, "hunk-1");
  assert.equal(sent.at(-1)?.patchHash, "abc123");
});

test("explorer file rows open tabs and switching updates selected content", async () =>
{
  const harness = LoadChatHarness();
  await FlushPromises();

  ExplorerFileButton(harness.app, "readme.md").click();
  await FlushPromises();

  const selectedTab = RequiredElement(harness.app, ".sheaf-chat-tab--selected");
  assert.match(selectedTab.textContent, /readme\.md/);
  assert.match(harness.app.textContent, /Readme/);

  const tabs = harness.app.querySelectorAll(".sheaf-chat-tab");
  assert.equal(tabs.length, 1);

  ExplorerFileButton(harness.app, "other.md").click();
  await FlushPromises();

  assert.equal(harness.app.querySelectorAll(".sheaf-chat-tab").length, 2);
  assert.match(RequiredElement(harness.app, ".sheaf-chat-tab--selected").textContent, /other\.md/);
  assert.match(harness.app.textContent, /Other/);

  tabs[0].click();
  await FlushPromises();
  assert.match(RequiredElement(harness.app, ".sheaf-chat-tab--selected").textContent, /readme\.md/);
  assert.match(harness.app.textContent, /Readme/);
});

test("text file previews use mapped Highlight.js languages", async () =>
{
  const calls: Array<{ code: string; language: string }> = [];
  const harness = LoadChatHarness({
    fetch: async (path) => HighlightFileFetch(path) || JsonResponse({}),
    highlight: {
      getLanguage(language: string): boolean {
        return ["cpp", "json"].includes(language);
      },
      highlight(code: string, options: { language: string }): { value: string } {
        calls.push({ code, language: options.language });
        if (options.language === "cpp") {
          return { value: '<span class="hljs-keyword">int</span> main()' };
        }
        return { value: '{ <span class="hljs-attr">&quot;enabled&quot;</span>: true }' };
      },
    },
  });
  await FlushPromises();

  ExplorerFileButton(harness.app, "main.cpp").click();
  await FlushPromises();

  RequiredElement(harness.app, ".sheaf-chat-file-highlighted");
  RequiredElement(harness.app, ".hljs-keyword");
  assert.equal(calls[0].language, "cpp");
  assert.match(calls[0].code, /int main/);

  ExplorerFileButton(harness.app, "config.json").click();
  await FlushPromises();

  RequiredElement(harness.app, ".sheaf-chat-file-highlighted");
  RequiredElement(harness.app, ".hljs-attr");
  assert.equal(calls[1].language, "json");
  assert.match(calls[1].code, /enabled/);
});

test("text file previews fall back to plain text without a usable highlighter", async () =>
{
  const harness = LoadChatHarness({
    fetch: async (path) => HighlightFileFetch(path) || JsonResponse({}),
  });
  await FlushPromises();

  ExplorerFileButton(harness.app, "main.cpp").click();
  await FlushPromises();

  assert.equal(harness.app.querySelector(".sheaf-chat-file-highlighted"), null);
  RequiredElement(harness.app, ".sheaf-chat-file-plain");
  assert.match(harness.app.textContent, /int main/);
});

test("text file previews fall back for unmapped extensions and highlighter failures", async () =>
{
  const calls: string[] = [];
  const harness = LoadChatHarness({
    fetch: async (path) => HighlightFileFetch(path) || JsonResponse({}),
    highlight: {
      getLanguage(language: string): boolean {
        return language === "cpp";
      },
      highlight(_code: string, options: { language: string }): { value: string } {
        calls.push(options.language);
        throw new Error("highlight failed");
      },
    },
  });
  await FlushPromises();

  ExplorerFileButton(harness.app, "notes.txt").click();
  await FlushPromises();

  assert.equal(calls.length, 0);
  assert.equal(harness.app.querySelector(".sheaf-chat-file-highlighted"), null);
  assert.match(harness.app.textContent, /plain notes/);

  ExplorerFileButton(harness.app, "main.cpp").click();
  await FlushPromises();

  assert.deepEqual(calls, ["cpp"]);
  assert.equal(harness.app.querySelector(".sheaf-chat-file-highlighted"), null);
  assert.match(harness.app.textContent, /int main/);
});

test("closing a tab updates the selected file content", async () =>
{
  const harness = LoadChatHarness();
  await FlushPromises();

  ExplorerFileButton(harness.app, "readme.md").click();
  await FlushPromises();

  ExplorerFileButton(harness.app, "other.md").click();
  await FlushPromises();

  const closeButtons = harness.app.querySelectorAll(".sheaf-chat-tab-close");
  assert.equal(closeButtons.length, 2);
  closeButtons[0].click();
  await FlushPromises();

  assert.equal(harness.app.querySelectorAll(".sheaf-chat-tab").length, 1);
  assert.match(RequiredElement(harness.app, ".sheaf-chat-tab--selected").textContent, /other\.md/);
});

test("collapse controls and resize handles update desktop panel state", async () =>
{
  const harness = LoadChatHarness();
  await FlushPromises();

  const explorerPane = RequiredElement(harness.app, ".sheaf-chat-explorer-pane");
  const chatPane = RequiredElement(harness.app, ".sheaf-chat-chat-pane");
  const explorerCollapse = RequiredElement(
    harness.app,
    ".sheaf-chat-explorer-pane .sheaf-chat-pane-collapse",
  );
  const chatCollapse = RequiredElement(
    harness.app,
    ".sheaf-chat-chat-pane .sheaf-chat-pane-collapse",
  );

  explorerCollapse.click();
  assert.equal(explorerPane.classList.contains("sheaf-chat-explorer-pane--collapsed"), true);
  chatCollapse.click();
  assert.equal(chatPane.classList.contains("sheaf-chat-chat-pane--collapsed"), true);

  const explorerResize = RequiredElement(harness.app, ".sheaf-chat-resize-handle--explorer");
  explorerResize.dispatchEvent({
    type: "mousedown",
    clientX: 100,
    preventDefault: () => undefined,
  });

  harness.document.dispatchEvent({ type: "mousemove", clientX: 180 });
  harness.document.dispatchEvent({ type: "mouseup" });

  const workspace = RequiredElement(harness.app, ".sheaf-chat-workspace");
  assert.equal(workspace.style["--sheaf-chat-explorer-width"], "320px");
});

test("markdown file links and assistant file links open or focus tabs", async () =>
{
  const harness = LoadChatHarness();
  const socket = harness.sockets[0];
  await FlushPromises();

  const readmeButton = RequiredElement(harness.app, ".sheaf-chat-explorer-file");
  readmeButton.click();
  await FlushPromises();

  const fileLink = harness.app.querySelector(".sheaf-markdown-file-link");
  assert.ok(fileLink, "expected rendered markdown file link");
  fileLink.click();
  await FlushPromises();

  assert.equal(harness.app.querySelectorAll(".sheaf-chat-tab").length, 2);
  assert.match(RequiredElement(harness.app, ".sheaf-chat-tab--selected").textContent, /other\.md/);

  socket.open();
  socket.receive(
    ServerEnvelope("agui.event", {
      type: "TEXT_MESSAGE_START",
      messageId: "assistant-link",
      role: "assistant",
    }, 1),
  );
  socket.receive(
    ServerEnvelope("agui.event", {
      type: "TEXT_MESSAGE_CONTENT",
      messageId: "assistant-link",
      delta: "Open [readme](sheaf-file:docs/readme.md).",
    }, 2),
  );
  socket.receive(
    ServerEnvelope("agui.event", {
      type: "TEXT_MESSAGE_END",
      messageId: "assistant-link",
    }, 3),
  );
  harness.flushAnimationFrames();
  await FlushPromises();

  const assistantLink = harness.app.querySelectorAll(".sheaf-markdown-file-link").find(
    (link) => link.getAttribute("href") === "sheaf-file:docs/readme.md",
  );
  assert.ok(assistantLink, "expected assistant file link");
  assistantLink.click();
  await FlushPromises();

  assert.match(RequiredElement(harness.app, ".sheaf-chat-tab--selected").textContent, /readme\.md/);
});

test("touch layout shows file view as primary with mobile toolbar", async () =>
{
  const harness = LoadChatHarness({ touch: true });
  await FlushPromises();

  assert.equal(harness.app.classList.contains("sheaf-chat-touch"), true);
  RequiredElement(harness.app, ".sheaf-chat-workspace--mobile");
  RequiredElement(harness.app, ".sheaf-chat-mobile-toolbar");
  RequiredElement(harness.app, ".sheaf-chat-file-view");
  RequiredElement(harness.app, ".sheaf-chat-mobile-file-title");

  assert.equal(
    harness.app.querySelector(".sheaf-chat-tab-bar"),
    null,
    "horizontal tab bar should not exist on touch",
  );
  assert.equal(
    harness.app.querySelector(".sheaf-chat-resize-handle"),
    null,
    "resize handles should not exist on touch",
  );
});

test("mobile explorer panel opens from left and can open files", async () =>
{
  const harness = LoadChatHarness({ touch: true });
  await FlushPromises();

  const explorerPanel = RequiredElement(
    harness.app,
    ".sheaf-chat-mobile-panel--explorer",
  );
  const explorerToggle = RequiredElement(
    harness.app,
    ".sheaf-chat-mobile-toolbar-explorer",
  );

  assert.equal(
    explorerPanel.classList.contains("sheaf-chat-mobile-panel--open"),
    false,
  );

  explorerToggle.click();
  assert.equal(
    explorerPanel.classList.contains("sheaf-chat-mobile-panel--open"),
    true,
  );
  assert.equal(
    RequiredElement(harness.app, ".sheaf-chat-mobile-backdrop").classList.contains(
      "sheaf-chat-mobile-backdrop--visible",
    ),
    true,
  );

  ExplorerFileButton(harness.app, "readme.md").click();
  await FlushPromises();

  assert.equal(
    explorerPanel.classList.contains("sheaf-chat-mobile-panel--open"),
    false,
    "explorer should close after opening a file",
  );
  assert.match(
    RequiredElement(harness.app, ".sheaf-chat-mobile-file-title").textContent,
    /readme\.md/,
  );
  assert.match(harness.app.textContent, /Readme/);
});

test("mobile tab panel opens from right with vertical tabs", async () =>
{
  const harness = LoadChatHarness({ touch: true });
  await FlushPromises();

  ExplorerFileButton(harness.app, "readme.md").click();
  await FlushPromises();
  ExplorerFileButton(harness.app, "other.md").click();
  await FlushPromises();

  const tabsPanel = RequiredElement(harness.app, ".sheaf-chat-mobile-panel--tabs");
  const tabsToggle = RequiredElement(harness.app, ".sheaf-chat-mobile-toolbar-tabs");

  tabsToggle.click();
  assert.equal(tabsPanel.classList.contains("sheaf-chat-mobile-panel--open"), true);

  const mobileTabs = harness.app.querySelectorAll(".sheaf-chat-mobile-tab");
  assert.equal(mobileTabs.length, 2);
  assert.match(mobileTabs[0].textContent, /readme\.md/);
  assert.match(mobileTabs[1].textContent, /other\.md/);

  mobileTabs[0].click();
  await FlushPromises();

  assert.equal(tabsPanel.classList.contains("sheaf-chat-mobile-panel--open"), false);
  assert.match(
    RequiredElement(harness.app, ".sheaf-chat-mobile-file-title").textContent,
    /readme\.md/,
  );
  assert.match(harness.app.textContent, /Readme/);

  tabsToggle.click();
  const closeButtons = harness.app.querySelectorAll(
    ".sheaf-chat-mobile-tab .sheaf-chat-tab-close",
  );
  assert.equal(closeButtons.length, 2);
  closeButtons[1].click();
  await FlushPromises();

  assert.equal(harness.app.querySelectorAll(".sheaf-chat-mobile-tab").length, 1);
  assert.match(
    RequiredElement(harness.app, ".sheaf-chat-mobile-file-title").textContent,
    /readme\.md/,
  );
});

test("mobile chat safe-area inset is applied once below composer", () =>
{
  const cssText = fs.readFileSync(x_sheafChatCssPath, "utf8");
  const chatPanelRule = CssRuleBody(cssText, ".sheaf-chat-mobile-panel--chat");
  const composerRule = CssRuleBody(
    cssText,
    ".sheaf-chat-mobile-panel--chat .sheaf-chat-composer",
  );
  const mobileBottomInsetRules = chatPanelRule + composerRule;

  assert.doesNotMatch(chatPanelRule, /safe-area-inset-bottom/);
  assert.match(
    composerRule,
    /padding-bottom:\s*calc\(10px \+ env\(safe-area-inset-bottom, 0px\)\)/,
  );
  assert.equal(
    mobileBottomInsetRules.match(/safe-area-inset-bottom/g)?.length,
    1,
  );
});

test("mobile chat panel opens from bottom and preserves send behavior", async () =>
{
  const harness = LoadChatHarness({ touch: true });
  const socket = harness.sockets[0];
  await FlushPromises();

  const chatPanel = RequiredElement(harness.app, ".sheaf-chat-mobile-panel--chat");
  const chatToggle = RequiredElement(harness.app, ".sheaf-chat-mobile-toolbar-chat");
  const textarea = RequiredElement(harness.app, ".sheaf-chat-textarea");
  const sendButton = RequiredElement(harness.app, ".sheaf-chat-send");

  chatToggle.click();
  assert.equal(chatPanel.classList.contains("sheaf-chat-mobile-panel--open"), true);
  assert.ok(chatPanel.querySelector(".sheaf-chat-chat-status"));
  assert.ok(chatPanel.querySelector(".sheaf-chat-chat-view"));
  assert.ok(chatPanel.querySelector(".sheaf-chat-composer"));

  socket.open();
  textarea.value = "Mobile chat message";
  sendButton.click();

  assert.equal(
    LastFrame(socket, "client.user_message").payload.text,
    "Mobile chat message",
  );
});

test("mobile backdrop closes panels without losing tabs or chat state", async () =>
{
  const harness = LoadChatHarness({ touch: true });
  const socket = harness.sockets[0];
  await FlushPromises();

  ExplorerFileButton(harness.app, "readme.md").click();
  await FlushPromises();

  const chatToggle = RequiredElement(harness.app, ".sheaf-chat-mobile-toolbar-chat");
  chatToggle.click();

  socket.open();
  const textarea = RequiredElement(harness.app, ".sheaf-chat-textarea");
  const sendButton = RequiredElement(harness.app, ".sheaf-chat-send");
  textarea.value = "Persist after close";
  sendButton.click();

  RequiredElement(harness.app, ".sheaf-chat-mobile-backdrop").click();

  assert.equal(
    RequiredElement(harness.app, ".sheaf-chat-mobile-panel--chat").classList.contains(
      "sheaf-chat-mobile-panel--open",
    ),
    false,
  );
  assert.match(
    RequiredElement(harness.app, ".sheaf-chat-mobile-file-title").textContent,
    /readme\.md/,
  );
  assert.match(harness.app.textContent, /Readme/);
  assert.equal(Frames(socket, "client.user_message").length, 1);
});

test("mobile stale-tab markers survive panel close", async () =>
{
  const harness = LoadChatHarness({ touch: true });
  await FlushPromises();

  ExplorerFileButton(harness.app, "readme.md").click();
  await FlushPromises();
  ExplorerFileButton(harness.app, "other.md").click();
  await FlushPromises();

  const socket = harness.sockets[0];
  socket.receive(
    ServerEnvelope("file.changed", {
      eventType: "fileChanged",
      path: "docs/readme.md",
      fileId: "docs/readme.md",
      changedAt: "2026-06-09T00:00:00.000Z",
      source: "edit_tool",
    }, 10),
  );
  await FlushPromises();

  const tabsToggle = RequiredElement(harness.app, ".sheaf-chat-mobile-toolbar-tabs");
  tabsToggle.click();

  const readmeTab = harness.app
    .querySelectorAll(".sheaf-chat-mobile-tab")
    .find((tab) => tab.textContent.includes("readme.md"));
  assert.ok(readmeTab);
  assert.equal(readmeTab.classList.contains("sheaf-chat-tab--stale"), true);

  RequiredElement(harness.app, ".sheaf-chat-mobile-backdrop").click();
  tabsToggle.click();

  const staleTab = harness.app
    .querySelectorAll(".sheaf-chat-mobile-tab")
    .find((tab) => tab.textContent.includes("readme.md"));
  assert.ok(staleTab);
  assert.equal(staleTab.classList.contains("sheaf-chat-tab--stale"), true);
});

test("file.changed refetches selected tab and defers stale background tabs", async () =>
{
  const fetchCalls: string[] = [];
  const harness = LoadChatHarness({
    fetch: async (path) => {
      fetchCalls.push(path);
      const response = DefaultFileFetch(path);
      assert.ok(response);
      return response;
    },
  });
  await FlushPromises();

  ExplorerFileButton(harness.app, "readme.md").click();
  await FlushPromises();

  ExplorerFileButton(harness.app, "other.md").click();
  await FlushPromises();

  const countFileFetches = (filePath: string): number =>
    fetchCalls.filter((path) => path.includes("/file?path=" + encodeURIComponent(filePath))).length;

  assert.equal(countFileFetches("docs/readme.md"), 1);
  assert.equal(countFileFetches("docs/other.md"), 1);

  const socket = harness.sockets[0];
  socket.receive(
    ServerEnvelope("file.changed", {
      eventType: "fileChanged",
      path: "docs/readme.md",
      fileId: "docs/readme.md",
      changedAt: "2026-06-09T00:00:00.000Z",
      source: "edit_tool",
    }, 10),
  );
  await FlushPromises();

  const readmeTab = harness.app
    .querySelectorAll(".sheaf-chat-tab")
    .find((tab) => tab.textContent.includes("readme.md"));
  assert.ok(readmeTab);
  assert.equal(readmeTab.classList.contains("sheaf-chat-tab--stale"), true);
  assert.equal(countFileFetches("docs/readme.md"), 1);

  readmeTab.click();
  await FlushPromises();

  const refreshedReadmeTab = harness.app
    .querySelectorAll(".sheaf-chat-tab")
    .find((tab) => tab.textContent.includes("readme.md"));
  assert.ok(refreshedReadmeTab);
  assert.equal(refreshedReadmeTab.classList.contains("sheaf-chat-tab--stale"), false);
  assert.equal(countFileFetches("docs/readme.md"), 2);

  const otherTab = harness.app
    .querySelectorAll(".sheaf-chat-tab")
    .find((tab) => tab.textContent.includes("other.md"));
  assert.ok(otherTab);
  otherTab.click();
  await FlushPromises();

  socket.receive(
    ServerEnvelope("file.changed", {
      eventType: "fileChanged",
      path: "docs/other.md",
      fileId: "docs/other.md",
      changedAt: "2026-06-09T00:00:01.000Z",
      source: "edit_tool",
    }, 11),
  );
  await FlushPromises();

  assert.equal(countFileFetches("docs/other.md"), 2);
});
