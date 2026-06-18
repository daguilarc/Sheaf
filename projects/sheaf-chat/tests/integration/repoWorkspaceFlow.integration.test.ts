import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

import { ResolveOpenAiTestModel } from "../server/websocket/helpers.js";
import { WithBrowserTestServer } from "./browserTestServer.js";

type BrowserContext = {
  close: () => Promise<void>;
  newPage: () => Promise<Page>;
};

type Browser = {
  close: () => Promise<void>;
  newContext: () => Promise<BrowserContext>;
};

type Locator = {
  click: (options?: { timeout?: number }) => Promise<void>;
  count: () => Promise<number>;
  first: () => Locator;
  innerText: () => Promise<string>;
  press: (key: string) => Promise<void>;
  waitFor: (options?: { timeout?: number; state?: "attached" | "detached" | "visible" | "hidden" }) => Promise<void>;
};

type Page = {
  close: () => Promise<void>;
  evaluate: <T>(predicate: (arg: unknown) => T, arg?: unknown) => Promise<T>;
  goto: (url: string, options?: { waitUntil?: "domcontentloaded" | "load" | "networkidle"; timeout?: number }) => Promise<unknown>;
  locator: (selector: string, options?: { hasText?: string | RegExp }) => Locator;
  on: (event: "console" | "pageerror", handler: (value: unknown) => void) => void;
  selectOption: (selector: string, value: string) => Promise<unknown>;
  waitForFunction: (predicate: (arg: unknown) => boolean, arg?: unknown, options?: { timeout?: number }) => Promise<unknown>;
  waitForSelector: (selector: string, options?: { timeout?: number; state?: "attached" | "detached" | "visible" | "hidden" }) => Promise<unknown>;
};

type PlaywrightModule = {
  chromium: {
    launch: (options?: { headless?: boolean }) => Promise<Browser>;
  };
};

const x_packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const x_realRepoRoot = path.resolve(x_packageRoot, "../..");
const x_scrollTarget = 180;

function BuildNotesContent(replacements?: Map<number, string>): string
{
  const longLines: string[] = ["# Notes", ""];
  for (let index = 1; index <= 400; index += 1)
  {
    longLines.push(
      replacements?.get(index) ??
      `Line ${index}: the quick brown fox jumps over the lazy dog.`,
    );
    longLines.push("");
  }
  return `${longLines.join("\n")}\n`;
}

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

function Git(cwd: string, args: string[]): void
{
  execFileSync("git", args, {
    cwd,
    stdio: "ignore",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Sheaf Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Sheaf Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  });
}

interface FixtureRepo
{
  homeDirectory: string;
  repoPath: string;
  repoName: string;
  worktreePath: string;
  cleanup: () => void;
}

function CreateFixtureRepo(): FixtureRepo
{
  const homeDirectory = mkdtempSync(path.join(tmpdir(), "sheaf-chat-home-"));
  const repoName = "workspace-fixture-repo";
  const repoPath = path.join(homeDirectory, repoName);
  const worktreeRoot = mkdtempSync(path.join(tmpdir(), "sheaf-chat-worktree-"));
  const worktreePath = path.join(worktreeRoot, "feature");

  Git(homeDirectory, ["init", "-b", "main", repoPath]);

  writeFileSync(path.join(repoPath, "README.md"), "# Fixture Repo\n\nFront-door verification fixture.\n", "utf8");

  writeFileSync(path.join(repoPath, "notes.md"), BuildNotesContent(), "utf8");
  writeFileSync(path.join(repoPath, "zeta.md"), BuildNotesContent(), "utf8");

  Git(repoPath, ["add", "."]);
  Git(repoPath, ["commit", "-m", "Seed fixture repo"]);
  Git(repoPath, ["worktree", "add", "-b", "feature", worktreePath]);

  return {
    homeDirectory,
    repoPath,
    repoName,
    worktreePath,
    cleanup: () =>
    {
      rmSync(homeDirectory, { recursive: true, force: true });
      rmSync(worktreeRoot, { recursive: true, force: true });
    },
  };
}

function BuildAgentReviewWsUrl(baseUrl: string, repoId: string, workspaceId: string): string
{
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws/agent-review";
  url.search = "";
  url.searchParams.set("repo", repoId);
  url.searchParams.set("workspace", workspaceId);
  url.searchParams.set("client", "playwright-test");
  return url.toString();
}

