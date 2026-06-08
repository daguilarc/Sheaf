import { mkdirSync } from "node:fs";

import { AgentManager } from "../../../src/agents/manager.js";
import type { SheafChatConfig } from "../../../src/server/config.js";
import { CreateSheafChatServer } from "../../../src/server/server.js";
import { CreateStoragePaths } from "../../../src/storage/paths.js";
import { CreateTestModelBundle } from "../../agents/lifecycle/helpers.js";
import { BuildTestConfig, WithFakeRepoAsync } from "../../agents/modelRegistry/helpers.js";

export interface TestServerHandle
{
  baseUrl: string;
  config: SheafChatConfig;
  agentManager: AgentManager;
  close: () => Promise<void>;
}

export async function StartTestServer(repoRoot: string): Promise<TestServerHandle>
{
  mkdirSync(repoRoot, { recursive: true });
  mkdirSync(`${repoRoot}/projects/demo`, { recursive: true });

  const config = BuildTestConfig(repoRoot, {
    openAiApiKey: "test-key",
  });
  const storagePaths = CreateStoragePaths(repoRoot);
  const modelBundle = CreateTestModelBundle();
  const agentManager = await AgentManager.Create({
    config,
    storagePaths,
    modelBundle,
  });
  const server = CreateSheafChatServer({
    config,
    bindHost: "127.0.0.1",
    bindPort: 0,
    agentManager,
  });
  const port = await server.listen();
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    config,
    agentManager,
    close: async () =>
    {
      await server.close();
      await agentManager.dispose();
    },
  };
}

export async function WithTestServer(
  callback: (handle: TestServerHandle) => Promise<void>,
): Promise<void>
{
  await WithFakeRepoAsync(async (repoRoot) =>
  {
    const handle = await StartTestServer(repoRoot);

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

export async function RequestJson(
  baseUrl: string,
  method: string,
  route: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }>
{
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const parsed = await response.json() as unknown;

  return {
    status: response.status,
    body: parsed,
  };
}

export function ResolveOpenAiTestModel(agentManager: AgentManager): { provider: string; id: string }
{
  const models = agentManager.listModels();
  const model = models.find((entry) => entry.provider === "openai" && entry.available);

  if (model === undefined)
  {
    throw new Error("openai test model not found");
  }

  return {
    provider: model.provider,
    id: model.id,
  };
}
