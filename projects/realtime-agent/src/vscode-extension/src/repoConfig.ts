import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { FindRepositoryRoot } from "realtime-agent-lib";

export interface WorkspaceFolderLike
{
  uri: { fsPath: string };
}

const x_realtimeAgentProjectRelative = "projects/realtime-agent";
const x_apiKeysRelative = "config/api_keys.json";
const x_runtimeLogRelative = "logs/realtime-agent/vscode-extension.jsonl";

export function FindSheafRepositoryRoot(startPath: string): string | undefined
{
  const root = FindRepositoryRoot(startPath);
  if (root === undefined)
  {
    return undefined;
  }

  const projectPath = path.join(root, x_realtimeAgentProjectRelative);
  if (!existsSync(projectPath))
  {
    return undefined;
  }

  return root;
}

export function FindSheafRepositoryRootFromWorkspaceFolders(
  folders: readonly WorkspaceFolderLike[],
): string | undefined
{
  for (const folder of folders)
  {
    const root = FindSheafRepositoryRoot(folder.uri.fsPath);
    if (root !== undefined)
    {
      return root;
    }
  }

  return undefined;
}

export function ResolveExtensionRuntimeLogPath(repoRoot: string): string
{
  return path.join(repoRoot, x_runtimeLogRelative);
}

export async function LoadOpenAiApiKeyFromRepoConfig(
  repoRoot: string,
): Promise<{ apiKey?: string; error?: string }>
{
  const apiKeysPath = path.join(repoRoot, x_apiKeysRelative);

  try
  {
    const content = await readFile(apiKeysPath, "utf8");
    const parsed = JSON.parse(content) as { openai_api_key?: unknown };
    const apiKey =
      typeof parsed.openai_api_key === "string" ? parsed.openai_api_key.trim() : "";

    if (apiKey.length > 0)
    {
      return { apiKey };
    }

    return {};
  }
  catch (error)
  {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT")
    {
      return {};
    }

    const message = error instanceof Error ? error.message : String(error);
    return { error: `Failed to load ${apiKeysPath}: ${message}` };
  }
}
