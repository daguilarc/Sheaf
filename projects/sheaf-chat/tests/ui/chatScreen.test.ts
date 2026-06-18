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

interface FakeRect
{
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}

class FakeChildCollection implements Iterable<FakeElement>
{
  private readonly x_items: FakeElement[] = [];

  public get length(): number
  {
    return this.x_items.length;
  }

  public set length(value: number)
  {
    this.x_items.length = value;
    this.x_SyncIndexes();
  }

  public [Symbol.iterator](): Iterator<FakeElement>
  {
    return this.x_items[Symbol.iterator]();
  }

  public at(index: number): FakeElement | undefined
  {
    return this.x_items.at(index);
  }

  public filter(predicate: (child: FakeElement) => boolean): FakeElement[]
  {
    return this.x_items.filter(predicate);
  }

  public includes(child: FakeElement): boolean
  {
    return this.x_items.includes(child);
  }

  public indexOf(child: FakeElement): number
  {
    return this.x_items.indexOf(child);
  }

  public map<T>(callback: (child: FakeElement) => T): T[]
  {
    return this.x_items.map(callback);
  }

  public push(child: FakeElement): number
  {
    const length = this.x_items.push(child);
    this.x_SyncIndexes();
    return length;
  }

  public splice(start: number, deleteCount: number, ...items: FakeElement[]): FakeElement[]
  {
    const removed = this.x_items.splice(start, deleteCount, ...items);
    this.x_SyncIndexes();
    return removed;
  }

  private x_SyncIndexes(): void
  {
    for (const key of Object.keys(this)) {
      if (/^\d+$/.test(key)) {
        delete (this as unknown as Record<string, FakeElement>)[key];
      }
    }
    this.x_items.forEach((item, index) => {
      (this as unknown as Record<number, FakeElement>)[index] = item;
    });
  }
}

class FakeElement
{
  public static activeElement: FakeElement | null = null;
  public static scrolledIntoView: FakeElement[] = [];
  public static scrollToCalls: Array<{ element: FakeElement; options: { top?: number; behavior?: string } }> = [];
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
  public readonly children = new FakeChildCollection();
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
  public getBoundingClientRect?: () => FakeRect;
  public scrollTo?: (options: { top?: number; behavior?: string }) => void;
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
    return Array.from(this.children);
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

  public focus(): void
  {
    FakeElement.activeElement = this;
    this.dispatchEvent({ type: "focus" });
  }

  public scrollIntoView(): void
  {
    FakeElement.scrolledIntoView.push(this);
  }

  public querySelector(selector: string): FakeElement | null
  {
    return this.querySelectorAll(selector)[0] || null;
  }

