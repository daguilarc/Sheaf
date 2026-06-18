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
  click: (options?: { position?: { x: number; y: number }; timeout?: number }) => Promise<void>;
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
  evaluate: <T, Arg = unknown>(pageFunction: (arg: Arg) => T, arg?: Arg) => Promise<T>;
  fill: (selector: string, value: string) => Promise<void>;
  goto: (url: string, options?: { waitUntil?: "domcontentloaded" | "load" | "networkidle"; timeout?: number }) => Promise<unknown>;
  locator: (selector: string, options?: { hasText?: string | RegExp }) => Locator;
  on: (event: "console" | "pageerror", handler: (value: unknown) => void) => void;
  waitForFunction: (predicate: (arg?: unknown) => boolean, arg?: unknown, options?: { timeout?: number }) => Promise<unknown>;
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

test("file view shows an Emacs point for read-only navigation", async () =>
{
  const { chromium } = await LoadPlaywright();

  await WithBrowserTestServer(async (handle) =>
  {
    const rootDirectory = path.join(handle.config.repoRoot, "projects", "demo");
    await WriteSessionFile(rootDirectory, "notes.txt", "alpha\nbeta\ngamma\n");

    const session = await CreateSessionWithRoot(handle, rootDirectory);
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try
    {
      await page.goto(
        `${handle.baseUrl}/#/repositories/${encodeURIComponent(session.repoId)}/workspaces/${encodeURIComponent(session.workspaceId)}`,
        { waitUntil: "domcontentloaded" },
      );

      await page.waitForFunction(() =>
      {
        const explorerText = document.querySelector(".sheaf-chat-explorer-tree")?.textContent ?? "";
        return explorerText.includes("notes.txt");
      }, undefined, { timeout: 5000 });

      await page.locator(".sheaf-chat-explorer-file", { hasText: "notes.txt" }).click();
      await page.locator(".sheaf-chat-file-view").waitFor({ timeout: 5000 });
      await page.locator(".sheaf-chat-file-view").click();

      const hasNavigationModule = await page.evaluate(() =>
        typeof (window as unknown as { SheafFileNavigation?: unknown }).SheafFileNavigation === "object",
      );
      assert.equal(hasNavigationModule, true);

      await page.locator(".sheaf-chat-file-point").waitFor({ timeout: 5000 });
      const pointOffset = await page.evaluate(() =>
        document.querySelector(".sheaf-chat-file-view")?.getAttribute("data-point-offset"),
      );
      assert.equal(pointOffset, "0");
    }
    finally
    {
      await page.close();
      await browser.close();
    }
  }, {
    realRepoRoot: x_realRepoRoot,
    port: PlaywrightPort(2),
  });
});

test("file view moves point with Emacs source-offset commands", async () =>
{
  const { chromium } = await LoadPlaywright();

  await WithBrowserTestServer(async (handle) =>
  {
    const rootDirectory = path.join(handle.config.repoRoot, "projects", "demo");
    await WriteSessionFile(rootDirectory, "moves.txt", "alpha\nbeta\ngamma\n");

    const session = await CreateSessionWithRoot(handle, rootDirectory);
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    async function PointOffset(): Promise<string | null>
    {
      return page.evaluate(() =>
        document.querySelector(".sheaf-chat-file-view")?.getAttribute("data-point-offset") ?? null,
      );
    }

    try
    {
      await page.goto(
        `${handle.baseUrl}/#/repositories/${encodeURIComponent(session.repoId)}/workspaces/${encodeURIComponent(session.workspaceId)}`,
        { waitUntil: "domcontentloaded" },
      );
      await page.waitForFunction(() =>
        (document.querySelector(".sheaf-chat-explorer-tree")?.textContent ?? "").includes("moves.txt"),
      undefined, { timeout: 5000 });
      await page.locator(".sheaf-chat-explorer-file", { hasText: "moves.txt" }).click();
      await page.locator(".sheaf-chat-file-point").waitFor({ timeout: 5000 });
      const fileView = page.locator(".sheaf-chat-file-view");
      await fileView.click();

      await fileView.press("ArrowRight");
      assert.equal(await PointOffset(), "1");
      await fileView.press("ArrowRight");
      assert.equal(await PointOffset(), "2");
      await fileView.press("Control+E");
      assert.equal(await PointOffset(), "5");
      await fileView.press("ArrowRight");
      assert.equal(await PointOffset(), "6");
      await fileView.press("ArrowDown");
      assert.equal(await PointOffset(), "11");
      await fileView.press("Control+A");
      assert.equal(await PointOffset(), "11");
      await fileView.press("ArrowUp");
      assert.equal(await PointOffset(), "6");
      await fileView.press("Control+A");
      assert.equal(await PointOffset(), "6");
      await fileView.press("Control+V");
      assert.equal(await PointOffset(), "17");
      await fileView.press("Alt+V");
      assert.equal(await PointOffset(), "0");
      await fileView.press("Control+V");
      assert.equal(await PointOffset(), "17");
      await page.locator(".sheaf-chat-file-plain").click({ position: { x: 2, y: 8 } });
      assert.equal(await PointOffset(), "0");
      assert.equal(
        await page.evaluate(() => document.querySelector(".sheaf-chat-file-view")?.textContent?.includes("alpha\nbeta\ngamma\n") === true),
        true,
      );
    }
    finally
    {
      await page.close();
      await browser.close();
    }
  }, {
    realRepoRoot: x_realRepoRoot,
    port: PlaywrightPort(3),
  });
});

test("file view supports C-g cancellation, mark, region, and exchange", async () =>
{
  const { chromium } = await LoadPlaywright();

  await WithBrowserTestServer(async (handle) =>
  {
    const rootDirectory = path.join(handle.config.repoRoot, "projects", "demo");
    await WriteSessionFile(rootDirectory, "mark.txt", "alpha\nbeta\n");

    const session = await CreateSessionWithRoot(handle, rootDirectory);
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    async function FileViewAttribute(name: string): Promise<string | null>
    {
      return page.evaluate(() => null).then(async () =>
        page.evaluate(() => document.querySelector(".sheaf-chat-file-view")?.outerHTML ?? ""),
      ).then((html) =>
      {
        const match = html.match(new RegExp(`${name}="([^"]*)"`));
        return match ? match[1]! : null;
      });
    }

    try
    {
      await page.goto(
        `${handle.baseUrl}/#/repositories/${encodeURIComponent(session.repoId)}/workspaces/${encodeURIComponent(session.workspaceId)}`,
        { waitUntil: "domcontentloaded" },
      );
      await page.waitForFunction(() =>
        (document.querySelector(".sheaf-chat-explorer-tree")?.textContent ?? "").includes("mark.txt"),
      undefined, { timeout: 5000 });
      await page.locator(".sheaf-chat-explorer-file", { hasText: "mark.txt" }).click();
      await page.locator(".sheaf-chat-file-point").waitFor({ timeout: 5000 });
      const fileView = page.locator(".sheaf-chat-file-view");
      await fileView.click();

      await fileView.press("Control+X");
      assert.equal(await FileViewAttribute("data-key-prefix"), "C-x");
      await fileView.press("Control+G");
      assert.equal(await FileViewAttribute("data-key-prefix"), null);

      await fileView.press("Control+Space");
      assert.equal(await FileViewAttribute("data-mark-offset"), "0");
      assert.equal(await FileViewAttribute("data-mark-active"), "true");
      await fileView.press("ArrowRight");
      await fileView.press("ArrowRight");
      assert.equal(await FileViewAttribute("data-point-offset"), "2");
      assert.equal(await page.locator(".sheaf-chat-file-region").count(), 1);

      await fileView.press("Control+X");
      assert.equal(await FileViewAttribute("data-key-prefix"), "C-x");
      await fileView.press("x");
      assert.equal(await FileViewAttribute("data-point-offset"), "0");
      assert.equal(await FileViewAttribute("data-mark-offset"), "2");
      assert.equal(await FileViewAttribute("data-mark-active"), "true");

      await fileView.press("Control+G");
      assert.equal(await FileViewAttribute("data-point-offset"), "0");
      assert.equal(await FileViewAttribute("data-mark-offset"), "2");
      assert.equal(await FileViewAttribute("data-mark-active"), "false");
      assert.equal(await page.locator(".sheaf-chat-file-region").count(), 0);

      await fileView.press("Control+X");
      await fileView.press("x");
      assert.equal(await FileViewAttribute("data-point-offset"), "2");
      assert.equal(await FileViewAttribute("data-mark-offset"), "0");
      assert.equal(await FileViewAttribute("data-mark-active"), "true");
    }
    finally
    {
      await page.close();
      await browser.close();
    }
  }, {
    realRepoRoot: x_realRepoRoot,
    port: PlaywrightPort(4),
  });
});

