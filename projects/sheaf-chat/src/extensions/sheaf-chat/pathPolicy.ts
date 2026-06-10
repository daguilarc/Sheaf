import { access, realpath } from "node:fs/promises";
import path from "node:path";

import { PathEscapeError } from "./errors.js";

export interface ResolveInputPathOptions
{
  allowMissing?: boolean;
}

export interface RootPolicy
{
  readonly rootDirectory: string;
  readonly canonicalRoot: string;
  ResolveInputPath(inputPath: string, options?: ResolveInputPathOptions): Promise<string>;
  ToRootRelativePath(absolutePath: string): string;
  AssertWithinRoot(absolutePath: string): void;
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

export function IsPathWithinRoot(candidate: string, canonicalRoot: string): boolean
{
  const relative = path.relative(path.resolve(canonicalRoot), path.resolve(candidate));

  if (relative === "")
  {
    return true;
  }

  if (relative.startsWith("..") || path.isAbsolute(relative))
  {
    return false;
  }

  return true;
}

export function ToRootRelativePathFromCanonical(canonicalRoot: string, absolutePath: string): string
{
  const relative = path.relative(path.resolve(canonicalRoot), path.resolve(absolutePath));

  if (relative === "" || relative === ".")
  {
    return ".";
  }

  if (relative.startsWith("..") || path.isAbsolute(relative))
  {
    throw new PathEscapeError(
      "Path is outside the session root",
      absolutePath,
      "resolved_path_outside_root",
    );
  }

  return relative.split(path.sep).join("/");
}

export async function CreateRootPolicy(rootDirectory: string): Promise<RootPolicy>
{
  const canonicalRoot = await realpath(path.resolve(rootDirectory));

  function AssertWithinRoot(absolutePath: string): void
  {
    const normalized = path.resolve(absolutePath);

    if (!IsPathWithinRoot(normalized, canonicalRoot))
    {
      throw new PathEscapeError(
        "Path is outside the session root",
        normalized,
        "resolved_path_outside_root",
      );
    }
  }

  function ToRootRelativePath(absolutePath: string): string
  {
    const normalized = path.resolve(absolutePath);
    const relative = path.relative(canonicalRoot, normalized);

    if (relative === "" || relative === ".")
    {
      return ".";
    }

    if (relative.startsWith("..") || path.isAbsolute(relative))
    {
      throw new PathEscapeError(
        "Path is outside the session root",
        absolutePath,
        "resolved_path_outside_root",
      );
    }

    return relative.split(path.sep).join("/");
  }

  async function ResolveMissingWithinRoot(candidate: string): Promise<string>
  {
    AssertWithinRoot(candidate);

    let existingAncestor = canonicalRoot;
    let checkPath = candidate;
    const missingSegments: string[] = [];

    while (checkPath !== canonicalRoot && checkPath.length > canonicalRoot.length)
    {
      try
      {
        await access(checkPath);
        existingAncestor = await realpath(checkPath);
        AssertWithinRoot(existingAncestor);
        break;
      }
      catch
      {
        missingSegments.unshift(path.basename(checkPath));
        checkPath = path.dirname(checkPath);
      }
    }

    let resolved = existingAncestor;

    for (const segment of missingSegments)
    {
      resolved = path.join(resolved, segment);
      AssertWithinRoot(resolved);
    }

    return resolved;
  }

  async function ResolveInputPath(
    inputPath: string,
    options?: ResolveInputPathOptions,
  ): Promise<string>
  {
    if (!inputPath || inputPath.includes("\0"))
    {
      throw new PathEscapeError(
        "Path is outside the session root",
        inputPath,
        "invalid_path",
      );
    }

    const trimmed = inputPath.trim();

    if (trimmed.length === 0)
    {
      throw new PathEscapeError(
        "Path is outside the session root",
        inputPath,
        "empty_path",
      );
    }

    if (HasParentTraversal(trimmed))
    {
      throw new PathEscapeError(
        "Path is outside the session root",
        inputPath,
        "parent_traversal",
      );
    }

    const normalizedInput = NormalizeSeparators(trimmed);
    let candidate: string;

    if (path.isAbsolute(normalizedInput))
    {
      candidate = path.resolve(normalizedInput);
    }
    else
    {
      candidate = path.resolve(canonicalRoot, normalizedInput);
    }

    if (!IsPathWithinRoot(candidate, canonicalRoot))
    {
      throw new PathEscapeError(
        "Path is outside the session root",
        inputPath,
        "outside_root",
      );
    }

    if (options?.allowMissing)
    {
      return ResolveMissingWithinRoot(candidate);
    }

    const resolved = await realpath(candidate);
    AssertWithinRoot(resolved);
    return resolved;
  }

  return {
    rootDirectory: canonicalRoot,
    canonicalRoot,
    ResolveInputPath,
    ToRootRelativePath,
    AssertWithinRoot,
  };
}