  public querySelectorAll(selector: string): FakeElement[]
  {
    const selectors = selector
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const results: FakeElement[] = [];
    const stack: FakeElement[] = [this];

    while (stack.length > 0) {
      const node = stack.shift();
      if (!node) {
        continue;
      }

      for (const candidate of selectors) {
        const parts = candidate.split(/\s+/).filter(Boolean);
        if (parts.length === 1) {
          if (this.x_MatchesSelector(node, parts[0])) {
            results.push(node);
            break;
          }
        } else if (this.x_MatchesDescendantSelector(node, parts)) {
          results.push(node);
          break;
        }
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
    const classMatch = /^\.([^\[]+)/.exec(selector);
    const attrMatch = /\[([^\]=]+)(?:="([^"]*)")?\]/.exec(selector);

    if (classMatch && !node.x_ClassNames().includes(classMatch[1])) {
      return false;
    }

    if (attrMatch) {
      const attrValue = node.getAttribute(attrMatch[1]);
      if (attrMatch[2] != null) {
        return attrValue === attrMatch[2];
      }
      return attrValue != null;
    }

    if (classMatch) {
      return true;
    }

    if (selector.includes("[")) {
      const tagMatch = /^([a-zA-Z][\w-]*)/.exec(selector);
      if (tagMatch && node.tagName !== tagMatch[1].toUpperCase()) {
        return false;
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
    /\/api\/repositories\/[^/]+\/workspaces\/[^/]+(?:\/chats\/[^/]+)?\/files\?path=(.+)$/,
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
    /\/api\/repositories\/[^/]+\/workspaces\/[^/]+(?:\/chats\/[^/]+)?\/file\?path=(.+)$/,
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
    /\/api\/repositories\/[^/]+\/workspaces\/[^/]+(?:\/chats\/[^/]+)?\/files\?path=(.+)$/,
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
    /\/api\/repositories\/[^/]+\/workspaces\/[^/]+(?:\/chats\/[^/]+)?\/file\?path=(.+)$/,
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
    hash: options?.hash || "#/repositories/repo-1/workspaces/workspace-1/chats/chat-1",
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
    repoId: "repo-1",
    workspaceId: "workspace-1",
    chatId: "chat-1",
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

function AssertSelectedFileTab(root: FakeElement, expectedPath: string): void
{
  assert.ok(
    Array.from(root.querySelectorAll(".sheaf-chat-tab--selected")).some((tab) =>
      tab.textContent.includes(expectedPath),
    ),
    `expected selected tab to include ${expectedPath}`,
  );
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

class SeededRandom
{
  private x_state: number;

  public constructor(seed: number)
  {
    this.x_state = seed >>> 0;
  }

  public next(): number
  {
    this.x_state = (Math.imul(this.x_state, 1664525) + 1013904223) >>> 0;
    return this.x_state / 0x100000000;
  }

  public int(maxExclusive: number): number
  {
    return Math.floor(this.next() * maxExclusive);
  }

  public pick<T>(items: T[]): T
  {
    assert.ok(items.length > 0, "expected seeded random choice candidates");
    return items[this.int(items.length)];
  }
}

interface ReviewWorkflowHunk
{
  file: string;
  hunkId: string;
  ordinal: number;
  header: string;
  patchHash: string;
  oldText: string;
  newText: string;
}

interface ReviewWorkflowUndo
{
  kind: "stage" | "revert";
  hunkId: string;
}

interface ReviewWorkflowCell
{
  x: number;
  y: number;
  r?: number;
  g?: number;
  b?: number;
  off?: true;
}

interface ExpectedClientFrame
{
  type: string;
  action?: string;
  hunkId?: string;
  patchHash?: string;
  text?: string;
  focused?: boolean;
  file?: string | null;
}

function CellKey(cell: Pick<ReviewWorkflowCell, "x" | "y">): string
{
  return `${cell.x},${cell.y}`;
}

function ReviewWorkflowCellMap(cells: ReviewWorkflowCell[]): Map<string, ReviewWorkflowCell>
{
  const map = new Map<string, ReviewWorkflowCell>();
  for (const cell of cells) {
    map.set(CellKey(cell), cell);
  }
  return map;
}

class FakeReviewDictatorRpc
{
  public readonly cellPaints: ReviewWorkflowCell[][] = [];
  public readonly insertTextCalls: string[] = [];

  public setCells(cells: ReviewWorkflowCell[]): void
  {
    this.cellPaints.push(cells.map((cell) => ({ ...cell })));
  }

  public insertText(text: string): void
  {
    this.insertTextCalls.push(text);
  }

  public lastCellPaint(): ReviewWorkflowCell[]
  {
    assert.ok(this.cellPaints.length > 0, "expected fake launchpad.setCells calls");
    return this.cellPaints[this.cellPaints.length - 1];
  }
}

function SerializedReviewFromEntries(entries: Array<Record<string, any>>): string | null
{
  const serializable = entries.filter((entry) =>
    entry.kind === "rejected" ||
    (typeof entry.text === "string" && entry.text.trim().length > 0)
  );
  if (serializable.length === 0) {
    return null;
  }

  return serializable.map((entry, index) => {
    const hunk = entry.hunk as Record<string, string>;
    const body = entry.kind === "rejected"
      ? "Rejected this hunk. Do not reintroduce it in the next turn."
      : String(entry.text).trim();
    return [
      `${index + 1}. ${hunk.sourceProvider} ${hunk.file} ${hunk.header} [${hunk.patchHash}]`,
      body,
      "",
      "```diff",
      String(hunk.patch).trimEnd(),
      "```",
    ].join("\n");
  }).join("\n\n");
}

function RandomReviewSession(seed: number): ReviewWorkflowHunk[]
{
  const random = new SeededRandom(seed);
  const files = [
    { file: "alpha.ts", hunks: 3 },
    { file: "beta.ts", hunks: 2 + random.int(2) },
    { file: "gamma.ts", hunks: 2 + random.int(2) },
  ];
  const hunks: ReviewWorkflowHunk[] = [];

  for (const file of files) {
    for (let index = 0; index < file.hunks; index += 1) {
      const line = 8 + (index * 11) + random.int(3);
      const shortFile = file.file.replace(/\W+/g, "-");
      hunks.push({
        file: file.file,
        hunkId: `${shortFile}-hunk-${index + 1}`,
        ordinal: index,
        header: `@@ -${line},1 +${line},1 @@`,
        patchHash: `${shortFile}-hash-${index + 1}-${random.int(10000)}`,
        oldText: `${file.file} old separated line ${index + 1}`,
        newText: `${file.file} new separated line ${index + 1}`,
      });
    }
  }

  return hunks;
}

class FakeAgentReviewWorkflow
{
  public readonly seed: number;
  public readonly hunks: ReviewWorkflowHunk[];
  public readonly fileOrder: string[];
  public readonly unstaged = new Set<string>();
  public readonly staged = new Set<string>();
  public readonly rejected = new Set<string>();
  public readonly pastedRejected = new Set<string>();
  public readonly comments = new Map<string, string>();
  public readonly undoStack: ReviewWorkflowUndo[] = [];
  public readonly dictator = new FakeReviewDictatorRpc();
  public readonly serverFrames: Array<Record<string, any>> = [];
  public visibleCommentHunkId: string | null = null;
  public focused = true;
  public currentHunkId: string | null;
  public fileAnchor: string;
  private x_socket: FakeWebSocket | null = null;
  private x_nextSentIndex = 0;

  public constructor(seed: number)
  {
    this.seed = seed;
    this.hunks = RandomReviewSession(seed);
    this.fileOrder = Array.from(new Set(this.hunks.map((hunk) => hunk.file)));
    for (const hunk of this.hunks) {
      this.unstaged.add(hunk.hunkId);
    }
    this.currentHunkId = this.hunks[0].hunkId;
    this.fileAnchor = this.hunks[0].file;
    this.x_UpdateCells();
  }

  public attach(socket: FakeWebSocket): void
  {
    this.x_socket = socket;
  }

  public sendBootstrap(): void
  {
    this.x_Receive({ type: "bootstrap", state: this.state() });
  }

  public receiveClientFrames(): Array<Record<string, any>>
  {
    assert.ok(this.x_socket, "expected fake review socket to be attached");
    const processed: Array<Record<string, any>> = [];
    while (this.x_nextSentIndex < this.x_socket.sent.length) {
      const frame = JSON.parse(this.x_socket.sent[this.x_nextSentIndex]) as Record<string, any>;
      this.x_nextSentIndex += 1;
      processed.push(frame);
      this.x_HandleClientFrame(frame);
    }
    return processed;
  }

  public hunk(hunkId: string): ReviewWorkflowHunk
  {
    const hunk = this.hunks.find((entry) => entry.hunkId === hunkId);
    assert.ok(hunk, `seed ${this.seed}: expected hunk ${hunkId}`);
    return hunk;
  }

  public currentHunk(): ReviewWorkflowHunk | null
  {
    return this.currentHunkId ? this.hunk(this.currentHunkId) : null;
  }

  public state(): Record<string, any>
  {
    const visibleHunks = this.x_VisibleHunks();
    const files = this.fileOrder
      .map((file) => ({
        file,
        hunkCount: visibleHunks.filter((hunk) => hunk.file === file).length,
      }))
      .filter((file) => file.hunkCount > 0);
    const currentHunk = this.currentHunk();
    const currentIndex = currentHunk
      ? visibleHunks.findIndex((hunk) => hunk.hunkId === currentHunk.hunkId)
      : -1;

    return {
      available: true,
      repoRoot: "/repo",
      sessionRoot: "/repo/projects/demo",
      sessionRootRelativeToRepo: "projects/demo",
      currentIndex,
      currentHunk: currentHunk ? this.x_AgentHunk(currentHunk, visibleHunks, files) : null,
      hunks: visibleHunks.map((hunk) => this.x_AgentHunk(hunk, visibleHunks, files)),
      files,
      inlineFiles: this.x_InlineFiles(),
      actions: this.actions(),
      reviewDraft: this.reviewDraft(),
      dictatorBridge: { connected: true, url: "fake://dictator", lastError: null },
    };
  }

  public actions(): Record<string, boolean>
  {
    const current = this.currentHunk();
    const currentFile = current ? current.file : this.fileAnchor;
    const sameFile = this.x_UnstagedInFile(currentFile);
    return {
      canGoUp: current !== null && sameFile.length > 1,
      canGoDown: current !== null && sameFile.length > 1,
      canGoPrevFile: this.x_FileWithUnstagedBefore(currentFile) !== null,
      canGoNextFile: this.x_FileWithUnstagedAfter(currentFile) !== null,
      canStage: current !== null,
      canRevert: current !== null,
      canUndo: this.undoStack.length > 0,
    };
  }

  public reviewDraft(): Record<string, any>
  {
    const entries: Array<Record<string, any>> = [];
    for (const hunk of this.hunks) {
      const text = this.comments.get(hunk.hunkId);
      if (text && text.trim().length > 0) {
        entries.push({
          kind: "comment",
          hunk: this.x_AgentHunkSnapshot(hunk),
          text,
        });
      }
      if (this.rejected.has(hunk.hunkId)) {
        entries.push({
          kind: "rejected",
          hunk: this.x_AgentHunkSnapshot(hunk),
        });
      }
    }
    return {
      entries,
      visibleCommentHunkId: this.visibleCommentHunkId,
      hasSerializedContent: entries.length > 0,
    };
  }

  public serializedReview(): string | null
  {
    return SerializedReviewFromEntries(this.reviewDraft().entries as Array<Record<string, any>>);
  }

  public expectedCells(): ReviewWorkflowCell[]
  {
    return this.x_ComputeCells();
  }

  public observedState(): Record<string, any>
  {
    const frame = this.serverFrames
      .slice()
      .reverse()
      .find((entry) => entry && entry.state);
    assert.ok(frame, `seed ${this.seed}: expected observed Agent Review state frame`);
    return frame.state;
  }

  public pressCell(x: number, y: number): void
  {
    if (x === 3 && y === 3) {
      if (!this.focused) {
        const serialized = this.serializedReview();
        if (this.currentHunkId === null && serialized !== null) {
          this.dictator.insertText(serialized);
          this.comments.clear();
          for (const hunkId of this.rejected) {
            this.pastedRejected.add(hunkId);
          }
          this.rejected.clear();
          this.visibleCommentHunkId = null;
          this.x_EmitState();
        }
        this.x_UpdateCells();
        return;
      }

      if (this.currentHunkId !== null) {
        this.visibleCommentHunkId = this.currentHunkId;
        this.x_EmitState();
        this.x_Receive({ type: "focus_comment", hunkId: this.currentHunkId });
      }
      this.x_UpdateCells();
      return;
    }

    const actionByCell: Record<string, string> = {
      "0,2": "revert",
      "1,2": "previousHunk",
      "2,2": "stage",
      "3,2": "undo",
      "0,3": "previousFile",
      "1,3": "nextHunk",
      "2,3": "nextFile",
    };
    const action = actionByCell[`${x},${y}`];
    if (!this.focused || !action) {
      this.x_UpdateCells();
      return;
    }
    this.x_RunCommand(action, undefined, undefined, "fake-cell-press");
    this.x_Receive({
      type: "command_result",
      result: { ok: true, action, commandId: "fake-cell-press" },
      state: this.state(),
    });
  }

  public assertTargetedNonFirstMutation(
    mutatedHunkId: string,
    firstHunkId: string,
    step: string,
  ): void
  {
    assert.ok(
      this.staged.has(mutatedHunkId) || this.rejected.has(mutatedHunkId),
      `seed ${this.seed} ${step}: expected selected non-first hunk ${mutatedHunkId} to be mutated`,
    );
    assert.ok(
      this.unstaged.has(firstHunkId),
      `seed ${this.seed} ${step}: first hunk ${firstHunkId} must remain unstaged`,
    );
    assert.equal(
      this.staged.has(firstHunkId) || this.rejected.has(firstHunkId),
      false,
      `seed ${this.seed} ${step}: first hunk ${firstHunkId} must not be mutated`,
    );
  }

  public assertModel(step: string): void
  {
    for (const hunk of this.hunks) {
      const buckets = [
        this.unstaged.has(hunk.hunkId),
        this.staged.has(hunk.hunkId),
        this.rejected.has(hunk.hunkId),
        this.pastedRejected.has(hunk.hunkId),
      ].filter(Boolean).length;
      assert.equal(buckets, 1, `seed ${this.seed} ${step}: hunk ${hunk.hunkId} must be in exactly one bucket`);
    }
    assert.deepEqual(
      this.dictator.lastCellPaint(),
      this.expectedCells(),
      `seed ${this.seed} ${step}: observed fake Launchpad colors must match the expected model`,
    );
  }

  private x_HandleClientFrame(frame: Record<string, any>): void
  {
    if (frame.type === "presence") {
      this.focused = frame.focused === true;
      this.x_UpdateCells();
      return;
    }

    if (frame.type === "focus") {
      if (typeof frame.hunkId === "string") {
        const target = this.hunks.find((hunk) => hunk.hunkId === frame.hunkId && this.unstaged.has(hunk.hunkId));
        if (target) {
          this.currentHunkId = target.hunkId;
          this.fileAnchor = target.file;
        }
      } else {
        this.currentHunkId = null;
        this.fileAnchor = typeof frame.file === "string" ? frame.file : this.fileAnchor;
      }
      this.x_EmitState();
      return;
    }

    if (frame.type === "command") {
      const action = String(frame.action || "");
      this.x_RunCommand(action, frame.hunkId, frame.patchHash, frame.id);
      this.x_Receive({
        type: "command_result",
        result: { ok: true, action, commandId: frame.id },
        state: this.state(),
      });
      return;
    }

    if (frame.type === "comment") {
      const hunkId = String(frame.hunkId || "");
      const text = String(frame.text || "");
      if (text.trim().length > 0) {
        this.comments.set(hunkId, text);
      } else {
        this.comments.delete(hunkId);
      }
      this.visibleCommentHunkId = hunkId;
      this.x_EmitState();
      return;
    }

    if (frame.type === "comment_focus") {
      this.visibleCommentHunkId = String(frame.hunkId || "");
      this.x_UpdateCells();
      return;
    }

    if (frame.type === "comment_blur") {
      this.x_UpdateCells();
    }
  }

  private x_RunCommand(action: string, hunkId?: string, patchHash?: string, commandId?: string): void
  {
    const current = this.currentHunk();
    if (action === "stage" || action === "revert") {
      assert.ok(current, `seed ${this.seed}: expected current hunk for ${action}`);
      assert.equal(hunkId, current.hunkId, `seed ${this.seed}: ${action} must target the selected hunk`);
      assert.equal(patchHash, current.patchHash, `seed ${this.seed}: ${action} must include selected patch hash`);
    }

    if (action === "nextHunk") {
      this.x_MoveHunk(1);
    } else if (action === "previousHunk") {
      this.x_MoveHunk(-1);
    } else if (action === "nextFile") {
      this.x_MoveFile(1);
    } else if (action === "previousFile") {
      this.x_MoveFile(-1);
    } else if (action === "stage" && current) {
      this.x_MutateCurrentHunk(current, "stage");
    } else if (action === "revert" && current) {
      this.x_MutateCurrentHunk(current, "revert");
    } else if (action === "undo") {
      this.x_Undo();
    } else {
      assert.fail(`seed ${this.seed}: unsupported review action ${action} (${commandId || "no id"})`);
    }
    this.x_UpdateCells();
  }

  private x_MoveHunk(direction: 1 | -1): void
  {
    const current = this.currentHunk();
    if (!current) {
      return;
    }
    const sameFile = this.x_UnstagedInFile(current.file);
    const index = sameFile.findIndex((hunk) => hunk.hunkId === current.hunkId);
    if (index < 0 || sameFile.length < 2) {
      return;
    }
    const nextIndex = (index + direction + sameFile.length) % sameFile.length;
    this.currentHunkId = sameFile[nextIndex].hunkId;
    this.fileAnchor = sameFile[nextIndex].file;
  }

  private x_MoveFile(direction: 1 | -1): void
  {
    const target = direction > 0
      ? this.x_FileWithUnstagedAfter(this.fileAnchor)
      : this.x_FileWithUnstagedBefore(this.fileAnchor);
    if (!target) {
      return;
    }
    const hunks = this.x_UnstagedInFile(target);
    this.currentHunkId = hunks[0]?.hunkId || null;
    this.fileAnchor = target;
  }

  private x_MutateCurrentHunk(current: ReviewWorkflowHunk, kind: "stage" | "revert"): void
  {
    this.unstaged.delete(current.hunkId);
    if (kind === "stage") {
      this.staged.add(current.hunkId);
    } else {
      this.rejected.add(current.hunkId);
      this.pastedRejected.delete(current.hunkId);
    }
    this.undoStack.push({ kind, hunkId: current.hunkId });
    this.visibleCommentHunkId = null;
    this.x_FocusAfterMutation(current);
  }

  private x_FocusAfterMutation(previous: ReviewWorkflowHunk): void
  {
    const remaining = this.x_UnstagedInFile(previous.file);
    this.fileAnchor = previous.file;
    if (remaining.length === 0) {
      this.currentHunkId = null;
      return;
    }
    const next = remaining.find((hunk) => hunk.ordinal > previous.ordinal) || remaining.at(-1);
    this.currentHunkId = next ? next.hunkId : null;
  }

  private x_Undo(): void
  {
    const entry = this.undoStack.pop();
    if (!entry) {
      return;
    }
    if (entry.kind === "stage") {
      this.staged.delete(entry.hunkId);
    } else {
      this.rejected.delete(entry.hunkId);
      this.pastedRejected.delete(entry.hunkId);
    }
    this.unstaged.add(entry.hunkId);
    const hunk = this.hunk(entry.hunkId);
    this.currentHunkId = entry.hunkId;
    this.fileAnchor = hunk.file;
    this.visibleCommentHunkId = null;
  }

  private x_EmitState(): void
  {
    this.x_UpdateCells();
    this.x_Receive({ type: "state", state: this.state() });
  }

  private x_Receive(envelope: unknown): void
  {
    assert.ok(this.x_socket, "expected fake review socket to be attached");
    this.serverFrames.push(envelope as Record<string, any>);
    this.x_socket.receive(envelope);
  }

  private x_UpdateCells(): void
  {
    this.dictator.setCells(this.x_ComputeCells());
  }

  private x_ComputeCells(): ReviewWorkflowCell[]
  {
    const actions = this.actions();
    const off = (x: number, y: number): ReviewWorkflowCell => ({ x, y, off: true });
    const navCells: Array<ReviewWorkflowCell & { availability: string }> = [
      { x: 0, y: 2, availability: "canRevert", r: 255, g: 0, b: 0 },
      { x: 1, y: 2, availability: "canGoUp", r: 255, g: 255, b: 0 },
      { x: 2, y: 2, availability: "canStage", r: 0, g: 255, b: 0 },
      { x: 3, y: 2, availability: "canUndo", r: 255, g: 255, b: 255 },
      { x: 0, y: 3, availability: "canGoPrevFile", r: 255, g: 255, b: 0 },
      { x: 1, y: 3, availability: "canGoDown", r: 255, g: 255, b: 0 },
      { x: 2, y: 3, availability: "canGoNextFile", r: 255, g: 255, b: 0 },
    ];
    const cells = navCells.map((cell) =>
      this.focused && actions[cell.availability]
        ? { x: cell.x, y: cell.y, r: cell.r, g: cell.g, b: cell.b }
        : off(cell.x, cell.y),
    );
    const reviewColor = !this.focused
      ? (this.currentHunkId === null && this.serializedReview() !== null
        ? { r: 0, g: 255, b: 0 }
        : { off: true as const })
      : (this.serializedReview() !== null
        ? { r: 0, g: 0, b: 255 }
        : { r: 90, g: 90, b: 90 });
    cells.push({ x: 3, y: 3, ...reviewColor });
    return cells;
  }

  private x_VisibleHunks(): ReviewWorkflowHunk[]
  {
    return this.hunks.filter((hunk) => this.unstaged.has(hunk.hunkId));
  }

  private x_UnstagedInFile(file: string): ReviewWorkflowHunk[]
  {
    return this.hunks.filter((hunk) => hunk.file === file && this.unstaged.has(hunk.hunkId));
  }

  private x_FileWithUnstagedAfter(file: string): string | null
  {
    const start = this.fileOrder.indexOf(file);
    for (let index = Math.max(0, start + 1); index < this.fileOrder.length; index += 1) {
      if (this.x_UnstagedInFile(this.fileOrder[index]).length > 0) {
        return this.fileOrder[index];
      }
    }
    return null;
  }

  private x_FileWithUnstagedBefore(file: string): string | null
  {
    const start = this.fileOrder.indexOf(file);
    for (let index = start - 1; index >= 0; index -= 1) {
      if (this.x_UnstagedInFile(this.fileOrder[index]).length > 0) {
        return this.fileOrder[index];
      }
    }
    return null;
  }

  private x_AgentHunk(
    hunk: ReviewWorkflowHunk,
    visibleHunks: ReviewWorkflowHunk[],
    files: Array<{ file: string; hunkCount: number }>,
  ): Record<string, any>
  {
    const fileIndex = files.findIndex((file) => file.file === hunk.file);
    return {
      ...this.x_AgentHunkSnapshot(hunk),
      hunkIndex: visibleHunks.findIndex((entry) => entry.hunkId === hunk.hunkId),
      hunkCount: visibleHunks.length,
      fileIndex,
      fileCount: files.length,
    };
  }

  private x_AgentHunkSnapshot(hunk: ReviewWorkflowHunk): Record<string, any>
  {
    return {
      sourceProvider: "sheaf-chat",
      repoRoot: "/repo",
      sessionRoot: "/repo/projects/demo",
      file: hunk.file,
      hunkId: hunk.hunkId,
      hunkIndex: hunk.ordinal,
      hunkCount: this.hunks.length,
      fileIndex: this.fileOrder.indexOf(hunk.file),
      fileCount: this.fileOrder.length,
      header: hunk.header,
      patchHash: hunk.patchHash,
      patch: [
        `diff --git a/${hunk.file} b/${hunk.file}`,
        hunk.header,
        `-${hunk.oldText}`,
        `+${hunk.newText}`,
        "",
      ].join("\n"),
    };
  }

  private x_InlineFiles(): Array<Record<string, any>>
  {
    return this.fileOrder.map((file) => {
      const rows: Array<Record<string, any>> = [];
      let lineNumber = 1;
      for (const hunk of this.hunks.filter((entry) => entry.file === file)) {
        rows.push({
          id: `${hunk.hunkId}-context-before-a`,
          kind: "context",
          text: `${file} context ${hunk.ordinal + 1}.a`,
          newLineNumber: lineNumber,
        });
        lineNumber += 1;
        rows.push({
          id: `${hunk.hunkId}-context-before-b`,
          kind: "context",
          text: `${file} context ${hunk.ordinal + 1}.b`,
          newLineNumber: lineNumber,
        });
        lineNumber += 1;
        if (this.unstaged.has(hunk.hunkId)) {
          rows.push({
            id: `${hunk.hunkId}-old`,
            kind: "deletion",
            text: hunk.oldText,
            hunkId: hunk.hunkId,
            oldLineNumber: lineNumber,
          });
          rows.push({
            id: `${hunk.hunkId}-new`,
            kind: "addition",
            text: hunk.newText,
            hunkId: hunk.hunkId,
            newLineNumber: lineNumber,
          });
        }
        lineNumber += 1;
      }
      return { file, rows };
    });
  }
}

async function FlushReviewWorkflow(harness: ChatHarness): Promise<void>
{
  await FlushPromises();
  harness.runTimers();
  harness.flushAnimationFrames();
  await FlushPromises();
}

function ReviewCommandButton(root: FakeElement, label: string): FakeElement
{
  const button = root
    .querySelectorAll(".sheaf-chat-agent-review-command")
    .find((entry) => entry.textContent === label);
  assert.ok(button, "expected Agent Review command button " + label);
  return button;
}

function ClickReviewCommand(root: FakeElement, label: string, seed: number, step: string): void
{
  const button = ReviewCommandButton(root, label);
  assert.equal(button.disabled, false, `seed ${seed} ${step}: ${label} button should be enabled before click`);
  button.click();
}

function ClientFramesSince(socket: FakeWebSocket, startIndex: number): Array<Record<string, any>>
{
  return socket.sent
    .slice(startIndex)
    .map((raw) => JSON.parse(raw) as Record<string, any>);
}

function ExpectedCommandFrame(workflow: FakeAgentReviewWorkflow, action: string): ExpectedClientFrame
{
  const current = workflow.currentHunk();
  return {
    type: "command",
    action,
    hunkId: current?.hunkId,
    patchHash: current?.patchHash,
  };
}

function AssertClientFrames(
  actual: Array<Record<string, any>>,
  expected: ExpectedClientFrame[],
  seed: number,
  step: string,
): void
{
  assert.equal(
    actual.length,
    expected.length,
    `seed ${seed} ${step}: expected ${expected.length} new WebSocket frame(s), got ${actual.length}`,
  );

  for (let index = 0; index < expected.length; index += 1) {
    const actualFrame = actual[index];
    const expectedFrame = expected[index];
    assert.equal(actualFrame.type, expectedFrame.type, `seed ${seed} ${step}: frame ${index} type`);

    if (expectedFrame.type === "command") {
      assert.equal(actualFrame.action, expectedFrame.action, `seed ${seed} ${step}: command action`);
      assert.equal(actualFrame.hunkId, expectedFrame.hunkId, `seed ${seed} ${step}: command hunkId`);
      assert.equal(actualFrame.patchHash, expectedFrame.patchHash, `seed ${seed} ${step}: command patchHash`);
      assert.equal(typeof actualFrame.id, "string", `seed ${seed} ${step}: command id should be generated`);
    } else if (expectedFrame.type === "comment") {
      assert.equal(actualFrame.hunkId, expectedFrame.hunkId, `seed ${seed} ${step}: comment hunkId`);
      assert.equal(actualFrame.text, expectedFrame.text, `seed ${seed} ${step}: comment text`);
    } else if (expectedFrame.type === "comment_focus") {
      assert.equal(actualFrame.hunkId, expectedFrame.hunkId, `seed ${seed} ${step}: comment focus hunkId`);
    } else if (expectedFrame.type === "presence") {
      assert.equal(actualFrame.focused, expectedFrame.focused, `seed ${seed} ${step}: presence focus`);
    } else if (expectedFrame.type === "focus") {
      assert.equal(actualFrame.hunkId ?? null, expectedFrame.hunkId ?? null, `seed ${seed} ${step}: focus hunkId`);
      assert.equal(actualFrame.file ?? null, expectedFrame.file ?? null, `seed ${seed} ${step}: focus file`);
    } else {
      assert.fail(`seed ${seed} ${step}: unsupported expected frame type ${expectedFrame.type}`);
    }
  }
}

async function CompleteObservedStep(
  harness: ChatHarness,
  workflow: FakeAgentReviewWorkflow,
  socket: FakeWebSocket,
  beforeSent: number,
  expectedFrames: ExpectedClientFrame[],
  step: string,
): Promise<void>
{
  const sentFrames = ClientFramesSince(socket, beforeSent);
  AssertClientFrames(sentFrames, expectedFrames, workflow.seed, step);
  const processedFrames = workflow.receiveClientFrames();
  assert.deepEqual(
    processedFrames,
    sentFrames,
    `seed ${workflow.seed} ${step}: fake service should process the observed client frames`,
  );
  await FlushReviewWorkflow(harness);
  AssertReviewWorkflowUi(harness, workflow, step);
}

async function ClickReviewCommandStep(
  harness: ChatHarness,
  workflow: FakeAgentReviewWorkflow,
  socket: FakeWebSocket,
  label: string,
  action: string,
  step: string,
): Promise<void>
{
  const beforeSent = socket.sent.length;
  const expected = ExpectedCommandFrame(workflow, action);
  ClickReviewCommand(harness.app, label, workflow.seed, step);
  await CompleteObservedStep(harness, workflow, socket, beforeSent, [expected], step);
}

async function SetReviewPresenceStep(
  harness: ChatHarness,
  workflow: FakeAgentReviewWorkflow,
  socket: FakeWebSocket,
  hidden: boolean,
  step: string,
): Promise<void>
{
  const beforeSent = socket.sent.length;
  (harness.document as any).hidden = hidden;
  harness.document.dispatchEvent({ type: "visibilitychange" });
  await CompleteObservedStep(
    harness,
    workflow,
    socket,
    beforeSent,
    [{ type: "presence", focused: !hidden }],
    step,
  );
}

function AgentReviewStateFetch(workflow: FakeAgentReviewWorkflow) {
  return async (requestPath: string): Promise<FakeFetchResponse> => {
    if (requestPath.endsWith("/agent-review")) {
      return JsonResponse(workflow.state());
    }
    if (requestPath.includes("/files?path=")) {
      return JsonResponse({
        directory: { name: ".", path: ".", kind: "directory" },
        entries: workflow.fileOrder.map((file) => ({
          name: file,
          path: file,
          kind: "file",
          supported: true,
          contentType: "text/plain",
        })),
      });
    }
    if (requestPath.includes("/file?path=")) {
      const filePath = decodeURIComponent(requestPath.split("/file?path=")[1] || "");
      const content = workflow.hunks
        .filter((hunk) => hunk.file === filePath)
        .map((hunk) => hunk.newText)
        .join("\n") + "\n";
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
    return JsonResponse({});
  };
}

function AssertReviewWorkflowUi(
  harness: ChatHarness,
  workflow: FakeAgentReviewWorkflow,
  step: string,
): void
{
  const state = workflow.observedState();
  const current = state.currentHunk as Record<string, any> | null;
  const seedPrefix = `seed ${workflow.seed} ${step}`;
  const focusedRows = harness.app.querySelectorAll(".sheaf-chat-agent-review-inline-row--focused");

  if (current) {
    assert.ok(
      focusedRows.length >= 2,
      `${seedPrefix}: expected focused inline rows for ${current.hunkId}`,
    );
    assert.ok(
      focusedRows.every((row) => row.getAttribute("data-hunk-id") === current.hunkId),
      `${seedPrefix}: focused rows should belong to ${current.hunkId}`,
    );
    const counts = RequiredElement(harness.app, ".sheaf-chat-agent-review-counts");
    assert.match(counts.textContent, /in file/, `${seedPrefix}: expected hunk/file counts`);
  } else {
    assert.equal(focusedRows.length, 0, `${seedPrefix}: expected no focused rows without current hunk`);
    assert.match(
      RequiredElement(harness.app, ".sheaf-chat-agent-review-status").textContent,
      /No unstaged hunks/,
      `${seedPrefix}: expected no-current-hunk status`,
    );
  }

  const buttonExpectations: Array<[string, string]> = [
    ["Prev File", "canGoPrevFile"],
    ["Prev", "canGoUp"],
    ["Next", "canGoDown"],
    ["Next File", "canGoNextFile"],
    ["Stage", "canStage"],
    ["Revert", "canRevert"],
    ["Undo", "canUndo"],
  ];
  for (const [label, key] of buttonExpectations) {
    assert.equal(
      ReviewCommandButton(harness.app, label).disabled,
      state.actions[key] !== true,
      `${seedPrefix}: ${label} availability should match model`,
    );
  }

  const textarea = harness.app.querySelector(".sheaf-chat-agent-review-comment-textarea") as FakeElement | null;
  const expectedComment = current ? workflow.comments.get(String(current.hunkId)) || "" : "";
  const shouldShowComment =
    current !== null &&
    (expectedComment.trim().length > 0 || workflow.visibleCommentHunkId === current.hunkId);
  if (shouldShowComment) {
    assert.ok(textarea, `${seedPrefix}: expected focused comment textarea`);
    assert.equal(textarea.value, expectedComment, `${seedPrefix}: rendered comment text should match model`);
  } else {
    assert.equal(textarea, null, `${seedPrefix}: expected no focused comment textarea`);
  }

  const cellMap = ReviewWorkflowCellMap(workflow.dictator.lastCellPaint());
  const expectedCells = ReviewWorkflowCellMap(workflow.expectedCells());
  for (const [key, expected] of expectedCells) {
    assert.deepEqual(cellMap.get(key), expected, `${seedPrefix}: fake Launchpad cell ${key}`);
  }

  const expectedDraft = workflow.reviewDraft();
  assert.deepEqual(
    state.reviewDraft.entries,
    expectedDraft.entries,
    `${seedPrefix}: review draft entries should match the expected model`,
  );
  assert.equal(
    state.reviewDraft.visibleCommentHunkId,
    expectedDraft.visibleCommentHunkId,
    `${seedPrefix}: visible comment hunk should match the expected model`,
  );
  const observedSerialized = SerializedReviewFromEntries(state.reviewDraft.entries);
  assert.equal(
    state.reviewDraft.hasSerializedContent,
    observedSerialized !== null,
    `${seedPrefix}: serialized draft availability should match model`,
  );
  assert.equal(
    observedSerialized,
    workflow.serializedReview(),
    `${seedPrefix}: serialized review text should match the expected draft entries`,
  );
  workflow.assertModel(step);
}

test("Agent Review Mode randomized Agent Review workflow seed 0x5eed2026", async () =>
{
  const seed = 0x5eed2026;
  const random = new SeededRandom(seed);
  const workflow = new FakeAgentReviewWorkflow(seed);
  const alphaFirst = "alpha-ts-hunk-1";
  const alphaSecond = "alpha-ts-hunk-2";
  const harness = LoadChatHarness({ fetch: AgentReviewStateFetch(workflow) });
  await FlushPromises();

  const reviewSocket = harness.sockets.find((socket) => socket.url.includes("/ws/agent-review"));
  assert.ok(reviewSocket, `seed ${seed}: expected Agent Review WebSocket`);
  workflow.attach(reviewSocket);
  reviewSocket.open();
  const openFrames = workflow.receiveClientFrames();
  AssertClientFrames(openFrames, [{ type: "presence", focused: true }], seed, "socket open presence");
  workflow.sendBootstrap();
  await FlushReviewWorkflow(harness);
  AssertReviewWorkflowUi(harness, workflow, "bootstrap");

  await ClickReviewCommandStep(harness, workflow, reviewSocket, "Next", "nextHunk", "skip first hunk");
  assert.equal(workflow.currentHunkId, alphaSecond, `seed ${seed}: expected navigation to non-first alpha hunk`);
  assert.ok(workflow.unstaged.has(alphaFirst), `seed ${seed}: skipped first alpha hunk should remain unstaged`);
  AssertReviewWorkflowUi(harness, workflow, "after skipping first hunk");

  await ClickReviewCommandStep(harness, workflow, reviewSocket, "Stage", "stage", "stage non-first hunk");
  workflow.assertTargetedNonFirstMutation(alphaSecond, alphaFirst, "after staging non-first hunk");
  AssertReviewWorkflowUi(harness, workflow, "after staging non-first hunk");

  await ClickReviewCommandStep(harness, workflow, reviewSocket, "Undo", "undo", "undo non-first stage");
  assert.ok(workflow.unstaged.has(alphaSecond), `seed ${seed}: undo-stage should restore selected non-first hunk`);
  assert.equal(workflow.staged.has(alphaSecond), false, `seed ${seed}: undo-stage should unstage selected hunk`);
  AssertReviewWorkflowUi(harness, workflow, "after undoing non-first stage");

  await ClickReviewCommandStep(harness, workflow, reviewSocket, "Revert", "revert", "revert non-first hunk");
  workflow.assertTargetedNonFirstMutation(alphaSecond, alphaFirst, "after reverting non-first hunk");
  AssertReviewWorkflowUi(harness, workflow, "after reverting non-first hunk");

  await ClickReviewCommandStep(harness, workflow, reviewSocket, "Undo", "undo", "undo non-first revert");
  assert.ok(workflow.unstaged.has(alphaSecond), `seed ${seed}: undo-revert should restore selected non-first hunk`);
  assert.equal(workflow.rejected.has(alphaSecond), false, `seed ${seed}: undo-revert should clear selected rejected marker`);
  AssertReviewWorkflowUi(harness, workflow, "after undoing non-first revert");

  const initialCommentText = `seed ${seed} deterministic comment add`;
  let beforeSent = reviewSocket.sent.length;
  workflow.pressCell(3, 3);
  await FlushReviewWorkflow(harness);
  let commentBox = RequiredElement(
    harness.app,
    ".sheaf-chat-agent-review-comment-textarea",
  ) as FakeElement;
  commentBox.value = initialCommentText;
  commentBox.dispatchEvent({ type: "input" });
  await CompleteObservedStep(
    harness,
    workflow,
    reviewSocket,
    beforeSent,
    [
      { type: "comment_focus", hunkId: alphaSecond },
      { type: "comment", hunkId: alphaSecond, text: initialCommentText },
    ],
    "after deterministic comment add",
  );
  assert.equal(
    workflow.comments.get(alphaSecond),
    initialCommentText,
    `seed ${seed}: expected initial deterministic comment to be stored`,
  );

  const editedCommentText = `seed ${seed} deterministic comment edit`;
  beforeSent = reviewSocket.sent.length;
  commentBox = RequiredElement(
    harness.app,
    ".sheaf-chat-agent-review-comment-textarea",
  ) as FakeElement;
  commentBox.value = editedCommentText;
  commentBox.dispatchEvent({ type: "input" });
  await CompleteObservedStep(
    harness,
    workflow,
    reviewSocket,
    beforeSent,
    [{ type: "comment", hunkId: alphaSecond, text: editedCommentText }],
    "after deterministic comment edit",
  );
  assert.equal(
    workflow.comments.get(alphaSecond),
    editedCommentText,
    `seed ${seed}: expected deterministic comment edit to overwrite the earlier text`,
  );
  assert.equal(
    workflow.reviewDraft().entries.filter((entry: Record<string, any>) =>
      entry.kind === "comment" &&
      entry.hunk.hunkId === alphaSecond &&
      entry.text === editedCommentText
    ).length,
    1,
    `seed ${seed}: expected exactly one edited comment draft entry for ${alphaSecond}`,
  );

  assert.equal(workflow.actions().canGoNextFile, true, `seed ${seed}: expected next-file to be available`);
  await ClickReviewCommandStep(harness, workflow, reviewSocket, "Next File", "nextFile", "guaranteed next-file jump");
  AssertReviewWorkflowUi(harness, workflow, "after guaranteed next-file jump");

  if (workflow.actions().canGoPrevFile) {
    await ClickReviewCommandStep(
      harness,
      workflow,
      reviewSocket,
      "Prev File",
      "previousFile",
      "guaranteed previous-file jump",
    );
    AssertReviewWorkflowUi(harness, workflow, "after guaranteed previous-file jump");
  }

  const runRandomStep = async (index: number): Promise<void> => {
    const actions = workflow.actions();
    const candidates: Array<() => Promise<{
      label: string;
      beforeSent: number;
      expectedFrames: ExpectedClientFrame[];
    }>> = [];

    if (actions.canGoDown) {
      candidates.push(async () => {
        const beforeSent = reviewSocket.sent.length;
        const expected = ExpectedCommandFrame(workflow, "nextHunk");
        ClickReviewCommand(harness.app, "Next", seed, `random ${index} next hunk`);
        return { label: "next hunk", beforeSent, expectedFrames: [expected] };
      });
    }
    if (actions.canGoUp) {
      candidates.push(async () => {
        const beforeSent = reviewSocket.sent.length;
        const expected = ExpectedCommandFrame(workflow, "previousHunk");
        ClickReviewCommand(harness.app, "Prev", seed, `random ${index} previous hunk`);
        return { label: "previous hunk", beforeSent, expectedFrames: [expected] };
      });
    }
    if (actions.canGoNextFile) {
      candidates.push(async () => {
        const beforeSent = reviewSocket.sent.length;
        const expected = ExpectedCommandFrame(workflow, "nextFile");
        ClickReviewCommand(harness.app, "Next File", seed, `random ${index} next file`);
        return { label: "next file", beforeSent, expectedFrames: [expected] };
      });
    }
    if (actions.canGoPrevFile) {
      candidates.push(async () => {
        const beforeSent = reviewSocket.sent.length;
        const expected = ExpectedCommandFrame(workflow, "previousFile");
        ClickReviewCommand(harness.app, "Prev File", seed, `random ${index} previous file`);
        return { label: "previous file", beforeSent, expectedFrames: [expected] };
      });
    }
    if (actions.canStage) {
      candidates.push(async () => {
        const beforeSent = reviewSocket.sent.length;
        const expected = ExpectedCommandFrame(workflow, "stage");
        ClickReviewCommand(harness.app, "Stage", seed, `random ${index} stage`);
        return { label: "stage", beforeSent, expectedFrames: [expected] };
      });
    }
    if (actions.canRevert) {
      candidates.push(async () => {
        const beforeSent = reviewSocket.sent.length;
        const expected = ExpectedCommandFrame(workflow, "revert");
        ClickReviewCommand(harness.app, "Revert", seed, `random ${index} revert`);
        return { label: "revert", beforeSent, expectedFrames: [expected] };
      });
    }
    if (actions.canUndo) {
      candidates.push(async () => {
        const beforeSent = reviewSocket.sent.length;
        const expected = ExpectedCommandFrame(workflow, "undo");
        ClickReviewCommand(harness.app, "Undo", seed, `random ${index} undo`);
        return { label: "undo", beforeSent, expectedFrames: [expected] };
      });
    }
    if (workflow.currentHunkId !== null && workflow.focused) {
      candidates.push(async () => {
        const beforeSent = reviewSocket.sent.length;
        const hunkId = workflow.currentHunkId!;
        workflow.pressCell(3, 3);
        await FlushReviewWorkflow(harness);
        const textarea = RequiredElement(
          harness.app,
          ".sheaf-chat-agent-review-comment-textarea",
        ) as FakeElement;
        const text = `seed ${seed} randomized comment ${index}.${random.int(100)}`;
        textarea.value = text;
        textarea.dispatchEvent({ type: "input" });
        return {
          label: "comment",
          beforeSent,
          expectedFrames: [
            { type: "comment_focus", hunkId },
            { type: "comment", hunkId, text },
          ],
        };
      });
      candidates.push(async () => {
        const beforeSent = reviewSocket.sent.length;
        (harness.document as any).hidden = true;
        harness.document.dispatchEvent({ type: "visibilitychange" });
        return {
          label: "presence hidden",
          beforeSent,
          expectedFrames: [{ type: "presence", focused: false }],
        };
      });
    }
    if (workflow.focused === false) {
      candidates.push(async () => {
        const beforeSent = reviewSocket.sent.length;
        (harness.document as any).hidden = false;
        harness.document.dispatchEvent({ type: "visibilitychange" });
        return {
          label: "presence visible",
          beforeSent,
          expectedFrames: [{ type: "presence", focused: true }],
        };
      });
    }

    const observation = await random.pick(candidates)();
    await CompleteObservedStep(
      harness,
      workflow,
      reviewSocket,
      observation.beforeSent,
      observation.expectedFrames,
      `random step ${index}: ${observation.label}`,
    );
  };

  for (let index = 0; index < 18; index += 1) {
    await runRandomStep(index);
  }

  if (workflow.focused === false) {
    await SetReviewPresenceStep(
      harness,
      workflow,
      reviewSocket,
      false,
      "refocused before arming paste",
    );
    AssertReviewWorkflowUi(harness, workflow, "refocused before arming paste");
  }

  if (workflow.serializedReview() === null && workflow.currentHunkId !== null) {
    const beforeSent = reviewSocket.sent.length;
    const hunkId = workflow.currentHunkId;
    workflow.pressCell(3, 3);
    await FlushReviewWorkflow(harness);
    const textarea = RequiredElement(
      harness.app,
      ".sheaf-chat-agent-review-comment-textarea",
    ) as FakeElement;
    const text = `seed ${seed} final armed review`;
    textarea.value = text;
    textarea.dispatchEvent({ type: "input" });
    await CompleteObservedStep(
      harness,
      workflow,
      reviewSocket,
      beforeSent,
      [
        { type: "comment_focus", hunkId },
        { type: "comment", hunkId, text },
      ],
      "after final comment arms review",
    );
  }

  if (workflow.currentHunkId === null && workflow.actions().canGoNextFile) {
    await ClickReviewCommandStep(
      harness,
      workflow,
      reviewSocket,
      "Next File",
      "nextFile",
      "select file before completion check",
    );
    AssertReviewWorkflowUi(harness, workflow, "after selecting file before completion check");
  }

  assert.ok(workflow.currentHunkId, `seed ${seed}: expected a current hunk before completion check`);
  const completedFile = workflow.currentHunk()!.file;
  while (workflow.currentHunk() && workflow.currentHunk()!.file === completedFile) {
    const action = random.next() < 0.5 ? "Stage" : "Revert";
    await ClickReviewCommandStep(
      harness,
      workflow,
      reviewSocket,
      action,
      action.toLowerCase(),
      `complete file with ${action}`,
    );
    AssertReviewWorkflowUi(harness, workflow, `after completing file hunk with ${action}`);
  }

  assert.equal(
    workflow.currentHunkId,
    null,
    `seed ${seed}: completing all hunks in ${completedFile} must leave no current hunk`,
  );
  assert.ok(
    workflow.actions().canGoNextFile || workflow.actions().canGoPrevFile,
    `seed ${seed}: another file should remain available only through explicit file navigation`,
  );
  AssertReviewWorkflowUi(harness, workflow, "after completing file without auto-advance");

  await SetReviewPresenceStep(harness, workflow, reviewSocket, true, "after unfocused armed state");
  const awayCells = ReviewWorkflowCellMap(workflow.dictator.lastCellPaint());
  assert.deepEqual(
    awayCells.get("3,3"),
    { x: 3, y: 3, r: 0, g: 255, b: 0 },
    `seed ${seed}: armed review cell should stay green while unfocused`,
  );
  AssertReviewWorkflowUi(harness, workflow, "after unfocused armed state");

  const serializedBeforePaste = workflow.serializedReview();
  assert.ok(serializedBeforePaste, `seed ${seed}: expected serialized review before paste`);
  const insertCountBeforePaste = workflow.dictator.insertTextCalls.length;
  const beforePasteSent = reviewSocket.sent.length;
  workflow.pressCell(3, 3);
  AssertClientFrames(
    ClientFramesSince(reviewSocket, beforePasteSent),
    [],
    seed,
    "after pressing (3,3) paste",
  );
  await FlushReviewWorkflow(harness);
  assert.equal(
    workflow.dictator.insertTextCalls.length,
    insertCountBeforePaste + 1,
    `seed ${seed}: pressing (3,3) should call fake cursor.insertText once`,
  );
  assert.equal(
    workflow.dictator.insertTextCalls.at(-1),
    serializedBeforePaste,
    `seed ${seed}: fake cursor.insertText should receive the armed review`,
  );
  assert.equal(workflow.serializedReview(), null, `seed ${seed}: successful paste should clear the review draft`);
  AssertReviewWorkflowUi(harness, workflow, "after pressing (3,3) paste");

  await SetReviewPresenceStep(harness, workflow, reviewSocket, false, "after final refocus");
  AssertReviewWorkflowUi(harness, workflow, "after final refocus");
});

test("repository picker renders backend repositories and navigates by repo id", async () =>
{
  const requests: Array<{ path: string; request?: Record<string, unknown> }> = [];
  const repositories: Array<{ repoId: string; name: string; path: string }> = [
    {
      repoId: "repo-1",
      name: "work",
      path: "/Users/test/work",
    },
  ];
  const harness = LoadChatHarness({
    hash: "#/",
    fetch: async (path, request) => {
      requests.push({ path, request });

      if (path === "/api/repositories") {
        return JsonResponse({ repositories }, true);
      }

      return JsonResponse({ error: { message: "unexpected request" } }, false);
    },
  });

  await FlushPromises();

  const firstRepositoryButton = RequiredElement(harness.app, ".sheaf-chat-list-button");
  assert.match(firstRepositoryButton.textContent, /^work/);
  assert.doesNotMatch(firstRepositoryButton.textContent, /undefined/);

  firstRepositoryButton.click();
  assert.equal(harness.location.hash, "#/repositories/repo-1");
  assert.equal(requests.some((request) => request.request?.method === "POST"), false);
  assert.doesNotMatch(harness.app.textContent, /undefined/);
});

test("chat send renders optimistically and dual user paths reconcile to one bubble", () =>
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

  const messageId = String(userFrame.payload.messageId);
  // The message is rendered immediately on submit via the optimistic local echo.
  assert.deepEqual(Array.from(handle.state.messageOrder), [messageId]);

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

// Reproduction for the "first message does not appear" bug.
//
// Today the user's own message is rendered only when the server echoes it back
// (chat.user_message / agui TEXT_MESSAGE events). On a brand-new chat whose agent
// must cold-start, that single echo races the connect/bootstrap handshake, so the
// user's first message can be invisible (or dropped) in the live view even though
// it is persisted and shows up on reload.
//
// The fix is an optimistic local echo: a submitted message renders immediately,
// keyed by the client-generated messageId, and the later server echo (same id)
// dedupes to a single bubble. This test asserts that behavior and therefore FAILS
// on current code (the message does not appear until the server broadcasts it) and
// PASSES once optimistic echo lands.
test("user message appears immediately on submit and the later server echo does not duplicate it", () =>
{
  const harness = LoadChatHarness();
  const socket = harness.sockets[0];
  const textarea = RequiredElement(harness.app, ".sheaf-chat-textarea");
  const sendButton = RequiredElement(harness.app, ".sheaf-chat-send");
  const handle = harness.handles[0];

  socket.open();
  harness.flushAnimationFrames();

  textarea.value = "hello";
  sendButton.click();
  harness.flushAnimationFrames();

  const userFrame = LastFrame(socket, "client.user_message");
  const messageId = String(userFrame.payload.messageId);

  // The submitted message must be visible right away, without any server frame.
  assert.equal(
    handle.transcript.querySelectorAll(".agui-chat-bubble--user").length,
    1,
    "submitted user message should render immediately, before any server echo",
  );
  assert.deepEqual(Array.from(handle.state.messageOrder), [messageId]);
  assert.equal(handle.state.messages.get(messageId).content, "hello");

  // The server then echoes the same message (chat.user_message plus the dual agui
  // TEXT_MESSAGE events, same messageId). It must reconcile to one bubble.
  socket.receive(ServerEnvelope("chat.user_message", { messageId, text: "hello" }, 1));
  socket.receive(
    ServerEnvelope("agui.event", { type: "TEXT_MESSAGE_START", messageId, role: "user" }, 2),
  );
  socket.receive(
    ServerEnvelope("agui.event", { type: "TEXT_MESSAGE_CONTENT", messageId, delta: "hello" }, 3),
  );
  socket.receive(ServerEnvelope("agui.event", { type: "TEXT_MESSAGE_END", messageId }, 4));
  harness.flushAnimationFrames();

  assert.equal(
    handle.transcript.querySelectorAll(".agui-chat-bubble--user").length,
    1,
    "server echo of the same messageId must not duplicate the optimistic bubble",
  );
  assert.deepEqual(Array.from(handle.state.messageOrder), [messageId]);
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
  assert.match(harness.sockets[1].url, /repo=repo-1/);
  assert.match(harness.sockets[1].url, /workspace=workspace-1/);
  assert.match(harness.sockets[1].url, /chat=chat-1/);
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
    inlineFiles: [
      {
        file: "app.ts",
        rows: [
          { id: "app.ts:1", kind: "deletion", text: "old", hunkId: "hunk-1", oldLineNumber: 1 },
          { id: "app.ts:2", kind: "addition", text: "new", hunkId: "hunk-1", newLineNumber: 1 },
        ],
      },
    ],
    actions: {
      canGoUp: false,
      canGoDown: false,
      canGoPrevFile: false,
      canGoNextFile: false,
      canStage: true,
      canRevert: true,
      canUndo: false,
    },
    reviewDraft: {
      entries: [],
      visibleCommentHunkId: null,
      hasSerializedContent: false,
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

  const reviewSocket = harness.sockets.find((socket) => socket.url.includes("/ws/agent-review"));
  assert.ok(reviewSocket, "expected Agent Review WebSocket");
  reviewSocket.open();
  reviewSocket.receive({ type: "bootstrap", state: reviewState });
  await FlushPromises();
  harness.flushAnimationFrames();

  assert.equal(harness.app.querySelector(".sheaf-chat-agent-review-hunk"), null);
  RequiredElement(harness.app, ".sheaf-chat-agent-review-inline");
  const focusedRows = harness.app.querySelectorAll(".sheaf-chat-agent-review-inline-row--focused");
  assert.equal(focusedRows.length, 2);
  assert.ok(
    focusedRows.some((row) =>
      row.classList.contains("sheaf-chat-agent-review-inline-row--deletion") &&
      row.textContent.includes("old"),
    ),
  );
  assert.ok(
    focusedRows.some((row) =>
      row.classList.contains("sheaf-chat-agent-review-inline-row--addition") &&
      row.textContent.includes("new"),
    ),
  );
  assert.equal(FakeElement.scrolledIntoView.at(-1)?.getAttribute("data-hunk-id"), "hunk-1");
  assert.match(harness.app.textContent, /old/);
  assert.match(harness.app.textContent, /new/);
  assert.equal(harness.app.querySelector(".sheaf-chat-agent-review-comment-textarea"), null);

  const stage = harness.app
    .querySelectorAll(".sheaf-chat-agent-review-command")
    .find((button) => button.textContent.includes("Stage"));
  assert.ok(stage, "expected Stage button");
  stage.click();

  const sent = reviewSocket.sent.map((raw) => JSON.parse(raw) as Record<string, any>);
  assert.equal(sent.at(-1)?.action, "stage");
  assert.equal(sent.at(-1)?.hunkId, "hunk-1");
  assert.equal(sent.at(-1)?.patchHash, "abc123");

  reviewState.reviewDraft.visibleCommentHunkId = "hunk-1";
  reviewSocket.receive({ type: "state", state: reviewState });
  reviewSocket.receive({ type: "focus_comment", hunkId: "hunk-1" });
  await FlushPromises();
  harness.runTimers();

  const commentBox = RequiredElement(harness.app, ".sheaf-chat-agent-review-comment-textarea") as any;
  RequiredElement(harness.app, ".sheaf-chat-agent-review-inline .sheaf-chat-agent-review-comment");
  assert.equal(
    FakeElement.activeElement?.classList.contains("sheaf-chat-agent-review-comment-textarea"),
    true,
  );

  commentBox.value = "Please simplify this branch.";
  commentBox.dispatchEvent(new Event("input", { bubbles: true }));

  const afterComment = reviewSocket.sent.map((raw) => JSON.parse(raw) as Record<string, any>);
  assert.equal(afterComment.at(-1)?.type, "comment");
  assert.equal(afterComment.at(-1)?.hunkId, "hunk-1");
  assert.equal(afterComment.at(-1)?.text, "Please simplify this branch.");
});

test("unified file viewer jumps from a non-hunk file to the next hunk file", async () =>
{
  const hunk = {
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
  };
  const focusedState: any = {
    available: true,
    repoRoot: "/repo",
    sessionRoot: "/repo/projects/demo",
    sessionRootRelativeToRepo: "projects/demo",
    currentIndex: 0,
    currentHunk: hunk,
    hunks: [hunk],
    files: [{ file: "app.ts", hunkCount: 1 }],
    inlineFiles: [
      {
        file: "app.ts",
        rows: [
          { id: "app.ts:1", kind: "deletion", text: "old", hunkId: "hunk-1", oldLineNumber: 1 },
          { id: "app.ts:2", kind: "addition", text: "new", hunkId: "hunk-1", newLineNumber: 1 },
        ],
      },
    ],
    actions: {
      canGoUp: false,
      canGoDown: false,
      canGoPrevFile: false,
      canGoNextFile: false,
      canStage: true,
      canRevert: true,
      canUndo: false,
    },
    reviewDraft: { entries: [], visibleCommentHunkId: null, hasSerializedContent: false },
    dictatorBridge: { connected: false, url: null, lastError: null },
  };
  const anchoredState: any = {
    ...focusedState,
    currentIndex: -1,
    currentHunk: null,
    actions: {
      canGoUp: false,
      canGoDown: false,
      canGoPrevFile: false,
      canGoNextFile: true,
      canStage: false,
      canRevert: false,
      canUndo: false,
    },
  };

  const harness = LoadChatHarness({
    fetch: async (requestPath) => {
      if (requestPath.endsWith("/agent-review")) {
        return JsonResponse(focusedState);
      }
      if (requestPath.includes("/files?path=")) {
        return JsonResponse({
          directory: { name: ".", path: ".", kind: "directory" },
          entries: [
            {
              name: "aardvark.ts",
              path: "aardvark.ts",
              kind: "file",
              supported: true,
              contentType: "text/plain",
            },
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
        const filePath = decodeURIComponent(requestPath.split("/file?path=")[1] || "");
        const content = filePath === "aardvark.ts" ? "plain file\n" : "new\n";
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
      return JsonResponse({});
    },
  });
  await FlushPromises();

  const reviewSocket = harness.sockets.find((socket) => socket.url.includes("/ws/agent-review"));
  assert.ok(reviewSocket, "expected Agent Review WebSocket");
  reviewSocket.open();
  reviewSocket.receive({ type: "bootstrap", state: focusedState });
  await FlushPromises();
  harness.flushAnimationFrames();

  ExplorerFileButton(harness.app, "aardvark.ts").click();
  await FlushPromises();

  assert.equal(harness.app.querySelector(".sheaf-chat-agent-review-inline"), null);
  assert.match(harness.app.textContent, /plain file/);
  let sent = reviewSocket.sent.map((raw) => JSON.parse(raw) as Record<string, any>);
  assert.equal(sent.at(-1)?.type, "focus");
  assert.equal(sent.at(-1)?.hunkId, null);
  assert.equal(sent.at(-1)?.file, "aardvark.ts");

  reviewSocket.receive({ type: "state", state: anchoredState });
  await FlushPromises();

  const nextFile = harness.app
    .querySelectorAll(".sheaf-chat-agent-review-command")
    .find((button) => button.textContent === "Next File");
  assert.ok(nextFile, "expected next-file button");
  assert.equal(nextFile.disabled, false);
  nextFile.click();

  sent = reviewSocket.sent.map((raw) => JSON.parse(raw) as Record<string, any>);
  assert.equal(sent.at(-1)?.type, "command");
  assert.equal(sent.at(-1)?.action, "nextFile");
  assert.equal(sent.at(-1)?.hunkId, undefined);

  reviewSocket.receive({
    type: "command_result",
    result: { ok: true, action: "nextFile", commandId: sent.at(-1)?.id },
    state: focusedState,
  });
  await FlushPromises();
  harness.flushAnimationFrames();

  RequiredElement(harness.app, ".sheaf-chat-agent-review-inline");
  assert.ok(
    Array.from(harness.app.querySelectorAll(".sheaf-chat-tab--selected")).some((tab) =>
      tab.textContent.includes("app.ts"),
    ),
    "expected next-file navigation to focus app.ts in the normal tab bar",
  );
});

test("unified file viewer follows Launchpad-origin Agent Review command results", async () =>
{
  const hunk = {
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
  };
  const focusedState: any = {
    available: true,
    repoRoot: "/repo",
    sessionRoot: "/repo/projects/demo",
    sessionRootRelativeToRepo: "projects/demo",
    currentIndex: 0,
    currentHunk: hunk,
    hunks: [hunk],
    files: [{ file: "app.ts", hunkCount: 1 }],
    inlineFiles: [
      {
        file: "app.ts",
        rows: [
          { id: "app.ts:1", kind: "deletion", text: "old", hunkId: "hunk-1", oldLineNumber: 1 },
          { id: "app.ts:2", kind: "addition", text: "new", hunkId: "hunk-1", newLineNumber: 1 },
        ],
      },
    ],
    actions: {
      canGoUp: false,
      canGoDown: false,
      canGoPrevFile: false,
      canGoNextFile: false,
      canStage: true,
      canRevert: true,
      canUndo: false,
    },
    reviewDraft: { entries: [], visibleCommentHunkId: null, hasSerializedContent: false },
    dictatorBridge: { connected: false, url: null, lastError: null },
  };
  const anchoredState: any = {
    ...focusedState,
    currentIndex: -1,
    currentHunk: null,
    actions: {
      canGoUp: false,
      canGoDown: false,
      canGoPrevFile: false,
      canGoNextFile: true,
      canStage: false,
      canRevert: false,
      canUndo: false,
    },
  };

  const harness = LoadChatHarness({
    fetch: async (requestPath) => {
      if (requestPath.endsWith("/agent-review")) {
        return JsonResponse(focusedState);
      }
      if (requestPath.includes("/files?path=")) {
        return JsonResponse({
          directory: { name: ".", path: ".", kind: "directory" },
          entries: [
            {
              name: "aardvark.ts",
              path: "aardvark.ts",
              kind: "file",
              supported: true,
              contentType: "text/plain",
            },
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
        const filePath = decodeURIComponent(requestPath.split("/file?path=")[1] || "");
        const content = filePath === "aardvark.ts" ? "plain file\n" : "new\n";
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
      return JsonResponse({});
    },
  });
  await FlushPromises();

  const reviewSocket = harness.sockets.find((socket) => socket.url.includes("/ws/agent-review"));
  assert.ok(reviewSocket, "expected Agent Review WebSocket");
  reviewSocket.open();
  reviewSocket.receive({ type: "bootstrap", state: focusedState });
  await FlushPromises();
  harness.flushAnimationFrames();

  ExplorerFileButton(harness.app, "aardvark.ts").click();
  await FlushPromises();

  assert.equal(harness.app.querySelector(".sheaf-chat-agent-review-inline"), null);
  assert.match(harness.app.textContent, /plain file/);
  let sent = reviewSocket.sent.map((raw) => JSON.parse(raw) as Record<string, any>);
  assert.equal(sent.at(-1)?.type, "focus");
  assert.equal(sent.at(-1)?.hunkId, null);
  assert.equal(sent.at(-1)?.file, "aardvark.ts");

  reviewSocket.receive({ type: "state", state: anchoredState });
  await FlushPromises();

  const sentBeforeCommandResult = reviewSocket.sent.length;
  reviewSocket.receive({
    type: "command_result",
    result: { ok: true, action: "nextFile", commandId: "launchpad:1" },
    state: focusedState,
  });
  await FlushPromises();
  harness.flushAnimationFrames();

  RequiredElement(harness.app, ".sheaf-chat-agent-review-inline");
  AssertSelectedFileTab(harness.app, "app.ts");
  sent = reviewSocket.sent
    .slice(sentBeforeCommandResult)
    .map((raw) => JSON.parse(raw) as Record<string, any>);
  assert.equal(
    sent.some((frame) => frame.type === "focus" && frame.file === "aardvark.ts"),
    false,
    "command-result sync must not steer focus back to the old non-hunk file",
  );
});

test("Agent Review Mode shows unstaged-hunk counts and updates with state", async () =>
{
  const makeHunk = (file: string, fileIndex: number, hunkIndex: number) => ({
    sourceProvider: "sheaf-chat",
    repoRoot: "/repo",
    sessionRoot: "/repo/projects/demo",
    file,
    hunkId: `${file}-${hunkIndex}`,
    hunkIndex,
    hunkCount: 3,
    fileIndex,
    fileCount: 2,
    header: "@@ -1 +1 @@",
    patchHash: `hash-${hunkIndex}`,
    patch: `diff --git a/${file} b/${file}\n@@ -1 +1 @@\n-old\n+new\n`,
  });

  const reviewState: any = {
    available: true,
    repoRoot: "/repo",
    sessionRoot: "/repo/projects/demo",
    sessionRootRelativeToRepo: "projects/demo",
    currentIndex: 0,
    currentHunk: makeHunk("alpha.ts", 0, 0),
    hunks: [makeHunk("alpha.ts", 0, 0), makeHunk("alpha.ts", 0, 1), makeHunk("beta.ts", 1, 2)],
    files: [
      { file: "alpha.ts", hunkCount: 2 },
      { file: "beta.ts", hunkCount: 1 },
    ],
    inlineFiles: [
      {
        file: "alpha.ts",
        rows: [
          { id: "alpha-0-old", kind: "deletion", text: "old alpha 1", hunkId: "alpha.ts-0", oldLineNumber: 1 },
          { id: "alpha-0-new", kind: "addition", text: "new alpha 1", hunkId: "alpha.ts-0", newLineNumber: 1 },
          { id: "alpha-context", kind: "context", text: "between", newLineNumber: 2 },
          { id: "alpha-1-old", kind: "deletion", text: "old alpha 2", hunkId: "alpha.ts-1", oldLineNumber: 5 },
          { id: "alpha-1-new", kind: "addition", text: "new alpha 2", hunkId: "alpha.ts-1", newLineNumber: 5 },
        ],
      },
      {
        file: "beta.ts",
        rows: [
          { id: "beta-2-old", kind: "deletion", text: "old beta", hunkId: "beta.ts-2", oldLineNumber: 1 },
          { id: "beta-2-new", kind: "addition", text: "new beta", hunkId: "beta.ts-2", newLineNumber: 1 },
        ],
      },
    ],
    actions: {
      canGoUp: true,
      canGoDown: true,
      canGoPrevFile: false,
      canGoNextFile: true,
      canStage: true,
      canRevert: true,
      canUndo: false,
    },
    reviewDraft: { entries: [], visibleCommentHunkId: null, hasSerializedContent: false },
    dictatorBridge: { connected: false, url: null, lastError: null },
  };

  const harness = LoadChatHarness({
    fetch: async (requestPath) => {
      if (requestPath.endsWith("/agent-review")) {
        return JsonResponse(reviewState);
      }
      if (requestPath.includes("/files?path=")) {
        return JsonResponse({
          directory: { name: ".", path: ".", kind: "directory" },
          entries: [],
        });
      }
      if (requestPath.includes("/file?path=")) {
        return JsonResponse({
          file: {
            name: "alpha.ts",
            path: "alpha.ts",
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

  const reviewSocket = harness.sockets.find((socket) => socket.url.includes("/ws/agent-review"));
  assert.ok(reviewSocket, "expected Agent Review WebSocket");
  reviewSocket.open();
  reviewSocket.receive({ type: "bootstrap", state: reviewState });
  await FlushPromises();
  harness.flushAnimationFrames();

  const counts = RequiredElement(harness.app, ".sheaf-chat-agent-review-counts");
  // alpha.ts (two hunks) is file 1 of 2; current hunk is hunk 1 of that file.
  assert.match(counts.textContent, /1\/2\s+in\s+file/);
  assert.match(counts.textContent, /file\s+1\/2/);
  assert.equal(harness.app.querySelectorAll(".sheaf-chat-agent-review-inline-row--focused").length, 2);
  assert.equal(harness.app.querySelectorAll(".sheaf-chat-agent-review-inline-row--muted").length, 2);

  const nextButton = harness.app
    .querySelectorAll(".sheaf-chat-agent-review-command")
    .find((button) => button.textContent === "Next File");
  assert.ok(nextButton, "expected next-file button");
  nextButton.click();
  const sent = reviewSocket.sent.map((raw) => JSON.parse(raw) as Record<string, any>);
  assert.equal(sent.at(-1)?.action, "nextFile");

  // Moving focus to beta.ts (one hunk, file 2 of 2) updates both positions.
  reviewState.currentHunk = makeHunk("beta.ts", 1, 2);
  reviewState.currentIndex = 2;
  reviewSocket.receive({
    type: "command_result",
    result: { ok: true, action: "nextFile", commandId: sent.at(-1)?.id },
    state: reviewState,
  });
  await FlushPromises();
  harness.flushAnimationFrames();

  const updated = RequiredElement(harness.app, ".sheaf-chat-agent-review-counts");
  assert.match(updated.textContent, /1\/1\s+in\s+file/);
  assert.match(updated.textContent, /file\s+2\/2/);
  assert.equal(FakeElement.scrolledIntoView.at(-1)?.getAttribute("data-hunk-id"), "beta.ts-2");
});

test("Agent Review Mode scrolls inline hunks with up to three leading rows", async () =>
{
  const hunk = {
    sourceProvider: "sheaf-chat",
    repoRoot: "/repo",
    sessionRoot: "/repo/projects/demo",
    file: "app.ts",
    hunkId: "hunk-later",
    hunkIndex: 0,
    hunkCount: 1,
    fileIndex: 0,
    fileCount: 1,
    header: "@@ -5 +5 @@",
    patchHash: "hash-later",
    patch: "diff --git a/app.ts b/app.ts\n@@ -5 +5 @@\n-old\n+new\n",
  };
  const reviewState: any = {
    available: true,
    repoRoot: "/repo",
    sessionRoot: "/repo/projects/demo",
    sessionRootRelativeToRepo: "projects/demo",
    currentIndex: 0,
    currentHunk: hunk,
    hunks: [hunk],
    files: [{ file: "app.ts", hunkCount: 1 }],
    inlineFiles: [
      {
        file: "app.ts",
        rows: [
          { id: "row-1", kind: "context", text: "one", newLineNumber: 1 },
          { id: "row-2", kind: "context", text: "two", newLineNumber: 2 },
          { id: "row-3", kind: "context", text: "three", newLineNumber: 3 },
          { id: "row-4", kind: "context", text: "four", newLineNumber: 4 },
          { id: "row-5-old", kind: "deletion", text: "old", hunkId: "hunk-later", oldLineNumber: 5 },
          { id: "row-5-new", kind: "addition", text: "new", hunkId: "hunk-later", newLineNumber: 5 },
        ],
      },
    ],
    actions: {
      canGoUp: false,
      canGoDown: false,
      canGoPrevFile: false,
      canGoNextFile: false,
      canStage: true,
      canRevert: true,
      canUndo: false,
    },
    reviewDraft: { entries: [], visibleCommentHunkId: null, hasSerializedContent: false },
    dictatorBridge: { connected: false, url: null, lastError: null },
  };

  const harness = LoadChatHarness({
    fetch: async (requestPath) => {
      if (requestPath.endsWith("/agent-review")) {
        return JsonResponse(reviewState);
      }
      if (requestPath.includes("/files?path=")) {
        return JsonResponse({
          directory: { name: ".", path: ".", kind: "directory" },
          entries: [],
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

  FakeElement.scrolledIntoView = [];
  const reviewSocket = harness.sockets.find((socket) => socket.url.includes("/ws/agent-review"));
  assert.ok(reviewSocket, "expected Agent Review WebSocket");
  reviewSocket.open();
  reviewSocket.receive({ type: "bootstrap", state: reviewState });
  await FlushPromises();
  harness.flushAnimationFrames();

  assert.equal(FakeElement.scrolledIntoView.at(-1)?.getAttribute("data-review-row-id"), "row-2");

  const nearStartHunk = {
    ...hunk,
    hunkId: "hunk-near-start",
    patchHash: "hash-near-start",
    header: "@@ -2 +2 @@",
  };
  reviewState.currentHunk = nearStartHunk;
  reviewState.hunks = [nearStartHunk];
  reviewState.inlineFiles = [
    {
      file: "app.ts",
      rows: [
        { id: "start-row-1", kind: "context", text: "one", newLineNumber: 1 },
        {
          id: "start-row-2-old",
          kind: "deletion",
          text: "old",
          hunkId: "hunk-near-start",
          oldLineNumber: 2,
        },
        {
          id: "start-row-2-new",
          kind: "addition",
          text: "new",
          hunkId: "hunk-near-start",
          newLineNumber: 2,
        },
      ],
    },
  ];

  reviewSocket.receive({ type: "state", state: reviewState });
  await FlushPromises();
  harness.flushAnimationFrames();

  assert.equal(FakeElement.scrolledIntoView.at(-1)?.getAttribute("data-review-row-id"), "start-row-1");
});

test("Agent Review Mode keeps already visible inline hunk rows in place", async () =>
{
  const hunk = {
    sourceProvider: "sheaf-chat",
    repoRoot: "/repo",
    sessionRoot: "/repo/projects/demo",
    file: "app.ts",
    hunkId: "hunk-visible",
    hunkIndex: 0,
    hunkCount: 1,
    fileIndex: 0,
    fileCount: 1,
    header: "@@ -5 +5 @@",
    patchHash: "hash-visible",
    patch: "diff --git a/app.ts b/app.ts\n@@ -5 +5 @@\n-old\n+new\n",
  };
  const reviewState: any = {
    available: true,
    repoRoot: "/repo",
    sessionRoot: "/repo/projects/demo",
    sessionRootRelativeToRepo: "projects/demo",
    currentIndex: 0,
    currentHunk: hunk,
    hunks: [hunk],
    files: [{ file: "app.ts", hunkCount: 1 }],
    inlineFiles: [
      {
        file: "app.ts",
        rows: [
          { id: "visible-row-1", kind: "context", text: "one", newLineNumber: 1 },
          { id: "visible-row-2", kind: "context", text: "two", newLineNumber: 2 },
          { id: "visible-row-3", kind: "context", text: "three", newLineNumber: 3 },
          { id: "visible-row-4", kind: "context", text: "four", newLineNumber: 4 },
          { id: "visible-row-5-old", kind: "deletion", text: "old", hunkId: "hunk-visible", oldLineNumber: 5 },
          { id: "visible-row-5-new", kind: "addition", text: "new", hunkId: "hunk-visible", newLineNumber: 5 },
        ],
      },
    ],
    actions: {
      canGoUp: false,
      canGoDown: false,
      canGoPrevFile: false,
      canGoNextFile: false,
      canStage: true,
      canRevert: true,
      canUndo: false,
    },
    reviewDraft: { entries: [], visibleCommentHunkId: null, hasSerializedContent: false },
    dictatorBridge: { connected: false, url: null, lastError: null },
  };

  const harness = LoadChatHarness({
    fetch: async (requestPath) => {
      if (requestPath.endsWith("/agent-review")) {
        return JsonResponse(reviewState);
      }
      if (requestPath.includes("/files?path=")) {
        return JsonResponse({
          directory: { name: ".", path: ".", kind: "directory" },
          entries: [],
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

  const reviewSocket = harness.sockets.find((socket) => socket.url.includes("/ws/agent-review"));
  assert.ok(reviewSocket, "expected Agent Review WebSocket");
  reviewSocket.open();
  reviewSocket.receive({ type: "bootstrap", state: reviewState });
  await FlushPromises();

  const fileView = RequiredElement(harness.app, ".sheaf-chat-file-view");
  fileView.scrollTop = 40;
  fileView.getBoundingClientRect = () => ({
    top: 100,
    bottom: 200,
    left: 0,
    right: 500,
    width: 500,
    height: 100,
  });
  fileView.scrollTo = (options) => {
    FakeElement.scrollToCalls.push({ element: fileView, options });
    if (typeof options.top === "number") {
      fileView.scrollTop = options.top;
    }
  };

  const inlineRows = harness.app.querySelectorAll(".sheaf-chat-agent-review-inline-row");
  inlineRows.forEach((row, index) => {
    row.getBoundingClientRect = () => ({
      top: 40 + (index * 20),
      bottom: 60 + (index * 20),
      left: 0,
      right: 500,
      width: 500,
      height: 20,
    });
  });

  FakeElement.scrolledIntoView = [];
  FakeElement.scrollToCalls = [];
  harness.flushAnimationFrames();
  FakeElement.scrolledIntoView = [];
  FakeElement.scrollToCalls = [];

  assert.equal(FakeElement.scrolledIntoView.length, 0);
  assert.equal(FakeElement.scrollToCalls.length, 0);
  assert.equal(fileView.scrollTop, 40);
});

test("file tabs auto-scroll to keep the active tab visible", async () =>
{
  const harness = LoadChatHarness();
  await FlushPromises();

  FakeElement.scrolledIntoView = [];

  ExplorerFileButton(harness.app, "readme.md").click();
  await FlushPromises();
  ExplorerFileButton(harness.app, "other.md").click();
  await FlushPromises();

  const lastScrolled = FakeElement.scrolledIntoView.at(-1);
  assert.ok(lastScrolled, "expected a tab to be scrolled into view");
  assert.ok(
    lastScrolled.classList.contains("sheaf-chat-tab--selected"),
    "scrolled element should be the selected tab",
  );
  assert.ok(lastScrolled.textContent.includes("other.md"), lastScrolled.textContent);

  // Switching back to the first tab scrolls that one into view.
  const tabs = harness.app.querySelectorAll(".sheaf-chat-tab");
  tabs[0].click();
  await FlushPromises();

  const afterSwitch = FakeElement.scrolledIntoView.at(-1);
  assert.ok(afterSwitch, "expected the reselected tab to be scrolled into view");
  assert.ok(afterSwitch.classList.contains("sheaf-chat-tab--selected"));
  assert.ok(afterSwitch.textContent.includes("readme.md"), afterSwitch.textContent);
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
  assert.ok(chatPanel.querySelector(".sheaf-chat-chat-pane-top"));
  assert.ok(chatPanel.querySelector(".sheaf-chat-chat-pane-back"), "chat-pane Back present");
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