test("file view page commands move by a visible page and keep point in view", async () =>
{
  const { chromium } = await LoadPlaywright();

  await WithBrowserTestServer(async (handle) =>
  {
    const rootDirectory = path.join(handle.config.repoRoot, "projects", "demo");
    const lines = Array.from({ length: 80 }, (_, index) =>
      `line ${String(index + 1).padStart(2, "0")} abcdefghij`
    );
    const content = `${lines.join("\n")}\n`;
    await WriteSessionFile(rootDirectory, "long.txt", content);

    const session = await CreateSessionWithRoot(handle, rootDirectory);
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try
    {
      await page.goto(
        `${handle.baseUrl}/#/repositories/${encodeURIComponent(session.repoId)}/workspaces/${encodeURIComponent(session.workspaceId)}`,
        { waitUntil: "domcontentloaded" },
      );
      await page.waitForFunction(() =>
        (document.querySelector(".sheaf-chat-explorer-tree")?.textContent ?? "").includes("long.txt"),
      undefined, { timeout: 5000 });
      await page.locator(".sheaf-chat-explorer-file", { hasText: "long.txt" }).click();
      await page.locator(".sheaf-chat-file-point").waitFor({ timeout: 5000 });
      await page.evaluate(() =>
      {
        const view = document.querySelector(".sheaf-chat-file-view") as HTMLElement | null;
        if (view) {
          view.style.flex = "0 0 128px";
          view.style.height = "128px";
          view.style.maxHeight = "128px";
          view.style.overflow = "auto";
        }
      });

      const fileView = page.locator(".sheaf-chat-file-view");
      await fileView.click();
      await fileView.press("Control+V");
      await page.waitForFunction(() =>
        ((document.querySelector(".sheaf-chat-file-view") as HTMLElement | null)?.scrollTop ?? 0) > 0,
      undefined, { timeout: 5000 });
      const afterPageDown = await page.evaluate((fileLength: unknown) =>
      {
        const view = document.querySelector(".sheaf-chat-file-view") as HTMLElement | null;
        const point = document.querySelector(".sheaf-chat-file-point") as HTMLElement | null;
        const viewRect = view?.getBoundingClientRect();
        const pointRect = point?.getBoundingClientRect();
        return {
          pointOffset: Number(view?.getAttribute("data-point-offset") ?? "-1"),
          scrollTop: view?.scrollTop ?? 0,
          maxScroll: view ? view.scrollHeight - view.clientHeight : 0,
          pointVisible:
            viewRect !== undefined &&
            pointRect !== undefined &&
            pointRect.top >= viewRect.top &&
            pointRect.bottom <= viewRect.bottom,
          fileLength: Number(fileLength),
        };
      }, content.length);
      assert.ok(afterPageDown.pointOffset > 0, "C-v should move point forward");
      assert.ok(
        afterPageDown.pointOffset < afterPageDown.fileLength,
        `C-v should not jump straight to EOF; point=${afterPageDown.pointOffset}`,
      );
      assert.ok(afterPageDown.scrollTop > 0, "C-v should scroll the file view");
      assert.ok(afterPageDown.scrollTop < afterPageDown.maxScroll, "C-v should not jump straight to bottom");
      assert.equal(afterPageDown.pointVisible, true, "point should remain visible after C-v");

      await fileView.press("Alt+V");
      await page.waitForFunction((previousScroll: unknown) =>
        ((document.querySelector(".sheaf-chat-file-view") as HTMLElement | null)?.scrollTop ?? 0) <
          Number(previousScroll),
      afterPageDown.scrollTop, { timeout: 5000 });
      const afterPageUp = await page.evaluate(() =>
      {
        const view = document.querySelector(".sheaf-chat-file-view") as HTMLElement | null;
        const point = document.querySelector(".sheaf-chat-file-point") as HTMLElement | null;
        const viewRect = view?.getBoundingClientRect();
        const pointRect = point?.getBoundingClientRect();
        return {
          pointOffset: Number(view?.getAttribute("data-point-offset") ?? "-1"),
          scrollTop: view?.scrollTop ?? 0,
          pointVisible:
            viewRect !== undefined &&
            pointRect !== undefined &&
            pointRect.top >= viewRect.top &&
            pointRect.bottom <= viewRect.bottom,
        };
      });
      assert.ok(afterPageUp.pointOffset < afterPageDown.pointOffset, "M-v should move point backward");
      assert.ok(afterPageUp.scrollTop < afterPageDown.scrollTop, "M-v should scroll upward");
      assert.equal(afterPageUp.pointVisible, true, "point should remain visible after M-v");
    }
    finally
    {
      await page.close();
      await browser.close();
    }
  }, {
    realRepoRoot: x_realRepoRoot,
    port: PlaywrightPort(14),
  });
});

test("file view synchronizes point and viewport during keyboard and scroll movement", async () =>
{
  const { chromium } = await LoadPlaywright();

  await WithBrowserTestServer(async (handle) =>
  {
    const rootDirectory = path.join(handle.config.repoRoot, "projects", "demo");
    const lines = Array.from({ length: 90 }, (_, index) =>
      `sync line ${String(index + 1).padStart(2, "0")}`
    );
    const content = `${lines.join("\n")}\n`;
    await WriteSessionFile(rootDirectory, "sync.txt", content);

    const session = await CreateSessionWithRoot(handle, rootDirectory);
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try
    {
      await page.goto(
        `${handle.baseUrl}/#/repositories/${encodeURIComponent(session.repoId)}/workspaces/${encodeURIComponent(session.workspaceId)}`,
        { waitUntil: "domcontentloaded" },
      );
      await page.waitForFunction(() =>
        (document.querySelector(".sheaf-chat-explorer-tree")?.textContent ?? "").includes("sync.txt"),
      undefined, { timeout: 5000 });
      await page.locator(".sheaf-chat-explorer-file", { hasText: "sync.txt" }).click();
      await page.locator(".sheaf-chat-file-point").waitFor({ timeout: 5000 });
      await page.evaluate(() =>
      {
        const view = document.querySelector(".sheaf-chat-file-view") as HTMLElement | null;
        if (view) {
          view.style.flex = "0 0 96px";
          view.style.height = "96px";
          view.style.maxHeight = "96px";
          view.style.overflow = "auto";
        }
      });

      const fileView = page.locator(".sheaf-chat-file-view");
      await fileView.click();
      for (let index = 0; index < 18; index += 1)
      {
        await fileView.press("ArrowDown");
      }

      await page.waitForFunction(() =>
      {
        const view = document.querySelector(".sheaf-chat-file-view") as HTMLElement | null;
        const point = document.querySelector(".sheaf-chat-file-point") as HTMLElement | null;
        const viewRect = view?.getBoundingClientRect();
        const pointRect = point?.getBoundingClientRect();
        return view !== null &&
          view.scrollTop > 0 &&
          viewRect !== undefined &&
          pointRect !== undefined &&
          pointRect.top >= viewRect.top &&
          pointRect.bottom <= viewRect.bottom;
      }, undefined, { timeout: 5000 });

      const beforeScrollPoint = await page.evaluate(() =>
        Number(document.querySelector(".sheaf-chat-file-view")?.getAttribute("data-point-offset") ?? "0")
      );
      await page.evaluate(() =>
      {
        const view = document.querySelector(".sheaf-chat-file-view") as HTMLElement | null;
        const source = document.querySelector(".sheaf-chat-file-navigable") as HTMLElement | null;
        if (!view || !source) {
          return;
        }
        const lineHeight = parseFloat(getComputedStyle(source).lineHeight) || 16;
        view.scrollTop += lineHeight * 8;
        view.dispatchEvent(new Event("scroll", { bubbles: true }));
      });
      await page.waitForFunction((previousPoint: unknown) =>
      {
        const point = Number(document.querySelector(".sheaf-chat-file-view")?.getAttribute("data-point-offset") ?? "0");
        return point > Number(previousPoint);
      }, beforeScrollPoint, { timeout: 5000 });
    }
    finally
    {
      await page.close();
      await browser.close();
    }
  }, {
    realRepoRoot: x_realRepoRoot,
    port: PlaywrightPort(15),
  });
});

