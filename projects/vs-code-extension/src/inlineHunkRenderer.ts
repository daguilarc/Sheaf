import * as vscode from "vscode";

import type { PaneState } from "./types.js";
import type { VirtualHunkDocument } from "./virtualHunkDocument.js";

export class InlineHunkRenderer implements vscode.Disposable
{
  private readonly added = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: "rgba(63, 185, 80, 0.14)",
  });
  private readonly currentAdded = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: "rgba(63, 185, 80, 0.34)",
    border: "1px solid rgba(63, 185, 80, 0.75)",
    overviewRulerColor: "rgba(63, 185, 80, 0.95)",
    overviewRulerLane: vscode.OverviewRulerLane.Right,
  });
  private readonly deleted = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: "rgba(248, 81, 73, 0.14)",
  });
  private readonly currentDeleted = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: "rgba(248, 81, 73, 0.34)",
    border: "1px solid rgba(248, 81, 73, 0.75)",
    overviewRulerColor: "rgba(248, 81, 73, 0.95)",
    overviewRulerLane: vscode.OverviewRulerLane.Right,
  });
  private readonly currentBoundary = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    border: "1px solid rgba(255, 255, 255, 0.35)",
    overviewRulerColor: "rgba(255, 255, 255, 0.7)",
    overviewRulerLane: vscode.OverviewRulerLane.Right,
  });
  private previousEditor: vscode.TextEditor | undefined;

  render(editor: vscode.TextEditor | undefined, state: PaneState, document: VirtualHunkDocument | null): void
  {
    if (editor === undefined || document === null || !state.paneOpen || state.currentHunk === null)
    {
      this.clear();
      return;
    }

    if (this.previousEditor !== undefined && this.previousEditor !== editor)
    {
      this.clearEditor(this.previousEditor);
    }
    this.previousEditor = editor;

    const added = RowRanges(editor, document, "added", false, state.currentHunkId);
    const currentAdded = RowRanges(editor, document, "added", true, state.currentHunkId);
    const deleted = RowRanges(editor, document, "deleted", false, state.currentHunkId);
    const currentDeleted = RowRanges(editor, document, "deleted", true, state.currentHunkId);
    const boundaries = BoundaryRanges(editor, document, state.currentHunkId);
    editor.setDecorations(this.added, added);
    editor.setDecorations(this.currentAdded, currentAdded);
    editor.setDecorations(this.deleted, deleted);
    editor.setDecorations(this.currentDeleted, currentDeleted);
    editor.setDecorations(this.currentBoundary, boundaries);
  }

  clear(): void
  {
    if (this.previousEditor !== undefined)
    {
      this.clearEditor(this.previousEditor);
      this.previousEditor = undefined;
    }
  }

  dispose(): void
  {
    this.clear();
    this.added.dispose();
    this.currentAdded.dispose();
    this.deleted.dispose();
    this.currentDeleted.dispose();
    this.currentBoundary.dispose();
  }

  private clearEditor(editor: vscode.TextEditor): void
  {
    editor.setDecorations(this.added, []);
    editor.setDecorations(this.currentAdded, []);
    editor.setDecorations(this.deleted, []);
    editor.setDecorations(this.currentDeleted, []);
    editor.setDecorations(this.currentBoundary, []);
  }
}

function RowRanges(editor: vscode.TextEditor, document: VirtualHunkDocument, kind: "added" | "deleted", current: boolean, currentHunkId: string | null): vscode.Range[]
{
  return document.rows
    .filter((row) => row.kind === kind && (row.hunkId === currentHunkId) === current)
    .map((row) => WholeLineRange(editor, row.virtualLine));
}

function BoundaryRanges(editor: vscode.TextEditor, document: VirtualHunkDocument, currentHunkId: string | null): vscode.Range[]
{
  if (currentHunkId === null)
  {
    return [];
  }
  const span = document.hunks.find((hunk) => hunk.hunkId === currentHunkId);
  if (span === undefined)
  {
    return [];
  }
  return [new vscode.Range(
    ClampLine(editor, span.virtualStartLine),
    0,
    ClampLine(editor, Math.max(span.virtualStartLine, span.virtualEndLineExclusive - 1)),
    Number.MAX_SAFE_INTEGER,
  )];
}

function WholeLineRange(editor: vscode.TextEditor, line: number): vscode.Range
{
  const clamped = ClampLine(editor, line);
  return new vscode.Range(clamped, 0, clamped, Number.MAX_SAFE_INTEGER);
}

function ClampLine(editor: vscode.TextEditor, line: number): number
{
  return Math.max(0, Math.min(line, Math.max(0, editor.document.lineCount - 1)));
}
