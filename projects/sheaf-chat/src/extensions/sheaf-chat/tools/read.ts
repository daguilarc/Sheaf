import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";

import { Type } from "typebox";

import { RelativizeDisplayPath } from "../results.js";
import type { ScopedToolContext, ScopedToolDefinition } from "../types.js";
import {
  FormatNumberedLines,
  HandlePathEscape,
  ResolveScopedPath,
  ToolError,
  ToolSuccess,
  TruncateTextHead,
} from "../toolHelpers.js";

const x_readSchema = Type.Object({
  path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
  offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed)" })),
  limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
});

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

export function CreateReadTool(context: ScopedToolContext): ScopedToolDefinition
{
  return {
    name: "read",
    label: "read",
    description:
      "Read the contents of a UTF-8 text file under the session root. Output is line-numbered and truncated to 2000 lines or 50KB. Use offset/limit for large files.",
    parameters: x_readSchema,
    async execute(_toolCallId, params, signal)
    {
      const pathArg = String(params.path ?? "");
      const offset = typeof params.offset === "number" ? params.offset : undefined;
      const limit = typeof params.limit === "number" ? params.limit : undefined;

      if (signal?.aborted)
      {
        return ToolError("Operation aborted");
      }

      let absolutePath: string;

      try
      {
        absolutePath = await ResolveScopedPath(context.policy, pathArg);
      }
      catch (error)
      {
        const escapeResult = HandlePathEscape(context, "read", error);

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
        return ToolError(`Could not read file: ${displayPath}`);
      }

      const buffer = await readFile(absolutePath);

      if (IsBinaryBuffer(buffer))
      {
        return ToolError(`File is not UTF-8 text: ${displayPath}`);
      }

      const textContent = buffer.toString("utf-8");
      const allLines = textContent.split("\n");
      const startLine = offset ? Math.max(0, offset - 1) : 0;

      if (startLine >= allLines.length)
      {
        return ToolError(
          `Offset ${offset} is beyond end of file (${allLines.length} lines total)`,
        );
      }

      let selectedLines: string[];

      if (limit !== undefined)
      {
        const endLine = Math.min(startLine + limit, allLines.length);
        selectedLines = allLines.slice(startLine, endLine);
      }
      else
      {
        selectedLines = allLines.slice(startLine);
      }

      const joined = selectedLines.join("\n");
      const truncation = TruncateTextHead(joined);
      const numbered = FormatNumberedLines(
        truncation.content.split("\n"),
        startLine + 1,
      );

      let output = `${displayPath}\n${numbered}`;

      if (truncation.truncated)
      {
        const nextOffset = startLine + truncation.outputLines + 1;
        output += `\n\n[Showing lines ${startLine + 1}-${startLine + truncation.outputLines} of ${allLines.length}. Use offset=${nextOffset} to continue.]`;
      }
      else if (limit !== undefined && startLine + selectedLines.length < allLines.length)
      {
        const nextOffset = startLine + selectedLines.length + 1;
        const remaining = allLines.length - (startLine + selectedLines.length);
        output += `\n\n[${remaining} more lines in file. Use offset=${nextOffset} to continue.]`;
      }

      return ToolSuccess(output, {
        path: displayPath,
        totalLines: allLines.length,
        truncated: truncation.truncated,
      });
    },
  };
}
