import * as nodePath from "node:path";

import type * as vscode from "vscode";

import type { VscodeFreshnessHost } from "../../src/freshness/vscodeFreshnessHost.js";

export interface FakeTextDocumentLike
{
  uri: vscode.Uri;
  languageId: string;
}

export interface FakeTextEditorLike
{
  document: FakeTextDocumentLike;
}

function ToPosix(p: string): string
{
  return p.split(nodePath.sep).join("/");
}

export class FakeVscodeFreshnessHost implements VscodeFreshnessHost
{
  private readonly m_workspaceRootFs: string;
  private m_activeEditor: FakeTextEditorLike | undefined;
  private readonly m_textDoc = new Set<(e: vscode.TextDocumentChangeEvent) => void>();
  private readonly m_active = new Set<(e: vscode.TextEditor | undefined) => void>();
  private readonly m_visible = new Set<(e: vscode.TextEditorVisibleRangesChangeEvent) => void>();
  private readonly m_selection = new Set<(e: vscode.TextEditorSelectionChangeEvent) => void>();

  constructor(workspaceRootFs: string)
  {
    this.m_workspaceRootFs = workspaceRootFs;
  }

  setActiveEditor(editor: FakeTextEditorLike | undefined): void
  {
    this.m_activeEditor = editor;
  }

  getActiveEditorForTest(): FakeTextEditorLike | undefined
  {
    return this.m_activeEditor;
  }

  makeFileUri(relativePosix: string): vscode.Uri
  {
    const abs = nodePath.join(this.m_workspaceRootFs, relativePosix.split("/").join(nodePath.sep));
    return { scheme: "file", fsPath: abs, path: abs } as vscode.Uri;
  }

  makeDocument(relativePosix: string, languageId: string): FakeTextDocumentLike
  {
    return {
      uri: this.makeFileUri(relativePosix),
      languageId,
    };
  }

  makeEditor(relativePosix: string, languageId = "typescript"): FakeTextEditorLike
  {
    return {
      document: this.makeDocument(relativePosix, languageId),
    };
  }

  onDidChangeTextDocument(listener: (e: vscode.TextDocumentChangeEvent) => void): vscode.Disposable
  {
    this.m_textDoc.add(listener);
    return {
      dispose: () =>
      {
        this.m_textDoc.delete(listener);
      },
    };
  }

  onDidChangeActiveTextEditor(listener: (e: vscode.TextEditor | undefined) => void): vscode.Disposable
  {
    this.m_active.add(listener);
    return {
      dispose: () =>
      {
        this.m_active.delete(listener);
      },
    };
  }

  onDidChangeTextEditorVisibleRanges(
    listener: (e: vscode.TextEditorVisibleRangesChangeEvent) => void,
  ): vscode.Disposable
  {
    this.m_visible.add(listener);
    return {
      dispose: () =>
      {
        this.m_visible.delete(listener);
      },
    };
  }

  onDidChangeTextEditorSelection(listener: (e: vscode.TextEditorSelectionChangeEvent) => void): vscode.Disposable
  {
    this.m_selection.add(listener);
    return {
      dispose: () =>
      {
        this.m_selection.delete(listener);
      },
    };
  }

  getActiveTextEditor(): vscode.TextEditor | undefined
  {
    return this.m_activeEditor as vscode.TextEditor | undefined;
  }

  asRelativePath(uri: vscode.Uri): string
  {
    const abs = ToPosix(uri.fsPath);
    const root = ToPosix(this.m_workspaceRootFs);
    if (abs === root)
    {
      return ".";
    }

    const prefix = root.endsWith("/") ? root : `${root}/`;
    if (!abs.startsWith(prefix))
    {
      return "";
    }

    return abs.slice(prefix.length);
  }

  fireDidChangeTextDocument(doc: FakeTextDocumentLike): void
  {
    const e = { document: doc } as vscode.TextDocumentChangeEvent;
    for (const l of this.m_textDoc)
    {
      l(e);
    }
  }

  fireDidChangeActiveTextEditor(editor: FakeTextEditorLike | undefined): void
  {
    this.m_activeEditor = editor;
    for (const l of this.m_active)
    {
      l(editor as vscode.TextEditor | undefined);
    }
  }

  fireDidChangeTextEditorVisibleRanges(editor: FakeTextEditorLike): void
  {
    const e = { textEditor: editor } as vscode.TextEditorVisibleRangesChangeEvent;
    for (const l of this.m_visible)
    {
      l(e);
    }
  }

  fireDidChangeTextEditorSelection(editor: FakeTextEditorLike): void
  {
    const e = { textEditor: editor } as vscode.TextEditorSelectionChangeEvent;
    for (const l of this.m_selection)
    {
      l(e);
    }
  }
}
