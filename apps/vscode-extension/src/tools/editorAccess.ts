import * as vscode from "vscode";

import type { ActiveEditorHandle, CursorRevealKind, EditorAccess, OpenedTextDocument } from "./editorAccessTypes.js";
import { ResolveWorkspacePath, type ResolveWorkspacePathResult } from "./pathPolicy.js";
import type { ToolError } from "./types.js";

function LastVisibleLine0Inclusive(range: vscode.Range): number
{
  if (range.end.line === range.start.line)
  {
    return range.start.line;
  }

  if (range.end.character === 0)
  {
    return Math.max(range.start.line, range.end.line - 1);
  }

  return range.end.line;
}

function MapRevealKind(kind: CursorRevealKind): vscode.TextEditorRevealType
{
  if (kind === "top")
  {
    return vscode.TextEditorRevealType.AtTop;
  }

  if (kind === "center")
  {
    return vscode.TextEditorRevealType.InCenter;
  }

  if (kind === "nearest")
  {
    return vscode.TextEditorRevealType.Default;
  }

  if (kind === "bottom")
  {
    return vscode.TextEditorRevealType.InCenter;
  }

  return vscode.TextEditorRevealType.Default;
}

function WorkspaceRelativePosixForUri(uri: vscode.Uri): string
{
  return vscode.workspace.asRelativePath(uri, false).split("\\").join("/");
}

function WrapDocument(doc: vscode.TextDocument, relativePosix: string): OpenedTextDocument
{
  return {
    absPath: doc.uri.fsPath,
    relativePosix,
    languageId: doc.languageId,
    lineCount: doc.lineCount,
    lineTextAt0(lineIndex0: number): string
    {
      return doc.lineAt(lineIndex0).text;
    },
    getText(): string
    {
      return doc.getText();
    },
    positionIsValid0(line0: number, character0: number): boolean
    {
      if (line0 < 0 || line0 >= doc.lineCount)
      {
        return false;
      }

      if (character0 < 0)
      {
        return false;
      }

      const validated = doc.validatePosition(new vscode.Position(line0, character0));
      return validated.line === line0 && validated.character === character0;
    },
    offsetAt0(line0: number, character0: number): number
    {
      return doc.offsetAt(new vscode.Position(line0, character0));
    },
    lineEndCharacter0(line0: number): number
    {
      return doc.lineAt(line0).range.end.character;
    },
    getTextRange0(
      startLine0: number,
      startCharacter0: number,
      endLine0: number,
      endCharacter0: number,
    ): string
    {
      const start = new vscode.Position(startLine0, startCharacter0);
      const end = new vscode.Position(endLine0, endCharacter0);
      return doc.getText(new vscode.Range(start, end));
    },
  };
}

function WrapEditor(editor: vscode.TextEditor, relativePosix: string): ActiveEditorHandle
{
  const doc = editor.document;
  const opened: OpenedTextDocument = WrapDocument(doc, relativePosix);

  return {
    document: opened,
    getActivePosition0(): { line: number; character: number }
    {
      const p = editor.selection.active;
      return { line: p.line, character: p.character };
    },
    setActivePosition0(line: number, character: number): void
    {
      const pos = new vscode.Position(line, character);
      editor.selection = new vscode.Selection(pos, pos);
    },
    getViewportInclusive0(): { firstLine0: number; lastLine0: number }
    {
      const vr = editor.visibleRanges[0];
      if (vr === undefined)
      {
        const p = editor.selection.active;
        return { firstLine0: p.line, lastLine0: p.line };
      }

      return {
        firstLine0: vr.start.line,
        lastLine0: LastVisibleLine0Inclusive(vr),
      };
    },
    revealLinePreservingSelection(line0: number, reveal: CursorRevealKind): void
    {
      const pos = new vscode.Position(line0, 0);
      const range = new vscode.Range(pos, pos);
      if (reveal === "bottom")
      {
        const topLine = Math.max(0, line0 - 5);
        const topPos = new vscode.Position(topLine, 0);
        editor.revealRange(new vscode.Range(topPos, pos), vscode.TextEditorRevealType.AtTop);
        return;
      }

      editor.revealRange(range, MapRevealKind(reveal));
    },
    revealCursorAfterMove(line0: number, char0: number, reveal: CursorRevealKind): void
    {
      const pos = new vscode.Position(line0, char0);
      editor.selection = new vscode.Selection(pos, pos);
      if (reveal === "bottom")
      {
        const topLine = Math.max(0, line0 - 5);
        const topPos = new vscode.Position(topLine, 0);
        editor.revealRange(new vscode.Range(topPos, pos), vscode.TextEditorRevealType.AtTop);
        return;
      }

      editor.revealRange(new vscode.Range(pos, pos), MapRevealKind(reveal));
    },
  };
}

