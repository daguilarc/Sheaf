import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import type { FakePiSession } from "../agents/lifecycle/helpers.js";
import {
  CreateSessionWithRoot,
  WaitForCondition,
  WriteSessionFile,
} from "../server/websocket/helpers.js";
import { WithBrowserTestServer } from "./browserTestServer.js";

type Browser = {
  close: () => Promise<void>;
  newPage: () => Promise<Page>;
};

type Locator = {
  click: (options?: { timeout?: number }) => Promise<void>;
  count: () => Promise<number>;
  fill: (value: string) => Promise<void>;
  innerText: () => Promise<string>;
  press: (key: string) => Promise<void>;
  textContent: () => Promise<string | null>;
  waitFor: (options?: { timeout?: number; state?: "attached" | "detached" | "visible" | "hidden" }) => Promise<void>;
};

type Page = {
  click: (selector: string) => Promise<void>;
  close: () => Promise<void>;
  fill: (selector: string, value: string) => Promise<void>;
  goto: (url: string, options?: { waitUntil?: "domcontentloaded" | "load" | "networkidle"; timeout?: number }) => Promise<unknown>;
  locator: (selector: string, options?: { hasText?: string | RegExp }) => Locator;
  on: (event: "console" | "pageerror", handler: (value: unknown) => void) => void;
  waitForFunction: (predicate: () => boolean, arg?: unknown, options?: { timeout?: number }) => Promise<unknown>;
  waitForSelector: (selector: string, options?: { timeout?: number; state?: "attached" | "detached" | "visible" | "hidden" }) => Promise<unknown>;
};

type PlaywrightModule = {
  chromium: {
    launch: (options?: { headless?: boolean }) => Promise<Browser>;
  };
};

const x_packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const x_realRepoRoot = path.resolve(x_packageRoot, "../..");
const x_defaultPort = 19104;

async function LoadPlaywright(): Promise<PlaywrightModule>
{
  const moduleName = "playwright";

  try
  {
    return await import(moduleName) as PlaywrightModule;
  }
  catch (error)
  {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Playwright is not installed or not resolvable from sheaf-chat. Run npm install in projects/sheaf-chat. Original error: ${message}`,
    );
  }
}

function PlaywrightPort(offset = 0): number
{
  const raw = process.env.SHEAF_CHAT_PLAYWRIGHT_PORT;

  if (raw === undefined || raw.trim().length === 0)
  {
    return x_defaultPort + offset;
  }

  const parsed = Number(raw);

  if (!Number.isInteger(parsed) || parsed <= 0 || parsed + offset > 65535)
  {
    throw new Error(`invalid SHEAF_CHAT_PLAYWRIGHT_PORT: ${raw}`);
  }

  return parsed + offset;
}

function FindOnlyFakeSession(fakeSessions: Map<string, FakePiSession>): FakePiSession
{
  const sessions = [...fakeSessions.values()];
  assert.equal(sessions.length, 1);
  return sessions[0]!;
}

function EmitAssistantMarkdown(fake: FakePiSession, text: string): void
{
  const message = {
    role: "assistant",
    content: [],
    timestamp: Date.now(),
  } as unknown;

  fake.Emit({ type: "agent_start" } as never);
  fake.Emit({ type: "message_start", message } as never);
  fake.Emit({
    type: "message_update",
    message,
    assistantMessageEvent: {
      type: "text_delta",
      delta: text,
    },
  } as never);
  fake.Emit({
    type: "message_update",
    message,
    assistantMessageEvent: {
      type: "text_end",
      content: text,
    },
  } as never);
  fake.Emit({ type: "message_end", message } as never);
  fake.Emit({
    type: "agent_end",
    messages: [],
    willRetry: false,
  } as never);
}

test("browser chat renders assistant markdown and LaTeX through the real UI", async () =>
{
  const { chromium } = await LoadPlaywright();

  await WithBrowserTestServer(async (handle) =>
  {
    const rootDirectory = path.join(handle.config.repoRoot, "projects", "demo");
    await WriteSessionFile(rootDirectory, "render-check.md", "# Render Fixture\n");

    const session = await CreateSessionWithRoot(handle, rootDirectory);
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const consoleMessages: string[] = [];
    const pageErrors: string[] = [];

    page.on("console", (message) =>
    {
      const typed = message as { type?: () => string; text?: () => string };
      const type = typeof typed.type === "function" ? typed.type() : "console";
      const text = typeof typed.text === "function" ? typed.text() : String(message);
      consoleMessages.push(`${type}: ${text}`);
    });
    page.on("pageerror", (error) =>
    {
      pageErrors.push(error instanceof Error ? error.message : String(error));
    });

    try
    {
      await page.goto(
        `${handle.baseUrl}/#/repositories/${encodeURIComponent(session.repoId)}/workspaces/${encodeURIComponent(session.workspaceId)}/chats/${encodeURIComponent(session.chatId)}`,
        { waitUntil: "domcontentloaded" },
      );

      await page.waitForSelector(".sheaf-chat-chat-layout .sheaf-chat-textarea", { timeout: 5000 });
      await page.waitForFunction(() => document.body.textContent?.includes("Connected") === true, undefined, {
        timeout: 5000,
      });
      await page.waitForFunction(() =>
      {
        const explorerText = document.querySelector(".sheaf-chat-explorer-tree")?.textContent ?? "";
        return /render-check\.md|route not found/i.test(explorerText);
      }, undefined, { timeout: 5000 });

      const explorerText = await page.locator(".sheaf-chat-explorer-tree").innerText();
      assert.equal(/route not found/i.test(explorerText), false);
      assert.match(explorerText, /render-check\.md/);

      const prompt = "Please render Markdown and LaTeX in the next assistant message.";
      await page.fill(".sheaf-chat-textarea", prompt);
      await page.locator(".sheaf-chat-textarea").press("Enter");

      await WaitForCondition(() =>
      {
        const fake = [...handle.fakeSessions.values()][0];
        return fake?.promptCalls.some((call) => call.text === prompt) === true;
      }, 5000);

      const fake = FindOnlyFakeSession(handle.fakeSessions);
      assert.equal(fake.promptCalls.at(-1)?.text, prompt);

      EmitAssistantMarkdown(
        fake,
        [
          "## Render Check",
          "",
          "- **bold marker**",
          "",
          "Inline math $a^2 + b^2 = c^2$ and display math:",
          "",
          "$$\\int_0^1 x^2 dx = \\frac{1}{3}$$",
        ].join("\n"),
      );

      await page.locator(".agui-chat-bubble--assistant h2", { hasText: "Render Check" }).waitFor({
        timeout: 5000,
      });
      await page.locator(".agui-chat-bubble--assistant strong", { hasText: "bold marker" }).waitFor({
        timeout: 5000,
      });
      await page.waitForSelector(
        ".agui-chat-bubble--assistant .katex, .agui-chat-bubble--assistant .sheaf-markdown-math",
        { timeout: 5000 },
      );

      const renderedMathCount = await page
        .locator(".agui-chat-bubble--assistant .katex, .agui-chat-bubble--assistant .sheaf-markdown-math")
        .count();
      assert.ok(renderedMathCount > 0);
      assert.deepEqual(pageErrors, []);
    }
    finally
    {
      await page.close();
      await browser.close();
    }

    const failingConsole = consoleMessages.filter((message) =>
      /error/i.test(message) && !/favicon/i.test(message),
    );
    assert.deepEqual(failingConsole, []);
  }, {
    realRepoRoot: x_realRepoRoot,
    port: PlaywrightPort(),
  });
});

