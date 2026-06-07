import { readFile } from "node:fs/promises";

import {
  FindRepositoryRoot,
  GetDefaultRealtimeAgentPaths,
  ResolveRepositoryPath,
  x_databaseRelative,
  x_defaultPromptRelative,
} from "./repo_paths.js";
import {
  DEFAULT_REALTIME_MODEL,
} from "./types.js";

const x_logsDirRelative = "logs/realtime-agent";
const x_dataDirRelative = "data/realtime-agent";

export interface RealtimeAgentConfig
{
  model: string;
  data_dir: string;
  database_path: string;
  logs_dir: string;
  default_prompt_file: string;
  updated_at?: string;
  version?: number;
}

export interface ResolvedRealtimeAgentConfig extends RealtimeAgentConfig
{
  configFile: string;
  databasePath: string;
  defaultPromptPath: string;
  logsDir: string;
  runtimeLogPath: string;
}

export interface LoadRealtimeAgentConfigOptions
{
  configPath?: string;
  repoRoot?: string;
}

export interface LoadOpenAiApiKeyOptions
{
  apiKeysPath?: string;
  repoRoot?: string;
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

function BuildDefaultConfig(repoRoot: string): ResolvedRealtimeAgentConfig
{
  const paths = GetDefaultRealtimeAgentPaths(repoRoot);

  return {
    model: DEFAULT_REALTIME_MODEL,
    data_dir: x_dataDirRelative,
    database_path: x_databaseRelative,
    logs_dir: x_logsDirRelative,
    default_prompt_file: x_defaultPromptRelative,
    configFile: paths.configFile,
    databasePath: paths.databasePath,
    defaultPromptPath: paths.defaultPromptFile,
    logsDir: ResolveRepositoryPath(x_logsDirRelative, repoRoot),
    runtimeLogPath: paths.runtimeLogPath,
  };
}

function ResolveConfigPaths(
  config: RealtimeAgentConfig,
  repoRoot: string,
  configFile: string,
  runtimeLogPath: string,
): ResolvedRealtimeAgentConfig
{
  return {
    ...config,
    configFile,
    databasePath: ResolveRepositoryPath(config.database_path, repoRoot),
    defaultPromptPath: ResolveRepositoryPath(config.default_prompt_file, repoRoot),
    logsDir: ResolveRepositoryPath(config.logs_dir, repoRoot),
    runtimeLogPath,
  };
}

export async function LoadRealtimeAgentConfig(
  options: LoadRealtimeAgentConfigOptions = {},
): Promise<ResolvedRealtimeAgentConfig>
{
  const repoRoot = RequireRepoRoot(options.repoRoot);
  const paths = GetDefaultRealtimeAgentPaths(repoRoot);
  const configPath = options.configPath ?? paths.configFile;

  try
  {
    const content = await readFile(configPath, "utf8");
    const parsed = JSON.parse(content) as Partial<RealtimeAgentConfig>;
    const merged: RealtimeAgentConfig = {
      model: parsed.model ?? DEFAULT_REALTIME_MODEL,
      data_dir: parsed.data_dir ?? x_dataDirRelative,
      database_path: parsed.database_path ?? x_databaseRelative,
      logs_dir: parsed.logs_dir ?? x_logsDirRelative,
      default_prompt_file: parsed.default_prompt_file ?? x_defaultPromptRelative,
      updated_at: parsed.updated_at,
      version: parsed.version,
    };

    return ResolveConfigPaths(merged, repoRoot, configPath, paths.runtimeLogPath);
  }
  catch (error)
  {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT")
    {
      return BuildDefaultConfig(repoRoot);
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new ConfigLoadError(`Failed to load ${configPath}: ${message}`);
  }
}

export async function LoadOpenAiApiKey(
  options: LoadOpenAiApiKeyOptions = {},
): Promise<string>
{
  const repoRoot = RequireRepoRoot(options.repoRoot);
  const paths = GetDefaultRealtimeAgentPaths(repoRoot);
  const apiKeysPath = options.apiKeysPath ?? paths.apiKeysFile;

  try
  {
    const content = await readFile(apiKeysPath, "utf8");
    const parsed = JSON.parse(content) as { openai_api_key?: unknown };
    const apiKey =
      typeof parsed.openai_api_key === "string" ? parsed.openai_api_key.trim() : "";

    if (apiKey.length > 0)
    {
      return apiKey;
    }
  }
  catch (error)
  {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT")
    {
      const message = error instanceof Error ? error.message : String(error);
      throw new ConfigLoadError(`Failed to load ${apiKeysPath}: ${message}`);
    }
  }

  throw new ConfigLoadError(
    `OpenAI API key not found. Add "openai_api_key" to ${apiKeysPath}.`,
  );
}
