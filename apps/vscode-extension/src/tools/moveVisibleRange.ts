import type { ToolDefinition } from "realtime-agent-lib";

import type { ActiveEditorHandle, CursorRevealKind } from "./editorAccessTypes.js";
import type { ToolServices } from "./toolContext.js";
import type { MoveVisibleRangeArgs, MoveVisibleRangeResult, ToolError, VisibleRangeRequest } from "./types.js";
import { IsToolError } from "./types.js";
import { BuildLinesForInclusiveLineRange1, BuildWindowAroundLine1 } from "./visibleWindow.js";

const x_inputSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    target: {
      oneOf: [
        {
          type: "object",
          properties: {
            mode: { const: "absolute" },
            file: { type: "string" },
            line: { type: "integer" },
            align: { enum: ["top", "center", "bottom"] },
          },
          required: ["mode", "file", "line"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            mode: { const: "relative" },
            lineDelta: { type: "integer" },
          },
          required: ["mode", "lineDelta"],
          additionalProperties: false,
        },
      ],
    },
    returnVisibleRange: {
      type: "object",
      properties: {
        linesAbove: { type: "integer" },
        linesBelow: { type: "integer" },
      },
      required: ["linesAbove", "linesBelow"],
      additionalProperties: false,
    },
  },
  required: ["target"],
  additionalProperties: false,
};

function MapViewportAlign(align: string | undefined): CursorRevealKind
{
  if (align === "top")
  {
    return "top";
  }

  if (align === "bottom")
  {
    return "bottom";
  }

  return "center";
}

function ParseReturnVisible(req: unknown): VisibleRangeRequest | ToolError
{
  const r = req as VisibleRangeRequest;
  if (
    r === null ||
    typeof r !== "object" ||
    !Number.isInteger(r.linesAbove) ||
    r.linesAbove < 0 ||
    !Number.isInteger(r.linesBelow) ||
    r.linesBelow < 0
  )
  {
    return { code: "invalid_range", message: "`returnVisibleRange` requires non-negative integer line counts." };
  }

  return r;
}

function RecordFreshnessAfterMoveVisibleRange(
  services: ToolServices,
  relativePosix: string,
  returnReq: VisibleRangeRequest | undefined,
  result: MoveVisibleRangeResult,
): void
{
  services.freshness.markViewportObserved(relativePosix);
  if (returnReq === undefined || result.visibleRange === undefined)
  {
    return;
  }

  if (result.visibleRange.lines.length > 0)
  {
    services.freshness.markFileObserved(relativePosix);
  }

  const c = result.cursor.line;
  const v = result.visibleRange;
  if (c >= v.visibleStartLine && c <= v.visibleEndLine)
  {
    services.freshness.markCursorObserved(relativePosix);
  }
}

function EndAgentMutationDeferred(guard: { end: () => void }): void
{
  setImmediate(() =>
  {
    guard.end();
  });
}

function BuildMoveResult(
  editor: ActiveEditorHandle,
  returnReq: VisibleRangeRequest | undefined,
  viewportFirst0: number,
  viewportLast0: number,
  cursorLine0: number,
  cursorChar0: number,
): MoveVisibleRangeResult
{
  const doc = editor.document;
  const cursorLine1 = cursorLine0 + 1;
  const result: MoveVisibleRangeResult = {
    cursor: { file: doc.relativePosix, line: cursorLine1, character: cursorChar0 },
  };

  if (returnReq === undefined)
  {
    return result;
  }

  const vFirst1 = viewportFirst0 + 1;
  const vLast1 = viewportLast0 + 1;
  const cursorInside = cursorLine1 >= vFirst1 && cursorLine1 <= vLast1;
  if (cursorInside)
  {
    result.visibleRange = BuildWindowAroundLine1(doc, cursorLine1, cursorChar0, returnReq.linesAbove, returnReq.linesBelow);
  }
  else
  {
    result.visibleRange = BuildLinesForInclusiveLineRange1(doc, vFirst1, vLast1, cursorLine1, cursorChar0);
  }

  return result;
}