function WaitForAgentReviewFrame(socket: WebSocket, type: string): Promise<Record<string, any>>
{
  return new Promise((resolve, reject) =>
  {
    const timer = setTimeout(() =>
    {
      socket.off("message", onMessage);
      reject(new Error(`timed out waiting for Agent Review frame: ${type}`));
    }, 5000);
    const onMessage = (raw: WebSocket.RawData): void =>
    {
      const frame = JSON.parse(raw.toString()) as Record<string, any>;
      if (frame.type !== type)
      {
        return;
      }
      socket.off("message", onMessage);
      clearTimeout(timer);
      resolve(frame);
    };
    socket.on("message", onMessage);
    socket.once("error", (error) =>
    {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function ClickExactButtonText(page: Page, selector: string, text: string): Promise<void>
{
  const clicked = await page.evaluate((arg) =>
  {
    const { selector: buttonSelector, text: buttonText } = arg as { selector: string; text: string };
    const buttons = Array.from(document.querySelectorAll(buttonSelector)) as HTMLButtonElement[];
    const button = buttons.find((candidate) =>
      candidate.textContent?.trim() === buttonText &&
      candidate.disabled !== true &&
      candidate.getClientRects().length > 0
    );
    if (button === undefined)
    {
      return false;
    }
    button.click();
    return true;
  }, { selector, text });

  assert.equal(clicked, true, `expected button with exact text: ${text}`);
}

interface ChatRouteIds
{
  repoId: string;
  workspaceId: string;
  chatId: string;
}

function ParseChatRoute(hash: string): ChatRouteIds
{
  const match = /#\/repositories\/([^/]+)\/workspaces\/([^/]+)\/chats\/([^/?]+)/.exec(hash);
  if (match === null)
  {
    throw new Error(`unexpected chat route hash: ${hash}`);
  }

  return {
    repoId: decodeURIComponent(match[1]!),
    workspaceId: decodeURIComponent(match[2]!),
    chatId: decodeURIComponent(match[3]!),
  };
}

async function WaitForServerCondition(
  predicate: () => Promise<boolean>,
  timeoutMs = 5000,
): Promise<void>
{
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs)
  {
    if (await predicate())
    {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error("timed out waiting for server condition");
}

test("front door repository/workspace flow restores editor state across devices", async () =>
{
  const { chromium } = await LoadPlaywright();
  const fixture = CreateFixtureRepo();
  const originalHome = process.env.HOME;
  process.env.HOME = fixture.homeDirectory;

  try
  {
    await WithBrowserTestServer(async (handle) =>
    {
      const browser = await chromium.launch({ headless: true });

      try
      {
        const availableModel = ResolveOpenAiTestModel(handle.agentManager);
        const modelValue = `${availableModel.provider}:${availableModel.id}`;

        const firstContext = await browser.newContext();
        const page = await firstContext.newPage();
        const pageErrors: string[] = [];
        page.on("pageerror", (error) =>
        {
          pageErrors.push(error instanceof Error ? error.message : String(error));
        });

        let routeIds: ChatRouteIds;

        try
        {
          // Front door: clean data/sheaf-chat means the repository picker is the entry point.
          await page.goto(`${handle.baseUrl}/#/`, { waitUntil: "domcontentloaded" });

          // Select the discovered repository (a direct child of $HOME that is a Git top level).
          await page.locator(".sheaf-chat-list-button", { hasText: fixture.repoName }).waitFor({ timeout: 5000 });
          await page.locator(".sheaf-chat-list-button", { hasText: fixture.repoName }).click();

          // Workspace picker shows both the main worktree and the linked worktree.
          await page.locator(".sheaf-chat-list-button", { hasText: "main" }).waitFor({ timeout: 5000 });
          await page.locator(".sheaf-chat-list-button", { hasText: "feature" }).waitFor({ timeout: 5000 });

          // Select the main workspace.
          await page.locator(".sheaf-chat-list-button", { hasText: "main" }).first().click();

          // Editor view for the workspace; create a chat with an available model.
          await page.waitForSelector(".sheaf-chat-workspace .sheaf-chat-form", { timeout: 5000 });
          await page.selectOption("#sheaf-chat-new-chat-model", modelValue);
          await page.locator(".sheaf-chat-form button[type=\"submit\"]").click();

          // Chat route is now active and the websocket is connected.
          await page.waitForFunction(() => /\/chats\//.test(window.location.hash), undefined, { timeout: 5000 });
          await page.waitForFunction(() => document.body.textContent?.includes("Connected") === true, undefined, {
            timeout: 5000,
          });

          const hash = await page.evaluate(() => window.location.hash);
          routeIds = ParseChatRoute(hash);

          // The explorer is rooted at the selected workspace and lists fixture files.
          await page.locator(".sheaf-chat-explorer-file", { hasText: "README.md" }).waitFor({ timeout: 5000 });
          await page.locator(".sheaf-chat-explorer-file", { hasText: "notes.md" }).waitFor({ timeout: 5000 });

          // Open two files; notes.md ends up selected (opened last).
          await page.locator(".sheaf-chat-explorer-file", { hasText: "README.md" }).click();
          await page.locator(".sheaf-chat-explorer-file", { hasText: "notes.md" }).click();
          await page.waitForFunction(() =>
          {
            const selected = document.querySelector(".sheaf-chat-tab--selected .sheaf-chat-tab-label");
            return selected?.textContent === "notes.md";
          }, undefined, { timeout: 5000 });

          // Scroll the file viewport like a user and let the debounced save flush.
          await page.waitForFunction((target) =>
          {
            const view = document.querySelector(".sheaf-chat-file-view") as HTMLElement | null;
            if (view === null || view.scrollHeight <= view.clientHeight + (target as number))
            {
              return false;
            }
            view.scrollTop = target as number;
            view.dispatchEvent(new Event("scroll"));
            return true;
          }, x_scrollTarget, { timeout: 5000 });

          // Confirm the server persisted editor state (the save is debounced) before closing this device.
          const editorStateUrl = `${handle.baseUrl}/api/repositories/${encodeURIComponent(routeIds.repoId)}`
            + `/workspaces/${encodeURIComponent(routeIds.workspaceId)}/editor-state`;

          await WaitForServerCondition(async () =>
          {
            const response = await fetch(editorStateUrl);
            if (!response.ok)
            {
              return false;
            }

            const body = await response.json() as {
              editorState: {
                tabs: string[];
                selectedPath: string | null;
                viewports: Record<string, { scrollTop: number }>;
              };
            };
            const state = body.editorState;
            return state.tabs.includes("README.md")
              && state.tabs.includes("notes.md")
              && state.selectedPath === "notes.md"
              && (state.viewports["notes.md"]?.scrollTop ?? 0) >= x_scrollTarget - 5;
          });
        }
        finally
        {
          await page.close();
        }

        // Second device: a fresh browser context with no shared client storage.
        const secondContext = await browser.newContext();
        const secondPage = await secondContext.newPage();
        const secondPageErrors: string[] = [];
        secondPage.on("pageerror", (error) =>
        {
          secondPageErrors.push(error instanceof Error ? error.message : String(error));
        });

        try
        {
          await secondPage.goto(
            `${handle.baseUrl}/#/repositories/${encodeURIComponent(routeIds.repoId)}`
              + `/workspaces/${encodeURIComponent(routeIds.workspaceId)}`,
            { waitUntil: "domcontentloaded" },
          );

          // Restored tabs appear without any interaction.
          await secondPage.locator(".sheaf-chat-tab .sheaf-chat-tab-label", { hasText: "README.md" }).waitFor({
            timeout: 5000,
          });
          await secondPage.locator(".sheaf-chat-tab .sheaf-chat-tab-label", { hasText: "notes.md" }).waitFor({
            timeout: 5000,
          });

          // The previously selected file is restored as the active tab.
          await secondPage.waitForFunction(() =>
          {
            const selected = document.querySelector(".sheaf-chat-tab--selected .sheaf-chat-tab-label");
            return selected?.textContent === "notes.md";
          }, undefined, { timeout: 5000 });

          // The viewport scroll position is restored on the second device.
          try
          {
            await secondPage.waitForFunction((target) =>
            {
              const view = document.querySelector(".sheaf-chat-file-view") as HTMLElement | null;
              return view !== null && Math.abs(view.scrollTop - (target as number)) <= 5;
            }, x_scrollTarget, { timeout: 5000 });
          }
          catch (error)
          {
            const metrics = await secondPage.evaluate(() =>
            {
              const view = document.querySelector(".sheaf-chat-file-view") as HTMLElement | null;
              return {
                scrollTop: view?.scrollTop ?? null,
                scrollHeight: view?.scrollHeight ?? null,
                clientHeight: view?.clientHeight ?? null,
              };
            });
            throw new Error(`viewport restore failed: ${JSON.stringify(metrics)} :: ${String(error)}`);
          }

          assert.deepEqual(secondPageErrors, []);
        }
        finally
        {
          await secondPage.close();
          await secondContext.close();
          await firstContext.close();
        }

        assert.deepEqual(pageErrors, []);
      }
      finally
      {
        await browser.close();
      }
    }, {
      realRepoRoot: x_realRepoRoot,
      port: 0,
    });
  }
  finally
  {
    if (originalHome === undefined)
    {
      delete process.env.HOME;
    }
    else
    {
      process.env.HOME = originalHome;
    }

    fixture.cleanup();
  }
});

test("front door Agent Review renders inline diffs and stages focused hunks in Chromium", async () =>
{
  const { chromium } = await LoadPlaywright();
  const fixture = CreateFixtureRepo();
  const originalHome = process.env.HOME;
  process.env.HOME = fixture.homeDirectory;

  writeFileSync(
    path.join(fixture.repoPath, "notes.md"),
    BuildNotesContent(new Map([
      [2, "Line 2: altered for agent review."],
      [300, "Line 300: altered for agent review."],
    ])),
    "utf8",
  );
  writeFileSync(
    path.join(fixture.repoPath, "zeta.md"),
    BuildNotesContent(new Map([
      [300, "Line 300: altered in the next review file."],
      [308, "Line 308: already visible after next-file navigation."],
    ])),
    "utf8",
  );

  try
  {
    await WithBrowserTestServer(async (handle) =>
    {
      const browser = await chromium.launch({ headless: true });

      try
      {
        const availableModel = ResolveOpenAiTestModel(handle.agentManager);
        const modelValue = `${availableModel.provider}:${availableModel.id}`;
        const context = await browser.newContext();
        const page = await context.newPage();
        const pageErrors: string[] = [];
        let reviewSocket: WebSocket | null = null;

        page.on("pageerror", (error) =>
        {
          pageErrors.push(error instanceof Error ? error.message : String(error));
        });

        try
        {
          await page.goto(`${handle.baseUrl}/#/`, { waitUntil: "domcontentloaded" });

          await page.locator(".sheaf-chat-list-button", { hasText: fixture.repoName }).waitFor({ timeout: 5000 });
          await page.locator(".sheaf-chat-list-button", { hasText: fixture.repoName }).click();
          await page.locator(".sheaf-chat-list-button", { hasText: "main" }).waitFor({ timeout: 5000 });
          await page.locator(".sheaf-chat-list-button", { hasText: "main" }).first().click();

          await page.waitForSelector(".sheaf-chat-workspace .sheaf-chat-form", { timeout: 5000 });
          await page.selectOption("#sheaf-chat-new-chat-model", modelValue);
          await page.locator(".sheaf-chat-form button[type=\"submit\"]").click();

          await page.waitForFunction(() => /\/chats\//.test(window.location.hash), undefined, { timeout: 5000 });
          await page.waitForFunction(() => document.body.textContent?.includes("Connected") === true, undefined, {
            timeout: 5000,
          });
          const routeIds = ParseChatRoute(await page.evaluate(() => window.location.hash));

          await page.waitForSelector(".sheaf-chat-agent-review-inline", { timeout: 5000 });
          await page.waitForSelector(".sheaf-chat-agent-review-inline-row--focused", { timeout: 5000 });
          await page.waitForSelector(".sheaf-chat-file-point--review", { timeout: 5000 });
          await page.locator(".sheaf-chat-explorer-file", { hasText: "notes.md" }).click();
          await page.waitForFunction(() =>
          {
            const selected = document.querySelector(".sheaf-chat-tab--selected .sheaf-chat-tab-label");
            return selected?.textContent?.trim() === "notes.md";
          }, undefined, { timeout: 5000 });

          const initialRows = await page.evaluate(() =>
          {
            return Array.from(document.querySelectorAll(".sheaf-chat-agent-review-inline-row--changed")).map((row) => ({
              className: row.className,
              hunkId: row.getAttribute("data-hunk-id"),
              text: row.textContent ?? "",
            }));
          });
          assert.equal(await page.locator(".sheaf-chat-agent-review-hunk").count(), 0);
          assert.ok(
            initialRows.some((row) =>
              row.className.includes("sheaf-chat-agent-review-inline-row--focused") &&
              row.className.includes("sheaf-chat-agent-review-inline-row--deletion") &&
              row.text.includes("Line 2: the quick brown fox jumps over the lazy dog."),
            ),
            "expected focused deletion for first hunk",
          );
          assert.ok(
            initialRows.some((row) =>
              row.className.includes("sheaf-chat-agent-review-inline-row--focused") &&
              row.className.includes("sheaf-chat-agent-review-inline-row--addition") &&
              row.text.includes("Line 2: altered for agent review."),
            ),
            "expected focused addition for first hunk",
          );
          assert.ok(
            initialRows.some((row) =>
              row.className.includes("sheaf-chat-agent-review-inline-row--muted") &&
              row.text.includes("Line 300: altered for agent review."),
            ),
            "expected non-focused second hunk to be visible and muted",
          );

          const fileView = page.locator(".sheaf-chat-file-view");
          const initialReviewPoint = await page.evaluate(() =>
            Number(document.querySelector(".sheaf-chat-file-view")?.getAttribute("data-point-offset") ?? "0")
          );
          await fileView.press("ArrowRight");
          await page.waitForFunction((expectedPoint: unknown) =>
            Number(document.querySelector(".sheaf-chat-file-view")?.getAttribute("data-point-offset") ?? "0") ===
              Number(expectedPoint),
          initialReviewPoint + 1, { timeout: 5000 });
          await fileView.press("Control+G");
          await page.waitForFunction(() =>
            document.querySelector(".sheaf-chat-form textarea") !== document.activeElement,
          undefined, { timeout: 5000 });
          assert.equal(
            await page.locator(".sheaf-chat-agent-review-inline-row--focused").count() > 0,
            true,
            "review hunk focus should survive file-view navigation",
          );

          await ClickExactButtonText(page, ".sheaf-chat-agent-review-command", "Next");
          await page.waitForFunction(() =>
          {
            return Array.from(document.querySelectorAll(".sheaf-chat-agent-review-inline-row--focused")).some((row) =>
              row.textContent?.includes("Line 300: altered for agent review.") === true
            );
          }, undefined, { timeout: 5000 });

          await page.waitForFunction(() =>
          {
            const view = document.querySelector(".sheaf-chat-file-view") as HTMLElement | null;
            const focusedRows = Array.from(document.querySelectorAll(".sheaf-chat-agent-review-inline-row--focused"));
            const focusedLine = focusedRows.find((row) =>
              row.textContent?.includes("Line 300: altered for agent review.") === true
            );
            const viewRect = view?.getBoundingClientRect();
            const focusedRect = focusedLine?.getBoundingClientRect();
            const rowHeight = focusedRect?.height ?? 0;
            const topOffset = viewRect !== undefined && focusedRect !== undefined
              ? focusedRect.top - viewRect.top
              : Number.POSITIVE_INFINITY;
            return viewRect !== undefined
              && focusedRect !== undefined
              && focusedRect.top >= viewRect.top
              && focusedRect.bottom <= viewRect.bottom
              && topOffset <= Math.max(96, rowHeight * 4);
          }, undefined, { timeout: 5000 });

          const afterNext = await page.evaluate(() =>
          {
            const view = document.querySelector(".sheaf-chat-file-view") as HTMLElement | null;
            const focusedRows = Array.from(document.querySelectorAll(".sheaf-chat-agent-review-inline-row--focused"));
            const viewRect = view?.getBoundingClientRect();
            const focusedLine = focusedRows.find((row) =>
              row.textContent?.includes("Line 300: altered for agent review.") === true
            );
            const point = document.querySelector(".sheaf-chat-file-point");
            const focusedRect = focusedLine?.getBoundingClientRect();
            const topOffset = viewRect !== undefined && focusedRect !== undefined
              ? focusedRect.top - viewRect.top
              : null;
            const rowHeight = focusedRect?.height ?? null;
            return {
              scrollTop: view?.scrollTop ?? 0,
              focusedHunkId: focusedLine?.getAttribute("data-hunk-id") ?? null,
              focusedText: focusedRows.map((row) => row.textContent ?? ""),
              pointInFocusedHunk: focusedLine?.contains(point) ?? false,
              pointOffset: view?.getAttribute("data-point-offset") ?? null,
              rowHeight,
              topOffset,
              focusedVisible:
                viewRect !== undefined &&
                focusedRect !== undefined &&
                focusedRect.top >= viewRect.top &&
                focusedRect.bottom <= viewRect.bottom,
            };
          });
          assert.equal(
            afterNext.focusedVisible,
            true,
            `expected hunk navigation to reveal focused row; scrollTop=${afterNext.scrollTop}`,
          );
          assert.ok(
            afterNext.topOffset !== null &&
            afterNext.rowHeight !== null &&
            afterNext.topOffset <= Math.max(96, afterNext.rowHeight * 4),
            `expected hunk navigation to place focused row near top; topOffset=${afterNext.topOffset}`,
          );
          assert.ok(afterNext.focusedText.some((text) => text.includes("Line 300: altered for agent review.")));
          assert.equal(
            afterNext.pointInFocusedHunk,
            true,
            `expected point to follow focused hunk; pointOffset=${afterNext.pointOffset}`,
          );
          assert.equal(pageErrors.length, 0, `unexpected page errors after navigation: ${pageErrors.join("\n")}`);

          reviewSocket = new WebSocket(BuildAgentReviewWsUrl(handle.baseUrl, routeIds.repoId, routeIds.workspaceId));
          await new Promise<void>((resolve, reject) =>
          {
            reviewSocket!.once("open", () => resolve());
            reviewSocket!.once("error", reject);
          });
          await WaitForAgentReviewFrame(reviewSocket, "bootstrap");
          reviewSocket.send(JSON.stringify({
            type: "comment",
            hunkId: afterNext.focusedHunkId,
            text: "Please revisit this hunk.",
          }));

          await page.waitForSelector(".sheaf-chat-agent-review-inline .sheaf-chat-agent-review-comment-textarea", {
            timeout: 5000,
          });
          const commentPlacement = await page.evaluate(() =>
          {
            const comment = document.querySelector(".sheaf-chat-agent-review-comment-textarea");
            const inline = document.querySelector(".sheaf-chat-agent-review-inline");
            const legacy = document.querySelector(".sheaf-chat-agent-review-hunk");
            return {
              insideInline: inline?.contains(comment) ?? false,
              insideLegacyPanel: legacy?.contains(comment) ?? false,
              value: (comment as HTMLTextAreaElement | null)?.value ?? "",
            };
          });
          assert.deepEqual(commentPlacement, {
            insideInline: true,
            insideLegacyPanel: false,
            value: "Please revisit this hunk.",
          });

          await ClickExactButtonText(page, ".sheaf-chat-agent-review-command", "Stage");
          await page.waitForFunction(() =>
          {
            return !Array.from(document.querySelectorAll(".sheaf-chat-agent-review-inline-row--changed")).some((row) =>
              row.textContent?.includes("Line 300: altered for agent review.") === true
            );
          }, undefined, { timeout: 5000 });
          const afterStageRows = await page.evaluate(() =>
          {
            return Array.from(document.querySelectorAll(".sheaf-chat-agent-review-inline-row")).map((row) => ({
              className: row.className,
              text: row.textContent ?? "",
            }));
          });
          assert.ok(
            afterStageRows.some((row) =>
              !row.className.includes("sheaf-chat-agent-review-inline-row--changed") &&
              row.text.includes("Line 300: altered for agent review."),
            ),
            "expected staged hunk content to remain as normal file content",
          );
          assert.ok(
            afterStageRows.some((row) =>
              row.className.includes("sheaf-chat-agent-review-inline-row--changed") &&
              row.text.includes("Line 2: altered for agent review."),
            ),
            "expected remaining unstaged hunk to stay visible",
          );

          await ClickExactButtonText(page, ".sheaf-chat-agent-review-command", "Next File");
          await page.waitForFunction(() =>
          {
            const selectedTab = document.querySelector(".sheaf-chat-tab--selected .sheaf-chat-tab-label");
            return selectedTab?.textContent?.trim() === "zeta.md";
          }, undefined, { timeout: 5000 });
          try
          {
            await page.waitForFunction(() =>
            {
              const view = document.querySelector(".sheaf-chat-file-view") as HTMLElement | null;
              const focusedRows = Array.from(document.querySelectorAll(".sheaf-chat-agent-review-inline-row--focused"));
              const focusedLine = focusedRows.find((row) =>
                row.textContent?.includes("Line 300: altered in the next review file.") === true
              );
              const viewRect = view?.getBoundingClientRect();
              const focusedRect = focusedLine?.getBoundingClientRect();
              const rowHeight = focusedRect?.height ?? 0;
              const topOffset = viewRect !== undefined && focusedRect !== undefined
                ? focusedRect.top - viewRect.top
                : Number.POSITIVE_INFINITY;
              return viewRect !== undefined
                && focusedRect !== undefined
                && focusedRect.top >= viewRect.top
                && focusedRect.bottom <= viewRect.bottom
                && topOffset <= Math.max(96, rowHeight * 4);
            }, undefined, { timeout: 5000 });
          }
          catch (error)
          {
            const metrics = await page.evaluate(() =>
            {
              const view = document.querySelector(".sheaf-chat-file-view") as HTMLElement | null;
              const focusedRows = Array.from(document.querySelectorAll(".sheaf-chat-agent-review-inline-row--focused"));
              const focusedLine = focusedRows.find((row) =>
                row.textContent?.includes("Line 300: altered in the next review file.") === true
              );
              const viewRect = view?.getBoundingClientRect();
              const focusedRect = focusedLine?.getBoundingClientRect();
              return {
                selectedTab: document.querySelector(".sheaf-chat-tab--selected .sheaf-chat-tab-label")?.textContent?.trim() ?? null,
                focusedTexts: focusedRows.map((row) => row.textContent ?? ""),
                pointText: document.querySelector(".sheaf-chat-file-point")?.textContent ?? null,
                pointOffset: view?.getAttribute("data-point-offset") ?? null,
                scrollTop: view?.scrollTop ?? null,
                viewTop: viewRect?.top ?? null,
                viewBottom: viewRect?.bottom ?? null,
                focusedTop: focusedRect?.top ?? null,
                focusedBottom: focusedRect?.bottom ?? null,
              };
            });
            throw new Error(`next-file hunk reveal failed: ${JSON.stringify(metrics)} :: ${String(error)}`);
          }
          const afterNextFile = await page.evaluate(() =>
          {
            const view = document.querySelector(".sheaf-chat-file-view") as HTMLElement | null;
            const focusedRows = Array.from(document.querySelectorAll(".sheaf-chat-agent-review-inline-row--focused"));
            const focusedLine = focusedRows.find((row) =>
              row.textContent?.includes("Line 300: altered in the next review file.") === true
            );
            const viewRect = view?.getBoundingClientRect();
            const focusedRect = focusedLine?.getBoundingClientRect();
            const point = document.querySelector(".sheaf-chat-file-point");
            return {
              counts: document.querySelector(".sheaf-chat-agent-review-counts")?.textContent ?? "",
              focusedText: focusedRows.map((row) => row.textContent ?? ""),
              pointInFocusedHunk: focusedLine?.contains(point) ?? false,
              pointOffset: view?.getAttribute("data-point-offset") ?? null,
              rowHeight: focusedRect?.height ?? null,
              scrollTop: view?.scrollTop ?? 0,
              topOffset: viewRect !== undefined && focusedRect !== undefined
                ? focusedRect.top - viewRect.top
                : null,
            };
          });
          assert.equal(afterNextFile.counts, "1/2 in file · file 2/2");
          assert.ok(
            afterNextFile.topOffset !== null &&
            afterNextFile.rowHeight !== null &&
            afterNextFile.topOffset <= Math.max(96, afterNextFile.rowHeight * 4),
            `expected next-file navigation to place focused row near top; topOffset=${afterNextFile.topOffset}`,
          );
          assert.ok(
            afterNextFile.focusedText.some((text) =>
              text.includes("Line 300: altered in the next review file."),
            ),
            "expected next-file navigation to focus the first hunk in zeta.md",
          );
          assert.equal(
            afterNextFile.pointInFocusedHunk,
            true,
            `expected point to follow next-file focused hunk; pointOffset=${afterNextFile.pointOffset}`,
          );

          await page.evaluate(() =>
          {
            const view = document.querySelector(".sheaf-chat-file-view") as HTMLElement | null;
            const target = Array.from(document.querySelectorAll(".sheaf-chat-agent-review-inline-row--changed"))
              .find((row) => row.textContent?.includes("Line 308: already visible after next-file navigation.") === true);
            if (view === null || target === undefined)
            {
              return;
            }

            const viewRect = view.getBoundingClientRect();
            const targetRect = target.getBoundingClientRect();
            if (targetRect.bottom > viewRect.bottom)
            {
              view.scrollTop += targetRect.bottom - viewRect.bottom + 24;
            }
            else if (targetRect.top < viewRect.top)
            {
              view.scrollTop -= viewRect.top - targetRect.top + 24;
            }
          });
          await page.waitForFunction(() =>
          {
            const view = document.querySelector(".sheaf-chat-file-view") as HTMLElement | null;
            const target = Array.from(document.querySelectorAll(".sheaf-chat-agent-review-inline-row--changed"))
              .find((row) => row.textContent?.includes("Line 308: already visible after next-file navigation.") === true);
            const viewRect = view?.getBoundingClientRect();
            const targetRect = target?.getBoundingClientRect();
            return viewRect !== undefined &&
              targetRect !== undefined &&
              targetRect.top >= viewRect.top &&
              targetRect.bottom <= viewRect.bottom;
          }, undefined, { timeout: 5000 });
          const beforeVisibleNextScrollTop = await page.evaluate(() =>
          {
            const view = document.querySelector(".sheaf-chat-file-view") as HTMLElement | null;
            return view?.scrollTop ?? 0;
          });

          await ClickExactButtonText(page, ".sheaf-chat-agent-review-command", "Next");
          await page.waitForFunction(() =>
          {
            return Array.from(document.querySelectorAll(".sheaf-chat-agent-review-inline-row--focused")).some((row) =>
              row.textContent?.includes("Line 308: already visible after next-file navigation.") === true
            );
          }, undefined, { timeout: 5000 });
          const afterVisibleNext = await page.evaluate(() =>
          {
            const view = document.querySelector(".sheaf-chat-file-view") as HTMLElement | null;
            const focusedRows = Array.from(document.querySelectorAll(".sheaf-chat-agent-review-inline-row--focused"));
            const focusedLine = focusedRows.find((row) =>
              row.textContent?.includes("Line 308: already visible after next-file navigation.") === true
            );
            const viewRect = view?.getBoundingClientRect();
            const focusedRect = focusedLine?.getBoundingClientRect();
            return {
              counts: document.querySelector(".sheaf-chat-agent-review-counts")?.textContent ?? "",
              focusedVisible:
                viewRect !== undefined &&
                focusedRect !== undefined &&
                focusedRect.top >= viewRect.top &&
                focusedRect.bottom <= viewRect.bottom,
              scrollTop: view?.scrollTop ?? 0,
            };
          });
          assert.equal(afterVisibleNext.counts, "2/2 in file · file 2/2");
          assert.equal(afterVisibleNext.focusedVisible, true);
          assert.equal(
            afterVisibleNext.scrollTop,
            beforeVisibleNextScrollTop,
            "expected already-visible hunk navigation to preserve scrollTop",
          );

          assert.deepEqual(pageErrors, []);
        }
        finally
        {
          reviewSocket?.close();
          await page.close();
          await context.close();
        }
      }
      finally
      {
        await browser.close();
      }
    }, {
      realRepoRoot: x_realRepoRoot,
      port: 0,
    });
  }
  finally
  {
    if (originalHome === undefined)
    {
      delete process.env.HOME;
    }
    else
    {
      process.env.HOME = originalHome;
    }

    fixture.cleanup();
  }
});
