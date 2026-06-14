import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface SheafChatPaths
{
  globalConfigFile: string;
  apiKeysFile: string;
  servicesJsonFile: string;
  dataDir: string;
  authDir: string;
}

const x_globalConfigRelative = "config/global_config.json";
const x_apiKeysRelative = "config/api_keys.json";
const x_servicesJsonRelative = "config/services.json";
const x_dataDirRelative = "data/sheaf-chat";
const x_authDirRelative = "data/sheaf-chat/auth";

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

export function GetDefaultSheafChatPaths(root?: string): SheafChatPaths
{
  const repoRoot = root ?? FindRepositoryRoot(x_moduleDir) ?? FindRepositoryRoot();

  if (repoRoot === undefined)
  {
    throw new Error("repository root not found");
  }

  return {
    globalConfigFile: path.join(repoRoot, x_globalConfigRelative),
    apiKeysFile: path.join(repoRoot, x_apiKeysRelative),
    servicesJsonFile: path.join(repoRoot, x_servicesJsonRelative),
    dataDir: path.join(repoRoot, x_dataDirRelative),
    authDir: path.join(repoRoot, x_authDirRelative),
  };
}

export {
  x_apiKeysRelative,
  x_authDirRelative,
  x_dataDirRelative,
  x_globalConfigRelative,
  x_servicesJsonRelative,
};
