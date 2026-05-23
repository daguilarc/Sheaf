import type { ChatTranscriptItem } from "../../types.js";

export interface MarkdownRenderSession {
  handle: unknown;
  release: () => void;
}

export interface TranscriptRenderContext {
  sourcePath: string;
  createMarkdownRenderSession: () => MarkdownRenderSession;
  renderMarkdown: (
    markdown: string,
    container: HTMLElement,
    sourcePath: string,
    handle: unknown,
  ) => Promise<void>;
}

export interface RenderedTranscriptItem {
  element: HTMLElement;
  release: () => void;
}

export function itemSignature(item: ChatTranscriptItem): string {
  switch (item.kind) {
    case "tool_call":
      return `${item.kind}:${item.text}:${item.tone}`;
    case "streaming":
      return `${item.kind}:${item.text}:${item.queueID}`;
    default:
      return `${item.kind}:${item.role}:${item.text}`;
  }
}

function isMarkdownItem(item: ChatTranscriptItem): boolean {
  return item.kind === "committed";
}

function createMessageElement(item: ChatTranscriptItem): HTMLElement {
  const element = document.createElement("div");
  const signature = itemSignature(item);
  element.dataset.signature = signature;
  element.dataset.kind = item.kind;
  element.setAttribute("role", "listitem");

  if (item.kind === "tool_call") {
    element.classList.add("sheaf-message", "sheaf-message--tool");
    if (item.tone === "error") {
      element.classList.add("sheaf-message--tool-error");
    }
    return element;
  }

  element.classList.add("sheaf-message");

  if (item.role === "user") {
    element.classList.add("sheaf-message--user");
  }
  else if (item.role === "assistant") {
    element.classList.add("sheaf-message--assistant");
  }
  else {
    element.classList.add("sheaf-message--system");
  }

  if (item.kind === "pending") {
    element.classList.add("sheaf-message--pending");
  }

  if (item.kind === "streaming") {
    element.classList.add("sheaf-message--streaming");
  }

  return element;
}

function createContentElement(markdown: boolean): HTMLElement {
  const content = document.createElement("div");
  content.classList.add("sheaf-message__content");
  content.classList.add(markdown ? "sheaf-message__content--markdown" : "sheaf-message__content--plaintext");
  return content;
}

function setPlaintextContent(content: HTMLElement, text: string): void {
  content.textContent = text;
}

function beginMarkdownRender(
  context: TranscriptRenderContext,
  item: ChatTranscriptItem,
  content: HTMLElement,
): () => void {
  const session = context.createMarkdownRenderSession();
  void context.renderMarkdown(item.text, content, context.sourcePath, session.handle);
  return session.release;
}

export function renderTranscriptItem(
  context: TranscriptRenderContext,
  item: ChatTranscriptItem,
): RenderedTranscriptItem {
  const element = createMessageElement(item);
  const markdown = isMarkdownItem(item);
  const content = createContentElement(markdown);
  element.appendChild(content);

  if (markdown) {
    return {
      element,
      release: beginMarkdownRender(context, item, content),
    };
  }

  setPlaintextContent(content, item.text);
  return {
    element,
    release: () => {},
  };
}

export function updateTranscriptItem(
  context: TranscriptRenderContext,
  rendered: RenderedTranscriptItem,
  item: ChatTranscriptItem,
): RenderedTranscriptItem {
  const newSig = itemSignature(item);
  if (rendered.element.dataset.signature === newSig) {
    return rendered;
  }

  if (item.kind === "streaming" && rendered.element.dataset.kind === "streaming") {
    const content = rendered.element.querySelector(".sheaf-message__content");
    if (content instanceof HTMLElement) {
      setPlaintextContent(content, item.text);
    }
    rendered.element.dataset.signature = newSig;
    return rendered;
  }

  return renderTranscriptItem(context, item);
}
