import type { ToolDefinition } from "realtime-agent-lib";

import type { CursorRevealKind } from "./editorAccessTypes.js";
import { FromVscodePosition0 } from "./positionConversion.js";
import type { ToolServices } from "./toolContext.js";
import type { SetCursorPositionArgs, SetCursorPositionResult, ToolError, VisibleRangeRequest } from "./types.js";
import { IsToolError } from "./types.js";
import { BuildWindowAroundLine1 } from "./visibleWindow.js";

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
            character: { type: "integer" },
          },
          required: ["mode", "file", "line"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            mode: { const: "relative" },
            lineDelta: { type: "integer" },
            character: { type: "integer" },
          },
          required: ["mode", "lineDelta"],
          additionalProperties: false,
        },
      ],
    },
    reveal: {
      type: "object",
      properties: {
        align: { enum: ["top", "center", "bottom", "nearest"] },
      },
      additionalProperties: false,
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

function MapRevealAlign(align: string | undefined): CursorRevealKind
{
  if (align === "top")
  {
    return "top";
  }

  if (align === "bottom")
  {
    return "bottom";
  }

  if (align === "nearest")
  {
    return "nearest";
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

function RecordFreshnessAfterSetCursor(
  services: ToolServices,
  relativePosix: string,
  returnReq: VisibleRangeRequest | undefined,
  result: SetCursorPositionResult,
): void
{
  services.freshness.markCursorObserved(relativePosix);
  if (returnReq !== undefined)
  {
    services.freshness.markViewportObserved(relativePosix);
    if (result.visibleRange !== undefined && result.visibleRange.lines.length > 0)
    {
      services.freshness.markFileObserved(relativePosix);
    }
  }
}

function EndAgentMutationDeferred(guard: { end: () => void }): void
{
  setImmediate(() =>
  {
    guard.end();
  });
}

export function CreateSetCursorPositionTool(
  services: ToolServices,
): ToolDefinition<SetCursorPositionArgs, SetCursorPositionResult | ToolError>
{
  return {
    name: "set_cursor_position",
    description: "Move the cursor to an absolute file/line or relative line delta, optionally revealing the viewport.",
    inputSchema: x_inputSchema,
    callback: async (rawArgs): Promise<SetCursorPositionResult | ToolError> =>
    {
      const args = rawArgs as SetCursorPositionArgs;
      const revealKind = MapRevealAlign(args.reveal?.align);
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
            editor.revealCursorAfterMove(0, 0, revealKind);
            const cursor1 = FromVscodePosition0(0, 0);
            const result: SetCursorPositionResult = {
              cursor: { file: doc.relativePosix, line: cursor1.line, character: cursor1.character },
            };
            if (returnReq !== undefined)
            {
              result.visibleRange = BuildWindowAroundLine1(
                doc,
                cursor1.line,
                cursor1.character,
                returnReq.linesAbove,
                returnReq.linesBelow,
              );
            }

            RecordFreshnessAfterSetCursor(services, doc.relativePosix, returnReq, result);
            return result;
          }

          const line1 = Math.min(Math.max(1, args.target.line), lineCount);
          const line0 = line1 - 1;
          const defaultChar = args.target.character ?? 0;
          const char0 = Math.min(Math.max(0, defaultChar), doc.lineTextAt0(line0).length);

          editor.revealCursorAfterMove(line0, char0, revealKind);
          const cursor1 = FromVscodePosition0(line0, char0);

          const result: SetCursorPositionResult = {
            cursor: { file: doc.relativePosix, line: cursor1.line, character: cursor1.character },
          };

          if (returnReq !== undefined)
          {
            result.visibleRange = BuildWindowAroundLine1(
              doc,
              cursor1.line,
              cursor1.character,
              returnReq.linesAbove,
              returnReq.linesBelow,
            );
          }

          RecordFreshnessAfterSetCursor(services, doc.relativePosix, returnReq, result);
          return result;
        }
        finally
        {
          EndAgentMutationDeferred(guard);
        }
      }

      const active = services.editorAccess.GetActiveEditor();
      if (active === undefined)
      {
        return { code: "no_active_editor", message: "No active text editor for relative move." };
      }

      if (!Number.isInteger(args.target.lineDelta))
      {
        return { code: "invalid_range", message: "`lineDelta` must be an integer." };
      }

      const guard = services.freshness.beginAgentMutation();
      try
      {
        const cur0 = active.getActivePosition0();
        const lineCount = active.document.lineCount;
        if (lineCount === 0)
        {
          active.revealCursorAfterMove(0, 0, revealKind);
          const cursor1 = FromVscodePosition0(0, 0);
          const result: SetCursorPositionResult = {
            cursor: { file: active.document.relativePosix, line: cursor1.line, character: cursor1.character },
          };
          if (returnReq !== undefined)
          {
            result.visibleRange = BuildWindowAroundLine1(
              active.document,
              cursor1.line,
              cursor1.character,
              returnReq.linesAbove,
              returnReq.linesBelow,
            );
          }

          RecordFreshnessAfterSetCursor(services, active.document.relativePosix, returnReq, result);
          return result;
        }

        const newLine0 = cur0.line + args.target.lineDelta;
        const clampedLine0 = Math.min(Math.max(0, newLine0), lineCount - 1);
        const defaultCharRel = args.target.character ?? cur0.character;
        const char0 = Math.min(Math.max(0, defaultCharRel), active.document.lineTextAt0(clampedLine0).length);

        active.revealCursorAfterMove(clampedLine0, char0, revealKind);
        const cursor1 = FromVscodePosition0(clampedLine0, char0);

        const result: SetCursorPositionResult = {
          cursor: { file: active.document.relativePosix, line: cursor1.line, character: cursor1.character },
        };

        if (returnReq !== undefined)
        {
          result.visibleRange = BuildWindowAroundLine1(
            active.document,
            cursor1.line,
            cursor1.character,
            returnReq.linesAbove,
            returnReq.linesBelow,
          );
        }

        RecordFreshnessAfterSetCursor(services, active.document.relativePosix, returnReq, result);
        return result;
      }
      finally
      {
        EndAgentMutationDeferred(guard);
      }
    },
  };
}
