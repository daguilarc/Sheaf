import * as vscode from "vscode";

import {
  BuildVirtualHunkDocument,
  HunkIdToVirtualSpan,
  ParseVirtualUri,
  type VirtualHunkDocument,
  VIRTUAL_HUNK_SCHEME,
} from "./virtualHunkDocument.js";
import type { PaneState } from "./types.js";

export class VirtualHunkProvider implements vscode.TextDocumentContentProvider, vscode.Disposable
{
  private readonly changedEmitter = new vscode.EventEmitter<vscode.Uri>();
  private readonly documents = new Map<string, VirtualHunkDocument>();

  readonly onDidChange = this.changedEmitter.event;

  provideTextDocumentContent(uri: vscode.Uri): string
  {
    return this.documents.get(uri.toString())?.text ?? "";
  }

  async render(state: PaneState): Promise<{ document: VirtualHunkDocument; editor: vscode.TextEditor }>
  {
    if (state.repoRoot === null || state.file === null)
    {
      throw new Error("No active hunk file.");
    }
    const realUri = vscode.Uri.file(`${state.repoRoot}/${state.file}`);
    const languageId = await SourceLanguageId(realUri);
    const realBytes = await vscode.workspace.fs.readFile(realUri);
    const realText = Buffer.from(realBytes).toString("utf8");
    const document = BuildVirtualHunkDocument(state.repoRoot, state.file, realText, state.hunks);
    const uri = vscode.Uri.parse(document.uri);
    const previous = this.documents.get(uri.toString());
    this.documents.set(uri.toString(), document);
    const alreadyOpen = vscode.workspace.textDocuments.some((textDocument) => textDocument.uri.toString() === uri.toString());
    if (alreadyOpen && previous?.text !== document.text)
    {
      this.changedEmitter.fire(uri);
      await NextTick();
    }
    let textDocument = await vscode.workspace.openTextDocument(uri);
    if (languageId !== null && textDocument.languageId !== languageId)
    {
      textDocument = await vscode.languages.setTextDocumentLanguage(textDocument, languageId);
    }
    const editor = await vscode.window.showTextDocument(textDocument, { preview: false, preserveFocus: false });
    return { document, editor };
  }

  getDocument(uri: vscode.Uri): VirtualHunkDocument | null
  {
    return this.documents.get(uri.toString()) ?? null;
  }

  getIdentity(uri: vscode.Uri)
  {
    return ParseVirtualUri(uri.toString());
  }

  revealCurrentHunk(editor: vscode.TextEditor, document: VirtualHunkDocument, state: PaneState): void
  {
    if (state.currentHunkId === null)
    {
      return;
    }
    const span = HunkIdToVirtualSpan(document, state.currentHunkId);
    if (span === null)
    {
      return;
    }
    const start = Math.max(0, span.virtualStartLine);
    const end = Math.max(start, span.virtualEndLineExclusive - 1);
    editor.revealRange(new vscode.Range(start, 0, end, 0), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  dispose(): void
  {
    this.changedEmitter.dispose();
    this.documents.clear();
  }
}

export function RegisterVirtualHunkProvider(context: vscode.ExtensionContext, provider: VirtualHunkProvider): void
{
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(VIRTUAL_HUNK_SCHEME, provider));
}

async function SourceLanguageId(uri: vscode.Uri): Promise<string | null>
{
  try
  {
    const document = await vscode.workspace.openTextDocument(uri);
    return document.languageId;
  }
  catch (error)
  {
    void error;
    return null;
  }
}

function NextTick(): Promise<void>
{
  return new Promise((resolve) => setTimeout(resolve, 0));
}
