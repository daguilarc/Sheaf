// Shared tool argument/result types (Spec 02) and ToolError.
//
// Tool callbacks must return JSON-serializable values. On validation or domain
// failures, return a ToolError object — do not throw. Thrown errors become
// realtime-agent `callback_failed` payloads and lose structured `code` values.
//

import type { AgentMutationGuard, FreshnessHooks } from "../freshness/types.js";

export type { AgentMutationGuard, FreshnessHooks };

export interface CodePosition
{
  file: string;
  line: number;
  character: number;
}

export interface CodeRange
{
  file: string;
  startLine: number;
  endLine: number;
}

export interface CodeLine
{
  line: number;
  text: string;
}

export interface VisibleRangeResult
{
  file: string;
  cursor: CodePosition;
  visibleStartLine: number;
  visibleEndLine: number;
  lines: CodeLine[];
}

export interface ToolError
{
  code:
    | "no_active_editor"
    | "file_not_found"
    | "path_outside_workspace"
    | "path_is_directory"
    | "binary_file"
    | "invalid_pattern"
    | "invalid_range"
    | "too_many_results"
    | "unsupported_document"
    | "invalid_position"
    | "file_mismatch"
    | "expected_text_mismatch"
    | "context_before_mismatch"
    | "context_after_mismatch"
    | "edit_rejected";
  message: string;
  details?: Record<string, unknown>;
}

export function IsToolError(value: unknown): value is ToolError
{
  if (value === null || typeof value !== "object")
  {
    return false;
  }

  const record = value as Record<string, unknown>;
  return typeof record.code === "string" && typeof record.message === "string";
}

export interface CodeReadArgs
{
  file: string;
  startLine?: number;
  endLine?: number;
}

export interface CodeReadResult
{
  file: string;
  lineCount: number;
  startLine: number;
  endLine: number;
  lines: CodeLine[];
}

export interface ListFilesArgs
{
  directory: string;
  recursive?: boolean;
  includeHidden?: boolean;
  maxEntries?: number;
}

export interface FileEntry
{
  path: string;
  kind: "file" | "directory";
}

export interface ListFilesResult
{
  directory: string;
  recursive: boolean;
  truncated: boolean;
  entries: FileEntry[];
}

export interface RgrepArgs
{
  pattern: string;
  directory?: string;
  fileGlob?: string;
  caseSensitive?: boolean;
  maxMatches?: number;
  contextLinesBefore?: number;
  contextLinesAfter?: number;
}

export interface RgrepMatch
{
  file: string;
  line: number;
  character: number;
  text: string;
  matchText: string;
  contextBefore?: CodeLine[];
  contextAfter?: CodeLine[];
}

export interface RgrepResult
{
  pattern: string;
  directory?: string;
  fileGlob?: string;
  truncated: boolean;
  matches: RgrepMatch[];
}

export interface ReadVisibleRangeArgs
{
  linesAbove: number;
  linesBelow: number;
}

export interface ReadVisibleRangeResult extends VisibleRangeResult
{
  requestedLinesAbove: number;
  requestedLinesBelow: number;
}

export type CursorMoveTarget =
  | {
      mode: "absolute";
      file: string;
      line: number;
      character?: number;
    }
  | {
      mode: "relative";
      lineDelta: number;
      character?: number;
    };

export interface CursorRevealOptions
{
  align?: "top" | "center" | "bottom" | "nearest";
}

export interface VisibleRangeRequest
{
  linesAbove: number;
  linesBelow: number;
}

export interface SetCursorPositionArgs
{
  target: CursorMoveTarget;
  reveal?: CursorRevealOptions;
  returnVisibleRange?: VisibleRangeRequest;
}

export interface SetCursorPositionResult
{
  cursor: CodePosition;
  visibleRange?: VisibleRangeResult;
}

export type ViewportMoveTarget =
  | {
      mode: "absolute";
      file: string;
      line: number;
      align?: "top" | "center" | "bottom";
    }
  | {
      mode: "relative";
      lineDelta: number;
    };

export interface MoveVisibleRangeArgs
{
  target: ViewportMoveTarget;
  returnVisibleRange?: VisibleRangeRequest;
}

export interface MoveVisibleRangeResult
{
  cursor: CodePosition;
  visibleRange?: VisibleRangeResult;
}

export interface ModifyFileArgs
{
  start: CodePosition;
  end: CodePosition;
  exactText: string;
  replacementText: string;
  contextBeforeText: string;
  contextAfterText: string;
}

export interface ModifyFileResult
{
  file: string;
  start: CodePosition;
  end: CodePosition;
  insertedText: string;
  replacedText: string;
}

export const NoOpFreshnessHooks: FreshnessHooks = {
  markFileObserved() {},
  markViewportObserved() {},
  markCursorObserved() {},
  beginAgentMutation: () => ({ end: () => {} }),
};
