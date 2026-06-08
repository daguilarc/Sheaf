import { mkdir, writeFile } from "node:fs/promises";
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

const x_writeSchema = Type.Object({
  path: Type.String({ description: "Path to the file to write (relative or absolute)" }),
  content: Type.String({ description: "Content to write to the file" }),
});

export function CreateWriteTool(context: ScopedToolContext): ScopedToolDefinition
{
  return {
    name: "write",
    label: "write",
    description:
      "Write content to a file under the session root. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
    parameters: x_writeSchema,
    async execute(_toolCallId, params, signal)
    {
      const pathArg = String(params.path ?? "");
      const content = String(params.content ?? "");

      if (signal?.aborted)
      {
        return ToolError("Operation aborted");
      }

      let absolutePath: string;

      try
      {
        absolutePath = await ResolveScopedPath(context.policy, pathArg, { allowMissing: true });
      }
      catch (error)
      {
        const escapeResult = HandlePathEscape(context, "write", error);

        if (escapeResult)
        {
          return escapeResult;
        }

        throw error;
      }

      const displayPath = RelativizeDisplayPath(context.policy, absolutePath);

      try
      {
        await mkdir(path.dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, content, "utf-8");
      }
      catch (error)
      {
        const escapeResult = HandlePathEscape(context, "write", error);

        if (escapeResult)
        {
          return escapeResult;
        }

        return ToolError(`Could not write file: ${displayPath}.`);
      }

      return ToolSuccess(
        `Successfully wrote ${content.length} bytes to ${displayPath}`,
        { path: displayPath, bytes: content.length },
      );
    },
  };
}
