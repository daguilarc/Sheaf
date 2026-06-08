import { constants } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";

import { Type } from "typebox";

import {
  ApplyEditsToNormalizedContent,
  DetectLineEnding,
  NormalizeToLf,
  RestoreLineEndings,
  StripBom,
  type EditReplacement,
} from "../editDiff.js";
import { RelativizeDisplayPath } from "../results.js";
import type { ScopedToolContext, ScopedToolDefinition } from "../types.js";
import {
  HandlePathEscape,
  ResolveScopedPath,
  ToolError,
  ToolSuccess,
} from "../toolHelpers.js";

const x_replaceEditSchema = Type.Object({
  oldText: Type.String({
    description:
      "Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call.",
  }),
  newText: Type.String({ description: "Replacement text for this targeted edit." }),
}, { additionalProperties: false });

const x_editSchema = Type.Object({
  path: Type.String({ description: "Path to the file to edit (relative or absolute)" }),
  edits: Type.Array(x_replaceEditSchema, {
    description:
      "One or more targeted replacements. Each edit is matched against the original file, not incrementally.",
  }),
}, { additionalProperties: false });

function PrepareEditArguments(input: Record<string, unknown>): Record<string, unknown>
{
  if (typeof input.edits === "string")
  {
    try
    {
      const parsed = JSON.parse(input.edits);

      if (Array.isArray(parsed))
      {
        input.edits = parsed;
      }
    }
    catch
    {
    }
  }

  if (
    typeof input.oldText === "string" &&
    typeof input.newText === "string"
  )
  {
    const edits = Array.isArray(input.edits) ? [...input.edits] : [];
    edits.push({ oldText: input.oldText, newText: input.newText });
    const { oldText: _oldText, newText: _newText, ...rest } = input;
    return { ...rest, edits };
  }

  return input;
}

function ValidateEditInput(input: Record<string, unknown>): { path: string; edits: EditReplacement[] }
{
  if (!Array.isArray(input.edits) || input.edits.length === 0)
  {
    throw new Error("Edit tool input is invalid. edits must contain at least one replacement.");
  }

  const edits: EditReplacement[] = [];

  for (const entry of input.edits)
  {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as EditReplacement).oldText !== "string" ||
      typeof (entry as EditReplacement).newText !== "string"
    )
    {
      throw new Error("Edit tool input is invalid. Each edit must include oldText and newText.");
    }

    edits.push({
      oldText: (entry as EditReplacement).oldText,
      newText: (entry as EditReplacement).newText,
    });
  }

  return { path: String(input.path ?? ""), edits };
}

export function CreateEditTool(context: ScopedToolContext): ScopedToolDefinition
{
  return {
    name: "edit",
    label: "edit",
    description:
      "Edit a single file under the session root using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file.",
    parameters: x_editSchema,
    async execute(_toolCallId, params, signal)
    {
      if (signal?.aborted)
      {
        return ToolError("Operation aborted");
      }

      let validated: { path: string; edits: EditReplacement[] };

      try
      {
        validated = ValidateEditInput(PrepareEditArguments(params));
      }
      catch (error)
      {
        return ToolError(error instanceof Error ? error.message : String(error));
      }

      let absolutePath: string;

      try
      {
        absolutePath = await ResolveScopedPath(context.policy, validated.path);
      }
      catch (error)
      {
        const escapeResult = HandlePathEscape(context, "edit", error);

        if (escapeResult)
        {
          return escapeResult;
        }

        throw error;
      }

      const displayPath = RelativizeDisplayPath(context.policy, absolutePath);

      try
      {
        await access(absolutePath, constants.R_OK | constants.W_OK);
      }
      catch (error)
      {
        const errorMessage =
          error instanceof Error && "code" in error
            ? `Error code: ${String((error as NodeJS.ErrnoException).code)}`
            : String(error);
        return ToolError(`Could not edit file: ${displayPath}. ${errorMessage}.`);
      }

      try
      {
        const buffer = await readFile(absolutePath);
        const rawContent = buffer.toString("utf-8");
        const { bom, text: content } = StripBom(rawContent);
        const originalEnding = DetectLineEnding(content);
        const normalizedContent = NormalizeToLf(content);
        const { newContent } = ApplyEditsToNormalizedContent(
          normalizedContent,
          validated.edits,
          displayPath,
        );
        const finalContent = bom + RestoreLineEndings(newContent, originalEnding);
        await writeFile(absolutePath, finalContent, "utf-8");

        return ToolSuccess(
          `Successfully replaced ${validated.edits.length} block(s) in ${displayPath}.`,
          { path: displayPath, edits: validated.edits.length },
        );
      }
      catch (error)
      {
        return ToolError(error instanceof Error ? error.message : String(error));
      }
    },
  };
}
