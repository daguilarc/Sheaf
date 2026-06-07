import * as vscode from "vscode";

export interface VscodeFreshnessHost
{
  onDidChangeTextDocument(listener: (e: vscode.TextDocumentChangeEvent) => void): vscode.Disposable;
  onDidChangeActiveTextEditor(listener: (e: vscode.TextEditor | undefined) => void): vscode.Disposable;
  onDidChangeTextEditorVisibleRanges(
    listener: (e: vscode.TextEditorVisibleRangesChangeEvent) => void,
  ): vscode.Disposable;
  onDidChangeTextEditorSelection(listener: (e: vscode.TextEditorSelectionChangeEvent) => void): vscode.Disposable;
  getActiveTextEditor(): vscode.TextEditor | undefined;
  getWorkspaceRoots(): string[];
}

export function CreateDefaultVscodeFreshnessHost(): VscodeFreshnessHost
{
  return {
    onDidChangeTextDocument: (listener) => vscode.workspace.onDidChangeTextDocument(listener),
    onDidChangeActiveTextEditor: (listener) => vscode.window.onDidChangeActiveTextEditor(listener),
    onDidChangeTextEditorVisibleRanges: (listener) => vscode.window.onDidChangeTextEditorVisibleRanges(listener),
    onDidChangeTextEditorSelection: (listener) => vscode.window.onDidChangeTextEditorSelection(listener),
    getActiveTextEditor: () => vscode.window.activeTextEditor,
    getWorkspaceRoots: () =>
    {
      const folders = vscode.workspace.workspaceFolders;
      if (folders === undefined || folders.length === 0)
      {
        return [];
      }

      return folders.map((f) => f.uri.fsPath);
    },
  };
}