export function CreateMoveVisibleRangeTool(
  services: ToolServices,
): ToolDefinition<MoveVisibleRangeArgs, MoveVisibleRangeResult | ToolError>
{
  return {
    name: "move_visible_range",
    description: "Scroll the viewport without moving the cursor (absolute line or relative line delta).",
    inputSchema: x_inputSchema,
    callback: async (rawArgs): Promise<MoveVisibleRangeResult | ToolError> =>
    {
      const args = rawArgs as MoveVisibleRangeArgs;
      let returnReq: VisibleRangeRequest | undefined;
      if (args.returnVisibleRange !== undefined)
      {
        const parsed = ParseReturnVisible(args.returnVisibleRange);
        if (IsToolError(parsed))
        {
          return parsed;
        }

        returnReq = parsed;
      }

      if (args.target.mode === "absolute")
      {
        if (!Number.isInteger(args.target.line))
        {
          return { code: "invalid_range", message: "`line` must be an integer." };
        }

        const resolved = services.editorAccess.ResolveWorkspacePathForTools(args.target.file);
        if ("code" in resolved)
        {
          return resolved;
        }

        const guard = services.freshness.beginAgentMutation();
        try
        {
          const editor = await services.editorAccess.OpenEditorAndFocus(resolved.absPath, resolved.relativePosix, false);
          if (IsToolError(editor))
          {
            return editor;
          }

          const doc = editor.document;
          const lineCount = doc.lineCount;
          if (lineCount === 0)
          {
            const cur0 = editor.getActivePosition0();
            const result: MoveVisibleRangeResult = {
              cursor: {
                file: doc.relativePosix,
                line: cur0.line + 1,
                character: cur0.character,
              },
            };
            if (returnReq !== undefined)
            {
              result.visibleRange = BuildWindowAroundLine1(doc, 0, cur0.character, returnReq.linesAbove, returnReq.linesBelow);
            }

            RecordFreshnessAfterMoveVisibleRange(services, doc.relativePosix, returnReq, result);
            return result;
          }

          const line1 = Math.min(Math.max(1, args.target.line), lineCount);
          const line0 = line1 - 1;
          const reveal = MapViewportAlign(args.target.align);
          editor.revealLinePreservingSelection(line0, reveal);

          const cur0 = editor.getActivePosition0();
          const vp = editor.getViewportInclusive0();
          const result = BuildMoveResult(editor, returnReq, vp.firstLine0, vp.lastLine0, cur0.line, cur0.character);
          RecordFreshnessAfterMoveVisibleRange(services, doc.relativePosix, returnReq, result);
          return result;
        }
        finally
        {
          EndAgentMutationDeferred(guard);
        }
      }

      const editor = services.editorAccess.GetActiveEditor();
      if (editor === undefined)
      {
        return { code: "no_active_editor", message: "No active text editor for relative viewport move." };
      }

      if (!Number.isInteger(args.target.lineDelta))
      {
        return { code: "invalid_range", message: "`lineDelta` must be an integer." };
      }

      const guard = services.freshness.beginAgentMutation();
      try
      {
        const doc = editor.document;
        const lineCount = doc.lineCount;
        if (lineCount === 0)
        {
          const cur0 = editor.getActivePosition0();
          const result: MoveVisibleRangeResult = {
            cursor: { file: doc.relativePosix, line: cur0.line + 1, character: cur0.character },
          };
          if (returnReq !== undefined)
          {
            result.visibleRange = BuildWindowAroundLine1(doc, 0, cur0.character, returnReq.linesAbove, returnReq.linesBelow);
          }

          RecordFreshnessAfterMoveVisibleRange(services, doc.relativePosix, returnReq, result);
          return result;
        }

        const vpBefore = editor.getViewportInclusive0();
        const newTop0 = Math.min(
          Math.max(0, vpBefore.firstLine0 + args.target.lineDelta),
          Math.max(0, lineCount - 1),
        );
        editor.revealLinePreservingSelection(newTop0, "top");

        const cur0 = editor.getActivePosition0();
        const vpAfter = editor.getViewportInclusive0();
        const result = BuildMoveResult(editor, returnReq, vpAfter.firstLine0, vpAfter.lastLine0, cur0.line, cur0.character);
        RecordFreshnessAfterMoveVisibleRange(services, doc.relativePosix, returnReq, result);
        return result;
      }
      finally
      {
        EndAgentMutationDeferred(guard);
      }
    },
  };
}
