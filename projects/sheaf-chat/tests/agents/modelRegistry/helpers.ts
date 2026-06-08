import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { AuthStorage } from "@earendil-works/pi-coding-agent";

import type { SheafChatConfig } from "../../../src/server/config.js";
import { GetDefaultSheafChatPaths } from "../../../src/server/repo_paths.js";

export function CreateFakeRepoRoot(): string
{
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "sheaf-chat-agents-"));
  mkdirSync(path.join(repoRoot, "config"), { recursive: true });
  mkdirSync(path.join(repoRoot, "structure"), { recursive: true });
  writeFileSync(path.join(repoRoot, "config", "services.json"), "[]");
  return repoRoot;
}

export function BuildTestConfig(
  repoRoot: string,
  overrides: Partial<SheafChatConfig> = {},
): SheafChatConfig
{
  const paths = GetDefaultSheafChatPaths(repoRoot);

  return {
    repoRoot,
    paths,
    localInferenceUrl: null,
    localInferenceApiKey: null,
    openAiApiKey: null,
    agentIdleOffloadSeconds: 300,
    localInferenceAvailable: false,
    ...overrides,
  };
}

export function WithFakeRepo<T>(callback: (repoRoot: string) => T): T
{
  const repoRoot = CreateFakeRepoRoot();

  try
  {
    return callback(repoRoot);
  }
  finally
  {
    rmSync(repoRoot, { recursive: true, force: true });
  }
}

export async function WithFakeRepoAsync<T>(
  callback: (repoRoot: string) => Promise<T>,
): Promise<T>
{
  const repoRoot = CreateFakeRepoRoot();

  try
  {
    return await callback(repoRoot);
  }
  finally
  {
    rmSync(repoRoot, { recursive: true, force: true });
  }
}

export function CreateInMemoryAuthStorage(): AuthStorage
{
  return AuthStorage.inMemory();
}

export function CreateMockFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): typeof fetch
{
  return async (input, init) =>
  {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return handler(url, init);
  };
}
