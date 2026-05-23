import type { ResolveWorkspacePathResult } from "./pathPolicy.js";
import type { ToolError } from "./types.js";

export interface OpenedTextDocument
{
  absPath: string;
  relativePosix: string;
  languageId: string;
  lineCount: number;
  lineTextAt0(lineIndex0: number): string;
  getText(): string;
}

export type CursorRevealKind = "default" | "center" | "top" | "bottom" | "nearest";

export interface ActiveEditorHandle
{
  readonly document: OpenedTextDocument;
  getActivePosition0(): { line: number; character: number };
  setActivePosition0(line: number, character: number): void;
  getViewportInclusive0(): { firstLine0: number; lastLine0: number };
  revealLinePreservingSelection(line0: number, reveal: CursorRevealKind): void;
  revealCursorAfterMove(line0: number, char0: number, reveal: CursorRevealKind): void;
}

export interface EditorAccess
{
  GetWorkspaceRoots(): string[];
  ResolveWorkspacePathForTools(input: string): ResolveWorkspacePathResult;
  Stat(absPath: string): Promise<{ kind: "file" | "directory"; size: number } | undefined>;
  OpenTextDocument(absPath: string, relativePosix: string): Promise<OpenedTextDocument | ToolError>;
  ReadDirectory(absPath: string): Promise<Array<{ name: string; kind: "file" | "directory" }>>;
  FindWorkspaceFiles(
    scope:
      | { type: "all_workspace"; includePattern: string }
      | { type: "under_root"; rootFsPath: string; includePatternRelativeToRoot: string },
    maxResults: number,
  ): Promise<string[]>;
  GetActiveEditor(): ActiveEditorHandle | undefined;
  OpenEditorAndFocus(
    absPath: string,
    relativePosix: string,
    preserveFocus: boolean,
  ): Promise<ActiveEditorHandle | ToolError>;
}
