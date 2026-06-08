import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";

import { Type } from "typebox";

import { RelativizeDisplayPath } from "../results.js";
import type { ScopedToolContext, ScopedToolDefinition } from "../types.js";
import {
  HandlePathEscape,
  ResolveScopedPath,
  ToolError,
  ToolSuccess,
} from "../toolHelpers.js";

const x_fileInfoSchema = Type.Object({
  path: Type.String({ description: "Relative path to stat under the session root" }),
});

export function CreateFileInfoTool(context: ScopedToolContext): ScopedToolDefinition
{
  return {
    name: "file_info",
    label: "file_info",
    description: "Stat a relative path under the session root and report canonical in-root metadata.",
    parameters: x_fileInfoSchema,
    async execute(_toolCallId, params, signal)
    {
      if (signal?.aborted)
      {
        return ToolError("Operation aborted");
      }

      const pathArg = String(params.path ?? "");

      let absolutePath: string;

      try
      {
        absolutePath = await ResolveScopedPath(context.policy, pathArg);
      }
      catch (error)
      {
        const escapeResult = HandlePathEscape(context, "file_info", error);

        if (escapeResult)
        {
          return escapeResult;
        }

        throw error;
      }

      const displayPath = RelativizeDisplayPath(context.policy, absolutePath);

      try
      {
        await access(absolutePath, constants.F_OK);
      }
      catch
      {
        return ToolError(`Path not found: ${displayPath}`);
      }

      const fileStat = await stat(absolutePath);
      const entryType = fileStat.isDirectory()
        ? "dir"
        : fileStat.isSymbolicLink()
          ? "symlink"
          : fileStat.isFile()
            ? "file"
            : "other";

      const output = [
        `path: ${displayPath}`,
        `type: ${entryType}`,
        `size: ${fileStat.size}`,
        `modifiedAt: ${fileStat.mtime.toISOString()}`,
        `createdAt: ${fileStat.birthtime.toISOString()}`,
      ].join("\n");

      return ToolSuccess(output, {
        path: displayPath,
        type: entryType,
        size: fileStat.size,
        modifiedAt: fileStat.mtime.toISOString(),
        createdAt: fileStat.birthtime.toISOString(),
      });
    },
  };
}
