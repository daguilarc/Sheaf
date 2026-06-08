import { constants } from "node:fs";
import { access, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { Type } from "typebox";

import { MatchesAnyGlob, MatchesGlob } from "../glob.js";
import { RelativizeDisplayPath } from "../results.js";
import type { ScopedToolContext, ScopedToolDefinition } from "../types.js";
import {
  HandlePathEscape,
  ResolveScopedPath,
  ToolError,
  ToolSuccess,
  x_treeDefaultIgnores,
} from "../toolHelpers.js";

const x_findFilesSchema = Type.Object({
  glob: Type.Optional(Type.String({ description: "Glob pattern to match files, e.g. '*.ts' or '**/*.json'" })),
  extension: Type.Optional(Type.String({ description: "File extension without dot, e.g. 'ts'" })),
  pathSegment: Type.Optional(Type.String({ description: "Require this path segment in the relative path" })),
  include: Type.Optional(Type.Array(Type.String(), { description: "Include globs" })),
  exclude: Type.Optional(Type.Array(Type.String(), { description: "Exclude globs" })),
  path: Type.Optional(Type.String({ description: "Directory to search (default: session root)" })),
  maxDepth: Type.Optional(Type.Number({ description: "Maximum search depth (default: unlimited)" })),
  limit: Type.Optional(Type.Number({ description: "Maximum number of results (default: 1000)" })),
});

const x_defaultLimit = 1000;

interface FindFilesOptions
{
  glob?: string;
  extension?: string;
  pathSegment?: string;
  include?: string[];
  exclude?: string[];
  maxDepth?: number;
  limit: number;
}

function ShouldSkipDirectory(name: string): boolean
{
  return x_treeDefaultIgnores.includes(name);
}

function MatchesFindFilters(relativePath: string, options: FindFilesOptions): boolean
{
  if (options.include && options.include.length > 0)
  {
    if (!MatchesAnyGlob(relativePath, options.include))
    {
      return false;
    }
  }

  if (options.exclude && options.exclude.length > 0)
  {
    if (MatchesAnyGlob(relativePath, options.exclude))
    {
      return false;
    }
  }

  if (options.glob && !MatchesGlob(relativePath, options.glob))
  {
    return false;
  }

  if (options.extension)
  {
    const expected = options.extension.startsWith(".") ? options.extension : `.${options.extension}`;

    if (!relativePath.endsWith(expected))
    {
      return false;
    }
  }

  if (options.pathSegment)
  {
    const segments = relativePath.split("/");

    if (!segments.includes(options.pathSegment))
    {
      return false;
    }
  }

  return true;
}

async function WalkFind(
  policy: ScopedToolContext["policy"],
  absoluteDirectory: string,
  depth: number,
  options: FindFilesOptions,
  results: string[],
): Promise<void>
{
  if (results.length >= options.limit)
  {
    return;
  }

  if (options.maxDepth !== undefined && depth > options.maxDepth)
  {
    return;
  }

  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries)
  {
    if (results.length >= options.limit)
    {
      return;
    }

    const entryAbsolute = path.join(absoluteDirectory, entry.name);
    policy.AssertWithinRoot(entryAbsolute);
    const entryRelative = RelativizeDisplayPath(policy, entryAbsolute);
    const entryStat = await stat(entryAbsolute);

    if (entryStat.isFile() && MatchesFindFilters(entryRelative, options))
    {
      results.push(entryRelative);
    }

    if (entryStat.isDirectory() && !ShouldSkipDirectory(entry.name))
    {
      await WalkFind(policy, entryAbsolute, depth + 1, options, results);
    }
  }
}

export function CreateFindFilesTool(context: ScopedToolContext): ScopedToolDefinition
{
  return {
    name: "find_files",
    label: "find_files",
    description:
      "Discover files under the session root by glob, extension, path segment, include/exclude globs, max depth, and limit.",
    parameters: x_findFilesSchema,
    async execute(_toolCallId, params, signal)
    {
      if (signal?.aborted)
      {
        return ToolError("Operation aborted");
      }

      const pathArg = typeof params.path === "string" ? params.path : ".";
      const options: FindFilesOptions = {
        glob: typeof params.glob === "string" ? params.glob : undefined,
        extension: typeof params.extension === "string" ? params.extension : undefined,
        pathSegment: typeof params.pathSegment === "string" ? params.pathSegment : undefined,
        include: Array.isArray(params.include) ? params.include.map(String) : undefined,
        exclude: Array.isArray(params.exclude) ? params.exclude.map(String) : undefined,
        maxDepth: typeof params.maxDepth === "number" ? params.maxDepth : undefined,
        limit: typeof params.limit === "number" ? params.limit : x_defaultLimit,
      };

      let absolutePath: string;

      try
      {
        absolutePath = await ResolveScopedPath(context.policy, pathArg);
      }
      catch (error)
      {
        const escapeResult = HandlePathEscape(context, "find_files", error);

        if (escapeResult)
        {
          return escapeResult;
        }

        throw error;
      }

      const displayPath = RelativizeDisplayPath(context.policy, absolutePath);

      try
      {
        await access(absolutePath, constants.R_OK);
      }
      catch
      {
        return ToolError(`Path not found: ${displayPath}`);
      }

      const directoryStat = await stat(absolutePath);

      if (!directoryStat.isDirectory())
      {
        return ToolError(`Not a directory: ${displayPath}`);
      }

      const results: string[] = [];
      await WalkFind(context.policy, absolutePath, 0, options, results);

      let output = results.join("\n");

      if (results.length >= options.limit)
      {
        output += `\n\n[Truncated: reached limit=${options.limit}.]`;
      }

      return ToolSuccess(output || "(no matches)", {
        path: displayPath,
        matchCount: results.length,
        truncated: results.length >= options.limit,
      });
    },
  };
}
