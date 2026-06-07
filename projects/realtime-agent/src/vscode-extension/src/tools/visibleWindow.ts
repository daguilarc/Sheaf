import type { OpenedTextDocument } from "./editorAccessTypes.js";
import type { CodeLine, VisibleRangeResult } from "./types.js";

export function ClampCharacter0OnLine(doc: OpenedTextDocument, line0: number, character0: number): number
{
  const text = doc.lineTextAt0(line0);
  return Math.min(Math.max(0, character0), text.length);
}

export function BuildWindowAroundLine1(
  doc: OpenedTextDocument,
  centerLine1: number,
  cursorCharacter0: number,
  linesAbove: number,
  linesBelow: number,
): VisibleRangeResult
{
  const n = doc.lineCount;
  if (n === 0)
  {
    return {
      file: doc.relativePosix,
      cursor: { file: doc.relativePosix, line: 0, character: 0 },
      visibleStartLine: 0,
      visibleEndLine: 0,
      lines: [],
    };
  }

  const center0 = Math.min(Math.max(centerLine1 - 1, 0), n - 1);
  const ch = ClampCharacter0OnLine(doc, center0, cursorCharacter0);
  const start0 = Math.max(0, center0 - linesAbove);
  const end0 = Math.min(n - 1, center0 + linesBelow);
  const lines: CodeLine[] = [];
  for (let i = start0; i <= end0; i++)
  {
    lines.push({ line: i + 1, text: doc.lineTextAt0(i) });
  }

  return {
    file: doc.relativePosix,
    cursor: { file: doc.relativePosix, line: center0 + 1, character: ch },
    visibleStartLine: start0 + 1,
    visibleEndLine: end0 + 1,
    lines,
  };
}

export function BuildLinesForInclusiveLineRange1(
  doc: OpenedTextDocument,
  startLine1: number,
  endLine1: number,
  cursorLine1: number,
  cursorCharacter0: number,
): VisibleRangeResult
{
  const n = doc.lineCount;
  if (n === 0)
  {
    return {
      file: doc.relativePosix,
      cursor: { file: doc.relativePosix, line: cursorLine1, character: cursorCharacter0 },
      visibleStartLine: 0,
      visibleEndLine: 0,
      lines: [],
    };
  }

  const start0 = Math.min(Math.max(startLine1 - 1, 0), n - 1);
  const end0 = Math.min(Math.max(endLine1 - 1, 0), n - 1);
  const lo = Math.min(start0, end0);
  const hi = Math.max(start0, end0);
  const lines: CodeLine[] = [];
  for (let i = lo; i <= hi; i++)
  {
    lines.push({ line: i + 1, text: doc.lineTextAt0(i) });
  }

  const cur0 = Math.min(Math.max(cursorLine1 - 1, 0), n - 1);
  const ch = ClampCharacter0OnLine(doc, cur0, cursorCharacter0);

  return {
    file: doc.relativePosix,
    cursor: { file: doc.relativePosix, line: cur0 + 1, character: ch },
    visibleStartLine: lo + 1,
    visibleEndLine: hi + 1,
    lines,
  };
}
