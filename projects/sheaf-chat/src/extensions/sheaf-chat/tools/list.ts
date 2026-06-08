import { constants } from "node:fs";
import { access, lstat, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { Type } from "typebox";

import { RelativizeDisplayPath } from "../results.js";
import type { ScopedToolContext, ScopedToolDefinition } from "../types.js";
import {
  HandlePathEscape,
  ResolveScopedPath,
  ToolError,
  ToolSuccess,
} from "../toolHelpers.js";

const x_listSchema = Type.Object({
  path: Type.Optional(Type.String({ description: "Directory to list (default: session root)" })),
  limit: Type.Optional(Type.Number({ description: "Maximum number of entries to return (default: 500)" })),
});

const x_defaultLimit = 500;

export function CreateListTool(context: ScopedToolContext): ScopedToolDefinition
{
  return {
    name: "list",
    label: "list",
    description:
      "List directory entries under the session root with file type, size, and modified time.",
    parameters: x_listSchema,
    async execute(_toolCallId, params, signal)
    {
      if (signal?.aborted)
      {
        return ToolError("Operation aborted");
      }

      const pathArg = typeof params.path === "string" ? params.path : ".";
      const limit = typeof params.limit === "number" ? params.limit : x_defaultLimit;

      let absolutePath: string;

      try
      {
        absolutePath = await ResolveScopedPath(context.policy, pathArg);
      }
      catch (error)
      {
        const escapeResult = HandlePathEscape(context, "list", error);

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

      const entries = await readdir(absolutePath, { withFileTypes: true });
      entries.sort((left, right) => left.name.localeCompare(right.name));

      const lines: string[] = [];
      let count = 0;

      for (const entry of entries)
      {
        if (count >= limit)
        {
          break;
        }

        const entryAbsolute = path.join(absolutePath, entry.name);
        context.policy.AssertWithinRoot(entryAbsolute);
        const entryRelative = RelativizeDisplayPath(context.policy, entryAbsolute);
        const entryStat = await lstat(entryAbsolute);
        const entryType = entryStat.isDirectory() ? "dir" : entryStat.isSymbolicLink() ? "symlink" : "file";
        const modifiedAt = entryStat.mtime.toISOString();
        lines.push(`${entryRelative}\t${entryType}\t${entryStat.size}\t${modifiedAt}`);
        count += 1;
      }

      let output = `${displayPath}\n${lines.join("\n")}`;

      if (entries.length > limit)
      {
        output += `\n\n[Truncated: showing ${limit} of ${entries.length} entries.]`;
      }

      return ToolSuccess(output, {
        path: displayPath,
        entryCount: count,
        truncated: entries.length > limit,
      });
    },
  };
}
