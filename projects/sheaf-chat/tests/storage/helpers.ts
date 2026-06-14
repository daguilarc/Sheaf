import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { CreateStoragePaths, type StoragePaths } from "../../src/storage/paths.js";
import {
  CacheRepositoryMetadata,
  CacheWorkspaceMetadata,
  IdForCanonicalPath,
} from "../../src/storage/repositories.js";
import type { RepositoryMetadata, WorkspaceMetadata } from "../../src/shared/types.js";

export async function WithTempStorage<T>(
  callback: (paths: StoragePaths) => Promise<T>,
): Promise<T>
{
  const repoRoot = await mkdtemp(path.join(tmpdir(), "sheaf-chat-storage-"));

  try
  {
    return await callback(CreateStoragePaths(repoRoot));
  }
  finally
  {
    await rm(repoRoot, { recursive: true, force: true });
  }
}

export async function CacheTestWorkspace(
  paths: StoragePaths,
  workspacePath: string,
  options: {
    repoPath?: string;
    repoName?: string;
    workspaceDisplayName?: string;
  } = {},
): Promise<{ repository: RepositoryMetadata; workspace: WorkspaceMetadata }>
{
  const repoPath = path.resolve(options.repoPath ?? workspacePath);
  const resolvedWorkspacePath = path.resolve(workspacePath);
  const now = new Date().toISOString();
  const repository: RepositoryMetadata = {
    repoId: IdForCanonicalPath(repoPath),
    name: options.repoName ?? path.basename(repoPath),
    path: repoPath,
    discoveredAt: now,
  };
  const workspace: WorkspaceMetadata = {
    repoId: repository.repoId,
    workspaceId: IdForCanonicalPath(resolvedWorkspacePath),
    kind: repoPath === resolvedWorkspacePath ? "main" : "worktree",
    path: resolvedWorkspacePath,
    displayName: options.workspaceDisplayName ?? path.basename(resolvedWorkspacePath),
    discoveredAt: now,
  };

  await CacheRepositoryMetadata(paths, repository);
  await CacheWorkspaceMetadata(paths, workspace);

  return { repository, workspace };
}
