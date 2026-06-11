import { mkdirSync, symlinkSync } from "node:fs";
import path from "node:path";

import type { PiSessionHandle } from "../../src/agents/piAdapter.js";
import { AgentManager } from "../../src/agents/manager.js";
import type { SessionBroadcasterRegistry } from "../../src/protocol/sessionBroadcaster.js";
import type { SessionPersistenceHubRegistry } from "../../src/protocol/sessionPersistenceHub.js";
import type { SheafChatConfig } from "../../src/server/config.js";
import { CreateSheafChatServer } from "../../src/server/server.js";
import { CreateStoragePaths } from "../../src/storage/paths.js";
import {
  CreateFakeTimers,
  CreateTestConfigWithRoot,
  CreateTestModelBundle,
  FakePiSession,
  WithFakeRepoAsync,
} from "../agents/lifecycle/helpers.js";

export interface BrowserTestServerHandle
{
  baseUrl: string;
  wsBaseUrl: string;
  config: SheafChatConfig;
  agentManager: AgentManager;
  broadcasterRegistry: SessionBroadcasterRegistry;
  persistenceHubRegistry: SessionPersistenceHubRegistry;
  fakeSessions: Map<string, FakePiSession>;
  close: () => Promise<void>;
}

function LinkDirectory(target: string, linkPath: string): void
{
  mkdirSync(path.dirname(linkPath), { recursive: true });

  try
  {
    symlinkSync(target, linkPath, "dir");
  }
  catch (error)
  {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST")
    {
      throw error;
    }
  }
}

function LinkRealStaticAssets(fakeRepoRoot: string, realRepoRoot: string): void
{
  LinkDirectory(
    path.join(realRepoRoot, "projects", "web", "src"),
    path.join(fakeRepoRoot, "projects", "web", "src"),
  );
  LinkDirectory(
    path.join(realRepoRoot, "projects", "sheaf-chat", "src"),
    path.join(fakeRepoRoot, "projects", "sheaf-chat", "src"),
  );
  LinkDirectory(
    path.join(realRepoRoot, "projects", "sheaf-chat", "node_modules"),
    path.join(fakeRepoRoot, "projects", "sheaf-chat", "node_modules"),
  );
}

export async function StartBrowserTestServer(
  repoRoot: string,
  options: {
    realRepoRoot: string;
    port: number;
    idleOffloadSeconds?: number;
    timers?: ReturnType<typeof CreateFakeTimers>;
  },
): Promise<BrowserTestServerHandle>
{
  mkdirSync(repoRoot, { recursive: true });
  mkdirSync(path.join(repoRoot, "projects", "demo"), { recursive: true });
  LinkRealStaticAssets(repoRoot, options.realRepoRoot);

  const config = CreateTestConfigWithRoot(repoRoot);
  const storagePaths = CreateStoragePaths(repoRoot);
  const modelBundle = CreateTestModelBundle();
  const fakeSessions = new Map<string, FakePiSession>();

  const agentManager = await AgentManager.Create({
    config,
    storagePaths,
    modelBundle,
    idleOffloadSeconds: options.idleOffloadSeconds ?? 1,
    setTimeoutFn: options.timers?.setTimeout,
    clearTimeoutFn: options.timers?.clearTimeout,
    createPiSession: async (input): Promise<PiSessionHandle> =>
    {
      const fake = new FakePiSession(
        path.basename(input.sessionFilePath, ".jsonl"),
        input.sessionFilePath,
        input.model,
      );
      fakeSessions.set(input.sessionFilePath, fake);
      return fake;
    },
  });

  const server = CreateSheafChatServer({
    config,
    bindHost: "127.0.0.1",
    bindPort: options.port,
    agentManager,
  });
  const port = await server.listen();

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    wsBaseUrl: `ws://127.0.0.1:${port}`,
    config,
    agentManager,
    broadcasterRegistry: server.broadcasterRegistry,
    persistenceHubRegistry: server.persistenceHubRegistry,
    fakeSessions,
    close: async () =>
    {
      await server.close();
      await agentManager.dispose();
    },
  };
}

export async function WithBrowserTestServer(
  callback: (handle: BrowserTestServerHandle) => Promise<void>,
  options: {
    realRepoRoot: string;
    port: number;
    idleOffloadSeconds?: number;
    timers?: ReturnType<typeof CreateFakeTimers>;
  },
): Promise<void>
{
  await WithFakeRepoAsync(async (repoRoot) =>
  {
    const handle = await StartBrowserTestServer(repoRoot, options);

    try
    {
      await callback(handle);
    }
    finally
    {
      await handle.close();
    }
  });
}
