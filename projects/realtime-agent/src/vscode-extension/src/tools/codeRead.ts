import type { ToolDefinition } from "realtime-agent-lib";

import type { ToolServices } from "./toolContext.js";
import type { CodeLine, CodeReadArgs, CodeReadResult, ToolError } from "./types.js";
import { IsToolError } from "./types.js";

const x_maxBinaryRejectBytes = 2 * 1024 * 1024;
const x_sniffBytes = 8192;

const x_inputSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    file: { type: "string" },
    startLine: { type: "integer" },
    endLine: { type: "integer" },
  },
  required: ["file"],
  additionalProperties: false,
};

function HasNulByte(text: string): boolean
{
  for (let i = 0; i < text.length; i++)
  {
    if (text.charCodeAt(i) === 0)
    {
      return true;
    }
  }

  return false;
}

export function CreateCodeReadTool(services: ToolServices): ToolDefinition<CodeReadArgs, CodeReadResult | ToolError>
{
  return {
    name: "code_read",
    description: "Read workspace file contents (full file or inclusive line range).",
    inputSchema: x_inputSchema,
    callback: async (rawArgs): Promise<CodeReadResult | ToolError> =>
    {
      const args = rawArgs as CodeReadArgs;
      if (typeof args.file !== "string")
      {
        return { code: "invalid_range", message: "Argument `file` must be a string." };
      }

      const resolved = services.editorAccess.ResolveWorkspacePathForTools(args.file);
      if ("code" in resolved)
      {
        return resolved;
      }

      const stat = await services.editorAccess.Stat(resolved.absPath);
      if (stat === undefined)
      {
        return { code: "file_not_found", message: "File not found." };
      }

      if (stat.kind === "directory")
      {
        return { code: "path_is_directory", message: "Path is a directory." };
      }

      if (stat.size > x_maxBinaryRejectBytes)
      {
        return { code: "binary_file", message: "File is too large to read as text." };
      }

      const doc = await services.editorAccess.OpenTextDocument(resolved.absPath, resolved.relativePosix);
      if (IsToolError(doc))
      {
        return doc;
      }

      if (doc.languageId === "binary")
      {
        return { code: "binary_file", message: "Document is binary." };
      }

      const head = doc.getText().slice(0, x_sniffBytes);
      if (HasNulByte(head))
      {
        return { code: "binary_file", message: "File contains NUL bytes in the first 8 KiB." };
      }

      const lineCount = doc.lineCount;
      const fullText = doc.getText();
      // VS Code reports empty text documents as `lineCount: 1` with a single empty
      // line. Treat any document whose full text is empty as the spec's degenerate
      // empty-file case so callers see a consistent shape.
      //
      if (lineCount === 0 || fullText.length === 0)
      {
        services.freshness.markFileObserved(doc.relativePosix);
        return {
          file: doc.relativePosix,
          lineCount: 0,
          startLine: 0,
          endLine: 0,
          lines: [],
        };
      }

      const hasStart = args.startLine !== undefined;
      const hasEnd = args.endLine !== undefined;
      let startLine = args.startLine;
      let endLine = args.endLine;

      if (!hasStart && !hasEnd)
      {
        startLine = 1;
        endLine = lineCount;
      }
      else if (hasStart && !hasEnd)
      {
        endLine = lineCount;
      }
      else if (!hasStart && hasEnd)
      {
        startLine = 1;
      }

      if (
        startLine === undefined ||
        endLine === undefined ||
        !Number.isInteger(startLine) ||
        !Number.isInteger(endLine)
      )
      {
        return { code: "invalid_range", message: "startLine and endLine must be integers when provided." };
      }

      if (startLine < 1 || endLine < 1 || startLine > endLine || endLine > lineCount)
      {
        return {
          code: "invalid_range",
          message: `Range must satisfy 1 <= startLine <= endLine <= ${lineCount}.`,
          details: { startLine, endLine, lineCount },
        };
      }

      const lines: CodeLine[] = [];
      for (let line1 = startLine; line1 <= endLine; line1++)
      {
        lines.push({ line: line1, text: doc.lineTextAt0(line1 - 1) });
      }

      services.freshness.markFileObserved(doc.relativePosix);

      return {
        file: doc.relativePosix,
        lineCount,
        startLine,
        endLine,
        lines,
      };
    },
  };
}
