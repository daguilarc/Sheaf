import type { ToolDefinition } from "realtime-agent-lib";

import { FromVscodePosition0 } from "./positionConversion.js";
import type { ToolServices } from "./toolContext.js";
import type { ReadVisibleRangeArgs, ReadVisibleRangeResult, ToolError } from "./types.js";
import { BuildWindowAroundLine1 } from "./visibleWindow.js";

const x_inputSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    linesAbove: { type: "integer" },
    linesBelow: { type: "integer" },
  },
  required: ["linesAbove", "linesBelow"],
  additionalProperties: false,
};

export function CreateReadVisibleRangeTool(
  services: ToolServices,
): ToolDefinition<ReadVisibleRangeArgs, ReadVisibleRangeResult | ToolError>
{
  return {
    name: "read_visible_range",
    description: "Read lines around the cursor in the active editor (unsaved buffer included).",
    inputSchema: x_inputSchema,
    callback: (rawArgs): ReadVisibleRangeResult | ToolError =>
    {
      const args = rawArgs as ReadVisibleRangeArgs;
      if (!Number.isInteger(args.linesAbove) || args.linesAbove < 0 || !Number.isInteger(args.linesBelow) || args.linesBelow < 0)
      {
        return { code: "invalid_range", message: "`linesAbove` and `linesBelow` must be non-negative integers." };
      }

      const editor = services.editorAccess.GetActiveEditor();
      if (editor === undefined)
      {
        return { code: "no_active_editor", message: "No active text editor." };
      }

      const cursor0 = editor.getActivePosition0();
      const cursor1 = FromVscodePosition0(cursor0.line, cursor0.character);
      const rel = editor.document.relativePosix;
      services.freshness.markFileObserved(rel);
      services.freshness.markViewportObserved(rel);
      services.freshness.markCursorObserved(rel);

      const visible = BuildWindowAroundLine1(
        editor.document,
        cursor1.line,
        cursor1.character,
        args.linesAbove,
        args.linesBelow,
      );

      return {
        ...visible,
        requestedLinesAbove: args.linesAbove,
        requestedLinesBelow: args.linesBelow,
      };
    },
  };
}
