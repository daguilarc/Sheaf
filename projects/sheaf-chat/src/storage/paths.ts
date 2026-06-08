import { realpath } from "node:fs/promises";
import path from "node:path";

import { GetDefaultSheafChatPaths } from "../server/repo_paths.js";
import { StorageError } from "./errors.js";
import { ValidatePileName, ValidateSessionId } from "./validation.js";

export const x_pilesDirRelative = "data/sheaf-chat/sessions/piles";
export const x_historyFileSuffix = ".sheaf-history.jsonl";
export const x_manifestFileSuffix = ".manifest.json";
export const x_provisionalFileSuffix = ".provisional.json";
export const x_sessionFileSuffix = ".jsonl";

export interface StoragePaths
{
  repoRoot: string;
  dataDir: string;
  sessionsDir: string;
  pilesDir: string;
}

export function CreateStoragePaths(repoRoot: string): StoragePaths
{
  const defaults = GetDefaultSheafChatPaths(repoRoot);

  return {
    repoRoot,
    dataDir: defaults.dataDir,
    sessionsDir: defaults.sessionsDir,
    pilesDir: path.join(defaults.sessionsDir, "piles"),
  };
}

export function ResolvePileDirectory(paths: StoragePaths, pile: string): string
{
  const validatedPile = ValidatePileName(pile);
  return path.join(paths.pilesDir, validatedPile);
}

export function ResolveSessionStem(paths: StoragePaths, pile: string, sessionId: string): string
{
  const pileDir = ResolvePileDirectory(paths, pile);
  const validatedSessionId = ValidateSessionId(sessionId);
  return path.join(pileDir, validatedSessionId);
}

export function ResolveSessionFilePath(paths: StoragePaths, pile: string, sessionId: string): string
{
  const validatedSessionId = ValidateSessionId(sessionId);
  return `${ResolveSessionStem(paths, pile, sessionId)}${x_sessionFileSuffix}`;
}

export function ResolveManifestFilePath(paths: StoragePaths, pile: string, sessionId: string): string
{
  const validatedSessionId = ValidateSessionId(sessionId);
  return `${ResolveSessionStem(paths, pile, sessionId)}${x_manifestFileSuffix}`;
}

export function ResolveHistoryFilePath(paths: StoragePaths, pile: string, sessionId: string): string
{
  const validatedSessionId = ValidateSessionId(sessionId);
  return `${ResolveSessionStem(paths, pile, sessionId)}${x_historyFileSuffix}`;
}

export function ResolveProvisionalFilePath(paths: StoragePaths, pile: string, sessionId: string): string
{
  const validatedSessionId = ValidateSessionId(sessionId);
  return `${ResolveSessionStem(paths, pile, sessionId)}${x_provisionalFileSuffix}`;
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
  pile: string,
  sessionId: string,
): string
{
  const validatedPile = ValidatePileName(pile);
  const validatedSessionId = ValidateSessionId(sessionId);
  return path.join(
    x_pilesDirRelative,
    validatedPile,
    `${validatedSessionId}${x_sessionFileSuffix}`,
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

export async function AssertPilePathWithinRoot(
  paths: StoragePaths,
  pileDirectory: string,
): Promise<string>
{
  return AssertPathWithinRoot(pileDirectory, paths.pilesDir);
}