test("file view supports incremental search and search-origin exchange", async () =>
{
  const { chromium } = await LoadPlaywright();

  await WithBrowserTestServer(async (handle) =>
  {
    const rootDirectory = path.join(handle.config.repoRoot, "projects", "demo");
    await WriteSessionFile(rootDirectory, "search.txt", "alpha\nbeta\nbeta again\n");

    const session = await CreateSessionWithRoot(handle, rootDirectory);
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    async function Attr(name: string): Promise<string | null>
    {
      return page.evaluate((attributeName: string) =>
        document.querySelector(".sheaf-chat-file-view")?.getAttribute(attributeName) ?? null,
      name);
    }

    try
    {
      await page.goto(
        `${handle.baseUrl}/#/repositories/${encodeURIComponent(session.repoId)}/workspaces/${encodeURIComponent(session.workspaceId)}`,
        { waitUntil: "domcontentloaded" },
      );
      await page.waitForFunction(() =>
        (document.querySelector(".sheaf-chat-explorer-tree")?.textContent ?? "").includes("search.txt"),
      undefined, { timeout: 5000 });
      await page.locator(".sheaf-chat-explorer-file", { hasText: "search.txt" }).click();
      await page.locator(".sheaf-chat-file-point").waitFor({ timeout: 5000 });
      const fileView = page.locator(".sheaf-chat-file-view");
      await fileView.click();

      await fileView.press("Control+S");
      await page.locator(".sheaf-chat-file-minibuffer").waitFor({ timeout: 5000 });
      await fileView.press("b");
      await fileView.press("e");
      await fileView.press("t");
      await fileView.press("a");
      assert.equal(await Attr("data-point-offset"), "6");
      assert.equal(await page.locator(".sheaf-chat-file-search-match").count(), 1);

      await fileView.press("Control+G");
      assert.equal(await Attr("data-point-offset"), "0");
      assert.equal(await page.locator(".sheaf-chat-file-minibuffer").count(), 0);

      await fileView.press("Control+S");
      await fileView.press("b");
      await fileView.press("e");
      await fileView.press("t");
      await fileView.press("a");
      await fileView.press("Control+S");
      assert.equal(await Attr("data-point-offset"), "11");
      await fileView.press("Control+R");
      assert.equal(await Attr("data-point-offset"), "6");
      assert.match(await page.locator(".sheaf-chat-file-minibuffer").textContent() || "", /backward/);
      await fileView.press("Control+S");
      assert.equal(await Attr("data-point-offset"), "11");
      await fileView.press("Enter");
      assert.equal(await page.locator(".sheaf-chat-file-minibuffer").count(), 0);
      assert.equal(await Attr("data-mark-offset"), "0");
      assert.equal(await Attr("data-mark-active"), "false");

      await fileView.press("Control+X");
      await fileView.press("x");
      assert.equal(await Attr("data-point-offset"), "0");
      assert.equal(await Attr("data-mark-offset"), "11");
      assert.equal(await Attr("data-mark-active"), "true");

      await fileView.press("Control+S");
      await fileView.press("a");
      await fileView.press("Enter");
      assert.equal(await Attr("data-mark-offset"), "11");
      assert.equal(await Attr("data-mark-active"), "true");

      await fileView.press("Control+S");
      await fileView.press("a");
      assert.equal(await Attr("data-point-offset"), "0");
      await fileView.press("ArrowRight");
      assert.equal(await page.locator(".sheaf-chat-file-minibuffer").count(), 0);
      assert.equal(await Attr("data-point-offset"), "1");
    }
    finally
    {
      await page.close();
      await browser.close();
    }
  }, {
    realRepoRoot: x_realRepoRoot,
    port: PlaywrightPort(5),
  });
});

test("file view keeps search matches visible while searching forward and backward", async () =>
{
  const { chromium } = await LoadPlaywright();

  await WithBrowserTestServer(async (handle) =>
  {
    const rootDirectory = path.join(handle.config.repoRoot, "projects", "demo");
    const lines: string[] = [];
    for (let index = 1; index <= 180; index += 1)
    {
      if (index === 12)
      {
        lines.push("early-target");
      }
      else if (index === 160)
      {
        lines.push("late-target");
      }
      else
      {
        lines.push(`filler line ${index}`);
      }
    }
    await WriteSessionFile(rootDirectory, "long-search.txt", `${lines.join("\n")}\n`);

    const session = await CreateSessionWithRoot(handle, rootDirectory);
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    async function PointIsVisible(): Promise<boolean>
    {
      return page.evaluate(() =>
      {
        const view = document.querySelector(".sheaf-chat-file-view") as HTMLElement | null;
        const point = document.querySelector(".sheaf-chat-file-point") as HTMLElement | null;
        const viewRect = view?.getBoundingClientRect();
        const pointRect = point?.getBoundingClientRect();
        return viewRect !== undefined &&
          pointRect !== undefined &&
          pointRect.top >= viewRect.top &&
          pointRect.bottom <= viewRect.bottom;
      });
    }

    try
    {
      await page.goto(
        `${handle.baseUrl}/#/repositories/${encodeURIComponent(session.repoId)}/workspaces/${encodeURIComponent(session.workspaceId)}`,
        { waitUntil: "domcontentloaded" },
      );
      await page.waitForFunction(() =>
        (document.querySelector(".sheaf-chat-explorer-tree")?.textContent ?? "").includes("long-search.txt"),
      undefined, { timeout: 5000 });
      await page.locator(".sheaf-chat-explorer-file", { hasText: "long-search.txt" }).click();
      await page.locator(".sheaf-chat-file-point").waitFor({ timeout: 5000 });
      const fileView = page.locator(".sheaf-chat-file-view");
      await fileView.click();

      await fileView.press("Control+S");
      await page.locator(".sheaf-chat-file-minibuffer").waitFor({ timeout: 5000 });
      for (const key of "late-target")
      {
        await fileView.press(key);
      }
      await page.waitForFunction(() =>
        Number(document.querySelector(".sheaf-chat-file-view")?.getAttribute("data-point-offset") ?? "0") > 1000,
      undefined, { timeout: 5000 });
      await page.waitForFunction(() =>
      {
        const view = document.querySelector(".sheaf-chat-file-view") as HTMLElement | null;
        const point = document.querySelector(".sheaf-chat-file-point") as HTMLElement | null;
        const viewRect = view?.getBoundingClientRect();
        const pointRect = point?.getBoundingClientRect();
        return viewRect !== undefined &&
          pointRect !== undefined &&
          pointRect.top >= viewRect.top &&
          pointRect.bottom <= viewRect.bottom;
      }, undefined, { timeout: 5000 });
      assert.equal(await PointIsVisible(), true);

      await fileView.press("Enter");
      await fileView.press("Control+R");
      await page.locator(".sheaf-chat-file-minibuffer", { hasText: "I-search backward:" }).waitFor({
        timeout: 5000,
      });
      for (const key of "early-target")
      {
        await fileView.press(key);
      }
      await page.waitForFunction(() =>
      {
        const point = Number(document.querySelector(".sheaf-chat-file-view")?.getAttribute("data-point-offset") ?? "0");
        return point > 0 && point < 1000;
      }, undefined, { timeout: 5000 });
      await page.waitForFunction(() =>
      {
        const view = document.querySelector(".sheaf-chat-file-view") as HTMLElement | null;
        const point = document.querySelector(".sheaf-chat-file-point") as HTMLElement | null;
        const viewRect = view?.getBoundingClientRect();
        const pointRect = point?.getBoundingClientRect();
        return viewRect !== undefined &&
          pointRect !== undefined &&
          pointRect.top >= viewRect.top &&
          pointRect.bottom <= viewRect.bottom;
      }, undefined, { timeout: 5000 });
      assert.equal(await PointIsVisible(), true);
    }
    finally
    {
      await page.close();
      await browser.close();
    }
  }, {
    realRepoRoot: x_realRepoRoot,
    port: PlaywrightPort(16),
  });
});

