import { constants } from "node:fs";
import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { Type } from "typebox";

import { MatchesAnyGlob } from "../glob.js";
import { RelativizeDisplayPath } from "../results.js";
import type { ScopedToolContext, ScopedToolDefinition } from "../types.js";
import {
  HandlePathEscape,
  ResolveScopedPath,
  ToolError,
  ToolSuccess,
  x_treeDefaultIgnores,
} from "../toolHelpers.js";

const x_searchTextSchema = Type.Object({
  pattern: Type.String({ description: "Search pattern (regex or literal string)" }),
  path: Type.Optional(Type.String({ description: "Directory or file to search (default: session root)" })),
  include: Type.Optional(Type.Array(Type.String(), { description: "Include globs" })),
  exclude: Type.Optional(Type.Array(Type.String(), { description: "Exclude globs" })),
  ignoreCase: Type.Optional(Type.Boolean({ description: "Case-insensitive search (default: false)" })),
  literal: Type.Optional(Type.Boolean({ description: "Treat pattern as literal string (default: false)" })),
  context: Type.Optional(Type.Number({ description: "Context lines before and after each match (default: 0)" })),
  limit: Type.Optional(Type.Number({ description: "Maximum number of matches (default: 100)" })),
});

const x_defaultLimit = 100;
const x_maxLineLength = 2000;

interface SearchTextOptions
{
  pattern: string;
  include?: string[];
  exclude?: string[];
  ignoreCase: boolean;
  literal: boolean;
  context: number;
  limit: number;
}

interface SearchMatch
{
  file: string;
  lineNumber: number;
  line: string;
}

function IsBinaryBuffer(buffer: Buffer): boolean
{
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));

  for (const byte of sample)
  {
    if (byte === 0)
    {
      return true;
    }
  }

  return false;
}

function BuildSearchRegex(options: SearchTextOptions): RegExp
{
  const source = options.literal ? options.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : options.pattern;
  const flags = options.ignoreCase ? "gi" : "g";
  return new RegExp(source, flags);
}

function ShouldSkipDirectory(name: string): boolean
{
  return x_treeDefaultIgnores.includes(name);
}

function MatchesSearchFilters(relativePath: string, options: SearchTextOptions): boolean
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

  return true;
}

function SearchFileContent(
  displayPath: string,
  content: string,
  regex: RegExp,
  options: SearchTextOptions,
  matches: SearchMatch[],
): void
{
  const lines = content.split("\n");

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++)
  {
    if (matches.length >= options.limit)
    {
      return;
    }

    const line = lines[lineIndex];
    regex.lastIndex = 0;

    if (!regex.test(line))
    {
      continue;
    }

    const contextBefore = Math.max(0, lineIndex - options.context);
    const contextAfter = Math.min(lines.length - 1, lineIndex + options.context);

    for (let contextIndex = contextBefore; contextIndex <= contextAfter; contextIndex++)
    {
      if (matches.length >= options.limit)
      {
        return;
      }

      let contextLine = lines[contextIndex];

      if (contextLine.length > x_maxLineLength)
      {
        contextLine = `${contextLine.slice(0, x_maxLineLength)}...`;
      }

      matches.push({
        file: displayPath,
        lineNumber: contextIndex + 1,
        line: contextLine,
      });
    }
  }
}

async function WalkSearch(
  policy: ScopedToolContext["policy"],
  absolutePath: string,
  options: SearchTextOptions,
  regex: RegExp,
  matches: SearchMatch[],
): Promise<void>
{
  if (matches.length >= options.limit)
  {
    return;
  }

  const entryStat = await stat(absolutePath);

  if (entryStat.isFile())
  {
    const displayPath = RelativizeDisplayPath(policy, absolutePath);

    if (!MatchesSearchFilters(displayPath, options))
    {
      return;
    }

    const buffer = await readFile(absolutePath);

    if (IsBinaryBuffer(buffer))
    {
      return;
    }

    SearchFileContent(displayPath, buffer.toString("utf-8"), regex, options, matches);
    return;
  }

  if (!entryStat.isDirectory())
  {
    return;
  }

  const entries = await readdir(absolutePath, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries)
  {
    if (matches.length >= options.limit)
    {
      return;
    }

    const entryAbsolute = path.join(absolutePath, entry.name);
    policy.AssertWithinRoot(entryAbsolute);

    if (entry.isDirectory())
    {
      if (!ShouldSkipDirectory(entry.name))
      {
        await WalkSearch(policy, entryAbsolute, options, regex, matches);
      }
      continue;
    }

    await WalkSearch(policy, entryAbsolute, options, regex, matches);
  }
}

export function CreateSearchTextTool(context: ScopedToolContext): ScopedToolDefinition
{
  return {
    name: "search_text",
    label: "search_text",
    description:
      "Search UTF-8 text files under the session root with literal or regex mode, case sensitivity, include/exclude globs, context lines, binary skipping, and match limits.",
    parameters: x_searchTextSchema,
    async execute(_toolCallId, params, signal)
    {
      if (signal?.aborted)
      {
        return ToolError("Operation aborted");
      }

      const pathArg = typeof params.path === "string" ? params.path : ".";
      const options: SearchTextOptions = {
        pattern: String(params.pattern ?? ""),
        include: Array.isArray(params.include) ? params.include.map(String) : undefined,
        exclude: Array.isArray(params.exclude) ? params.exclude.map(String) : undefined,
        ignoreCase: params.ignoreCase === true,
        literal: params.literal === true,
        context: typeof params.context === "number" ? Math.max(0, params.context) : 0,
        limit: typeof params.limit === "number" ? params.limit : x_defaultLimit,
      };

      if (options.pattern.length === 0)
      {
        return ToolError("pattern must not be empty");
      }

      let regex: RegExp;

      try
      {
        regex = BuildSearchRegex(options);
      }
      catch (error)
      {
        return ToolError(
          `Invalid search pattern: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      let absolutePath: string;

      try
      {
        absolutePath = await ResolveScopedPath(context.policy, pathArg);
      }
      catch (error)
      {
        const escapeResult = HandlePathEscape(context, "search_text", error);

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

      const matches: SearchMatch[] = [];
      await WalkSearch(context.policy, absolutePath, options, regex, matches);

      const output = matches
        .map((match) => `${match.file}:${match.lineNumber}:${match.line}`)
        .join("\n");

      let text = output || "(no matches)";

      if (matches.length >= options.limit)
      {
        text += `\n\n[Truncated: reached limit=${options.limit}.]`;
      }

      return ToolSuccess(text, {
        path: displayPath,
        matchCount: matches.length,
        truncated: matches.length >= options.limit,
      });
    },
  };
}
