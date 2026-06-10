import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const x_packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const x_aguiChatJsPath = path.resolve(x_packageRoot, "..", "web", "src", "agui-chat.js");
const x_sheafMarkdownPath = path.join(x_packageRoot, "src", "ui", "sheaf-markdown.js");

async function LoadChatMarkdownApi(): Promise<{
  renderAssistantMarkdown: (text: string) => string;
  formatMarkdown: (text: string) => string;
}>
{
  const sandbox: Record<string, unknown> = {
    globalThis: {},
    window: {},
    document: {
      createElement: () => ({
        className: "",
        appendChild: () => undefined,
        addEventListener: () => undefined,
      }),
    },
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;

  const markdownItModule = await import("markdown-it");
  const katexModule = await import("katex");
  sandbox.markdownit = markdownItModule.default;
  sandbox.katex = katexModule.default;

  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(x_sheafMarkdownPath, "utf8"), sandbox as vm.Context);
  vm.runInContext(fs.readFileSync(x_aguiChatJsPath, "utf8"), sandbox as vm.Context);

  const chatView = sandbox.ChatView as {
    _test: {
      renderAssistantMarkdown: (text: string) => string;
      formatMarkdown: (text: string) => string;
    };
  };

  return chatView._test;
}

test("assistant markdown rendering uses SheafMarkdown when vendor libraries are loaded", async () =>
{
  const api = await LoadChatMarkdownApi();
  const html = api.renderAssistantMarkdown("## Title\n\n`code` and $a+b$");

  assert.match(html, /<h2>Title<\/h2>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /class="sheaf-markdown-math/);
});

test("assistant markdown rendering falls back to legacy formatter without SheafMarkdown", async () =>
{
  const sandbox: Record<string, unknown> = {
    globalThis: {},
    window: {},
    document: {
      createElement: () => ({
        className: "",
        appendChild: () => undefined,
        addEventListener: () => undefined,
      }),
    },
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(x_aguiChatJsPath, "utf8"), sandbox as vm.Context);

  const chatView = sandbox.ChatView as {
    _test: {
      renderAssistantMarkdown: (text: string) => string;
    };
  };

  const html = chatView._test.renderAssistantMarkdown("**bold**");
  assert.match(html, /<strong>bold<\/strong>/);
  assert.equal(html.includes("sheaf-markdown"), false);
});