test("file view search follows Emacs smart case and wrap pause semantics", async () =>
{
  const { chromium } = await LoadPlaywright();

  await WithBrowserTestServer(async (handle) =>
  {
    const rootDirectory = path.join(handle.config.repoRoot, "projects", "demo");
    await WriteSessionFile(rootDirectory, "emacs-search.txt", "FOO\nbar\nneedle\nmiddle\nneedle\nFoo\n");

    const session = await CreateSessionWithRoot(handle, rootDirectory);
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    async function PointOffset(): Promise<number>
    {
      return page.evaluate(() =>
        Number(document.querySelector(".sheaf-chat-file-view")?.getAttribute("data-point-offset") ?? "-1")
      );
    }

    async function PromptText(): Promise<string>
    {
      return page.evaluate(() =>
        document.querySelector(".sheaf-chat-file-minibuffer")?.textContent ?? ""
      );
    }

    try
    {
      await page.goto(
        `${handle.baseUrl}/#/repositories/${encodeURIComponent(session.repoId)}/workspaces/${encodeURIComponent(session.workspaceId)}`,
        { waitUntil: "domcontentloaded" },
      );
      await page.waitForFunction(() =>
        (document.querySelector(".sheaf-chat-explorer-tree")?.textContent ?? "").includes("emacs-search.txt"),
      undefined, { timeout: 5000 });
      await page.locator(".sheaf-chat-explorer-file", { hasText: "emacs-search.txt" }).click();
      await page.locator(".sheaf-chat-file-point").waitFor({ timeout: 5000 });
      const fileView = page.locator(".sheaf-chat-file-view");
      await fileView.click();

      await fileView.press("Control+S");
      for (const key of "foo")
      {
        await fileView.press(key);
      }
      assert.equal(await PointOffset(), 0, "lowercase query should match uppercase file text");
      assert.equal(await page.locator(".sheaf-chat-file-search-match").count(), 1);
      await fileView.press("Control+G");

      await fileView.press("Control+S");
      for (const key of "Foo")
      {
        await fileView.press(key);
      }
      assert.equal(await PointOffset(), 29, "uppercase query should be case-sensitive");
      await fileView.press("Backspace");
      await fileView.press("Backspace");
      await fileView.press("Backspace");
      for (const key of "foo")
      {
        await fileView.press(key);
      }
      assert.equal(await PointOffset(), 0, "removing uppercase restores case-insensitive search");
      await fileView.press("Control+G");

      await fileView.press("Control+S");
      for (const key of "needle")
      {
        await fileView.press(key);
      }
      assert.equal(await PointOffset(), 8);
      await fileView.press("Control+S");
      assert.equal(await PointOffset(), 22);
      await fileView.press("Control+S");
      assert.equal(await PointOffset(), 22, "first repeat at last match should pause before wrapping");
      assert.match(await PromptText(), /Failing/i);
      await fileView.press("Control+S");
      assert.equal(await PointOffset(), 8, "second repeat should wrap to first match");
      assert.match(await PromptText(), /Wrapped/i);

      await fileView.press("Enter");
      await fileView.press("Control+S");
      await page.locator(".sheaf-chat-file-minibuffer", { hasText: "I-search:" }).waitFor({
        timeout: 5000,
      });
      for (const key of "needle")
      {
        await fileView.press(key);
      }
      assert.equal(await PointOffset(), 8);
      await fileView.press("Control+S");
      assert.equal(await PointOffset(), 22);
      await fileView.press("Enter");
      for (let index = 0; index < "needle".length; index += 1)
      {
        await fileView.press("ArrowRight");
      }
      await fileView.press("Control+R");
      for (const key of "needle")
      {
        await fileView.press(key);
      }
      assert.equal(await PointOffset(), 22);
      await fileView.press("Control+R");
      assert.equal(await PointOffset(), 8);
      await fileView.press("Control+R");
      assert.equal(await PointOffset(), 8, "first reverse repeat at first match should pause before wrapping");
      assert.match(await PromptText(), /Failing/i);
      await fileView.press("Control+R");
      assert.equal(await PointOffset(), 22, "second reverse repeat should wrap to last match");
      assert.match(await PromptText(), /Wrapped/i);
    }
    finally
    {
      await page.close();
      await browser.close();
    }
  }, {
    realRepoRoot: x_realRepoRoot,
    port: PlaywrightPort(17),
  });
});

