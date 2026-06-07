import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface RealtimeAgentPaths
{
  configFile: string;
  apiKeysFile: string;
  defaultPromptFile: string;
  databasePath: string;
  runtimeLogPath: string;
}

const x_configRelative = "config/realtime-agent.json";
const x_apiKeysRelative = "config/api_keys.json";
const x_defaultPromptRelative =
  "projects/realtime-agent/prompts/system-prompts/basic_realtime_conversation_v1.md";
const x_databaseRelative = "data/realtime-agent/realtime-agent.sqlite";
const x_runtimeLogRelative = "logs/realtime-agent/realtime-agent.jsonl";

const x_moduleDir =
  typeof __dirname === "string"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));

export function FindRepositoryRoot(startPath?: string): string | undefined
{
  const startDir = path.resolve(startPath ?? process.cwd());
  let current = startDir;

  while (current !== path.dirname(current))
  {
    const servicesJsonPath = path.join(current, "config", "services.json");
    const structureDir = path.join(current, "structure");

    if (existsSync(servicesJsonPath) && existsSync(structureDir))
    {
      return current;
    }

    current = path.dirname(current);
  }

  return undefined;
}

export function ResolveRepositoryPath(relativePath: string, root?: string): string
{
  const repoRoot = root ?? FindRepositoryRoot(x_moduleDir) ?? FindRepositoryRoot();

  if (repoRoot === undefined)
  {
    throw new Error("repository root not found");
  }

  return path.join(repoRoot, relativePath);
}

export function GetDefaultRealtimeAgentPaths(root?: string): RealtimeAgentPaths
{
  const repoRoot = root ?? FindRepositoryRoot(x_moduleDir) ?? FindRepositoryRoot();

  if (repoRoot === undefined)
  {
    throw new Error("repository root not found");
  }

  return {
    configFile: path.join(repoRoot, x_configRelative),
    apiKeysFile: path.join(repoRoot, x_apiKeysRelative),
    defaultPromptFile: path.join(repoRoot, x_defaultPromptRelative),
    databasePath: path.join(repoRoot, x_databaseRelative),
    runtimeLogPath: path.join(repoRoot, x_runtimeLogRelative),
  };
}

export {
  x_apiKeysRelative,
  x_configRelative,
  x_databaseRelative,
  x_defaultPromptRelative,
  x_runtimeLogRelative,
};
