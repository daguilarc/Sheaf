import * as fs from "node:fs";
import * as nodePath from "node:path";

import type { ToolError } from "./types.js";

export type ResolveWorkspacePathOk = {
  absPath: string;
  relativePosix: string;
  rootFsPath: string;
};

export type ResolveWorkspacePathResult = ResolveWorkspacePathOk | ToolError;

function FileNotFound(message: string): ToolError
{
  return { code: "file_not_found", message };
}

function PathOutsideWorkspace(message: string): ToolError
{
  return { code: "path_outside_workspace", message };
}

function TryRealpath(absolutePath: string): string
{
  try
  {
    return fs.realpathSync.native(absolutePath);
  }
  catch
  {
    const dir = nodePath.dirname(absolutePath);
    const base = nodePath.basename(absolutePath);
    try
    {
      return nodePath.join(fs.realpathSync.native(dir), base);
    }
    catch
    {
      return nodePath.normalize(absolutePath);
    }
  }
}

function IsPathInsideRoot(root: string, candidateAbs: string): boolean
{
  const resolvedRoot = TryRealpath(root);
  const resolvedCandidate = TryRealpath(candidateAbs);
  const rel = nodePath.relative(resolvedRoot, resolvedCandidate);
  return rel.length === 0 || (!rel.startsWith("..") && !nodePath.isAbsolute(rel));
}

export function ResolveWorkspacePath(input: string, workspaceRoots: string[]): ResolveWorkspacePathResult
{
  const trimmed = input.trim();
  if (trimmed.length === 0)
  {
    return FileNotFound("Path is empty.");
  }

  if (workspaceRoots.length === 0)
  {
    return PathOutsideWorkspace("No workspace folder is open.");
  }

  const primaryRoot = workspaceRoots[0]!;
  const candidateAbs = nodePath.normalize(
    nodePath.isAbsolute(trimmed) ? trimmed : nodePath.join(primaryRoot, trimmed),
  );

  let matchedRoot: string | undefined;
  for (const root of workspaceRoots)
  {
    if (IsPathInsideRoot(root, candidateAbs))
    {
      matchedRoot = root;
      break;
    }
  }

  if (matchedRoot === undefined)
  {
    return PathOutsideWorkspace("Path resolves outside the workspace.");
  }

  let realRootResolved: string;
  try
  {
    realRootResolved = fs.realpathSync.native(matchedRoot);
  }
  catch
  {
    realRootResolved = nodePath.normalize(matchedRoot);
  }

  const resolvedCandidate = TryRealpath(candidateAbs);
  const relativeNative = nodePath.relative(realRootResolved, resolvedCandidate);
  const relativePosix =
    relativeNative.length === 0 ? "." : relativeNative.split(nodePath.sep).join("/");

  return {
    absPath: candidateAbs,
    relativePosix,
    rootFsPath: matchedRoot,
  };
}