test("file view supports find-file completion and buffer tab switching", async () =>
{
  const { chromium } = await LoadPlaywright();

  await WithBrowserTestServer(async (handle) =>
  {
    const rootDirectory = path.join(handle.config.repoRoot, "projects", "demo");
    await WriteSessionFile(rootDirectory, "current.txt", "current\n");
    await WriteSessionFile(rootDirectory, "octane.txt", "octane\n");
    await WriteSessionFile(rootDirectory, "octave.txt", "octave\n");
    await WriteSessionFile(rootDirectory, "other.txt", "other\n");
    await WriteSessionFile(rootDirectory, "reports-alpha.txt", "reports alpha\n");
    await WriteSessionFile(rootDirectory, "reports-beta.txt", "reports beta\n");
    await WriteSessionFile(rootDirectory, "sub/nested.txt", "nested\n");

    const session = await CreateSessionWithRoot(handle, rootDirectory);
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    async function Attr(name: string): Promise<string | null>
    {
      return page.evaluate((attributeName: string) =>
        document.querySelector(".sheaf-chat-file-view")?.getAttribute(attributeName) ?? null,
      name);
    }

    try
    {
      await page.goto(
        `${handle.baseUrl}/#/repositories/${encodeURIComponent(session.repoId)}/workspaces/${encodeURIComponent(session.workspaceId)}`,
        { waitUntil: "domcontentloaded" },
      );
      await page.waitForFunction(() =>
        (document.querySelector(".sheaf-chat-explorer-tree")?.textContent ?? "").includes("current.txt"),
      undefined, { timeout: 5000 });
      await page.locator(".sheaf-chat-explorer-file", { hasText: "current.txt" }).click();
      await page.locator(".sheaf-chat-file-point").waitFor({ timeout: 5000 });
      const fileView = page.locator(".sheaf-chat-file-view");
      await fileView.click();

      await fileView.press("Control+X");
      await fileView.press("f");
      await page.locator(".sheaf-chat-file-minibuffer", { hasText: "Find file:" }).waitFor({
        timeout: 5000,
      });
      await fileView.press("o");
      await fileView.press("c");
      await fileView.press("Tab");
      await page.waitForFunction(() =>
        (document.querySelector(".sheaf-chat-file-minibuffer-input")?.textContent ?? "") === "octa",
      undefined, { timeout: 5000 });
      assert.match(await page.locator(".sheaf-chat-file-minibuffer").textContent() || "", /octane\.txt/);
      assert.match(await page.locator(".sheaf-chat-file-minibuffer").textContent() || "", /octave\.txt/);
      await fileView.press("n");
      await fileView.press("Tab");
      await page.waitForFunction(() =>
        (document.querySelector(".sheaf-chat-file-minibuffer-input")?.textContent ?? "") === "octane.txt",
      undefined, { timeout: 5000 });
      await fileView.press("Control+G");

      await fileView.press("Control+X");
      await fileView.press("f");
      await page.locator(".sheaf-chat-file-minibuffer", { hasText: "Find file:" }).waitFor({
        timeout: 5000,
      });
      for (const key of ["o", "t", "h", "e"])
      {
        await fileView.press(key);
      }
      await fileView.press("Tab");
      await page.waitForFunction(() =>
        (document.querySelector(".sheaf-chat-file-minibuffer")?.textContent ?? "").includes("other.txt"),
      undefined, { timeout: 5000 });
      await fileView.press("Enter");
      await page.waitForFunction(() =>
        document.querySelector(".sheaf-chat-file-view")?.getAttribute("data-navigation-path") === "other.txt",
      undefined, { timeout: 5000 });

      await fileView.press("Control+X");
      await fileView.press("b");
      await page.locator(".sheaf-chat-file-minibuffer", { hasText: "Switch buffer:" }).waitFor({
        timeout: 5000,
      });
      await fileView.press("Enter");
      assert.equal(await Attr("data-navigation-path"), "current.txt");

      await fileView.press("Control+X");
      await fileView.press("f");
      await fileView.press(".");
      await fileView.press(".");
      await fileView.press("/");
      await fileView.press("b");
      await fileView.press("a");
      await fileView.press("d");
      await fileView.press("Enter");
      await page.waitForFunction(() =>
        (document.querySelector(".sheaf-chat-file-minibuffer-error")?.textContent ?? "").includes("Unsafe path"),
      undefined, { timeout: 5000 });
      assert.equal(await Attr("data-navigation-path"), "current.txt");
      await fileView.press("Control+G");

      await fileView.press("Control+X");
      await fileView.press("f");
      await fileView.press("s");
      await fileView.press("Tab");
      await page.waitForFunction(() =>
        (document.querySelector(".sheaf-chat-file-minibuffer-input")?.textContent ?? "").includes("sub/"),
      undefined, { timeout: 5000 });
      await fileView.press("n");
      await fileView.press("Tab");
      await page.waitForFunction(() =>
        (document.querySelector(".sheaf-chat-file-minibuffer-input")?.textContent ?? "").includes("sub/nested.txt"),
      undefined, { timeout: 5000 });
      await fileView.press("Enter");
      await page.waitForFunction(() =>
        document.querySelector(".sheaf-chat-file-view")?.getAttribute("data-navigation-path") === "sub/nested.txt",
      undefined, { timeout: 5000 });

      for (const reportPath of ["reports-alpha.txt", "reports-beta.txt"])
      {
        await fileView.press("Control+X");
        await fileView.press("f");
        await page.locator(".sheaf-chat-file-minibuffer", { hasText: "Find file:" }).waitFor({
          timeout: 5000,
        });
        const defaultInput = await page.locator(".sheaf-chat-file-minibuffer-input").textContent() || "";
        for (let index = 0; index < defaultInput.length; index += 1)
        {
          await fileView.press("Backspace");
        }
        for (const key of reportPath)
        {
          await fileView.press(key);
        }
        await fileView.press("Enter");
        await page.waitForFunction((expectedPath: unknown) =>
          document.querySelector(".sheaf-chat-file-view")?.getAttribute("data-navigation-path") === expectedPath,
        reportPath, { timeout: 5000 });
      }

      await fileView.press("Control+X");
      await fileView.press("b");
      await fileView.press("r");
      await fileView.press("e");
      await fileView.press("p");
      await fileView.press("Tab");
      await page.waitForFunction(() =>
        (document.querySelector(".sheaf-chat-file-minibuffer-input")?.textContent ?? "") === "reports-",
      undefined, { timeout: 5000 });
      assert.match(await page.locator(".sheaf-chat-file-minibuffer").textContent() || "", /reports-alpha\.txt/);
      assert.match(await page.locator(".sheaf-chat-file-minibuffer").textContent() || "", /reports-beta\.txt/);
      await fileView.press("Control+G");

      await fileView.press("Control+X");
      await fileView.press("b");
      await fileView.press("m");
      await fileView.press("i");
      await fileView.press("s");
      await fileView.press("s");
      await fileView.press("i");
      await fileView.press("n");
      await fileView.press("g");
      await fileView.press("Enter");
      await page.waitForFunction(() =>
        (document.querySelector(".sheaf-chat-file-minibuffer-error")?.textContent ?? "").includes("No matching buffer"),
      undefined, { timeout: 5000 });
      assert.equal(await Attr("data-navigation-path"), "reports-beta.txt");
    }
    finally
    {
      await page.close();
      await browser.close();
    }
  }, {
    realRepoRoot: x_realRepoRoot,
    port: PlaywrightPort(6),
  });
});

test("markdown file navigation uses source offsets while keeping rendered preview", async () =>
{
  const { chromium } = await LoadPlaywright();

  await WithBrowserTestServer(async (handle) =>
  {
    const rootDirectory = path.join(handle.config.repoRoot, "projects", "demo");
    await WriteSessionFile(rootDirectory, "guide.md", "# Title\n\n- item\n");
    await WriteSessionFile(rootDirectory, "other.md", "# Other\n");

    const session = await CreateSessionWithRoot(handle, rootDirectory);
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try
    {
      await page.goto(
        `${handle.baseUrl}/#/repositories/${encodeURIComponent(session.repoId)}/workspaces/${encodeURIComponent(session.workspaceId)}`,
        { waitUntil: "domcontentloaded" },
      );
      await page.waitForFunction(() =>
        (document.querySelector(".sheaf-chat-explorer-tree")?.textContent ?? "").includes("guide.md"),
      undefined, { timeout: 5000 });
      await page.locator(".sheaf-chat-explorer-file", { hasText: "guide.md" }).click();
      await page.locator(".sheaf-file-view-content h1", { hasText: "Title" }).waitFor({
        timeout: 5000,
      });
      const fileView = page.locator(".sheaf-chat-file-view");
      await fileView.click();
      await page.locator(".sheaf-chat-file-point").waitFor({ timeout: 5000 });

      await fileView.press("Control+E");
      const pointOffset = await page.evaluate(() =>
        document.querySelector(".sheaf-chat-file-view")?.getAttribute("data-point-offset"),
      );
      assert.equal(pointOffset, "7");

      await page.locator(".sheaf-chat-explorer-file", { hasText: "other.md" }).click();
      await page.waitForFunction(() =>
        document.querySelector(".sheaf-chat-file-view")?.getAttribute("data-navigation-path") === "other.md",
      undefined, { timeout: 5000 });
      await page.locator(".sheaf-chat-tab", { hasText: "guide.md" }).click();
      await page.waitForFunction(() =>
        document.querySelector(".sheaf-chat-file-view")?.getAttribute("data-navigation-path") === "guide.md",
      undefined, { timeout: 5000 });
      assert.equal(
        await page.evaluate(() => document.querySelector(".sheaf-chat-file-view")?.getAttribute("data-point-offset")),
        "7",
      );

      await new Promise((resolve) => setTimeout(resolve, 600));
      const restored = await browser.newPage();
      try
      {
        await restored.goto(
          `${handle.baseUrl}/#/repositories/${encodeURIComponent(session.repoId)}/workspaces/${encodeURIComponent(session.workspaceId)}`,
          { waitUntil: "domcontentloaded" },
        );
        await restored.waitForFunction(() =>
          document.querySelector(".sheaf-chat-file-view")?.getAttribute("data-navigation-path") === "guide.md",
        undefined, { timeout: 5000 });
        assert.equal(
          await restored.evaluate(() => document.querySelector(".sheaf-chat-file-view")?.getAttribute("data-point-offset")),
          "7",
        );
      }
      finally
      {
        await restored.close();
      }
    }
    finally
    {
      await page.close();
      await browser.close();
    }
  }, {
    realRepoRoot: x_realRepoRoot,
    port: PlaywrightPort(7),
  });
});

test("highlighted file navigation composes point, region, and search decorations", async () =>
{
  const { chromium } = await LoadPlaywright();

  await WithBrowserTestServer(async (handle) =>
  {
    const rootDirectory = path.join(handle.config.repoRoot, "projects", "demo");
    await WriteSessionFile(rootDirectory, "code.js", "function demo() {\n  return 1;\n}\n");

    const session = await CreateSessionWithRoot(handle, rootDirectory);
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try
    {
      await page.goto(
        `${handle.baseUrl}/#/repositories/${encodeURIComponent(session.repoId)}/workspaces/${encodeURIComponent(session.workspaceId)}`,
        { waitUntil: "domcontentloaded" },
      );
      await page.waitForFunction(() =>
        (document.querySelector(".sheaf-chat-explorer-tree")?.textContent ?? "").includes("code.js"),
      undefined, { timeout: 5000 });
      await page.locator(".sheaf-chat-explorer-file", { hasText: "code.js" }).click();
      await page.locator(".sheaf-chat-file-highlighted .hljs").waitFor({ timeout: 5000 });
      await page.locator(".sheaf-chat-file-point").waitFor({ timeout: 5000 });

      const fileView = page.locator(".sheaf-chat-file-view");
      await fileView.click();
      await fileView.press("Control+Space");
      await fileView.press("ArrowRight");
      await fileView.press("ArrowRight");
      assert.equal(await page.locator(".sheaf-chat-file-highlighted .sheaf-chat-file-region").count(), 1);

      await fileView.press("Control+G");
      await fileView.press("Control+S");
      await fileView.press("r");
      await fileView.press("e");
      await fileView.press("t");
      assert.equal(await page.locator(".sheaf-chat-file-highlighted .sheaf-chat-file-search-match").count(), 1);
    }
    finally
    {
      await page.close();
      await browser.close();
    }
  }, {
    realRepoRoot: x_realRepoRoot,
    port: PlaywrightPort(8),
  });
});

