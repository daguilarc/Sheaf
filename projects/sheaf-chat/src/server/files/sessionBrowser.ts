import { constants } from "node:fs";
import { access, lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

import type { AgentManager } from "../../agents/manager.js";
import { PathEscapeError } from "../../extensions/sheaf-chat/errors.js";
import {
  ClassifyDirectoryEntry,
  ClassifyFile,
} from "../../extensions/sheaf-chat/fileClassification.js";
import {
  CreateRootPolicy,
  type RootPolicy,
} from "../../extensions/sheaf-chat/pathPolicy.js";
import { x_treeDefaultIgnores } from "../../extensions/sheaf-chat/toolHelpers.js";
import { StorageError } from "../../storage/errors.js";

export interface FileBrowserEntry
{
  name: string;
  path: string;
  kind: "file" | "directory";
  supported?: boolean;
  contentType?: string;
}

export interface FileGetResponse
{
  file: FileBrowserEntry & {
    content: string;
    size: number;
    modifiedAt: string;
  };
}

export interface FileListResponse
{
  directory: FileBrowserEntry;
  entries: FileBrowserEntry[];
}

export interface ResolveBrowserRelativePathOptions
{
  allowEmpty?: boolean;
}

function NormalizeSeparators(inputPath: string): string
{
  return inputPath.replace(/\\/g, "/");
}

function HasParentTraversal(inputPath: string): boolean
{
  const segments = NormalizeSeparators(inputPath).split("/");

  for (const segment of segments)
  {
    if (segment === "..")
    {
      return true;
    }
  }

  return false;
}

function RejectBrowserAbsolutePath(inputPath: string): void
{
  const normalized = NormalizeSeparators(inputPath.trim());

  if (path.isAbsolute(normalized) || /^[a-zA-Z]:/.test(normalized))
  {
    throw new StorageError("path_escape", "path must be relative to the session root");
  }
}

function MapPathEscapeError(error: unknown): never
{
  if (error instanceof PathEscapeError)
  {
    throw new StorageError("path_escape", error.message);
  }

  throw error;
}

function IsMissingPathError(error: unknown): boolean
{
  if (!(error instanceof Error))
  {
    return false;
  }

  const errnoCode = (error as NodeJS.ErrnoException).code;

  return errnoCode === "ENOENT" || errnoCode === "ENOTDIR";
}

async function ResolveBrowserExistingPath(
  policy: RootPolicy,
  relativePath: string,
  options?: ResolveBrowserRelativePathOptions,
): Promise<string>
{
  try
  {
    return await ResolveBrowserRelativePath(policy, relativePath, options);
  }
  catch (error)
  {
    if (error instanceof StorageError)
    {
      throw error;
    }

    if (IsMissingPathError(error))
    {
      throw new StorageError("file_not_found", "path not found");
    }

    MapPathEscapeError(error);
  }
}

export async function CreateSessionRootPolicy(
  agentManager: AgentManager,
  pile: string,
  sessionId: string,
): Promise<RootPolicy>
{
  const rootDirectory = await agentManager.resolveSessionRootDirectory(pile, sessionId);
  return CreateRootPolicy(rootDirectory);
}

export async function ResolveBrowserRelativePath(
  policy: RootPolicy,
  relativePath: string,
  options?: ResolveBrowserRelativePathOptions,
): Promise<string>
{
  if (relativePath.includes("\0"))
  {
    throw new StorageError("path_escape", "path must be relative to the session root");
  }

  const trimmed = relativePath.trim();

  if (trimmed.length === 0)
  {
    if (options?.allowEmpty)
    {
      try
      {
        return await policy.ResolveInputPath(".");
      }
      catch (error)
      {
        MapPathEscapeError(error);
      }
    }

    throw new StorageError("invalid_request", "path query parameter is required");
  }

  RejectBrowserAbsolutePath(trimmed);

  if (HasParentTraversal(trimmed))
  {
    throw new StorageError("path_escape", "path must be relative to the session root");
  }

  try
  {
    return await policy.ResolveInputPath(NormalizeSeparators(trimmed));
  }
  catch (error)
  {
    MapPathEscapeError(error);
  }
}

function ShouldIgnoreDirectory(name: string): boolean
{
  return x_treeDefaultIgnores.includes(name);
}

function BuildDirectoryEntry(policy: RootPolicy, absolutePath: string): FileBrowserEntry
{
  const relativePath = policy.ToRootRelativePath(absolutePath);

  return {
    name: path.basename(absolutePath),
    path: relativePath === "." ? "." : relativePath,
    kind: "directory",
    supported: true,
  };
}

function SortBrowserEntries(left: FileBrowserEntry, right: FileBrowserEntry): number
{
  if (left.kind !== right.kind)
  {
    return left.kind === "directory" ? -1 : 1;
  }

  return left.name.localeCompare(right.name);
}

export async function ReadSessionFile(
  policy: RootPolicy,
  relativePath: string,
): Promise<FileGetResponse>
{
  const absolutePath = await ResolveBrowserExistingPath(policy, relativePath);
  const fileStat = await stat(absolutePath);

  if (fileStat.isDirectory())
  {
    throw new StorageError("not_a_file", "path is a directory, not a file");
  }

  const buffer = await readFile(absolutePath);
  const classification = ClassifyFile(path.basename(absolutePath), buffer);

  if (!classification.supported)
  {
    throw new StorageError("unsupported_file", "file is not a supported text document");
  }

  const rootRelativePath = policy.ToRootRelativePath(absolutePath);

  return {
    file: {
      name: path.basename(absolutePath),
      path: rootRelativePath,
      kind: "file",
      supported: true,
      contentType: classification.contentType,
      content: buffer.toString("utf-8"),
      size: fileStat.size,
      modifiedAt: fileStat.mtime.toISOString(),
    },
  };
}

async function ResolveListableEntry(
  policy: RootPolicy,
  parentAbsolute: string,
  entryName: string,
): Promise<{ absolutePath: string; kind: "file" | "directory" } | null>
{
  const entryAbsolute = path.join(parentAbsolute, entryName);
  policy.AssertWithinRoot(entryAbsolute);

  const entryStat = await lstat(entryAbsolute);

  if (entryStat.isSymbolicLink())
  {
    try
    {
      const resolved = await realpath(entryAbsolute);
      policy.AssertWithinRoot(resolved);
      const resolvedStat = await stat(resolved);

      if (resolvedStat.isDirectory())
      {
        return { absolutePath: resolved, kind: "directory" };
      }

      return { absolutePath: resolved, kind: "file" };
    }
    catch
    {
      return null;
    }
  }

  if (entryStat.isDirectory())
  {
    return { absolutePath: entryAbsolute, kind: "directory" };
  }

  if (entryStat.isFile())
  {
    return { absolutePath: entryAbsolute, kind: "file" };
  }

  return null;
}

export async function ListSessionDirectory(
  policy: RootPolicy,
  relativePath: string,
): Promise<FileListResponse>
{
  const absolutePath = await ResolveBrowserExistingPath(policy, relativePath, {
    allowEmpty: true,
  });
  const directoryStat = await stat(absolutePath);

  if (!directoryStat.isDirectory())
  {
    throw new StorageError("not_a_directory", "path is not a directory");
  }

  const directory = BuildDirectoryEntry(policy, absolutePath);
  const dirEntries = await readdir(absolutePath);
  const entries: FileBrowserEntry[] = [];

  for (const entryName of dirEntries)
  {
    const resolved = await ResolveListableEntry(policy, absolutePath, entryName);

    if (resolved === null)
    {
      continue;
    }

    const entryAbsolute = path.join(absolutePath, entryName);
    const rootRelativePath = policy.ToRootRelativePath(entryAbsolute);

    if (resolved.kind === "directory")
    {
      if (ShouldIgnoreDirectory(entryName))
      {
        continue;
      }

      entries.push({
        name: entryName,
        path: rootRelativePath,
        kind: "directory",
        supported: true,
      });
      continue;
    }

    const classification = ClassifyDirectoryEntry(entryName);

    entries.push({
      name: entryName,
      path: rootRelativePath,
      kind: "file",
      supported: classification.supported,
      ...(classification.contentType !== undefined
        ? { contentType: classification.contentType }
        : {}),
    });
  }

  entries.sort(SortBrowserEntries);

  return {
    directory,
    entries,
  };
}
