import { access, readFile } from "node:fs/promises";
import path from "node:path";

import type { ModelMetadata } from "../shared/types.js";
import {
  FindRepositoryRoot,
  GetDefaultSheafChatPaths,
  type SheafChatPaths,
} from "./repo_paths.js";

export const x_defaultAgentIdleOffloadSeconds = 300;

export interface GlobalConfigFile
{
  local_inference_url?: string;
  agent_idle_offload_seconds?: number;
  sheaf_chat?: {
    local_inference_url?: string;
    agent_idle_offload_seconds?: number;
  };
}

export interface ApiKeysFile
{
  local_inference_api_key?: string;
  openai_api_key?: string;
}

export interface SheafChatConfig
{
  repoRoot: string;
  paths: SheafChatPaths;
  localInferenceUrl: string | null;
  localInferenceApiKey: string | null;
  agentIdleOffloadSeconds: number;
  localInferenceAvailable: boolean;
}

export interface LoadSheafChatConfigOptions
{
  repoRoot?: string;
  globalConfigPath?: string;
  apiKeysPath?: string;
}

export class ConfigLoadError extends Error
{
  constructor(message: string)
  {
    super(message);
    this.name = "ConfigLoadError";
  }
}

function RequireRepoRoot(repoRoot?: string): string
{
  const resolved = repoRoot ?? FindRepositoryRoot();

  if (resolved === undefined)
  {
    throw new ConfigLoadError("repository root not found");
  }

  return resolved;
}

async function FileExists(filePath: string): Promise<boolean>
{
  try
  {
    await access(filePath);
    return true;
  }
  catch
  {
    return false;
  }
}

function ParseOptionalString(value: unknown): string | null
{
  if (typeof value !== "string")
  {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function ResolveLocalInferenceUrl(globalConfig: GlobalConfigFile): string | null
{
  const nested = globalConfig.sheaf_chat?.local_inference_url;
  const topLevel = globalConfig.local_inference_url;
  return ParseOptionalString(nested ?? topLevel);
}

function ResolveAgentIdleOffloadSeconds(globalConfig: GlobalConfigFile): number
{
  const nested = globalConfig.sheaf_chat?.agent_idle_offload_seconds;
  const topLevel = globalConfig.agent_idle_offload_seconds;
  const value = nested ?? topLevel;

  if (typeof value === "number" && Number.isFinite(value) && value > 0)
  {
    return Math.floor(value);
  }

  return x_defaultAgentIdleOffloadSeconds;
}

export async function LoadSheafChatConfig(
  options: LoadSheafChatConfigOptions = {},
): Promise<SheafChatConfig>
{
  const repoRoot = RequireRepoRoot(options.repoRoot);
  const paths = GetDefaultSheafChatPaths(repoRoot);
  const globalConfigPath = options.globalConfigPath ?? paths.globalConfigFile;
  const apiKeysPath = options.apiKeysPath ?? paths.apiKeysFile;

  let globalConfig: GlobalConfigFile = {};

  if (await FileExists(globalConfigPath))
  {
    const raw = await readFile(globalConfigPath, "utf8");
    globalConfig = JSON.parse(raw) as GlobalConfigFile;
  }

  let apiKeys: ApiKeysFile = {};

  if (await FileExists(apiKeysPath))
  {
    const raw = await readFile(apiKeysPath, "utf8");
    apiKeys = JSON.parse(raw) as ApiKeysFile;
  }

  const localInferenceUrl = ResolveLocalInferenceUrl(globalConfig);
  const localInferenceApiKey = ParseOptionalString(apiKeys.local_inference_api_key);
  const localInferenceAvailable =
    localInferenceUrl !== null && localInferenceApiKey !== null;

  return {
    repoRoot,
    paths,
    localInferenceUrl,
    localInferenceApiKey,
    agentIdleOffloadSeconds: ResolveAgentIdleOffloadSeconds(globalConfig),
    localInferenceAvailable,
  };
}

export function BuildLocalModelMetadata(
  config: SheafChatConfig,
  modelId = "local-default",
): ModelMetadata
{
  return {
    provider: "local",
    id: modelId,
    displayName: modelId,
    available: config.localInferenceAvailable,
  };
}

export function ResolveConfigDirectory(repoRoot: string): string
{
  return path.join(repoRoot, "config");
}
