import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

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

  const longLines: string[] = ["# Notes", ""];
  for (let index = 1; index <= 400; index += 1)
  {
    longLines.push(`Line ${index}: the quick brown fox jumps over the lazy dog.`);
    longLines.push("");
  }
  writeFileSync(path.join(repoPath, "notes.md"), `${longLines.join("\n")}\n`, "utf8");

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
