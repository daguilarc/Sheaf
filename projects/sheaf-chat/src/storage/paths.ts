import { realpath } from "node:fs/promises";
import path from "node:path";

import { GetDefaultSheafChatPaths } from "../server/repo_paths.js";
import { StorageError } from "./errors.js";
import {
  ValidateChatId,
  ValidateRepoId,
  ValidateWorkspaceId,
} from "./validation.js";

export const x_repositoriesDirRelative = "data/sheaf-chat/repositories";
export const x_historyFileSuffix = ".sheaf-history.jsonl";
export const x_manifestFileSuffix = ".manifest.json";
export const x_provisionalFileSuffix = ".provisional.json";
export const x_sessionFileSuffix = ".jsonl";
export const x_repositoryMetadataFile = "repository.json";
export const x_workspaceMetadataFile = "workspace.json";
export const x_workspaceEditorStateFile = "editor-state.json";

export interface StoragePaths
{
  repoRoot: string;
  dataDir: string;
  repositoriesDir: string;
}

export function CreateStoragePaths(repoRoot: string): StoragePaths
{
  const defaults = GetDefaultSheafChatPaths(repoRoot);

  return {
    repoRoot,
    dataDir: defaults.dataDir,
    repositoriesDir: path.join(defaults.dataDir, "repositories"),
  };
}

export function ResolveRepositoryDirectory(paths: StoragePaths, repoId: string): string
{
  return path.join(paths.repositoriesDir, ValidateRepoId(repoId));
}

export function ResolveRepositoryMetadataPath(paths: StoragePaths, repoId: string): string
{
  return path.join(ResolveRepositoryDirectory(paths, repoId), x_repositoryMetadataFile);
}

export function ResolveWorkspacesDirectory(paths: StoragePaths, repoId: string): string
{
  return path.join(ResolveRepositoryDirectory(paths, repoId), "workspaces");
}

export function ResolveWorkspaceDirectory(
  paths: StoragePaths,
  repoId: string,
  workspaceId: string,
): string
{
  return path.join(
    ResolveWorkspacesDirectory(paths, repoId),
    ValidateWorkspaceId(workspaceId),
  );
}

export function ResolveWorkspaceMetadataPath(
  paths: StoragePaths,
  repoId: string,
  workspaceId: string,
): string
{
  return path.join(
    ResolveWorkspaceDirectory(paths, repoId, workspaceId),
    x_workspaceMetadataFile,
  );
}

export function ResolveWorkspaceEditorStatePath(
  paths: StoragePaths,
  repoId: string,
  workspaceId: string,
): string
{
  return path.join(
    ResolveWorkspaceDirectory(paths, repoId, workspaceId),
    x_workspaceEditorStateFile,
  );
}

export function ResolveChatsDirectory(
  paths: StoragePaths,
  repoId: string,
  workspaceId: string,
): string
{
  return path.join(ResolveWorkspaceDirectory(paths, repoId, workspaceId), "chats");
}

export function ResolveChatStem(
  paths: StoragePaths,
  repoId: string,
  workspaceId: string,
  chatId: string,
): string
{
  return path.join(
    ResolveChatsDirectory(paths, repoId, workspaceId),
    ValidateChatId(chatId),
  );
}

export function ResolveSessionFilePath(
  paths: StoragePaths,
  repoId: string,
  workspaceId: string,
  chatId: string,
): string
{
  return `${ResolveChatStem(paths, repoId, workspaceId, chatId)}${x_sessionFileSuffix}`;
}

export function ResolveManifestFilePath(
  paths: StoragePaths,
  repoId: string,
  workspaceId: string,
  chatId: string,
): string
{
  return `${ResolveChatStem(paths, repoId, workspaceId, chatId)}${x_manifestFileSuffix}`;
}

export function ResolveHistoryFilePath(
  paths: StoragePaths,
  repoId: string,
  workspaceId: string,
  chatId: string,
): string
{
  return `${ResolveChatStem(paths, repoId, workspaceId, chatId)}${x_historyFileSuffix}`;
}

export function ResolveProvisionalFilePath(
  paths: StoragePaths,
  repoId: string,
  workspaceId: string,
  chatId: string,
): string
{
  return `${ResolveChatStem(paths, repoId, workspaceId, chatId)}${x_provisionalFileSuffix}`;
}

export function ResolveRootDirectory(repoRoot: string, rootDirectory: string): string
{
  if (path.isAbsolute(rootDirectory))
  {
    return path.resolve(rootDirectory);
  }

  return path.resolve(repoRoot, rootDirectory);
}

export function ManifestSessionFileReference(
  repoRoot: string,
  repoId: string,
  workspaceId: string,
  chatId: string,
): string
{
  return path.join(
    x_repositoriesDirRelative,
    ValidateRepoId(repoId),
    "workspaces",
    ValidateWorkspaceId(workspaceId),
    "chats",
    `${ValidateChatId(chatId)}${x_sessionFileSuffix}`,
  );
}

async function ResolveExistingPath(targetPath: string): Promise<string>
{
  const resolved = path.resolve(targetPath);

  try
  {
    return await realpath(resolved);
  }
  catch (error)
  {
    const nodeError = error as NodeJS.ErrnoException;

    if (nodeError.code !== "ENOENT")
    {
      throw error;
    }
  }

  return resolved;
}

export async function AssertPathWithinRoot(
  candidatePath: string,
  rootPath: string,
): Promise<string>
{
  const resolvedRoot = await ResolveExistingPath(rootPath);
  const resolvedCandidate = await ResolveExistingPath(candidatePath);
  const relative = path.relative(resolvedRoot, resolvedCandidate);

  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)))
  {
    return resolvedCandidate;
  }

  throw new StorageError("path_escape", "path escapes the storage root");
}

export async function AssertRepositoryPathWithinRoot(
  paths: StoragePaths,
  repositoryDirectory: string,
): Promise<string>
{
  return AssertPathWithinRoot(repositoryDirectory, paths.repositoriesDir);
}