test("rendered file point does not inject blank text into previews", async () =>
{
  const { chromium } = await LoadPlaywright();

  await WithBrowserTestServer(async (handle) =>
  {
    const rootDirectory = path.join(handle.config.repoRoot, "projects", "demo");
    const code = "function demo() {\n  return 1;\n}\n";
    await WriteSessionFile(rootDirectory, "code.js", code);
    await WriteSessionFile(rootDirectory, "guide.md", "# Title\n\nBody\n");

    const session = await CreateSessionWithRoot(handle, rootDirectory);
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try
    {
      await page.goto(
        `${handle.baseUrl}/#/repositories/${encodeURIComponent(session.repoId)}/workspaces/${encodeURIComponent(session.workspaceId)}`,
        { waitUntil: "domcontentloaded" },
      );
      await page.waitForFunction(() =>
        (document.querySelector(".sheaf-chat-explorer-tree")?.textContent ?? "").includes("code.js"),
      undefined, { timeout: 5000 });

      await page.locator(".sheaf-chat-explorer-file", { hasText: "code.js" }).click();
      await page.locator(".sheaf-chat-file-highlighted .sheaf-chat-file-point").waitFor({ timeout: 5000 });
      assert.equal(
        await page.evaluate(() => document.querySelector(".sheaf-chat-file-highlighted")?.textContent),
        code,
      );
      await page.locator(".sheaf-chat-file-view").press("Control+E");
      assert.equal(
        await page.evaluate(() => document.querySelector(".sheaf-chat-file-highlighted")?.textContent),
        code,
      );

      await page.locator(".sheaf-chat-explorer-file", { hasText: "guide.md" }).click();
      await page.locator(".sheaf-file-view-content h1", { hasText: "Title" }).waitFor({ timeout: 5000 });
      assert.equal(
        await page.evaluate(() => (document.querySelector(".sheaf-file-view-content")?.textContent ?? "").includes("\u00a0")),
        false,
      );
      await page.locator(".sheaf-chat-file-view").press("Control+E");
      assert.equal(
        await page.evaluate(() => (document.querySelector(".sheaf-file-view-content")?.textContent ?? "").includes("\u00a0")),
        false,
      );
    }
    finally
    {
      await page.close();
      await browser.close();
    }
  }, {
    realRepoRoot: x_realRepoRoot,
    port: PlaywrightPort(12),
  });
});

test("minibuffer stays visible for active repeated commands in highlighted previews", async () =>
{
  const { chromium } = await LoadPlaywright();

  await WithBrowserTestServer(async (handle) =>
  {
    const rootDirectory = path.join(handle.config.repoRoot, "projects", "demo");
    await WriteSessionFile(rootDirectory, "code.js", "function demo() {\n  return 1;\n}\n");
    await WriteSessionFile(rootDirectory, "other.txt", "other\n");

    const session = await CreateSessionWithRoot(handle, rootDirectory);
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    async function ExpectMinibuffer(text: string): Promise<void>
    {
      await page.locator(".sheaf-chat-file-minibuffer", { hasText: text }).waitFor({ timeout: 5000 });
      assert.equal(await page.locator(".sheaf-chat-file-minibuffer").count(), 1);
    }

    async function ExpectNoMinibuffer(): Promise<void>
    {
      await page.waitForFunction(() =>
        document.querySelectorAll(".sheaf-chat-file-minibuffer").length === 0,
      undefined, { timeout: 5000 });
    }

    try
    {
      await page.goto(
        `${handle.baseUrl}/#/repositories/${encodeURIComponent(session.repoId)}/workspaces/${encodeURIComponent(session.workspaceId)}`,
        { waitUntil: "domcontentloaded" },
      );
      await page.waitForFunction(() =>
        (document.querySelector(".sheaf-chat-explorer-tree")?.textContent ?? "").includes("code.js"),
      undefined, { timeout: 5000 });
      await page.locator(".sheaf-chat-explorer-file", { hasText: "code.js" }).click();
      await page.locator(".sheaf-chat-file-highlighted .hljs").waitFor({ timeout: 5000 });
      const fileView = page.locator(".sheaf-chat-file-view");
      await fileView.click();

      await fileView.press("Control+X");
      await fileView.press("f");
      await ExpectMinibuffer("Find file:");
      await fileView.press("Control+G");
      await ExpectNoMinibuffer();

      await fileView.press("Control+S");
      await ExpectMinibuffer("I-search:");
      await fileView.press("r");
      await fileView.press("e");
      await fileView.press("t");
      await ExpectMinibuffer("ret");
      await fileView.press("Control+G");
      await ExpectNoMinibuffer();

      await fileView.press("Control+X");
      await fileView.press("b");
      await ExpectMinibuffer("Switch buffer:");
      await fileView.press("Control+G");
      await ExpectNoMinibuffer();

      await fileView.press("Control+X");
      await fileView.press("f");
      await ExpectMinibuffer("Find file:");
    }
    finally
    {
      await page.close();
      await browser.close();
    }
  }, {
    realRepoRoot: x_realRepoRoot,
    port: PlaywrightPort(10),
  });
});

test("find-file default path is editable with backspace for sibling directories", async () =>
{
  const { chromium } = await LoadPlaywright();

  await WithBrowserTestServer(async (handle) =>
  {
    const rootDirectory = path.join(handle.config.repoRoot, "projects", "demo");
    await WriteSessionFile(rootDirectory, "alpha/current.txt", "current\n");
    await WriteSessionFile(rootDirectory, "beta/target.txt", "target\n");

    const session = await CreateSessionWithRoot(handle, rootDirectory);
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    async function InputText(): Promise<string>
    {
      return page.evaluate(() =>
        document.querySelector(".sheaf-chat-file-minibuffer-input")?.textContent ?? "",
      );
    }

    try
    {
      await page.goto(
        `${handle.baseUrl}/#/repositories/${encodeURIComponent(session.repoId)}/workspaces/${encodeURIComponent(session.workspaceId)}`,
        { waitUntil: "domcontentloaded" },
      );
      await page.waitForFunction(() =>
        (document.querySelector(".sheaf-chat-explorer-tree")?.textContent ?? "").includes("alpha"),
      undefined, { timeout: 5000 });
      await page.locator(".sheaf-chat-explorer-directory", { hasText: "alpha" }).click();
      await page.locator(".sheaf-chat-explorer-file", { hasText: "current.txt" }).click();
      await page.waitForFunction(() =>
        document.querySelector(".sheaf-chat-file-view")?.getAttribute("data-navigation-path") === "alpha/current.txt",
      undefined, { timeout: 5000 });

      const fileView = page.locator(".sheaf-chat-file-view");
      await fileView.click();
      await fileView.press("Control+X");
      await fileView.press("f");
      await page.locator(".sheaf-chat-file-minibuffer", { hasText: "Find file:" }).waitFor({ timeout: 5000 });
      assert.equal(await InputText(), "alpha/");

      await fileView.press("Control+G");
      await page.waitForFunction(() =>
        document.querySelectorAll(".sheaf-chat-file-minibuffer").length === 0,
      undefined, { timeout: 5000 });

      await fileView.press("Control+X");
      await fileView.press("f");
      assert.equal(await InputText(), "alpha/");
      for (let index = 0; index < "alpha/".length; index += 1)
      {
        await fileView.press("Backspace");
      }
      assert.equal(await InputText(), "");

      await fileView.press("b");
      await fileView.press("e");
      await fileView.press("t");
      await fileView.press("a");
      await fileView.press("Tab");
      await page.waitForFunction(() =>
        document.querySelector(".sheaf-chat-file-minibuffer-input")?.textContent === "beta/",
      undefined, { timeout: 5000 });
      await fileView.press("t");
      await fileView.press("Tab");
      await page.waitForFunction(() =>
        document.querySelector(".sheaf-chat-file-minibuffer-input")?.textContent === "beta/target.txt",
      undefined, { timeout: 5000 });
      await fileView.press("Enter");
      await page.waitForFunction(() =>
        document.querySelector(".sheaf-chat-file-view")?.getAttribute("data-navigation-path") === "beta/target.txt",
      undefined, { timeout: 5000 });
    }
    finally
    {
      await page.close();
      await browser.close();
    }
  }, {
    realRepoRoot: x_realRepoRoot,
    port: PlaywrightPort(11),
  });
});

