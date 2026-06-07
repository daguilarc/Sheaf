import type { ToolDefinition } from "realtime-agent-lib";

import { ToVscodePosition0 } from "./positionConversion.js";
import type { ToolServices } from "./toolContext.js";
import type { CodePosition, ModifyFileArgs, ModifyFileResult, ToolError } from "./types.js";
import { IsToolError } from "./types.js";

const x_maxBinaryRejectBytes = 2 * 1024 * 1024;
const x_sniffBytes = 8192;
const x_previewLimit = 160;

const x_inputSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    start: {
      type: "object",
      properties: {
        file: { type: "string" },
        line: { type: "integer" },
        character: { type: "integer" },
      },
      required: ["file", "line", "character"],
      additionalProperties: false,
    },
    end: {
      type: "object",
      properties: {
        file: { type: "string" },
        line: { type: "integer" },
        character: { type: "integer" },
      },
      required: ["file", "line", "character"],
      additionalProperties: false,
    },
    exactText: { type: "string" },
    replacementText: { type: "string" },
    contextBeforeText: { type: "string" },
    contextAfterText: { type: "string" },
  },
  required: ["start", "end", "exactText", "replacementText", "contextBeforeText", "contextAfterText"],
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

function EndAgentMutationDeferred(guard: { end: () => void }): void
{
  setImmediate(() =>
  {
    guard.end();
  });
}

function ParseCodePosition(value: unknown, label: string): CodePosition | ToolError
{
  if (value === null || typeof value !== "object")
  {
    return { code: "invalid_position", message: `\`${label}\` must be an object with file, line, and character.` };
  }

  const record = value as Record<string, unknown>;
  if (typeof record.file !== "string" || record.file.length === 0)
  {
    return { code: "invalid_position", message: `\`${label}.file\` must be a non-empty string.` };
  }

  if (!Number.isInteger(record.line) || (record.line as number) < 1)
  {
    return { code: "invalid_position", message: `\`${label}.line\` must be a positive integer.` };
  }

  if (!Number.isInteger(record.character) || (record.character as number) < 0)
  {
    return { code: "invalid_position", message: `\`${label}.character\` must be a non-negative integer.` };
  }

  return {
    file: record.file,
    line: record.line as number,
    character: record.character as number,
  };
}

function PositionIsBeforeOrEqual(start: CodePosition, end: CodePosition): boolean
{
  if (start.line < end.line)
  {
    return true;
  }

  if (start.line > end.line)
  {
    return false;
  }

  return start.character <= end.character;
}

function BuildMismatchDetails(
  file: string,
  start: CodePosition,
  end: CodePosition,
  mismatchCategory: string,
  expected: string,
  actual: string,
): Record<string, unknown>
{
  const actualPreview = actual.length > x_previewLimit ? actual.slice(0, x_previewLimit) : actual;

  return {
    file,
    start,
    end,
    mismatchCategory,
    expectedLength: expected.length,
    actualLength: actual.length,
    actualPreview,
  };
}

export function CreateModifyFileTool(
  services: ToolServices,
): ToolDefinition<ModifyFileArgs, ModifyFileResult | ToolError>
{
  return {
    name: "modifyFile",
    description:
      "Replace an exact range in a workspace text document after validating target text and three-line surrounding context.",
    inputSchema: x_inputSchema,
    callback: async (rawArgs): Promise<ModifyFileResult | ToolError> =>
    {
      const args = rawArgs as ModifyFileArgs;
      const startParsed = ParseCodePosition(args.start, "start");
      if (IsToolError(startParsed))
      {
        return startParsed;
      }

      const endParsed = ParseCodePosition(args.end, "end");
      if (IsToolError(endParsed))
      {
        return endParsed;
      }

      const start = startParsed;
      const end = endParsed;

      if (
        typeof args.exactText !== "string"
        || typeof args.replacementText !== "string"
        || typeof args.contextBeforeText !== "string"
        || typeof args.contextAfterText !== "string"
      )
      {
        return {
          code: "invalid_position",
          message:
            "`exactText`, `replacementText`, `contextBeforeText`, and `contextAfterText` must be strings.",
        };
      }

      if (start.file !== end.file)
      {
        return {
          code: "file_mismatch",
          message: "`start.file` and `end.file` must refer to the same workspace file.",
          details: { startFile: start.file, endFile: end.file },
        };
      }

      const resolved = services.editorAccess.ResolveWorkspacePathForTools(start.file);
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
        return { code: "binary_file", message: "File is too large to edit as text." };
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

      const start0 = ToVscodePosition0(start.line, start.character);
      const end0 = ToVscodePosition0(end.line, end.character);

      if (!doc.positionIsValid0(start0.line, start0.character) || !doc.positionIsValid0(end0.line, end0.character))
      {
        return {
          code: "invalid_position",
          message: "Start or end position is outside the document buffer.",
          details: { file: doc.relativePosix, start, end },
        };
      }

      if (!PositionIsBeforeOrEqual(start, end))
      {
        return {
          code: "invalid_position",
          message: "Start position must be before or equal to the end position.",
          details: { file: doc.relativePosix, start, end },
        };
      }

      const beforeStartLine0 = Math.max(0, start0.line - 3);
      const afterEndLine0 = Math.min(doc.lineCount - 1, end0.line + 3);

      const targetText = doc.getTextRange0(start0.line, start0.character, end0.line, end0.character);
      const beforeText = doc.getTextRange0(beforeStartLine0, 0, start0.line, start0.character);
      const afterText = doc.getTextRange0(
        end0.line,
        end0.character,
        afterEndLine0,
        doc.lineEndCharacter0(afterEndLine0),
      );

      if (targetText !== args.exactText)
      {
        return {
          code: "expected_text_mismatch",
          message: "Target range text does not match `exactText`.",
          details: BuildMismatchDetails(
            doc.relativePosix,
            start,
            end,
            "target",
            args.exactText,
            targetText,
          ),
        };
      }

      if (beforeText !== args.contextBeforeText)
      {
        return {
          code: "context_before_mismatch",
          message: "Before-context text does not match `contextBeforeText`.",
          details: BuildMismatchDetails(
            doc.relativePosix,
            start,
            end,
            "before",
            args.contextBeforeText,
            beforeText,
          ),
        };
      }

      if (afterText !== args.contextAfterText)
      {
        return {
          code: "context_after_mismatch",
          message: "After-context text does not match `contextAfterText`.",
          details: BuildMismatchDetails(
            doc.relativePosix,
            start,
            end,
            "after",
            args.contextAfterText,
            afterText,
          ),
        };
      }

      const guard = services.freshness.beginAgentMutation();
      try
      {
        const replaceResult = await services.editorAccess.ReplaceTextRange(
          resolved.absPath,
          doc.relativePosix,
          {
            startLine0: start0.line,
            startCharacter0: start0.character,
            endLine0: end0.line,
            endCharacter0: end0.character,
          },
          args.replacementText,
        );

        if (IsToolError(replaceResult))
        {
          return replaceResult;
        }

        services.freshness.markFileObserved(doc.relativePosix);

        const normalizedStart: CodePosition = { file: doc.relativePosix, line: start.line, character: start.character };
        const normalizedEnd: CodePosition = { file: doc.relativePosix, line: end.line, character: end.character };

        return {
          file: doc.relativePosix,
          start: normalizedStart,
          end: normalizedEnd,
          insertedText: args.replacementText,
          replacedText: args.exactText,
        };
      }
      finally
      {
        EndAgentMutationDeferred(guard);
      }
    },
  };
}
