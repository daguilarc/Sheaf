import test from "node:test";
import assert from "node:assert/strict";

import {
  renderTranscriptItem,
  updateTranscriptItem,
  type TranscriptRenderContext,
} from "../src/chat/components/messageRenderer.js";

import type { ChatTranscriptItem } from "../src/types.js";

class FakeClassList {
  private readonly values = new Set<string>();

  add(...tokens: string[]): void {
    for (const token of tokens) {
      this.values.add(token);
    }
  }

  contains(token: string): boolean {
    return this.values.has(token);
  }
}

class FakeElement {
  readonly dataset: Record<string, string> = {};
  readonly classList = new FakeClassList();
  readonly children: FakeElement[] = [];
  textContent = "";
  private readonly attributes = new Map<string, string>();

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  querySelector(selector: string): FakeElement | null {
    if (!selector.startsWith(".")) {
      return null;
    }
    const className = selector.slice(1);
    return this.children.find((child) => child.classList.contains(className)) ?? null;
  }
}

function installFakeDom(): () => void {
  const previousDocument = globalThis.document;
  const previousHTMLElement = (globalThis as { HTMLElement?: unknown }).HTMLElement;

  globalThis.document = {
    createElement: () => new FakeElement(),
  } as unknown as Document;
  (globalThis as { HTMLElement?: unknown }).HTMLElement = FakeElement;

  return () => {
    globalThis.document = previousDocument;
    if (previousHTMLElement === undefined) {
      delete (globalThis as { HTMLElement?: unknown }).HTMLElement;
    }
    else {
      (globalThis as { HTMLElement?: unknown }).HTMLElement = previousHTMLElement;
    }
  };
}

function committedAssistant(text: string): ChatTranscriptItem {
  return {
    kind: "committed",
    id: "assistant-1",
    role: "assistant",
    text,
  };
}

function createContext() {
  const renderCalls: Array<{ markdown: string; sourcePath: string; handle: unknown }> = [];
  const released: unknown[] = [];

  const context: TranscriptRenderContext = {
    sourcePath: ".sheaf/chat-transcript.md",
    createMarkdownRenderSession: () => {
      const handle = { id: `handle-${renderCalls.length}` };
      return {
        handle,
        release: () => {
          released.push(handle);
        },
      };
    },
    renderMarkdown: async (markdown, container, sourcePath, handle) => {
      renderCalls.push({ markdown, sourcePath, handle });
      container.textContent = `rendered:${markdown}`;
    },
  };

  return { context, renderCalls, released };
}

test("committed assistant inline math uses markdown rendering", async () => {
  const restore = installFakeDom();

  try {
    const { context, renderCalls, released } = createContext();
    const rendered = renderTranscriptItem(context, committedAssistant("Euler: $e^{i\\pi} + 1 = 0$"));

    assert.equal(renderCalls.length, 1);
    assert.equal(renderCalls[0]?.markdown, "Euler: $e^{i\\pi} + 1 = 0$");
    assert.equal(renderCalls[0]?.sourcePath, ".sheaf/chat-transcript.md");
    assert.equal(rendered.element.dataset.kind, "committed");
    assert.equal(rendered.element.querySelector(".sheaf-message__content--markdown")?.textContent, "rendered:Euler: $e^{i\\pi} + 1 = 0$");

    rendered.release();
    assert.equal(released.length, 1);
  } finally {
    restore();
  }
});

test("committed assistant display math uses markdown rendering", () => {
  const restore = installFakeDom();

  try {
    const { context, renderCalls } = createContext();
    const rendered = renderTranscriptItem(context, committedAssistant("$$\\int_0^1 x^2 dx$$"));

    assert.equal(renderCalls.length, 1);
    assert.equal(renderCalls[0]?.markdown, "$$\\int_0^1 x^2 dx$$");
    assert.equal(rendered.element.querySelector(".sheaf-message__content--markdown")?.textContent, "rendered:$$\\int_0^1 x^2 dx$$");
  } finally {
    restore();
  }
});

test("streaming assistant remains plaintext and updates in place", () => {
  const restore = installFakeDom();

  try {
    const { context, renderCalls } = createContext();
    const initial = renderTranscriptItem(context, {
      kind: "streaming",
      id: "stream-1",
      role: "assistant",
      text: "Typing",
      queueID: 7,
    });

    assert.equal(renderCalls.length, 0);
    assert.equal(initial.element.querySelector(".sheaf-message__content--plaintext")?.textContent, "Typing");

    const updated = updateTranscriptItem(context, initial, {
      kind: "streaming",
      id: "stream-1",
      role: "assistant",
      text: "Typing more",
      queueID: 7,
    });

    assert.equal(updated, initial);
    assert.equal(renderCalls.length, 0);
    assert.equal(updated.element.querySelector(".sheaf-message__content--plaintext")?.textContent, "Typing more");
  } finally {
    restore();
  }
});

test("pending and tool rows remain plaintext", () => {
  const restore = installFakeDom();

  try {
    const { context, renderCalls } = createContext();
    const pending = renderTranscriptItem(context, {
      kind: "pending",
      id: "pending-1",
      role: "user",
      text: "Draft text",
    });
    const tool = renderTranscriptItem(context, {
      kind: "tool_call",
      id: "tool-1",
      text: "Applied patch",
      tone: "normal",
    });

    assert.equal(renderCalls.length, 0);
    assert.equal(pending.element.querySelector(".sheaf-message__content--plaintext")?.textContent, "Draft text");
    assert.equal(tool.element.querySelector(".sheaf-message__content--plaintext")?.textContent, "Applied patch");
  } finally {
    restore();
  }
});

test("streaming row replaced by committed row switches to markdown rendering", () => {
  const restore = installFakeDom();

  try {
    const { context, renderCalls, released } = createContext();
    const streaming = renderTranscriptItem(context, {
      kind: "streaming",
      id: "turn-1",
      role: "assistant",
      text: "Partial",
      queueID: 2,
    });

    const committed = updateTranscriptItem(context, streaming, committedAssistant("Final $x^2$"));

    assert.notEqual(committed, streaming);
    assert.equal(renderCalls.length, 1);
    assert.equal(streaming.element.querySelector(".sheaf-message__content--plaintext")?.textContent, "Partial");
    assert.equal(committed.element.querySelector(".sheaf-message__content--markdown")?.textContent, "rendered:Final $x^2$");

    streaming.release();
    committed.release();
    assert.equal(released.length, 1);
  } finally {
    restore();
  }
});