test("file view randomized minibuffer workflow preserves command invariants", async () =>
{
  const { chromium } = await LoadPlaywright();

  await WithBrowserTestServer(async (handle) =>
  {
    const rootDirectory = path.join(handle.config.repoRoot, "projects", "demo");
    await WriteSessionFile(rootDirectory, "alpha/current.txt", "current alpha text\n");
    await WriteSessionFile(rootDirectory, "beta/target.txt", "target beta text\n");
    await WriteSessionFile(rootDirectory, "code.js", "function target() {\n  return true;\n}\n");

    const session = await CreateSessionWithRoot(handle, rootDirectory);
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    const model = {
      selectedPath: "alpha/current.txt",
      tabs: new Set<string>(["alpha/current.txt"]),
    };
    const fileView = page.locator(".sheaf-chat-file-view");

    function Rng(seed: number): () => number
    {
      let value = seed >>> 0;
      return () =>
      {
        value = (value * 1103515245 + 12345) >>> 0;
        return value / 0x100000000;
      };
    }

    function DirectoryName(pathValue: string): string
    {
      const slash = pathValue.lastIndexOf("/");
      return slash < 0 ? "" : pathValue.slice(0, slash + 1);
    }

    async function PressText(text: string): Promise<void>
    {
      for (const character of text)
      {
        await fileView.press(character);
      }
    }

    async function InputText(): Promise<string>
    {
      return page.evaluate(() =>
        document.querySelector(".sheaf-chat-file-minibuffer-input")?.textContent ?? "",
      );
    }

    async function ExpectMinibuffer(text: string): Promise<void>
    {
      await page.locator(".sheaf-chat-file-minibuffer", { hasText: text }).waitFor({ timeout: 5000 });
      assert.equal(await page.locator(".sheaf-chat-file-minibuffer").count(), 1);
    }

    async function ExpectNoMinibuffer(): Promise<void>
    {
      await page.waitForFunction(() =>
        document.querySelectorAll(".sheaf-chat-file-minibuffer").length === 0,
      undefined, { timeout: 5000 });
    }

    async function AssertInvariants(label: string): Promise<void>
    {
      const observed = await page.evaluate(() =>
      {
        const view = document.querySelector(".sheaf-chat-file-view");
        return {
          path: view?.getAttribute("data-navigation-path") ?? null,
          minibuffers: document.querySelectorAll(".sheaf-chat-file-minibuffer").length,
          keyPrefix: view?.getAttribute("data-key-prefix") ?? null,
          hasNbsp: (view?.textContent ?? "").includes("\u00a0"),
        };
      });
      assert.equal(observed.path, model.selectedPath, `${label}: selected path`);
      assert.equal(observed.minibuffers, 0, `${label}: minibuffer cleared`);
      assert.equal(observed.keyPrefix, null, `${label}: prefix cleared`);
      assert.equal(observed.hasNbsp, false, `${label}: no injected blank text`);
    }

    async function StartFindFile(): Promise<void>
    {
      await fileView.press("Control+X");
      await fileView.press("f");
      await ExpectMinibuffer("Find file:");
      assert.equal(await InputText(), DirectoryName(model.selectedPath));
    }

    async function ClearPromptInput(): Promise<void>
    {
      const input = await InputText();
      for (let index = 0; index < input.length; index += 1)
      {
        await fileView.press("Backspace");
      }
      assert.equal(await InputText(), "");
    }

    async function OpenPath(pathValue: string, label: string): Promise<void>
    {
      await StartFindFile();
      await ClearPromptInput();
      await PressText(pathValue);
      await fileView.press("Enter");
      await page.waitForFunction((expectedPath: unknown) =>
        document.querySelector(".sheaf-chat-file-view")?.getAttribute("data-navigation-path") === expectedPath,
      pathValue, { timeout: 5000 });
      model.selectedPath = pathValue;
      model.tabs.add(pathValue);
      await AssertInvariants(label);
    }

    async function CancelThenOpen(pathValue: string, label: string): Promise<void>
    {
      await StartFindFile();
      await fileView.press("Control+G");
      await AssertInvariants(label + " cancel find-file");
      await OpenPath(pathValue, label + " retry find-file");
    }

    async function CancelThenSearch(label: string): Promise<void>
    {
      await fileView.press("Control+S");
      await ExpectMinibuffer("I-search:");
      await PressText("t");
      await ExpectMinibuffer("t");
      await fileView.press("Control+G");
      await AssertInvariants(label + " cancel search");
      await fileView.press("Control+S");
      await ExpectMinibuffer("I-search:");
      await PressText("t");
      await fileView.press("Enter");
      await AssertInvariants(label + " accept search after cancel");
    }

    async function CancelThenSwitchBuffer(targetPath: string, label: string): Promise<void>
    {
      await fileView.press("Control+X");
      await fileView.press("b");
      await ExpectMinibuffer("Switch buffer:");
      await fileView.press("Control+G");
      await AssertInvariants(label + " cancel buffer");
      await fileView.press("Control+X");
      await fileView.press("b");
      await ExpectMinibuffer("Switch buffer:");
      await PressText(targetPath);
      await fileView.press("Enter");
      await page.waitForFunction((expectedPath: unknown) =>
        document.querySelector(".sheaf-chat-file-view")?.getAttribute("data-navigation-path") === expectedPath,
      targetPath, { timeout: 5000 });
      model.selectedPath = targetPath;
      await AssertInvariants(label + " switch buffer after cancel");
    }

    async function MissingBufferThenCancel(label: string): Promise<void>
    {
      await fileView.press("Control+X");
      await fileView.press("b");
      await ExpectMinibuffer("Switch buffer:");
      await PressText("missing-buffer");
      await fileView.press("Enter");
      await ExpectMinibuffer("No matching buffer");
      await fileView.press("Control+G");
      await AssertInvariants(label + " missing buffer cancel");
    }

    async function PrefixCancel(label: string): Promise<void>
    {
      await fileView.press("Control+X");
      await page.waitForFunction(() =>
        document.querySelector(".sheaf-chat-file-view")?.getAttribute("data-key-prefix") === "C-x",
      undefined, { timeout: 5000 });
      await fileView.press("Control+G");
      await AssertInvariants(label + " prefix cancel");
    }

    try
    {
      await page.goto(
        `${handle.baseUrl}/#/repositories/${encodeURIComponent(session.repoId)}/workspaces/${encodeURIComponent(session.workspaceId)}`,
        { waitUntil: "domcontentloaded" },
      );
      await page.waitForFunction(() =>
        (document.querySelector(".sheaf-chat-explorer-tree")?.textContent ?? "").includes("alpha"),
      undefined, { timeout: 5000 });
      await page.locator(".sheaf-chat-explorer-directory", { hasText: "alpha" }).click();
      await page.locator(".sheaf-chat-explorer-file", { hasText: "current.txt" }).click();
      await page.waitForFunction(() =>
        document.querySelector(".sheaf-chat-file-view")?.getAttribute("data-navigation-path") === "alpha/current.txt",
      undefined, { timeout: 5000 });
      await fileView.click();
      await AssertInvariants("initial");

      const allPaths = ["alpha/current.txt", "beta/target.txt", "code.js"];
      for (const seed of [0x51ea, 0xc0de])
      {
        const random = Rng(seed);
        for (let step = 0; step < 14; step += 1)
        {
          const operation = Math.floor(random() * 5);
          const label = `seed ${seed} step ${step}`;
          if (operation === 0)
          {
            await CancelThenOpen(allPaths[Math.floor(random() * allPaths.length)]!, label);
          }
          else if (operation === 1)
          {
            await CancelThenSearch(label);
          }
          else if (operation === 2)
          {
            const tabs = Array.from(model.tabs);
            await CancelThenSwitchBuffer(tabs[Math.floor(random() * tabs.length)]!, label);
          }
          else if (operation === 3)
          {
            await MissingBufferThenCancel(label);
          }
          else
          {
            await PrefixCancel(label);
          }
        }
      }
    }
    finally
    {
      await page.close();
      await browser.close();
    }
  }, {
    realRepoRoot: x_realRepoRoot,
    port: PlaywrightPort(13),
  });
});