test("browser chat can re-expand desktop side panes after collapse", async () =>
{
  const { chromium } = await LoadPlaywright();

  await WithBrowserTestServer(async (handle) =>
  {
    const rootDirectory = path.join(handle.config.repoRoot, "projects", "demo");
    await WriteSessionFile(rootDirectory, "render-check.md", "# Render Fixture\n");

    const session = await CreateSessionWithRoot(handle, rootDirectory);
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try
    {
      await page.goto(
        `${handle.baseUrl}/#/repositories/${encodeURIComponent(session.repoId)}/workspaces/${encodeURIComponent(session.workspaceId)}/chats/${encodeURIComponent(session.chatId)}`,
        { waitUntil: "domcontentloaded" },
      );

      await page.waitForSelector(".sheaf-chat-chat-layout .sheaf-chat-textarea", { timeout: 5000 });
      await page.waitForFunction(() => document.body.textContent?.includes("Connected") === true, undefined, {
        timeout: 5000,
      });

      await page.locator(".sheaf-chat-explorer-pane .sheaf-chat-pane-collapse").click();
      await page.waitForFunction(() =>
        document.querySelector(".sheaf-chat-explorer-pane")?.classList.contains("sheaf-chat-explorer-pane--collapsed") === true,
      undefined, { timeout: 5000 });
      await page.locator(".sheaf-chat-chat-pane .sheaf-chat-pane-collapse").click();
      await page.waitForFunction(() =>
        document.querySelector(".sheaf-chat-chat-pane")?.classList.contains("sheaf-chat-chat-pane--collapsed") === true,
      undefined, { timeout: 5000 });

      await page.waitForFunction(() =>
      {
        const button = document.querySelector(".sheaf-chat-explorer-pane .sheaf-chat-pane-collapse");
        const rect = button?.getBoundingClientRect();
        return rect != null && rect.width > 0 && rect.height > 0;
      }, undefined, { timeout: 1000 });
      await page.waitForFunction(() =>
      {
        const button = document.querySelector(".sheaf-chat-chat-pane .sheaf-chat-pane-collapse");
        const rect = button?.getBoundingClientRect();
        return rect != null && rect.width > 0 && rect.height > 0;
      }, undefined, { timeout: 1000 });

      await page.locator(".sheaf-chat-explorer-pane .sheaf-chat-pane-collapse").click({ timeout: 1000 });
      await page.waitForFunction(() =>
        document.querySelector(".sheaf-chat-explorer-pane")?.classList.contains("sheaf-chat-explorer-pane--collapsed") === false,
      undefined, { timeout: 5000 });
      await page.locator(".sheaf-chat-chat-pane .sheaf-chat-pane-collapse").click({ timeout: 1000 });
      await page.waitForFunction(() =>
        document.querySelector(".sheaf-chat-chat-pane")?.classList.contains("sheaf-chat-chat-pane--collapsed") === false,
      undefined, { timeout: 5000 });
    }
    finally
    {
      await page.close();
      await browser.close();
    }
  }, {
    realRepoRoot: x_realRepoRoot,
    port: PlaywrightPort(1),
  });
});