export function CreateVscodeEditorAccess(): EditorAccess
{
  const access: EditorAccess = {
    GetWorkspaceRoots(): string[]
    {
      const folders = vscode.workspace.workspaceFolders;
      if (folders === undefined || folders.length === 0)
      {
        return [];
      }

      return folders.map((f) => f.uri.fsPath);
    },

    ResolveWorkspacePathForTools(input: string): ResolveWorkspacePathResult
    {
      return ResolveWorkspacePath(input, access.GetWorkspaceRoots());
    },

    async Stat(absPath: string): Promise<{ kind: "file" | "directory"; size: number } | undefined>
    {
      const uri = vscode.Uri.file(absPath);
      try
      {
        const st = await vscode.workspace.fs.stat(uri);
        if (st.type === vscode.FileType.Directory)
        {
          return { kind: "directory", size: Number(st.size) };
        }

        return { kind: "file", size: Number(st.size) };
      }
      catch
      {
        return undefined;
      }
    },

    async OpenTextDocument(absPath: string, relativePosix: string): Promise<OpenedTextDocument | ToolError>
    {
      try
      {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(absPath));
        return WrapDocument(doc, relativePosix);
      }
      catch (error)
      {
        return {
          code: "unsupported_document",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async ReadDirectory(absPath: string): Promise<Array<{ name: string; kind: "file" | "directory" }>>
    {
      const uri = vscode.Uri.file(absPath);
      const entries = await vscode.workspace.fs.readDirectory(uri);
      return entries.map(([name, type]) => ({
        name,
        kind: type === vscode.FileType.Directory ? "directory" : "file",
      }));
    },

    async FindWorkspaceFiles(
      scope:
        | { type: "all_workspace"; includePattern: string }
        | { type: "under_root"; rootFsPath: string; includePatternRelativeToRoot: string },
      maxResults: number,
    ): Promise<string[]>
    {
      const limit = Math.max(1, maxResults);
      if (scope.type === "all_workspace")
      {
        const uris = await vscode.workspace.findFiles(scope.includePattern, undefined, limit);
        return uris.map((u) => u.fsPath);
      }

      const folder = vscode.workspace.workspaceFolders?.find((f) => f.uri.fsPath === scope.rootFsPath);
      const baseUri = folder !== undefined ? folder.uri : vscode.Uri.file(scope.rootFsPath);
      const pattern = new vscode.RelativePattern(baseUri, scope.includePatternRelativeToRoot);
      const uris = await vscode.workspace.findFiles(pattern, undefined, limit);
      return uris.map((u) => u.fsPath);
    },

    GetActiveEditor(): ActiveEditorHandle | undefined
    {
      const ed = vscode.window.activeTextEditor;
      if (ed === undefined)
      {
        return undefined;
      }

      return WrapEditor(ed, WorkspaceRelativePosixForUri(ed.document.uri));
    },

    async OpenEditorAndFocus(
      absPath: string,
      relativePosix: string,
      preserveFocus: boolean,
    ): Promise<ActiveEditorHandle | ToolError>
    {
      try
      {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(absPath));
        const editor = await vscode.window.showTextDocument(doc, { preview: false, preserveFocus });
        return WrapEditor(editor, relativePosix);
      }
      catch (error)
      {
        return {
          code: "unsupported_document",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async ReplaceTextRange(
      absPath: string,
      relativePosix: string,
      range: {
        startLine0: number;
        startCharacter0: number;
        endLine0: number;
        endCharacter0: number;
      },
      replacementText: string,
    ): Promise<{ accepted: true } | ToolError>
    {
      void relativePosix;

      try
      {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(absPath));
        const opened = WrapDocument(doc, relativePosix);

        if (
          !opened.positionIsValid0(range.startLine0, range.startCharacter0)
          || !opened.positionIsValid0(range.endLine0, range.endCharacter0)
        )
        {
          return {
            code: "invalid_position",
            message: "Start or end position is outside the document buffer.",
            details: {
              file: relativePosix,
              startLine0: range.startLine0,
              startCharacter0: range.startCharacter0,
              endLine0: range.endLine0,
              endCharacter0: range.endCharacter0,
            },
          };
        }

        const startOffset = opened.offsetAt0(range.startLine0, range.startCharacter0);
        const endOffset = opened.offsetAt0(range.endLine0, range.endCharacter0);
        if (startOffset > endOffset)
        {
          return {
            code: "invalid_position",
            message: "Start position must be before or equal to the end position.",
            details: {
              file: relativePosix,
              startLine0: range.startLine0,
              startCharacter0: range.startCharacter0,
              endLine0: range.endLine0,
              endCharacter0: range.endCharacter0,
            },
          };
        }

        const edit = new vscode.WorkspaceEdit();
        const start = new vscode.Position(range.startLine0, range.startCharacter0);
        const end = new vscode.Position(range.endLine0, range.endCharacter0);
        edit.replace(doc.uri, new vscode.Range(start, end), replacementText);
        const accepted = await vscode.workspace.applyEdit(edit);
        if (!accepted)
        {
          return {
            code: "edit_rejected",
            message: "VS Code rejected the buffer edit.",
            details: { file: relativePosix },
          };
        }

        return { accepted: true };
      }
      catch (error)
      {
        return {
          code: "unsupported_document",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };

  return access;
}