test("file view deterministic navigation simulation matches observed source offsets", async () =>
{
  const { chromium } = await LoadPlaywright();

  await WithBrowserTestServer(async (handle) =>
  {
    const rootDirectory = path.join(handle.config.repoRoot, "projects", "demo");
    const content = "zero\none\ntwo\nthree\n";
    await WriteSessionFile(rootDirectory, "simulate.txt", content);

    const session = await CreateSessionWithRoot(handle, rootDirectory);
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    async function Offset(): Promise<string | null>
    {
      return page.evaluate(() =>
        document.querySelector(".sheaf-chat-file-view")?.getAttribute("data-point-offset") ?? null,
      );
    }

    async function State(): Promise<{ mark: string | null; markActive: string | null; point: string | null; prefix: string | null; textOk: boolean }>
    {
      return page.evaluate((expectedContent: unknown) =>
      {
        const view = document.querySelector(".sheaf-chat-file-view");
        return {
          point: view?.getAttribute("data-point-offset") ?? null,
          mark: view?.getAttribute("data-mark-offset") ?? null,
          markActive: view?.getAttribute("data-mark-active") ?? null,
          prefix: view?.getAttribute("data-key-prefix") ?? null,
          textOk: view?.textContent?.includes(String(expectedContent)) === true,
        };
      }, content);
    }

    const lineStarts = [0];
    for (let index = 0; index < content.length; index += 1)
    {
      if (content[index] === "\n")
      {
        lineStarts.push(index + 1);
      }
    }

    function LineIndex(offset: number): number
    {
      let result = 0;
      for (let index = 0; index < lineStarts.length; index += 1)
      {
        if (lineStarts[index]! <= offset)
        {
          result = index;
        }
      }
      return result;
    }

    function LineEnd(line: number): number
    {
      const start = lineStarts[line] ?? 0;
      const next = lineStarts[line + 1];
      return Math.max(start, next === undefined ? content.length : next - 1);
    }

    function MoveVertical(point: number, desiredColumn: number | null, delta: number): { column: number; point: number }
    {
      const line = LineIndex(point);
      const column = desiredColumn ?? point - (lineStarts[line] ?? 0);
      const nextLine = Math.max(0, Math.min(lineStarts.length - 1, line + delta));
      const nextStart = lineStarts[nextLine] ?? 0;
      return {
        column,
        point: Math.max(nextStart, Math.min(nextStart + column, LineEnd(nextLine))),
      };
    }

    function Rng(seed: number): () => number
    {
      let value = seed >>> 0;
      return () =>
      {
        value = (value * 1664525 + 1013904223) >>> 0;
        return value / 0x100000000;
      };
    }

    try
    {
      await page.goto(
        `${handle.baseUrl}/#/repositories/${encodeURIComponent(session.repoId)}/workspaces/${encodeURIComponent(session.workspaceId)}`,
        { waitUntil: "domcontentloaded" },
      );
      await page.waitForFunction(() =>
        (document.querySelector(".sheaf-chat-explorer-tree")?.textContent ?? "").includes("simulate.txt"),
      undefined, { timeout: 5000 });
      await page.locator(".sheaf-chat-explorer-file", { hasText: "simulate.txt" }).click();
      await page.locator(".sheaf-chat-file-point").waitFor({ timeout: 5000 });
      const fileView = page.locator(".sheaf-chat-file-view");
      await fileView.click();

      const model = {
        point: 0,
        mark: null as number | null,
        markActive: false,
        desiredColumn: null as number | null,
      };
      const commands = [
        "ArrowRight",
        "ArrowLeft",
        "ArrowDown",
        "ArrowUp",
        "Control+A",
        "Control+E",
        "Control+V",
        "Alt+V",
        "Control+Space",
        "exchange",
        "Control+G",
      ];

      for (const seed of [7, 13, 29])
      {
        const random = Rng(seed);
        for (let step = 0; step < 24; step += 1)
        {
          const command = commands[Math.floor(random() * commands.length)]!;
          if (command === "ArrowRight")
          {
            model.point = Math.min(content.length, model.point + 1);
            model.desiredColumn = null;
            await fileView.press(command);
          }
          else if (command === "ArrowLeft")
          {
            model.point = Math.max(0, model.point - 1);
            model.desiredColumn = null;
            await fileView.press(command);
          }
          else if (command === "ArrowDown" || command === "ArrowUp")
          {
            const moved = MoveVertical(model.point, model.desiredColumn, command === "ArrowDown" ? 1 : -1);
            model.point = moved.point;
            model.desiredColumn = moved.column;
            await fileView.press(command);
          }
          else if (command === "Control+A")
          {
            model.point = lineStarts[LineIndex(model.point)] ?? 0;
            model.desiredColumn = null;
            await fileView.press(command);
          }
          else if (command === "Control+E")
          {
            model.point = LineEnd(LineIndex(model.point));
            model.desiredColumn = null;
            await fileView.press(command);
          }
          else if (command === "Control+V")
          {
            const moved = MoveVertical(model.point, model.desiredColumn, 1000);
            model.point = moved.point;
            model.desiredColumn = moved.column;
            await fileView.press(command);
          }
          else if (command === "Alt+V")
          {
            const moved = MoveVertical(model.point, model.desiredColumn, -1000);
            model.point = moved.point;
            model.desiredColumn = moved.column;
            await fileView.press(command);
          }
          else if (command === "Control+Space")
          {
            model.mark = model.point;
            model.markActive = true;
            await fileView.press(command);
          }
          else if (command === "exchange")
          {
            await fileView.press("Control+X");
            assert.equal((await State()).prefix, "C-x", `prefix after exchange start seed ${seed} step ${step}`);
            await fileView.press("x");
            if (model.mark !== null)
            {
              const oldPoint = model.point;
              model.point = model.mark;
              model.mark = oldPoint;
              model.markActive = true;
            }
          }
          else if (command === "Control+G")
          {
            model.markActive = false;
            await fileView.press(command);
          }
          else
          {
            await fileView.press(command);
          }

          const observed = await State();
          assert.equal(observed.point, String(model.point), `point after ${command} seed ${seed} step ${step}`);
          assert.equal(observed.mark, model.mark === null ? null : String(model.mark), `mark after ${command} seed ${seed} step ${step}`);
          assert.equal(observed.markActive, model.markActive ? "true" : "false", `mark active after ${command} seed ${seed} step ${step}`);
          assert.equal(observed.prefix, null, `prefix cleared after ${command} seed ${seed} step ${step}`);
          assert.equal(observed.textOk, true, `content stayed readable after ${command} seed ${seed} step ${step}`);
        }
      }

      await fileView.press("Control+G");
      await page.locator(".sheaf-chat-file-plain").click({ position: { x: 2, y: 8 } });
      assert.equal(await Offset(), "0");
      await fileView.press("Control+S");
      await fileView.press("t");
      await fileView.press("w");
      await fileView.press("o");
      assert.equal(await Offset(), String(content.toLowerCase().indexOf("two")));
      assert.equal(await page.locator(".sheaf-chat-file-minibuffer").count(), 1);
      await fileView.press("Enter");
      assert.equal(await page.locator(".sheaf-chat-file-minibuffer").count(), 0);
      assert.equal((await State()).textOk, true);
    }
    finally
    {
      await page.close();
      await browser.close();
    }
  }, {
    realRepoRoot: x_realRepoRoot,
    port: PlaywrightPort(9),
  });
});
