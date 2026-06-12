import * as vscode from "vscode";

import type { HunkAction, PaneState } from "./types.js";

export class HunkPane
{
  private panel: vscode.WebviewPanel | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly onAction: (action: HunkAction) => void,
  )
  {
  }

  show(state: PaneState): void
  {
    if (this.panel === undefined)
    {
      this.panel = vscode.window.createWebviewPanel(
        "sheafUnstagedHunks",
        "Unstaged Hunk",
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "out", "webview")],
          retainContextWhenHidden: true,
        },
      );
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });
      this.panel.webview.onDidReceiveMessage((message: { type?: string; action?: HunkAction }) => {
        if (message.type === "action" && message.action !== undefined)
        {
          this.onAction(message.action);
        }
      });
      this.panel.webview.html = this.html(this.panel.webview);
    }

    this.panel.reveal(vscode.ViewColumn.Beside, true);
    this.postState(state);
  }

  hide(state: PaneState): void
  {
    this.postState(state);
    this.panel?.dispose();
    this.panel = undefined;
  }

  postState(state: PaneState): void
  {
    void this.panel?.webview.postMessage({ type: "state", state });
  }

  private html(webview: vscode.Webview): string
  {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "out", "webview", "index.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "out", "webview", "index.css"));
    const nonce = Math.random().toString(36).slice(2);
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${styleUri}">
  <title>Unstaged Hunk</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
